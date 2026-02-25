# KxAI — Service Dependency & Signal Flow Map

> Wygenerowano: 2026-02-25 (rev.3 — updated 2026-02-26)
> Cel: Unikanie cross-cutting bugów (race conditions, signal propagation gaps, API contract mismatches).
> Rev.3: Naprawiono finding #2 (signal gap w legacy take-control), #3 (duplicate SecurityGuard/SystemMonitor). Dodano PrivacyService.

---

## 1. Service Construction Dependencies

### ServiceContainer Init Phases (service-container.ts, 472 LOC)

#### Phase 1 — Core (no deps, L162–L170)
| Service | Constructor Args |
|---------|-----------------|
| `ConfigService` | *(none)* |
| `SecurityService` | *(none)* |
| `DatabaseService` | *(none)* — `database.initialize()` called immediately |

#### Phase 2 — Construct (L175–L210)
| Service | Constructor Args |
|---------|------------------|
| `MemoryService` | `config`, `database` |
| `AIService` | `config`, `security` |
| `ScreenCaptureService` | *(none)* |
| `CronService` | *(none)* |
| `ToolsService` | *(none)* — constructor creates fallback `SecurityGuard`/`SystemMonitor`, overridden by container instances in Phase 5 |
| `WorkflowService` | *(none)* |
| `EmbeddingService` | `security`, `config`, `database` |
| `AutomationService` | *(none)* |
| `BrowserService` | *(none)* |
| `PluginService` | *(none)* |
| `SecurityGuard` | *(none)* |
| `SystemMonitor` | *(none)* |
| `TTSService` | `security` |
| `ScreenMonitorService` | *(none)* |
| `TranscriptionService` | `security` |
| `UpdaterService` | *(none)* |
| `McpClientService` | *(none)* |
| `FileIntelligenceService` | *(none)* |
| `CalendarService` | `config` |
| `PrivacyService` | `database` |

#### Phase 3 — Async Init (L209–L211)
- `memory.initialize()` ‖ `embedding.initialize()` — **parallel, no cross-deps**

#### Phase 4 — RAG + Plugins (L218–L222)
| Service | Constructor Args |
|---------|-----------------|
| `RAGService` | `embedding`, `config`, `database` |
- `rag.initialize()` ‖ `plugins.initialize()` — **parallel**

#### Phase 5 — Cross-service Wiring (L225–L265, post-construction setters)
| Setter Call | Target Service | Injected Dependency |
|-------------|---------------|-------------------|
| `ai.setMemoryService(memory)` | AIService | MemoryService |
| `tools.setServices({automation, browser, rag, plugins, cron, privacy, securityGuard, systemMonitor})` | ToolsService | 8 services (incl. container-level SecurityGuard/SystemMonitor) |
| `mcpClient.setDependencies({toolsService, configService})` | McpClientService | ToolsService, ConfigService |
| `agentLoop.setRAGService(rag)` | AgentLoop | RAGService |
| `agentLoop.setAutomationService(automation)` | AgentLoop | AutomationService |
| `agentLoop.setScreenCaptureService(screenCapture)` | AgentLoop | ScreenCaptureService |
| `screenMonitor.setScreenCapture(screenCapture)` | ScreenMonitorService | ScreenCaptureService |
| `agentLoop.setScreenMonitorService(screenMonitor)` | AgentLoop | ScreenMonitorService |
| `cron.setExecutor(job => cronExecutor.executeCronJob(job))` | CronService | AgentLoop (via closure) |

**AgentLoop** — central orchestrator (L120–L194 agent-loop.ts):
- Constructor: `ai`, `tools`, `cron`, `workflow`, `memory`, `config`
- Creates internally: `SystemMonitor`, `PromptService`, `IntentDetector`, `SubAgentManager`
- Creates sub-modules: `ToolExecutor(tools, ai)`, `ResponseProcessor(memory, cron)`, `ContextBuilder({memory, workflow, config, cron, tools, ai, systemMonitor, promptService, subAgentManager})`, `HeartbeatEngine({ai, memory, workflow, cron, tools, promptService, responseProcessor})`, `TakeControlEngine(ai, tools, memory, promptService, intentDetector)`, `CronExecutor(workflow, processWithTools)`

