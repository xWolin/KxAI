# KxAI — Service Dependency & Signal Flow Map

> Wygenerowano: 2026-03-13 (rev.4 — updated for CortexEngine unification)
> Cel: Unikanie cross-cutting bugów (race conditions, signal propagation gaps, API contract mismatches).
> Rev.4: Zaktualizowano o `CortexEngine` (zastępuje Heartbeat, Proactive, Reflection), `CronExecutor` oraz usunięto zduplikowane ścieżki take-control w `AgentLoop`.

---

## 1. Service Construction Dependencies

### ServiceContainer Init Phases (service-container.ts)

#### Phase 1 — Core (no deps)
| Service | Constructor Args |
|---------|-----------------|
| `ConfigService` | *(none)* |
| `SecurityService` | *(none)* |
| `DatabaseService` | *(none)* — `database.initialize()` called immediately |

#### Phase 2 — Construct
| Service | Constructor Args |
|---------|------------------|
| `MemoryService` | `config`, `database` |
| `AIService` | `config`, `security` |
| `ScreenCaptureService` | *(none)* |
| `CronService` | *(none)* |
| `ToolsService` | *(none)* |
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
| `TelegramService` | *(none)* |

#### Phase 3 — Async Init
- `memory.initialize()` ‖ `embedding.initialize()` — **parallel, no cross-deps**

#### Phase 4 — RAG + Plugins
| Service | Constructor Args |
|---------|-----------------|
| `RAGService` | `embedding`, `config`, `database` |
- `rag.initialize()` ‖ `plugins.initialize()` — **parallel**

#### Phase 5 — Cross-service Wiring (post-construction setters)
| Setter Call | Target Service | Injected Dependency |
|-------------|---------------|-------------------|
| `ai.setMemoryService(memory)` | AIService | MemoryService |
| `tools.setServices({...})` | ToolsService | 8 services |
| `mcpClient.setDependencies({...})` | McpClientService | ToolsService, ConfigService |
| `agentLoop.setRAGService(rag)` | AgentLoop | RAGService |
| `agentLoop.setAutomationService(automation)` | AgentLoop | AutomationService |
| `agentLoop.setScreenCaptureService(screenCapture)` | AgentLoop | ScreenCaptureService |
| `screenMonitor.setScreenCapture(screenCapture)` | ScreenMonitorService | ScreenCaptureService |
| `agentLoop.setScreenMonitorService(screenMonitor)` | AgentLoop | ScreenMonitorService |
| `cron.setExecutor(...)` | CronService | CronExecutor (via closure) |
| `telegram.setDependencies({...})` | TelegramService | Security, Config, AgentLoop |

**AgentLoop** — central orchestrator (agent-loop.ts):
- Constructor: `ai`, `tools`, `cron`, `workflow`, `memory`, `config`
- Creates internally: `SystemMonitor`, `PromptService`, `IntentDetector`, `SubAgentManager`
- Creates sub-modules: `ToolExecutor`, `ResponseProcessor`, `ContextBuilder`, `TakeControlEngine`, `CronExecutor`

**CortexEngine** (cortex-engine.ts):
- Constructor: `{ai, memory, workflow, cron, tools, promptService, responseProcessor, config, securityGuard}`
- Replaces legacy `HeartbeatEngine`, `ProactiveEngine`, and `ReflectionEngine`.
- Handles autonomous thought cycles, proactive rules, and reflections.

#### Deferred Init (initDeferred)
| Service | Dependencies |
|---------|-------------|
| `DashboardServer` | `meetingCoach`, port, `{tools, cron, rag, workflow, systemMonitor, mcpClient}` |
| `DiagnosticService` | `{ai, memory, config, cron, workflow, tools, systemMonitor, rag, browser, screenMonitor, screenCapture, tts}` |

---

## 2. Signal/Cancellation Flow

### AbortController Creation Points

