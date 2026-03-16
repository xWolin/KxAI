# ADR-001: Autonomy Queue & Task Handoff

**Status:** Proposed
**Date:** 2026-03-16
**Authors:** claude-g
**Reviewers:** codex-2, gemini, Wolin

---

## Context

KxAI's `CortexEngine.think()` generates autonomous thoughts and executes tools in the same synchronous cycle. This creates several bottlenecks:

### Current Architecture Gaps

| Gap | Location | Impact |
|-----|----------|--------|
| **Skip-not-queue** | `cortex-engine.ts:726,736` | When agent is processing user message OR think already running → current thought is silently dropped. No retry, no persistence. |
| **No think→agent handoff** | — | `think()` calls tools directly in-band. It cannot queue a multi-step task for `AgentLoop` to run later (e.g. "write report and send email"). |
| **Shallow anti-repeat** | `observationHistory` (scene-level only) | Repeated topics/decisions within same session are not deduplicated. Agent can propose same optimization every cycle. |
| **AFK tasks reset on restart** | `afkTasksDone` Set (in-memory) | Tasks re-run every session start. No awareness of what was done in previous sessions. |
| **Think ↔ AgentLoop decoupled** | `main.ts` wire | Cortex knows only `isProcessing` boolean. AgentLoop doesn't know what Cortex last decided. No shared state. |
| **No observability** | — | No metrics for: queue depth, think latency, drop reasons, task completion rate. |

### What Makes Autonomous Agents Work Well

From analysis of OpenClaw and general patterns:
1. **Persistent goal store** — goals survive restarts, have priority, TTL, and completion status
2. **Event-driven wake-up** — agent reacts to events (cron, notifications, user return) not just timers
3. **Think → queue → execute separation** — reflection produces tasks, tasks go into queue, executor runs them
4. **Topic-scoped deduplication** — recent thoughts tracked by topic hash with TTL, not just visual scene
5. **Backpressure** — queue has capacity limits; low-priority items are dropped, not stacked

---

## Decision

Implement autonomy improvements in **3 small, independently-reviewable PRs**. No big-bang rewrite.

---

## Phase 1 — ThinkQueue + Skip → Enqueue

**Goal:** Stop dropping thoughts. When `think()` would skip (agent busy), enqueue the trigger instead.

### Component: `ThinkQueue`

```typescript
interface ThinkTrigger {
  id: string;
  reason: 'timer' | 'cron_event' | 'user_return' | 'manual';
  priority: 'high' | 'normal' | 'low';
  enqueuedAt: number;
  payload?: string; // optional context hint
}

class ThinkQueue {
  private queue: ThinkTrigger[] = [];
  private static readonly MAX_SIZE = 5;

  enqueue(trigger: ThinkTrigger): void {
    // Backpressure: drop lowest-priority if full
    if (this.queue.length >= ThinkQueue.MAX_SIZE) {
      const lowestIdx = findLowestPriorityIndex(this.queue);
      this.queue.splice(lowestIdx, 1);
    }
    this.queue.push(trigger);
  }

  dequeue(): ThinkTrigger | null { ... }
  depth(): number { return this.queue.length; }
  dropReasons(): Record<string, number> { ... }
}
```

**Changes to `cortex-engine.ts`:**
- Replace skip-return with `thinkQueue.enqueue(trigger)` when agent is busy
- After each `AgentLoop` message processed → drain queue (process 1 queued think)
- Metrics: emit `think:queued`, `think:dropped`, `think:drained` events

**Arbitration with user chat:**
- `isProcessingCheck()` = true → enqueue (do NOT execute think while user is typing)
- Queue is drained AFTER user message fully processed (response sent)
- AFK mode bypasses queue — `afkThink()` runs directly (no user to conflict with)

**Failure modes:**
- Queue full + all same priority → oldest item dropped, metric incremented
- Agent crashes with items in queue → items lost (queue is in-memory, Phase 3 can persist)
- Think cycle errors → item removed from queue, error logged, next item processed

### Tests (required for gate):
- `ThinkQueue` unit: enqueue, dequeue, backpressure drop, priority ordering
- `CortexEngine` integration: verify `think()` enqueues when `isProcessingCheck=true` instead of skipping
- `CortexEngine` integration: verify queue drains after processing mock user message
- Metrics: `think:queued` event emitted on enqueue