**MeetingCoachService** (L258, service-container.ts):
- Constructor: `transcription`, `ai`, `config`, `security`, `rag`, `screenCapture`

#### Deferred Init (initDeferred, L275–L372)
| Service | Dependencies |
|---------|-------------|
| `DashboardServer` | `meetingCoach`, port, `{tools, cron, rag, workflow, systemMonitor, mcpClient}` |
| `DiagnosticService` | `{ai, memory, config, cron, workflow, tools, systemMonitor, rag, browser, screenMonitor, screenCapture, tts}` |

✅ **Resolved (rev.3)**: `ToolsService` constructor creates fallback `SecurityGuard`/`SystemMonitor`, but Phase 5 `setServices()` now injects container-level instances, ensuring audit logs go to the same `SecurityGuard` used by IPC handlers.

---

## 2. Signal/Cancellation Flow

### AbortController Creation Points

| Location | File:Line | Scope |
|----------|-----------|-------|
| `AgentLoop.streamWithTools()` | agent-loop.ts:L505 | Per user message stream |
| `AgentLoop.processWithTools()` | agent-loop.ts:L380 | Per tool-only call (cron, background) |
| `AgentLoop.startTakeControl()` | agent-loop.ts:L1585 | Per take-control session |
| `TakeControlEngine.startTakeControl()` | take-control-engine.ts:L162 | Per take-control session (engine copy) |
| `HeartbeatEngine.heartbeat()` | heartbeat-engine.ts:L242 | Per heartbeat cycle |
| `HeartbeatEngine.afkHeartbeat()` | heartbeat-engine.ts:L307 | Per AFK task cycle |

### Signal Propagation Path

```
User clicks STOP
  └→ IPC Ch.AGENT_STOP (ipc.ts:L122)
       └→ agentLoop.stopProcessing() (agent-loop.ts:L488–490)
            ├→ this.abortController?.abort()  ← aborts streamWithTools / processWithTools
            └→ (does NOT call takeControlEngine.stopTakeControl() — see gap below)

User clicks STOP TAKE CONTROL
  └→ IPC Ch.AUTOMATION_STOP_CONTROL (ipc.ts:L764)
       └→ agentLoop.stopTakeControl() (agent-loop.ts:L1992–1994)
            ├→ this.abortController?.abort()       ← aborts AgentLoop's own AC
            └→ this.takeControlEngine.stopTakeControl() ← aborts Engine's own AC
```

### Signal Flow: AgentLoop → AIService → SDK

```
AgentLoop.abortController.signal
  └→ options.signal passed to:
       ├→ ai.streamMessage(..., { signal })           (agent-loop.ts:L648)
       ├→ ai.sendMessage(..., { signal })             (agent-loop.ts:L382)
       ├→ ai.streamMessageWithNativeTools(..., { signal }) (agent-loop.ts:L843)
       ├→ ai.continueWithToolResults(..., { signal })      (agent-loop.ts:L897)
       └→ AIService extracts signal (ai-service.ts:L366/L542)
            ├→ openaiClient.chat.completions.create({...}, { signal }) (L376/L552)
            └→ anthropicClient.messages.create/stream({...}, { signal }) (L396/L577)
```

### Signal Flow: HeartbeatEngine → AIService

```
HeartbeatEngine.abortController.signal
  └→ ai.sendMessage(prompt, ..., { skipHistory: true, signal }) (heartbeat-engine.ts:L246)
       └→ Same SDK forwarding as above
  └→ runHeartbeatToolLoop(response, 5, signal) (heartbeat-engine.ts:L249)
       └→ ai.sendMessage(..., { skipHistory: true, signal }) per iteration (L345+)
```