| Location | File:Line | Scope |
|----------|-----------|-------|
| `AgentLoop.streamWithTools()` | agent-loop.ts | Per user message stream |
| `AgentLoop.processWithTools()` | agent-loop.ts | Per tool-only call (cron, background) |
| `TakeControlEngine.startTakeControl()` | take-control-engine.ts | Per take-control session |
| `CortexEngine.think()` / `safeRunReflection()` | cortex-engine.ts | Per autonomous cycle |

### Signal Propagation Path

```
User clicks STOP
  └→ IPC Ch.AGENT_STOP
       └→ agentLoop.stopProcessing()
            ├→ this.abortController?.abort()
            ├→ takeControlEngine.stopTakeControl()
            └→ cortexEngine.stop()

User clicks STOP TAKE CONTROL
  └→ IPC Ch.AUTOMATION_STOP_CONTROL
       └→ agentLoop.stopTakeControl()
            └→ takeControlEngine.stopTakeControl()
```

### ⚠️ Identified Signal Gaps

1. ~~**Dual take-control paths with separate AbortControllers**~~ ✅ FIXED: `AgentLoop` now strictly delegates all take-control logic to `TakeControlEngine`.
2. ~~**TakeControlEngine does NOT forward signal to AI calls**~~ ✅ FIXED.

---

## 3. Shared Mutable State

### Critical Shared References

| Shared Object | Services Holding Reference | Mutation Risk |
|--------------|--------------------------|---------------|
| `MemoryService` instance | AIService, AgentLoop, ContextBuilder, ResponseProcessor, CortexEngine | **HIGH** — concurrent `addMessage()`. No mutex. |
| `ConfigService` instance | Most services | **MEDIUM** — reads are frequent, writes debounced |
| `ToolsService.toolRegistry` | AgentLoop, McpClientService, PluginService | **HIGH** — MCP connects modify dynamically |
| `CronService.jobs` | AgentLoop, CronExecutor, CortexEngine | **MEDIUM** |
| `AIService.conversationHistory` | Any service calling `ai.sendMessage()` | **MEDIUM** — `CortexEngine` and `CronExecutor` correctly use `skipHistory: true` |

### Potential Race Conditions

1. **Concurrent message processing + Cortex think**:
   - `CortexEngine` checks `isProcessingCheck()` before running `think()`. It's a TOCTOU race, but practically mitigates context pollution.

---

## 4. IPC ↔ Service Boundary

### `Ch.CORTEX_SET_ENABLED`
```
Handler Flow:
  If true:
    agentLoop.stopHeartbeat() (Legacy)
    services.proactiveEngine.stop() (Legacy)
    cortexEngine.start()
  If false:
    cortexEngine.stop()
```
**Implication**: Full deduplication ensures old engines and new Cortex don't run simultaneously.

---

## 5. Event Emitter Chains

### Callback-based Event Chains (non-EventEmitter)

| Source | Callback Field | Consumers |
|--------|---------------|----------|
| `AgentLoop.onAgentStatus` | `(status: AgentStatus) => void` | ipc.ts → renderer + dashboard |
| `CortexEngine.onMessage` | `(msg: CortexMessage) => void` | ipc.ts → renderer chat history |
| `TelegramService.onMessage` | `(msg: TelegramMessageEvent) => void`| ipc.ts → renderer |

---

## Summary of Critical Findings

| # | Finding | Severity | Location |
|---|---------|----------|----------|
| 1 | ~~**Dual AbortController**~~ ✅ FIXED | ✅ Fixed | agent-loop.ts, take-control-engine.ts |
| 2 | ~~**Duplicate take-control code paths**~~ ✅ FIXED | ✅ Fixed | agent-loop.ts |
| 3 | **Shutdown Phase 1 is fire-and-forget** — services used by in-flight operations may close before operations complete | 🟡 Medium | service-container.ts |
| 4 | **ToolsService registry mutation during MCP disconnect** — could affect active tool loops | 🟢 Low | mcp-client-service.ts |