---

## Phase 2 — PersistentTaskService + Think→Agent Handoff

**Goal:** `think()` can spawn multi-step tasks that AgentLoop executes silently.

### Component: `PersistentTaskService`

```typescript
interface AutonomousTask {
  id: string;
  title: string;
  instruction: string; // what the agent should do
  priority: 'critical' | 'high' | 'normal' | 'low';
  source: 'think' | 'reflection' | 'cron' | 'user';
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  ttlMs?: number; // auto-expire stale tasks
  sessionId?: string; // which session created this
  result?: string;
}

class PersistentTaskService {
  // Persisted to disk (JSON) — survives restarts
  async enqueue(task: Omit<AutonomousTask, 'id' | 'createdAt' | 'status'>): Promise<string>
  async claim(maxAge?: number): Promise<AutonomousTask | null>
  async complete(id: string, result: string): Promise<void>
  async fail(id: string, error: string): Promise<void>
  getPending(): AutonomousTask[]
  getMetrics(): { depth: number; avgLatencyMs: number; failureRate: number }
}
```

**Handoff from think():**

When `runNativeToolLoop` returns a response that contains a structured task proposal (e.g. `## TASK: ...` block), CortexEngine creates a `PersistentTask` instead of executing immediately.

**AgentLoop integration:**
- After user message done AND queue empty → check `PersistentTaskService.claim()`
- Execute claimed task via `runNativeToolLoop` with `source: 'autonomous'`
- Result stored back in task (not shown to user unless task emits notification)
- Arbitration: user starts typing mid-task → pause task, re-enqueue as pending

**Topic deduplication (anti-repeat):**
- Task title hashed (topic hash): before enqueue, check if same topic hash exists in pending/done within TTL (default 2h)
- If duplicate → skip enqueue, log reason
- Tracks last 20 topic hashes with timestamps (stored in `PersistentTaskService`)

**Failure modes:**
- Task claims but AgentLoop is busy → re-enqueue with backoff
- Task TTL expired before execution → mark `cancelled`, log
- Think loop produces no task → no enqueue (normal operation)
- Disk write fails → task lost, error logged, fallback to in-memory

### Tests (required for gate):
- `PersistentTaskService` unit: enqueue, claim, complete, fail, TTL expiry
- Topic dedup: same topic within TTL → not enqueued; different topic → enqueued
- AgentLoop integration: task claimed and executed after user message done
- Arbitration: user message during task execution → task paused, re-enqueued
- Metrics: `task:enqueued`, `task:claimed`, `task:completed`, `task:dedup_skip`

---

## Phase 3 — Persistent AFK Tasks + Reflection Memory + Observability

**Goal:** AFK tasks persist across sessions; reflection remembers what it analyzed; metrics dashboard.

### 3a. Persistent AFK completion state

Currently `afkTasksDone: Set<string>` is in-memory — cleared on restart.

**Fix:** Store AFK task completion in `PersistentTaskService` (from Phase 2):
- Before running AFK task: check if task was completed in this session AND in last N hours from disk
- Mark tasks with `source: 'afk'` + `sessionId`

### 3b. Reflection memory (topic dedup)

Currently `reflectionHistory` is 5 in-memory summaries. Add topic hash index to disk:
- Hash: `sha256(sorted(topTopics, date))` → if identical to last reflection → skip
- Already done via `contextHash` (cortex-engine.ts:1021) but not persisted across restarts

### 3c. Observability metrics

Emit structured metrics via existing `WorkflowMonitor` or new `CortexMetrics`:
```
think:queued { reason, priority }
think:dropped { reason: 'backpressure' | 'max_size', droppedPriority }
think:drained { waitMs }
task:enqueued { source, priority }
task:dedup_skip { topic, lastSeenMs }
task:claimed { queueDepth }
task:completed { latencyMs }
task:failed { error }
```

UI: surface `CortexMetrics` in the Cortex status panel (already has activity display).

### Tests:
- AFK task: completes in session, restart → not re-run within TTL
- Reflection: same context hash → skip (across restarts)
- Metrics: all events emitted with correct payload
- Coverage gate: ≥30%

---

## Component Boundary Summary