### Signal Flow: TakeControlEngine

```
TakeControlEngine.abortController.signal
  └→ Used via `this.isAborted` getter (take-control-engine.ts:L79–80)
  └→ Checked in while loops: L237, L471
  └→ Checked after actions: L334, L548
  ⚠️ Signal is NOT passed to ai.computerUseStep() or ai.sendMessageWithVision()
```

### Cancellation Check Points

| Method | Check Mechanism | File:Line |
|--------|----------------|-----------|
| `AgentLoop._processWithToolsInner` | `this.isCancelled` (getter → `abortController.signal.aborted`) | L428, L451 |
| `AgentLoop._streamWithToolsInner` | `this.isCancelled` | L639, L810 |
| `AgentLoop._streamWithNativeToolsFlow` | `this.isCancelled` | L859, L886 |
| `AgentLoop.startTakeControl` | `this.isCancelled` | L1660 (while loop) |
| `TakeControlEngine` | `this.isAborted` (getter → `abortController.signal.aborted`) | L237, L334, L471, L548 |
| `HeartbeatEngine` | **No explicit check** — relies on signal aborting the AI SDK call | — |

### ⚠️ Identified Signal Gaps

1. **`stopProcessing()` does NOT stop take-control (agent-loop.ts:L488–490)**:
   `stopProcessing()` only calls `this.abortController?.abort()`. During `startTakeControl()` in AgentLoop (L1563), a **new** `AbortController` is created (L1585), but `stopProcessing()` doesn't call `takeControlEngine.stopTakeControl()`. The `stopTakeControl()` method (L1992) does both. **Risk**: If user triggers `AGENT_STOP` while take-control is active, only the AgentLoop's AC is aborted; the `TakeControlEngine`'s own AC (L39, take-control-engine.ts) remains alive.
   - **Mitigation**: `startTakeControl()` in AgentLoop checks `this.isCancelled` using AgentLoop's AC (L1660). But `TakeControlEngine.startTakeControl()` creates its own separate AC (L162), so the engine's inner loop uses a different signal.

2. **Dual take-control paths with separate AbortControllers**:
   - `AgentLoop` has `takeControlActive` flag + `abortController` (L73, L77)
   - `TakeControlEngine` has `takeControlActive` flag + `abortController` (L38–39)
   - `AgentLoop.startTakeControl()` creates its own AC (L1585) AND `TakeControlEngine.startTakeControl()` creates another (L162)
   - Both paths exist: AgentLoop.takeControlNativeAnthropic (L1611) uses AgentLoop's isCancelled, while TakeControlEngine uses its own isAborted
   - `isTakeControlActive()` (L1997) checks BOTH: `this.takeControlActive || this.takeControlEngine.isTakeControlActive()`

3. **TakeControlEngine does NOT forward signal to AI calls**:
   - `ai.computerUseStep()` at take-control-engine.ts:L252 — no signal parameter
   - `ai.sendMessageWithVision()` at take-control-engine.ts:L510 — no signal parameter
   - Cancellation relies entirely on `while (!this.isAborted)` loop checks, meaning an in-flight API call won't be aborted immediately

4. **HeartbeatEngine lacks isCancelled check in tool loop**:
   - `runHeartbeatToolLoop()` (heartbeat-engine.ts:L345) passes signal to AI calls but does NOT check `signal.aborted` between iterations. If `stopHeartbeat()` is called mid-loop, the next AI call will throw (via SDK), but there's no graceful early exit check.

---

## 3. Shared Mutable State

### Critical Shared References

| Shared Object | Services Holding Reference | Mutation Risk |
|--------------|--------------------------|---------------|
| `MemoryService` instance | AIService (via setter), AgentLoop, ContextBuilder, ResponseProcessor, HeartbeatEngine, TakeControlEngine, MeetingCoachService | **HIGH** — concurrent `addMessage()` from AgentLoop (user chat) + HeartbeatEngine (background) + CronExecutor (scheduled). No mutex. |
| `ConfigService` instance | AIService, AgentLoop (via ContextBuilder), EmbeddingService, RAGService, McpClientService, MeetingCoachService, CalendarService | **MEDIUM** — reads are frequent, writes are debounced (200ms) and serialized internally |
| `ToolsService.toolRegistry` (Map) | AgentLoop (via tools), McpClientService (register/unregister), PluginService (register), DiagnosticService (self_test tool), CalendarService (via calendar tools), FileIntelligenceService (via file tools) | **HIGH** — MCP connects/disconnects modify the registry dynamically while tool loops may be iterating `getDefinitions()` |
| `CronService.jobs` (array) | AgentLoop (via cron), CronExecutor, ResponseProcessor (addJob), DashboardServer (read) | **MEDIUM** — cron jobs can be added by AI during tool loop while `getJobs()` is called by heartbeat |
| `AgentLoop.abortController` | AgentLoop, IPC handlers (via stopProcessing) | **HIGH** — see §2 for dual-AC problem |
| `AgentLoop.isProcessing` (boolean) | AgentLoop (set in streamWithTools), HeartbeatEngine (read via callback) | **LOW** — single writer, but no memory barrier (JS is single-threaded, so OK) |
| `AgentLoop.pendingTakeControlTask` | AgentLoop (set from intent detection + response parsing), IPC (consumed via consumePendingTakeControl) | **LOW** — consumed once, set once |
| `AgentLoop.takeControlActive` | AgentLoop (L73, set in startTakeControl), TakeControlEngine (L38, separate flag) | **MEDIUM** — two separate booleans that must agree; `isTakeControlActive()` ORs both |
| `AIService.conversationHistory` (via MemoryService) | Every service calling `ai.sendMessage()` with `skipHistory: false` | **MEDIUM** — HeartbeatEngine and CronExecutor use `skipHistory: true`, but tool loops in legacy path don't always |

### Potential Race Conditions

1. **Concurrent message processing + heartbeat**:
   - `streamWithTools()` sets `isProcessing = true` (L504), heartbeat checks `isProcessingCheck()` (heartbeat-engine.ts:L188). But between the heartbeat check and the actual AI call, `streamWithTools` could start. Both would write to conversation history.
   - **Mitigation**: `isProcessing` flag is checked, but it's a **TOCTOU** race — HeartbeatEngine could pass the check right before `streamWithTools` sets the flag.

2. **ToolsService registry modification during iteration**:
   - MCP client `unregisterByPrefix()` can remove tools while `_streamWithNativeToolsFlow` holds a reference to `getDefinitions()` result. Since `getDefinitions()` returns a copy (array spread), this is likely safe — but if it returns a reference, tool calls could fail with "tool not found".

3. **Dual take-control race**:
   - `AgentLoop.startTakeControl()` checks `this.takeControlActive` (L1578) and `TakeControlEngine.startTakeControl()` checks its own `this.takeControlActive` (L159). If two take-control requests arrive simultaneously (unlikely but possible via IPC + chat intent), both guards could pass before either sets the flag.

---

## 4. IPC ↔ Service Boundary

### `Ch.AGENT_STOP` (ipc.ts:L122–L127)

```
IPC Handler:
  agentLoop.stopProcessing()  →  this.abortController?.abort()
  return { success: true }    ←  Returns IMMEDIATELY (fire-and-forget)
  
Comment (L124): "Don't send done: true here — the AI_STREAM_MESSAGE handler 
will send it when streamWithTools() resolves after the AbortSignal terminates the stream."
```

**Implication**: The renderer receives `{ success: true }` instantly. The actual stream termination happens asynchronously when `streamWithTools()` catches the abort, exits its finally block (L510–512), and the `AI_STREAM_MESSAGE` handler sends `{ done: true }` (L147).