```
User Message
    │
    ▼
AgentLoop.processMessage()
    │ ── sets isProcessing=true ──►  CortexEngine checks → enqueues in ThinkQueue
    │                                (no think during user message)
    │ ── response sent ──────────►  ThinkQueue.drain() → think() runs
    │                                think() may → PersistentTaskService.enqueue(task)
    ▼
AgentLoop idle
    │ ── polls PersistentTaskService.claim() ──► executes task silently
    │                                            result stored, notification optional
    ▼
CronService fires
    │ ── cortexEngine.pushEvent() ──► ThinkQueue.enqueue({ reason: 'cron_event', priority: 'high' })
```

---

## What We Are NOT Doing

- No rewrite of `runNativeToolLoop` — Phase 1-2 wrap it, don't change it
- No new AI model calls — queue/task logic is all TypeScript, zero extra API cost
- No UI changes until Phase 3 (observability only)
- No changes to `SecurityGuard` / action policy — existing gates stay

---

## Acceptance Criteria

| Phase | Gate |
|-------|------|
| 1 | ThinkQueue unit tests pass; `think()` enqueues instead of skipping; drain verified in integration test |
| 2 | PersistentTaskService unit tests pass; task handoff integration test; topic dedup regression test |
| 3 | AFK task not repeated after restart; metrics emitted; coverage ≥30% |

---

## OpenClaw Learnings (Benchmark)

Source: `https://github.com/openclaw/openclaw` — analyzed 2026-03-16

### Patterns We Are Adopting

**Queue modes (Phase 1 enhancement):**
OpenClaw's `SessionActorQueue` has 4 modes: `collect` (coalesce), `steer` (inject into current run), `followup` (next turn), `steer-backlog`. Our `ThinkQueue` should support at minimum:
- `enqueue` (default) — add to queue for next available cycle
- `steer` — inject as event into the currently-running think cycle (via `pushEvent()` — already exists)

This means high-priority cron events can steer an in-progress think rather than waiting.

**Overflow summarization (Phase 1 enhancement):**
OpenClaw caps queue at 20 messages with `drop: summarize` policy — dropped items become a short bullet summary injected as a synthetic follow-up. Apply to ThinkQueue: when dropping a low-priority trigger, append a `{payload: "Dropped: <reason>"}` summary that gets included in the next think's event section.

**Interim ack guardrail (Phase 2 addition):**
OpenClaw detects when an isolated run only produces an acknowledgment ("on it", "checking now") with no tool calls or subagent descendants, and auto-triggers a focused follow-up. Add to KxAI: if `runNativeToolLoop` completes with text-only output (0 tool calls) and the prompt was action-oriented (contained task instructions), trigger one follow-up turn.

**Context-aware vs. isolated (already partially done):**
OpenClaw distinguishes: heartbeat (main session — full context) vs. cron isolated (no prior context). KxAI already does this: `think()` has full session context; `afkThink()` and cron jobs via `CronExecutor` are effectively isolated. Good. Phase 2 should preserve this separation.

**Pre-compaction memory flush:**
OpenClaw triggers a silent agentic turn when context approaches limits, instructing the agent to write durable memories before compaction. KxAI should add: when `runNativeToolLoop` detects response includes `<pre_compact>` signal or token count crosses threshold, trigger a brief "store key memories" tool call before ending the cycle.

**Retain/Recall/Reflect operational loop (Phase 3 guidance):**
OpenClaw's memory docs describe the pattern: Retain (append facts to daily log), Recall (query before acting), Reflect (scheduled updates to entity summaries). KxAI's existing memory tools + HEARTBEAT.md map onto this — Phase 3 should formalize it in prompts.

### Patterns We Are Explicitly NOT Adopting (out of scope)

- Gateway-as-process model — KxAI is Electron, not a server
- Channel-aware delivery pipeline (Discord/WhatsApp) — KxAI uses Telegram + in-app UI
- `sessions_spawn` subagent non-blocking model — too architecturally invasive for now
- Vector-search memory (LanceDB) — KxAI has `search_memory` RAG already; no need to replicate
- Model fallback chain — KxAI is single-model; out of scope

### Key Insight (from OpenClaw analysis)

> "Autonomous activity is not about running the model more often — it is about making each activation **context-rich, result-auditable, and loop-safe** while keeping costs manageable through intelligent batching and model selection."

This validates our approach: ThinkQueue + PersistentTaskService + dedup TTL = context-rich activations that don't repeat, with backpressure to control cost.