### `Ch.AI_STREAM_MESSAGE` (ipc.ts:L140–L200)

```
Handler Flow:
  1. agentLoop.streamWithTools(message, context, onChunk)
     └→ onChunk sends Ev.AI_STREAM { chunk } to renderer
  2. On success: send Ev.AI_STREAM { done: true }
  3. Check agentLoop.consumePendingTakeControl()
     └→ If pending: show dialog → if confirmed:
        ├→ send Ev.AGENT_CONTROL_STATE { active: true }
        ├→ send Ev.AI_STREAM { takeControlStart: true }
        └→ agentLoop.startTakeControl() (runs in background, L174)
             └→ .then() sends { done: true } + { active: false }
```

**Race risk**: `consumePendingTakeControl()` is called AFTER `streamWithTools()` returns. If another IPC call arrives between `streamWithTools()` returning and `consumePendingTakeControl()` checking — the pending task could be lost or stale. Low probability (single UI, single user).

### `Ch.AUTOMATION_TAKE_CONTROL` (ipc.ts:L718–L762)

```
Handler Flow:
  1. Rate limit check (30s cooldown via `lastTakeControlTime`)
  2. Show dialog.showMessageBox (blocking until user responds)
  3. securityGuard.logAudit(...)
  4. Send Ev.AI_STREAM { takeControlStart: true }
  5. agentLoop.startTakeControl(task, onStatus, onChunk, confirmed=true)
     └→ onStatus sends Ev.AUTOMATION_STATUS_UPDATE
     └→ onChunk sends Ev.AI_STREAM { chunk }
  6. Send Ev.AI_STREAM { done: true }
```

### `Ch.AUTOMATION_STOP_CONTROL` (ipc.ts:L764–L767)

```
Handler Flow:
  agentLoop.stopTakeControl()
    ├→ this.abortController?.abort()
    └→ this.takeControlEngine.stopTakeControl()
         └→ this.abortController?.abort()
  return { success: true }
```

### Race: STOP during TAKE_CONTROL start

If `AUTOMATION_STOP_CONTROL` arrives while `AUTOMATION_TAKE_CONTROL` is awaiting `dialog.showMessageBox()`:
- `startTakeControl()` hasn't been called yet
- `stopTakeControl()` aborts an old/null AC
- Then user confirms dialog → `startTakeControl()` proceeds with a fresh AC

**Result**: Stop is effectively ignored. Low risk since dialog blocks the UI.

---

## 5. Event Emitter Chains

### EventEmitter Services

| Service | Extends EventEmitter | Events Emitted |
|---------|---------------------|----------------|
| `ConfigService` | ✅ (config.ts:L46) | `'change'` (L292) |
| `MeetingCoachService` | ✅ (meeting-coach.ts:L194) | `meeting:state`, `meeting:started`, `meeting:stopped`, `meeting:transcript`, `meeting:coaching`, `meeting:coaching-chunk`, `meeting:coaching-done`, `meeting:error`, `meeting:tick`, `meeting:stop-capture`, `meeting:detected`, `meeting:briefing-updated`, `meeting:speaker-identified` |
| `TranscriptionService` | ✅ (transcription-service.ts:L44) | *(events consumed by MeetingCoachService)* |

| `CalendarService` | ❌ (callback-based) | `onStatusChange` callback — pushed via IPC `Ev.CALENDAR_STATUS` |

### Callback-based Event Chains (non-EventEmitter)

| Source | Callback Field | Consumers |
|--------|---------------|----------|
| `AgentLoop.onAgentStatus` | `(status: AgentStatus) => void` | ipc.ts:L103 → `safeSend(Ev.AGENT_STATUS)` + `dashboard.pushAgentStatus()` |
| `AgentLoop.onHeartbeatResult` | `(message: string) => void` | *(set by ipc.ts or main.ts — sends proactive notification)* |
| `AgentLoop.onSubAgentResult` | `(result: SubAgentResult) => void` | *(set by ipc.ts)* |
| `HeartbeatEngine.onAgentStatus` | `(status: AgentStatus) => void` | AgentLoop constructor (L161) → delegates to `this.emitStatus()` |
| `TakeControlEngine.onAgentStatus` | `(status: AgentStatus) => void` | AgentLoop constructor (L166) → delegates to `this.emitStatus()` |
| `CalendarService.onStatusChange` | `(status: CalendarStatus) => void` | ipc.ts → `safeSend(Ev.CALENDAR_STATUS)` |

### Full Event Chains

#### MeetingCoach → Dashboard + Renderer

```
MeetingCoachService.emit('meeting:*')
  ├→ [service-container.ts:L310–L315] dashboard.pushEvent(event, data)
  │    └→ WebSocket broadcast to dashboard SPA
  └→ [ipc.ts:L904–L908] meetingCoach.on(event) → safeSend(event, data)
       └→ mainWindow.webContents.send(event, data) → renderer
```

⚠️ **Duplicate listeners**: Meeting events are forwarded to the dashboard in **TWO** places:
1. `service-container.ts:L310` (initDeferred) — for dashboard WebSocket
2. `ipc.ts:L904` — for renderer IPC

This is intentional (different destinations) but means **every meeting event fires 2 listeners**.

#### Config Changes → Renderer

```
ConfigService.emit('change', changes)  (config.ts:L292)
  └→ [main.ts:L321] configService.on('change')
       └→ mainWindow.webContents.send(Ev.CONFIG_CHANGED, changes)
            └→ renderer useStoreInit listens → updates useConfigStore
```

#### Agent Status → Renderer + Dashboard

```
AgentLoop.emitStatus(status)  (agent-loop.ts:L113)
  └→ this.onAgentStatus?.(status)
       └→ [ipc.ts:L103–L105]
            ├→ safeSend(Ev.AGENT_STATUS, status) → renderer
            └→ dashboard.pushAgentStatus(status) → WebSocket
```

#### Calendar Status → Renderer

```
CalendarService.onStatusChange(callback)
  └→ [ipc.ts] calendarService.onStatusChange(status)
       └→ safeSend(Ev.CALENDAR_STATUS, status) → renderer
            └→ SettingsPanel listens → updates calendar UI state
```

---

## 6. Lifecycle Dependencies — Shutdown Order

### Current Shutdown (service-container.ts:L381–L425)

```
Phase 1 — Stop active processing (prevent new work):
  agentLoop.stopProcessing()     ← aborts current AI stream / tool loop
  screenMonitor.stop()           ← stops screen capture timer
  cron.stopAll()                 ← stops cron scheduling (no new executions)
  updater.destroy()              ← removes update check timer

Phase 2 — Close network connections:
  calendar.shutdown()            ← clears sync interval, disconnects CalDAV
  mcpClient.shutdown()           ← disconnects all MCP servers (async)
  meetingCoach.stopMeeting()     ← stops transcription + coaching (async)
  transcription.stopAll()        ← closes Deepgram WebSockets (async)
  browser.close()                ← closes CDP connections (async)
  dashboard.stop()               ← stops Express + WebSocket server (async)

Phase 3 — Stop watchers and plugins:
  rag.destroy()                  ← stops file watchers
  plugins.destroy()              ← unloads plugins

Phase 4 — Cleanup temp resources:
  tts.cleanup()                  ← deletes temp audio files

Phase 5 — Flush caches & persist data:
  embedding.flushCache()         ← writes cached embeddings to SQLite
  embedding.terminateWorker()    ← kills worker thread
  config.shutdown()              ← flushes pending debounced save (async)

Phase 6 — Close database (must be last):
  memory.shutdown()              ← WAL checkpoint + close
  database.close()               ← close SQLite connection
```

### Critical Ordering Constraints

| Must Stop First | Before | Reason |
|-----------------|--------|--------|
| `agentLoop` | `ai`, `memory`, `tools` | Active tool loops call AI and write to memory |
| `screenMonitor` | `screenCapture` | Monitor uses capture service |
| `cron` | `agentLoop` | Cron executor delegates to agentLoop.processWithTools |
| `calendar` | `config`, `database` | Calendar reads config for connections, caches in memory |
| `mcpClient` | `tools` | MCP unregisters tools during shutdown |
| `meetingCoach` | `transcription`, `ai`, `rag` | Coach uses transcription + AI + RAG |
| `rag` | `embedding`, `database` | RAG reads embeddings and chunks from SQLite |
| `embedding` | `database` | Embedding cache persisted to SQLite |
| `config` | `database` | Config flush might trigger DB writes indirectly |
| `memory` | `database` | Memory uses SQLite for session storage |

### ⚠️ Potential Issues

1. **Phase 1 `stopProcessing()` is fire-and-forget**: It just sets the abort flag. An in-flight `processWithTools()` may still be running during Phase 2–5. If it tries to call `ai.sendMessage()` or `memory.addMessage()` after those services shut down, it could throw. The `finally` blocks in `streamWithTools()` (L510–512) only reset `isProcessing` and `abortController` — they don't await the AI to actually stop.

2. **HeartbeatEngine not explicitly stopped**: `stopProcessing()` aborts the AgentLoop's AC, but HeartbeatEngine has its own AC and timer. The heartbeat timer is owned by AgentLoop (`heartbeatTimer`) but `stopHeartbeat()` is not called during shutdown Phase 1 — only `stopProcessing()` is called. However, HeartbeatEngine's timer is set via `setInterval`, which will survive until the process exits or `stopHeartbeat()` is explicitly called.

3. **MCP client shutdown in Phase 2 calls `toolsService.unregisterByPrefix()`**: If a tool loop is still winding down from Phase 1, tools could disappear mid-execution.

4. **No timeout on Phase 1 operations**: Unlike Phase 2–6 which use `tryAsync` with error isolation, Phase 1 uses `trySync` which won't handle a hanging `stopProcessing()`.

---

## Summary of Critical Findings

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| 1 | **Dual AbortController** — AgentLoop and TakeControlEngine both create ACs for take-control, `stopProcessing()` only aborts AgentLoop's | 🟡 Medium | agent-loop.ts:L1585, take-control-engine.ts:L162 |
| 2 | ~~**TakeControlEngine doesn't forward signal to AI calls**~~ ✅ FIXED (rev.3) — signal now passed to `ai.computerUseStep()` in legacy `takeControlNativeAnthropic()` | ✅ Fixed | agent-loop.ts:L1670 |
| 3 | ~~**Duplicate SecurityGuard/SystemMonitor**~~ ✅ FIXED (rev.3) — `setServices()` now accepts container instances | ✅ Fixed | tools-service.ts + service-container.ts Phase 5 |
| 4 | **HeartbeatEngine timer not explicitly cleared on shutdown** — relies on process exit | 🟢 Low | service-container.ts Phase 1 |
| 5 | **TOCTOU race on isProcessing** — heartbeat check passes, then streamWithTools starts | 🟢 Low | agent-loop.ts:L504, heartbeat-engine.ts:L188 |
| 6 | **Shutdown Phase 1 is fire-and-forget** — services used by in-flight operations may close before operations complete | 🟡 Medium | service-container.ts:L385 |
| 7 | **ToolsService registry mutation during MCP disconnect** — could affect active tool loops | 🟢 Low | mcp-client-service.ts shutdown, tools-service.ts |
| 8 | **Duplicate take-control code paths** — AgentLoop has its own `takeControlNativeAnthropic` (L1611) AND delegates to `TakeControlEngine` | 🟡 Medium | agent-loop.ts:L1590–1592 vs take-control-engine.ts |
