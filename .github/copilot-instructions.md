# KxAI — Copilot Instructions

## Projekt

**KxAI** to personalny AI desktop agent (Electron 33 + React 19 + TypeScript 5.7 + Vite 6).
Agent działa jako floating widget na pulpicie, posiada czat z AI (OpenAI / Anthropic), system pamięci (SQLite + markdown files), proaktywne notyfikacje, screen capture z vision, cron jobs, framework narzędzi (tools), workflow learning i time awareness.
RAG pipeline z SQLite-vec (hybrid search: vector + FTS5), native function calling, natywny CDP do automatyzacji przeglądarki.

## Architektura

```
src/
├── shared/                 # Typy współdzielone main ↔ renderer (Faza 0.1 ✅)
│   ├── types/
│   │   ├── ai.ts           # ConversationMessage, ProactiveMessage
│   │   ├── config.ts       # KxAIConfig, OnboardingData
│   │   ├── tools.ts        # ToolDefinition, ToolResult, ToolCategory
│   │   ├── cron.ts         # CronJob, CronExecution
│   │   ├── workflow.ts     # ActivityEntry, WorkflowPattern
│   │   ├── rag.ts          # RAGChunk, RAGSearchResult, IndexProgress
│   │   ├── agent.ts        # AgentStatus, SubAgentInfo, SubAgentResult
│   │   ├── security.ts     # AuditEntry, SecurityStats
│   │   ├── tts.ts          # TTSConfig
│   │   ├── system.ts       # SystemSnapshot, CpuInfo, MemoryInfo, ...
│   │   ├── meeting.ts      # MeetingStateInfo, MeetingCoachConfig, ...
│   │   ├── plugins.ts      # PluginInfo
│   │   ├── automation.ts   # AutomationStatus
│   │   ├── mcp.ts          # McpServerConfig, McpHubStatus, McpRegistryEntry
│   │   └── index.ts        # Barrel re-export
│   └── constants.ts        # Stałe (limity, domyślne wartości)
│   └── ipc-schema.ts        # IPC channel/event constants (Ch, Ev, ChSend) (Faza 3.1 ✅)
│   └── schemas/
│       └── ai-responses.ts  # Zod schemas: ScreenAnalysis, CronSuggestion, MemoryUpdate, TakeControl (Faza 2.2 ✅)
├── main/                   # Electron main process
│   ├── main.ts             # Entry point, okno, tray, ServiceContainer init (Faza 3.2 ✅)
│   ├── ipc.ts              # IPC handlers (bridge main ↔ renderer)
│   ├── preload.ts          # Context bridge (window.kxai API)
│   └── services/
│       ├── service-container.ts # DI container: typed ServiceMap, 6-phase init/shutdown (Faza 3.2 ✅)
│       ├── ai-service.ts       # OpenAI + Anthropic SDK, streaming, vision, native FC
│       ├── tool-schema-converter.ts # ToolDefinition[] → OpenAI/Anthropic format (Faza 2.1 ✅)
│       ├── logger.ts           # Tagged logger: createLogger('Tag') (Quick Win ✅)
│       ├── memory.ts           # Markdown-based pamięć (~userData/workspace/memory/)
│       ├── screen-capture.ts   # Screenshot capture (desktopCapturer)
│       ├── cron-service.ts     # Cron jobs CRUD, scheduling, persistence
│       ├── tools-service.ts    # Extensible tools framework (30+ built-in)
│       ├── workflow-service.ts # Activity logging, pattern detection, time awareness
│       ├── agent-loop.ts       # Orchestrator: delegates to extracted modules (Faza 2.6 ✅)
│       ├── tool-executor.ts    # Tool calling + parallel execution (Faza 2.6 ✅)
│       ├── response-processor.ts # Response parsing + cron/memory extraction (Faza 2.6 ✅)
│       ├── context-builder.ts  # System prompt assembly (Faza 2.6 ✅)
│       ├── heartbeat-engine.ts # Autonomous mode (Faza 2.6 ✅)
│       ├── take-control-engine.ts # Desktop automation mode (Faza 2.6 ✅)
│       ├── cron-executor.ts    # Cron job runner (Faza 2.6 ✅)
│       ├── tool-loop-detector.ts # Loop detection (hash, ping-pong, spiraling)
│       ├── cdp-client.ts        # Native CDP client (WebSocket) — replaces playwright-core (Faza 1.1 ✅)
│       ├── browser-service.ts  # CDP browser automation — native CDP (Faza 1.2 ✅)
│       ├── automation-service.ts # Desktop automation (mouse/keyboard via OS APIs)
│       ├── database-service.ts # SQLite storage (better-sqlite3, WAL, FTS5, sqlite-vec) (Faza 2.3+2.4 ✅)
│       ├── rag-service.ts      # RAG pipeline: SQLite storage, vec0 KNN, hybrid search (Faza 2.4 ✅)
│       ├── embedding-service.ts # OpenAI embeddings + TF-IDF fallback, SQLite cache (Faza 2.4 ✅)
│       ├── context-manager.ts  # Inteligentne okno kontekstowe (token budget)
│       ├── screen-monitor.ts   # Tiered monitoring (T0/T1/T2)
│       ├── sub-agent.ts        # Multi-agent system
│       ├── meeting-coach.ts    # Real-time meeting coaching (Deepgram)
│       ├── plugin-service.ts   # Dynamic plugin loading
│       ├── security-guard.ts   # Security layer (SSRF, injection, rate limiting)
│       ├── prompt-service.ts   # Markdown-based prompt management (async API — Faza 3.3 ✅)
│       ├── intent-detector.ts  # User intent recognition (regex-based)
│       ├── tts-service.ts      # TTS (ElevenLabs / OpenAI / Web Speech)
│       ├── transcription-service.ts # Deepgram STT
│       ├── dashboard-server.ts # Localhost dashboard (Express + WebSocket)
│       ├── retry-handler.ts    # Exponential backoff retry logic
│       ├── diagnostic-service.ts # System diagnostics
│       ├── updater-service.ts  # Auto-updater via electron-updater + GitHub Releases (Faza 7.1 ✅)
│       ├── mcp-client-service.ts # MCP Client — connects to external MCP servers (Faza 8.1 ✅)
│       └── config.ts          # Configuration persistence (async save — Faza 3.3 ✅)
├── renderer/               # React frontend
│   ├── App.tsx             # Routing (widget/chat/settings/cron/onboarding/meeting)
│   ├── types.ts            # KxAIBridge interface + renderer-only types
│   ├── components/
│   │   ├── FloatingWidget.tsx      # Draggable widget z manual drag detection
│   │   ├── ChatPanel.tsx           # Czat z AI, streaming, screenshot
│   │   ├── CronPanel.tsx           # UI zarządzania cron jobami
│   │   ├── SettingsPanel.tsx       # Konfiguracja (API keys, model, persona)
│   │   ├── OnboardingWizard.tsx    # Onboarding flow
│   │   ├── ProactiveNotification.tsx # Proactive message popup
│   │   ├── CoachingOverlay.tsx     # Meeting coach overlay
│   │   └── ErrorBoundary.tsx       # React error boundary per-view (Faza 3.5 ✅)
│   └── styles/
│       └── global.css      # Wszystkie style (futuristic dark theme)
```

## Konwencje

- **Język**: Komunikaty UI i komentarze w kodzie po polsku tam gdzie to naturalne (UX), nazwy zmiennych/typów po angielsku
- **Typy**: Używaj TypeScript strict mode; współdzielone typy w `src/shared/types/` (canonical source), re-exportowane w serwisach dla backward compat
- **Path aliases**: `@shared/*` → `src/shared/*`, `@main/*` → `src/main/*`, `@renderer/*` → `src/renderer/*`
- **IPC**: Kanały IPC definiowane jako stałe w `src/shared/ipc-schema.ts` (Ch/Ev/ChSend). Każdy nowy handler dodaj w `ipc.ts` używając stałych, expose w `preload.ts`, typuj w `types.ts`
- **DI**: Serwisy rejestrowane w `ServiceContainer` (`service-container.ts`). Dostęp: `container.get('nazwa')`. Nowe serwisy dodaj do `ServiceMap` + `init()` + `shutdown()`
- **Styling**: CSS Modules per-component (`*.module.css`), `cn()` utility, design tokens w `global.css` `:root`. Import: `import s from './Comp.module.css'`
- **AI models**: OpenAI używa `max_completion_tokens` (nie `max_tokens`); GPT-5+ używa roli `developer` zamiast `system`
- **Tool calling**: Native function calling (OpenAI tools API / Anthropic tool_use) domyślnie włączone (`config.useNativeFunctionCalling`). Fallback na ```tool bloki gdy wyłączone.
- **Cron suggestions**: AI outputuje ```cron\n{JSON}\n``` bloki, agent-loop parsuje i proponuje użytkownikowi
- **Logging**: Używaj `createLogger('Tag')` z `src/main/services/logger.ts` zamiast `console.log/warn/error`
- **Testing**: Vitest z mockami electron/fs. Testy w `tests/`. Konwencja: `tests/<service-name>.test.ts`
- **Persistence**: SQLite (better-sqlite3, WAL) jako primary storage (sesje, RAG chunks, embeddings, cache). Markdown files dla pamięci agenta (SOUL.md, USER.md, MEMORY.md). Dane w `app.getPath('userData')/workspace/` (memory/, cron/, workflow/)

## Komendy

```bash
npm run dev          # Uruchom w trybie dev (Vite + Electron)
npm run build        # Zbuduj produkcyjnie
npm run dist         # Zbuduj + spakuj (electron-builder)
npm run typecheck    # Sprawdź TypeScript (oba tsconfigi)
npm run test         # Uruchom testy (Vitest)
npm run test:watch   # Testy w watch mode
npm run test:coverage # Testy z coverage report
npm run format       # Formatuj kod (Prettier)
npm run format:check # Sprawdź formatowanie
npx tsc --noEmit     # Sprawdź renderer TypeScript
npx tsc --noEmit -p tsconfig.main.json  # Sprawdź main process TypeScript
```

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`) buduje na 3 platformach: Windows (NSIS), macOS (dmg+zip), Linux (AppImage+deb).

---

# PLAN REFACTORU — "KxAI v1.0 Production Ready"

> Audyt przeprowadzony: Luty 2026
> Cel: Przekształcenie prototypu w produkt gotowy do wysłania klientom.
> Filozofia: Nie kopiujemy rozwiązań — tworzymy nowe, lepsze.

## Podsumowanie audytu — Co już mamy (mocne strony)

1. **Solidna architektura serwisów** — wyraźny podział odpowiedzialności (29 serwisów)
2. **Inteligentny system promptów** — markdown-based z overrides i variable substitution
3. **Tiered screen monitoring** — T0/T1/T2 minimalizuje koszty API (95% free)
4. **ContextManager** — token budgeting, importance scoring, summarization
5. **ToolLoopDetector** — zaawansowana detekcja zapętleń (hash, ping-pong, spiraling)
6. **SecurityGuard** — SSRF protection, command injection prevention, audit log
7. **RAG pipeline** — SQLite-vec hybrid search (vector KNN + FTS5 keyword → RRF), smart chunking per 7 file types, SQLite persistent embedding cache + hot cache, incremental reindex (Faza 2.4 ✅)
8. **Meeting Coach** — real-time Deepgram transcription + streaming AI coaching
9. **Sub-agent system** — izolowane zadania z własnym tool loop
10. **IntentDetector** — regex-based rozpoznawanie intencji (PL + EN)

## Zidentyfikowane problemy krytyczne

### P1: Browser Service — Playwright jako hard dependency ✅ ROZWIĄZANO
- **Problem**: `playwright-core` wymaga dodatkowych binariów chromium (~200MB), jest ciężki, problematyczny w packaging
- **Problem**: Korzysta z dedykowanego profilu — nie widzi cookies/sesji użytkownika
- **Rozwiązanie**: Faza 1 ✅ — Native CDP client (`cdp-client.ts`) + BrowserService przepisany na natywny CDP. `playwright-core` usunięty z dependencies.

### P2: Tool calling — niestandardowy format (```tool bloki) ✅ ROZWIĄZANO
- **Problem**: Zamiast native function calling API (OpenAI/Anthropic), AI musi generować markdown code blocks
- **Problem**: Łatwy do złamania, wymaga custom parsingu, nie działa z parallel tool calls
- **Rozwiązanie**: Faza 2.1 ✅ — Native function calling z `tool-schema-converter.ts`. Parallel tool calls. Fallback na ```tool bloki zachowany.

### P3: Monolityczny ipc.ts (970 linii) i preload.ts (292 linie) ✅ ROZWIĄZANO
- **Problem**: Każda nowa funkcja to zmiany w 3 plikach (ipc + preload + types)
- **Problem**: Brak walidacji parametrów IPC, brak typesafe bridge
- **Rozwiązanie**: Faza 3.1 ✅ — `ipc-schema.ts` z 95 stałymi kanałów (Ch, Ev, ChSend). Zero string literals w ipc.ts/preload.ts/main.ts. Faza 3.2 ✅ — ServiceContainer eliminuje manual wiring.

### P4: Brak testów ✅ CZĘŚCIOWO ROZWIĄZANO
- **Problem**: Zero testów — unit, integration, e2e
- **Rozwiązanie**: Faza 5.1 ✅ — Vitest setup, 172 testy unit (IntentDetector, SecurityGuard, ContextManager, PromptService). Integration/E2E do zrobienia.

### P5: Frontend — jeden plik CSS (global.css), brak component library ✅ CZĘŚCIOWO ROZWIĄZANO
- **Problem**: Skalowanie UI jest trudne, brak design system
- **Rozwiązanie**: Faza 4.1 ✅ — CSS Modules per-component (8 plików `*.module.css`), `cn()` utility, design tokens w `:root`. Monolityczny `global.css` (2846→181 linii). Component library (4.2) i state management (4.3) do zrobienia.

### P6: Brak error boundaries i crash reporting ✅ CZĘŚCIOWO ROZWIĄZANO
- **Problem**: Uncaught error = biały ekran, brak telemetrii
- **Rozwiązanie**: Faza 3.5 ✅ — React ErrorBoundary per-view, `KxAIError` structured error class, `process.on('uncaughtException/unhandledRejection')` w main.ts. Sentry/crash reporting opcjonalnie później.

### P7: Synchronous fs operations blokujące main process ✅ CZĘŚCIOWO ROZWIĄZANO
- **Problem**: `fs.readFileSync`, `fs.writeFileSync` w wielu serwisach blokują event loop
- **Rozwiązanie**: Faza 3.3 ✅ — 7 najczęściej wywoływanych serwisów skonwertowanych na `fs/promises` (config, prompt-service, memory, security, security-guard, workflow-service, cron-service). Ciężkie serwisy (RAG, embedding, browser) odsunięte do worker threads (Faza 7.2).

### P8: Memory service — flat file based, nie skaluje się ✅ ROZWIĄZANO
- **Problem**: JSON session files, brak search, brak retention policy
- **Rozwiązanie**: Faza 2.3 ✅ — SQLite-backed z better-sqlite3, WAL mode, FTS5, retention policy (30d archive, 90d delete), auto-migracja starych JSON sesji.

---

## Faza 0: Przygotowanie infrastruktury (Tydzień 1)

### Krok 0.1 — Monorepo structure + shared types
```
src/
├── shared/              # NOWY — typy współdzielone main ↔ renderer
│   ├── types/
│   │   ├── ipc.ts       # Definicje kanałów IPC (auto-generowane)
│   │   ├── ai.ts        # AI message types
│   │   ├── tools.ts     # Tool definitions
│   │   ├── memory.ts    # Conversation/memory types
│   │   ├── config.ts    # Config schema
│   │   └── index.ts     # Re-export
│   └── constants.ts     # Stałe (limity, domyślne wartości)
├── main/
└── renderer/
```
- [x] Wyodrębnij typy z `renderer/types.ts` i plików serwisów do `shared/types/` ✅ (13 plików typów + barrel export)
- [ ] Zrób `shared/types/ipc.ts` z typed channels (eliminuje ręczne stringi IPC)
- [x] Skonfiguruj TypeScript path aliases (`@shared/*`, `@main/*`, `@renderer/*`) ✅

### Krok 0.2 — Linting + formatting
- [x] Dodaj ESLint flat config (`eslint.config.mjs`) z regułami: ✅
  - `no-restricted-properties` — flaguj synchroniczne fs operacje
  - `@typescript-eslint/recommended`
  - React hooks + react-refresh
- [x] Dodaj Prettier z konfiguracją ✅ (`.prettierrc` + `.prettierignore`)
- [ ] Dodaj `lint-staged` + `husky` pre-commit hooks
- [x] Dodaj `npm run typecheck` jako alias ✅

### Krok 0.3 — Dependency audit + cleanup
- [x] Usuń `playwright-core` z dependencies (zastąpiony w Fazie 1) ✅
- [x] Usuń `screenshot-desktop` — zastąp natywnym `desktopCapturer` ✅
- [x] Dodaj `better-sqlite3` + `@types/better-sqlite3` dla lokalnego storage ✅
- [x] Dodaj `zod` do runtime validation schemas (IPC params, config, tool params) ✅
- [x] Stworzono tagged logger (`logger.ts`) zamiast raw console.log ✅ (electron-log opcjonalnie później)

---

## Faza 1: Browser Bypass — Natywny CDP bez Playwright (Tydzień 2-3)

> **Innowacja**: Zamiast Playwright (heavy, separate browser), podłączamy się BEZPOŚREDNIO do Chrome/Edge użytkownika przez Chrome DevTools Protocol, z jego cookies, sesje, rozszerzenia. Zero dodatkowych binarek.

### Krok 1.1 — Native CDP Client (`cdp-client.ts`) ✅
> **Zaimplementowano**: `cdp-client.ts` (~926 LOC) z 3 klasami: `CDPConnection` (WebSocket wrapper z request tracking), `CDPPage` (Page/Runtime/Input commands), `CDPBrowser` (HTTP target management). Obsługuje connect do istniejącej przeglądarki, multiple tabs via `/json/list`, full input emulation.

- [x] Stwórz klient CDP oparty na WebSocket ✅ (CDPConnection + CDPPage + CDPBrowser)
- [x] Obsługa connection do istniejącej przeglądarki ✅ (HTTP /json/version, DevToolsActivePort parsing)
- [x] Obsługa multiple tabs (targets) via CDP `/json/list` ✅

### Krok 1.2 — Przepisanie BrowserService na native CDP ✅
> **Zaimplementowano**: Cały `browser-service.ts` przepisany — Playwright API zastąpione natywnym CDP. Accessibility snapshot via `Runtime.evaluate`, input via `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent`, screenshot via `Page.captureScreenshot`. Wszystkie metody (click, type, hover, scroll, tabs, wait, fillForm, extractText) działają na CDPPage/CDPBrowser.

- [x] Accessibility snapshot via `Runtime.evaluate` (SNAPSHOT_SCRIPT) ✅
- [x] Input events via CDP `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent` ✅
- [ ] Network interception via `Fetch.enable` + `Fetch.requestPaused` (przyszła iteracja)
- [x] `Page.captureScreenshot` via CDP ✅

### Krok 1.3 — User Profile Bridge ✅
> **Zaimplementowano**: BrowserService zachowuje pełną logikę user profile bridge — wykrywanie profili Chrome/Edge/Brave, podłączanie do istniejącej sesji, fallback na profil KxAI, SQLite backup cookies. Teraz działa przez natywny CDP zamiast Playwright.

- [x] Agent korzysta z OTWARTEJ przeglądarki użytkownika ✅ (zachowane z oryginalnej implementacji)
- [x] Fallback na dedykowany profil KxAI ✅
- [ ] Permission dialog: "KxAI chce użyć Twojej przeglądarki — pozwolić?" (przyszła iteracja)

### Krok 1.4 — Anti-detection layer
- [ ] CDP ma wbudowane sposoby na omijanie bot detection:
  - `Page.addScriptToEvaluateOnNewDocument` — nadpisz `navigator.webdriver`
  - Realistic input delays via `Input.dispatchMouseEvent` z timestamps
  - User-agent inheritance z prawdziwego Chrome
- [ ] Agent działa jak człowiek — nie jak Selenium/Playwright bot

### Krok 1.5 — Streaming page observation
- [ ] CDP `Page.domContentEventFired`, `Page.loadEventFired` — śledź nawigację
- [ ] MutationObserver via `Runtime.evaluate` — reaguj na zmiany DOM w real-time
- [ ] Agent "widzi" stronę w continuous mode, nie tylko na żądanie snapshot

---

## Faza 2: AI & Agent Core Upgrade (Tydzień 3-5)

### Krok 2.1 — Native Function Calling ✅
> **Zaimplementowano**: `tool-schema-converter.ts` konwertuje `ToolDefinition[]` na format OpenAI/Anthropic. `ai-service.ts` ma `streamMessageWithNativeTools()` i `continueWithToolResults()`. `agent-loop.ts` ma `_streamWithNativeToolsFlow()` z parallel tool calls. Feature flag: `config.useNativeFunctionCalling` (default: true).

- [x] Przepisz `ai-service.ts` na native tool use ✅
- [x] Dodaj JSON Schema do każdego tool (zamiast prostego `Record<string, {type, description}>`) ✅ (`tool-schema-converter.ts`)
- [x] Obsłuż `parallel_tool_calls` — AI może wywołać N narzędzi jednocześnie ✅
- [x] Zachowaj backward compatibility z ```tool blokami jako fallback ✅
- [x] Ujednolicenie tool result format: `tool_call_id` mapping ✅

### Krok 2.2 — Structured Outputs ✅
> **Zaimplementowano**: Zod schemas w `src/shared/schemas/ai-responses.ts` (ScreenAnalysis, CronSuggestion, MemoryUpdate, TakeControl). OpenAI screen analysis upgraded z `json_object` na `json_schema` (Structured Outputs) z `buildOpenAIJsonSchema()`. Anthropic regex naprawiony (greedy → non-greedy). Wszystkie parsery w `response-processor.ts` używają `safeParse()` z logowaniem błędów. Zduplikowane parsery usunięte z `agent-loop.ts` — delegacja do `ResponseProcessor`.

- [x] OpenAI Structured Outputs (`json_schema`) dla screen analysis ✅
- [x] Zod schema validation dla cron/memory/take_control parserów ✅
- [x] Deduplikacja: agent-loop deleguje do ResponseProcessor ✅
- [x] Error logging zamiast cichych `catch {}` ✅
- [ ] Structured Outputs dla intent classification (przyszła iteracja)

### Krok 2.3 — Memory v2 — SQLite-backed ✅
> **Zaimplementowano**: `database-service.ts` (~430 LOC) z better-sqlite3. WAL mode, FTS5 full-text search, prepared statements, schema migrations. `memory.ts` zaktualizowany — SQLite jako primary storage z JSON fallback. Auto-migracja starych JSON sesji. Retention policy (archive 30d, delete 90d). Graceful shutdown z WAL checkpoint w `main.ts`.

- [x] Migruj conversation storage z JSON files do SQLite ✅ (database-service.ts)
- [x] Zachowaj markdown memory files (SOUL.md, USER.md, MEMORY.md) ✅
- [x] SQLite: transakcje, indexy, FTS5 full-text search, WAL mode ✅
- [x] Retention policy: auto-archive sessions >30 dni, delete >90 dni ✅
- [x] Auto-import starych JSON sessions do SQLite ✅

### Krok 2.4 — RAG v2 — SQLite vec + hybrid search ✅
> **Zaimplementowano**: `sqlite-vec` (v0.1.7-alpha.2) załadowany do better-sqlite3. Schema v2 w `database-service.ts` z tabelami: `rag_chunks` (content+metadata), `rag_chunks_fts` (FTS5 unicode61), `rag_embeddings` (vec0 float[1536] cosine distance), `embedding_cache` (BLOB LRU 200K entries), `rag_folders` (stats). Hybrid search via Reciprocal Rank Fusion (RRF, k=60, vectorWeight=0.7). `embedding-service.ts` — SQLite persistent cache + hot cache (Map, 10K entries). `rag-service.ts` — in-memory chunks[] + index.json zastąpione SQLite storage. Legacy migration (JSON → SQLite) z auto-cleanup.

- [x] Zamień in-memory embedding storage na SQLite vec extension ✅ (vec0 virtual table z cosine distance)
- [x] Hybrid search: vector similarity + FTS5 keyword search → RRF re-ranking ✅
- [x] Incremental indexing z `mtime` tracking persystowany w SQLite ✅ (rag_folders table)
- [ ] Streaming chunking — nie ładuj całego pliku do RAM, streamuj i chunkuj (przyszła iteracja)

### Krok 2.5 — Multi-provider AI abstraction
- [ ] Stwórz `AIProvider` interface:
  ```typescript
  interface AIProvider {
    chat(messages: Message[], options: ChatOptions): AsyncGenerator<ChatChunk>;
    embed(texts: string[]): Promise<number[][]>;
    vision(message: string, image: string): Promise<string>;
    supportedFeatures: Set<'function-calling' | 'vision' | 'streaming' | 'structured-output'>;
  }
  ```
- [ ] Implementacje: `OpenAIProvider`, `AnthropicProvider`, `OllamaProvider` (local!)
- [ ] **Ollama support** — agent działa offline z lokalnymi modelami (llama, mistral, phi)
- [ ] Hot-swap providerów bez restartu
- [ ] Cost tracking per provider per session

### Krok 2.6 — Agent Loop v2 — Modularization ✅
> **Zaimplementowano**: Agent loop rozbity na 6 wyodrębnionych modułów w `src/main/services/`. Orchestrator (`agent-loop.ts`) deleguje do: `tool-executor.ts`, `response-processor.ts`, `context-builder.ts`, `heartbeat-engine.ts`, `take-control-engine.ts`, `cron-executor.ts`. Moduły mają własne odpowiedzialności, łatwo testowalne.

- [x] Rozbij na modularną architekturę ✅ (6 modułów wyodrębnionych)
- [ ] EventEmitter-based communication między modułami (przyszła iteracja)
- [ ] Cancellation via `AbortController` (zamiast custom `cancelProcessing` flag)
- [x] Parallel tool execution gdy AI requestuje multiple tools ✅ (via native FC)

---

## Faza 3: Architektura & Stabilność (Tydzień 5-7)

### Krok 3.1 — IPC v2 — Typesafe channel constants ✅
> **Zaimplementowano**: `src/shared/ipc-schema.ts` z 95 stałymi kanałów w 3 grupach: `Ch` (74 handle channels), `Ev` (19 event channels), `ChSend` (2 send channels). Wszystkie string literals w `ipc.ts`, `preload.ts` i `main.ts` zamienione na stałe. Zero magic strings.

- [x] Stałe IPC kanałów w `ipc-schema.ts` (Ch, Ev, ChSend) ✅
- [x] Migracja `ipc.ts` — 74 handlery na stałe Ch.* ✅
- [x] Migracja `preload.ts` — 74+ wywołań na stałe Ch.*/Ev.*/ChSend.* ✅
- [x] Migracja `main.ts` — eventy na stałe Ev.* ✅
- [ ] Runtime validation parametrów IPC via zod schemas (przyszła iteracja)
- [ ] Pełny codegen bridge z typami (przyszła iteracja)

### Krok 3.2 — Service Container / Dependency Injection ✅
> **Zaimplementowano**: `service-container.ts` z typowanym `ServiceMap` (22 serwisy). `get<K>(key)` z pełnym TS inference. 6-fazowa `init()` (dependency order) zastępuje ~100 linii ręcznego wiring. 6-fazowa `shutdown()` centralizuje graceful cleanup. `getIPCServices()` mapuje na interfejs kompatybilny z `setupIPC()`. `main.ts` zredukowany z ~685 do ~460 linii.

- [x] Typowany `ServiceContainer` z `ServiceMap` interface (22 klucze) ✅
- [x] `get<K>(key)` — generyczny accessor z TypeScript inference ✅
- [x] 6-fazowa `init()` w kolejności zależności ✅
- [x] 6-fazowa `shutdown()` — centralizacja graceful cleanup ✅
- [x] `getIPCServices()` — backward compat z `setupIPC()` ✅
- [x] `main.ts` zredukowany o ~225 linii ✅

### Krok 3.3 — Async-first file operations ✅
> **Zaimplementowano**: 7 najczęściej wywoływanych serwisów skonwertowanych z `fs.*Sync` na `fs/promises`. Fire-and-forget pattern (`void save()`) dla nie-krytycznych operacji, `await` dla krytycznych. 18 callerów prompt-service zaktualizowanych. Testy przepisane na async mocki.

- [x] Skonwertuj 7 serwisów: config, prompt-service, memory, security, security-guard, workflow-service, cron-service ✅
- [x] Fire-and-forget pattern dla nie-krytycznych zapisów ✅
- [x] Atomic writes w cron-service (write + rename) ✅
- [ ] Ciężkie serwisy (RAG, embedding, browser) → worker threads (Faza 7.2)
- [ ] `electron-log` z async file rotation

### Krok 3.4 — Graceful shutdown ✅
> **Zaimplementowano**: 6-fazowy sequential shutdown w `app.on('will-quit')` z 5s timeout wrapper. Fazy: 1) Stop processing (agentLoop, screenMonitor, cron), 2) Close network (meetingCoach, transcription, browser, dashboard), 3) Stop watchers (RAG, plugins), 4) Cleanup temp (TTS), 5) Flush caches (embedding), 6) Close DB (memory/SQLite). Promise.race z timeout.

- [x] Sequential cleanup z 6 fazami ✅
- [x] 5s timeout wrapper (prevent hanging) ✅
- [x] 11 serwisów zamykanych (było 4) ✅
- [x] Logging każdego kroku ✅

### Krok 3.5 — Error handling & crash reporting ✅
> **Zaimplementowano**: `KxAIError` class w `shared/types/errors.ts` z ~30 `ErrorCode` enum values, severity levels, JSON serialization. `ErrorBoundary.tsx` — React error boundary per-view (Onboarding, Chat, Cron, Meeting, Settings) z fallback UI i "Spróbuj ponownie" button. CSS styles matching dark theme.

- [x] React Error Boundaries (per-view w App.tsx) ✅
- [x] Main process: `process.on('uncaughtException')`, `process.on('unhandledRejection')` ✅ (Quick Wins)
- [x] Structured error types (`KxAIError`, `ErrorCode`, `ErrorSeverity`) ✅
- [ ] Optional: Sentry/crash reporting (opt-in w settings)

### Krok 3.6 — Configuration v2
- [ ] Migruj z JSON file do `electron-store` z schema validation (zod)
- [ ] Reactive config — serwisy subskrybują zmiany:
  ```typescript
  config.onChange('aiProvider', (newVal, oldVal) => {
    aiService.reinitialize();
  });
  ```
- [ ] Config migrations (version tracking, auto-upgrade stary format)
- [ ] Secrets NIGDY w config — zawsze w `safeStorage` (jest w security.ts, dobrze)

---

## Faza 4: Frontend Redesign (Tydzień 7-9)

### Krok 4.1 — UI Framework upgrade ✅
> **Zaimplementowano**: CSS Modules z `localsConvention: 'camelCase'` w Vite. 8 komponentów wyodrębnionych z monolitycznego `global.css` (2846→181 linii): FloatingWidget, ErrorBoundary, ProactiveNotification, ChatPanel, OnboardingWizard, SettingsPanel, CronPanel, CoachingOverlay. Utility `cn()` do łączenia klas. TypeScript declarations (`css-modules.d.ts`). Design tokens zachowane w `:root` global.css.

- [x] CSS Modules zamiast monolitycznego `global.css` ✅ (8 plików `*.module.css`)
- [x] `cn()` utility (`src/renderer/utils/cn.ts`) do warunkowego łączenia klas ✅
- [x] `composes:` CSS Modules feature dla wariantów (np. `.btnActive { composes: btn; }`) ✅
- [x] Design tokens (CSS custom properties) zachowane w global.css `:root` ✅
- [ ] Dark/Light theme via CSS custom properties (przyszła iteracja)

### Krok 4.2 — Component library
- [ ] Wyodrębnij reusable components:
  ```
  renderer/components/
  ├── ui/                    # Atomic components
  │   ├── Button.tsx
  │   ├── Input.tsx
  │   ├── Modal.tsx
  │   ├── Toast.tsx
  │   ├── Tooltip.tsx
  │   ├── Badge.tsx
  │   ├── Spinner.tsx
  │   └── Card.tsx
  ├── chat/                  # Chat-specific
  │   ├── ChatPanel.tsx
  │   ├── MessageBubble.tsx
  │   ├── StreamingIndicator.tsx
  │   ├── ToolCallDisplay.tsx
  │   └── InputBar.tsx
  ├── dashboard/             # Dashboard widgets
  │   ├── AgentStatusBar.tsx
  │   ├── CronPanel.tsx
  │   ├── RAGPanel.tsx
  │   └── SystemMonitor.tsx
  └── layout/                # Layout components
      ├── FloatingWidget.tsx
      ├── PanelHeader.tsx
      └── NavigationTabs.tsx
  ```

### Krok 4.3 — State management
- [ ] Wprowadź lekki state management (zamiast prop drilling):
  - Opcja A: `zustand` (minimal, TS-friendly)
  - Opcja B: React Context + useReducer (zero dependency)
  - **Rekomendacja**: zustand — stores:
    - `useChatStore` — messages, streaming state, input
    - `useConfigStore` — config, reactive updates
    - `useAgentStore` — agent status, sub-agents, tools
    - `useMeetingStore` — meeting state, transcripts, coaching

### Krok 4.4 — Dashboard SPA refactor
> **Problem**: Dashboard to single HTML file (dashboard-spa.html) z inline JS.

- [ ] Przenieś dashboard do osobnego React view lub web component
- [ ] WebSocket client rewrite — reconnection, buffering
- [ ] Responsive design (mobile-friendly — do przyszłego mobile companion)

### Krok 4.5 — Rich interactions
- [ ] Drag & Drop files do czatu → auto-upload + analiza (PDF, obrazki, kod)
- [ ] Inline tool call visualization (expandable cards zamiast tekstu)
- [ ] Image previews w czacie (screenshoty, wykresy)
- [ ] Code blocks z syntax highlighting (Prism.js/Shiki)
- [ ] Keyboard shortcuts panel (Ctrl+K search, Ctrl+Shift+K take-control, etc.)

---

## Faza 5: Testing & Quality (Tydzień 9-10)

### Krok 5.1 — Unit tests ✅
> **Zaimplementowano**: Vitest setup (`vitest.config.ts`), 4 pliki testowe (172 testy). Pokryte: `IntentDetector` (25 wzorców PL/EN, confidence, context, capture groups, shouldAuto* metody, detectAll), `SecurityGuard` (16 niebezpiecznych + 9 bezpiecznych komend, SSRF, path validation, rate limiting, shell sanitization, audit), `ContextManager` (estimateTokens, getModelContextLimit, configureForModel, buildContextWindow, pin/unpin, scoring, summary generation), `PromptService` (load priority, render, exists, list, copyToUser, cache).

- [x] Setup: Vitest (szybkie, ESM-native, Vite-compatible) ✅
- [x] Priorytet testowania:
  1. ~~`ToolLoopDetector` — critical safety mechanism~~ (do zrobienia w przyszłej iteracji)
  2. `SecurityGuard` — command injection, SSRF, path traversal ✅
  3. `ContextManager` — token budgeting, importance scoring ✅
  4. `IntentDetector` — intent recognition accuracy ✅
  5. `PromptService` — template rendering, variable substitution ✅
  6. Tool parameter validation (po dodaniu zod schemas)

### Krok 5.2 — Integration tests
- [ ] IPC round-trip tests (main ↔ renderer)
- [ ] AI service mock — test tool calling flow bez API calls
- [ ] RAG pipeline test — index → search → result quality
- [ ] Cron scheduling accuracy

### Krok 5.3 — E2E tests
- [ ] Electron E2E z Playwright Test (osobne od browser-service!)
- [ ] Scenariusze: onboarding → chat → tool use → settings
- [ ] Screenshot regression testing

### Krok 5.4 — CI pipeline update
- [ ] Dodaj test step do GitHub Actions workflow
- [ ] Type checking + linting jako gate
- [ ] Coverage report (minimum: 60% na critical paths)
- [ ] Auto-release z semantic versioning

---

## Faza 6: Nowe funkcje — Differentiators (Tydzień 10-14)

> Te funkcje robią z KxAI produkt, którego nie ma na rynku.

### Krok 6.1 — Smart Clipboard Pipeline
- [ ] Monitor schowka w tle (opt-in):
  - Skopiowany tekst → auto-detect type (URL, code, email, address, JSON)
  - AI enrichment: URL → auto-summary, code → explain, JSON → format
  - Clipboard history z searchem
- [ ] "Paste with AI" — Ctrl+Shift+V transformuje zawartość przed wklejeniem

### Krok 6.2 — Workflow Automator (Macro Recorder)
- [ ] Nagrywaj sekwencje akcji użytkownika:
  - Kliknięcia, keyboard input, nawigacja, tool calls
  - AI analizuje i generuje powtarzalny "workflow script"
- [ ] Replay z parametryzacją:
  ```
  User: "Zrób to samo co wczoraj z raportem, ale dla Q2"
  Agent: [replay recorded workflow z podmienionymi parametrami]
  ```

### Krok 6.3 — Knowledge Graph
- [ ] Buduj graf wiedzy o użytkowniku:
  - Osoby (kontakty, relacje, firmy)
  - Projekty (technologie, deadlines, status)
  - Preferencje (narzędzia, godziny pracy, style komunikacji)
  - Nawyki (co robi o której, ile czasu na co)
- [ ] SQLite + JSON-LD format
- [ ] Agent "zna" użytkownika coraz lepiej z każdym dniem

### Krok 6.4 — Proactive Intelligence Engine
> Upgrade obecnego heartbeat do prawdziwego proaktywnego AI.

- [ ] **Context Fusion**: łączenie informacji z:
  - Ekranu (T0/T1/T2 monitoring)
  - Kalendarza (ICS import lub Google Calendar API)
  - Emaila (IMAP/Gmail API — opt-in)
  - Pogody/news (RSS/API)
  - System state (battery, disk, processes)
- [ ] **Predictive Actions**:
  - "Za 15 minut masz spotkanie z Jackiem — przygotowałem briefing"
  - "Twój dysk ma 5% wolnego miejsca — mam posprzątać temp files?"
  - "Pracujesz nad bug #342 od 3h — może spojrzysz na problem z innej strony?"
- [ ] **Learning Loop**: agent uczy się kiedy user appreciates sugestie vs. ignoruje

### Krok 6.5 — Local LLM Support (Ollama)
- [ ] Integracja z Ollama — agent działa bez internetu:
  - Auto-detect Ollama na localhost:11434
  - Model selection (llama 3.3, mistral, phi-4, qwen)
  - Fallback chain: OpenAI → Anthropic → Ollama → offline mode
- [ ] Hybrid mode: Ollama do szybkich/prywatnych zapytań, cloud do złożonych
- [ ] Embeddingi lokalne (nomic-embed-text) — RAG bez OpenAI API key

### Krok 6.6 — File Intelligence
- [ ] Agent "rozumie" pliki na komputerze:
  - PDF extraction z poprawnym layoutem (pdf-parse jest, ale usprawnij)
  - DOCX/XLSX parsing (dodaj `mammoth`, `xlsx`)
  - Image analysis (local CLIP lub cloud vision)
  - Audio transcription (Whisper local lub API)
- [ ] "Przeanalizuj ten folder" → deep analysis z raportem
- [ ] "Znajdź wszystkie dokumenty o umowie z X" → RAG search + file opening

---

## Faza 7: Production Hardening (Tydzień 14-16)

### Krok 7.1 — Auto-updater ✅
> **Zaimplementowano**: `updater-service.ts` (~220 LOC) z `electron-updater`. `autoUpdater.autoDownload = false` (user decyduje). Auto-check 10s po starcie + co 4h. Event handling: checking/available/not-available/downloading/downloaded/error. Push state do renderera via `Ev.UPDATE_STATE`. IPC: `Ch.UPDATE_CHECK`, `Ch.UPDATE_DOWNLOAD`, `Ch.UPDATE_INSTALL`, `Ch.UPDATE_GET_STATE`. Wired w ServiceContainer + shutdown Phase 1. CI/CD: `--publish always` + `GH_TOKEN` + `*.yml`/`*.blockmap` w GitHub Releases. `package.json` publish config: GitHub provider.

- [x] `electron-updater` z GitHub Releases ✅
- [x] Release notes w app ✅ (pushed via UpdateState.releaseNotes)
- [x] Update check na starcie + periodic (co 4h) ✅
- [ ] Delta updates (nie cały installer) — wymaga code signing (przyszła iteracja)

### Krok 7.2 — Performance optimization
- [ ] Lazy loading serwisów — nie inicjalizuj meeting-coach jeśli user go nie używa
- [ ] Worker threads dla CPU-intensive tasks:
  - TF-IDF embedding computation
  - PDF parsing
  - File scanning (RAG indexing)
- [ ] Memory leak detection (WeakRef + FinalizationRegistry)
- [ ] Profiling script (`npm run profile`)

### Krok 7.3 — Accessibility
- [ ] Keyboard navigation w całym UI
- [ ] Screen reader support (aria-labels)
- [ ] High contrast mode
- [ ] Reduced motion mode

### Krok 7.4 — Internationalization (i18n)
- [ ] Wyodrębnij stringi UI do translation files
- [ ] Support: PL (primary), EN (secondary)
- [ ] Język agenta = język UI (konfigurowalny)

### Krok 7.5 — Privacy & compliance
- [ ] "Data stays local" guarantee — wszystko w userData, nic na serwerze
- [ ] Opcjonalny telemetry z explicit opt-in
- [ ] Data export (GDPR compliance) — "Eksportuj wszystkie moje dane"
- [ ] Data deletion — "Usuń wszystko o mnie"
- [ ] Privacy policy generator na onboardingu

### Krok 7.6 — Packaging & distribution
- [ ] Podpisywanie kodu (Windows: code signing cert, macOS: Developer ID)
- [ ] Notarization (macOS)
- [ ] Microsoft Store submission
- [ ] Homebrew formula (macOS/Linux)
- [ ] Auto-generated changelog z commit messages

---

## Faza 8: Integration Hub — MCP Client (Tydzień 16-18)

> **Innowacja**: Zamiast budować każdą integrację od zera, KxAI łączy się z zewnętrznymi serwerami MCP (Model Context Protocol).
> Jedna implementacja daje dostęp do 2000+ istniejących serwerów — kalendarze, Gmail, Slack, Notion, GitHub, bazy danych, i więcej.

### Krok 8.1 — MCP Client Service ✅
> **Zaimplementowano**: `mcp-client-service.ts` (~350 LOC) z `@modelcontextprotocol/sdk`. 3 typy transportu (Streamable HTTP, SSE, stdio). Auto-discover tools via `client.listTools()`. Auto-register w ToolsService z prefiksem `mcp_{server}_{tool}`. Curated registry 12 popularnych serwerów. Dashboard MCP Hub z grafem + rejestrem serwerów.

- [x] `@modelcontextprotocol/sdk` zainstalowany ✅
- [x] Shared types (`McpServerConfig`, `McpServerStatus`, `McpHubStatus`, `McpRegistryEntry`) ✅
- [x] 3 transporty: StreamableHTTP (z SSE fallback), SSE, stdio ✅
- [x] Auto-discover + auto-register tools w ToolsService ✅
- [x] `ToolsService.unregister()` + `unregisterByPrefix()` — dynamic tool removal ✅
- [x] IPC: 9 kanałów Ch.MCP_* + 1 event Ev.MCP_STATUS ✅
- [x] ServiceContainer wiring (init Phase 5, shutdown Phase 2) ✅
- [x] Dashboard: MCP Hub page + serwery w grafie agenta (`.graph-node--mcp`) ✅
- [x] Curated registry: 12 serwerów (CalDAV, GitHub, Slack, Notion, Brave Search, etc.) ✅
- [x] Env vars UI — konfiguracja API keys/env per serwer (Settings panel → zakładka 🔌 MCP) ✅
- [ ] Auto-reconnect z exponential backoff
- [ ] MCP server health monitoring (ping interval)

### Krok 8.2 — Google Calendar via CalDAV MCP
- [ ] Integracja z `caldav-mcp` — CRUD eventów, recurrence, reminders
- [ ] UI w Settings do konfiguracji CalDAV URL + credentials
- [ ] Agent może: tworzyć eventy, sprawdzać kalendarz, przypominać o spotkaniach
- [ ] Proaktywne: "Za 15 min masz spotkanie z Jackiem"

### Krok 8.3 — Gmail / Email via MCP
- [ ] Integracja z MCP server do email (IMAP lub Gmail API)
- [ ] Agent może: czytać emaile, wysyłać odpowiedzi, szukać w skrzynce
- [ ] Proaktywne: "Masz 3 nowe emaile od klienta X"

### Krok 8.4 — Reminder Engine ✅
> **Zaimplementowano**: 3 narzędzia AI: `set_reminder`, `list_reminders`, `cancel_reminder`. Naturalny język PL/EN do cron: "jutro o 9:00", "za 2 godziny", "w piątek o 15:30", "codziennie o 8:00", "2025-03-15 10:00". One-shot scheduling z auto-disable (`CronJob.oneShot` + `runAt`). Prompte zaktualizowane (RESOURCEFUL.md + TOOLS.md). CronService rozszerzony o `runAt`-based scheduling.

- [x] Agent zapamiętuje reminders w cron jobs ✅ (set_reminder → CronJob z category:'reminder')
- [x] "Przypomnij mi jutro o 9:00 żeby wysłać raport" ✅ (parseReminderTime z PL/EN)
- [x] One-shot reminders z auto-disable po wykonaniu ✅ (CronJob.oneShot + runAt)
- [ ] Integration z kalendarzem — auto-tworzenie eventów z reminderów (wymaga Phase 8.2)

### Krok 8.5 — MCP Server Discovery
- [ ] Dynamiczny fetch rejestru z glama.ai/mcp/servers lub GitHub awesome-mcp-servers
- [ ] Search + filter w dashboard UI
- [ ] One-click install z auto-detect wymaganych env vars
- [ ] Community rating / popularity sorting

---

## Kolejność implementacji (prioritized backlog)

| # | Zadanie | Faza | Impact | Effort | Priorytet | Status |
|---|---------|------|--------|--------|-----------|--------|
| 1 | Native Function Calling | 2.1 | 🔴 Critical | M | P0 | ✅ Done |
| 2 | Browser CDP Bypass | 1.1-1.3 | 🔴 Critical | L | P0 | ✅ Done |
| 3 | Shared types + path aliases | 0.1 | 🟡 High | S | P0 | ✅ Done |
| 4 | SQLite memory + RAG | 2.3-2.4 | 🟡 High | L | P1 | ✅ Done |
| 5 | Agent Loop modularization | 2.6 | 🟡 High | L | P1 | ✅ Done |
| 6 | Unit tests (safety-critical) | 5.1 | 🟡 High | M | P1 | ✅ Done (172) |
| 7 | Async file operations | 3.3 | 🟢 Medium | M | P2 | ✅ Done (7 serwisów) |
| 8 | Error boundaries | 3.5 | 🟢 Medium | S | P2 | ✅ Done |
| 9 | Graceful shutdown | 3.4 | 🟢 Medium | S | P2 | ✅ Done |
| 10 | IPC typesafe bridge | 3.1 | 🟢 Medium | M | P2 | ✅ Done |
| 11 | Service container | 3.2 | 🟢 Medium | M | P2 | ✅ Done |
| 12 | Frontend CSS Modules | 4.1 | 🟢 Medium | M | P2 | ✅ Done (8 modułów) |
| 13 | Ollama local LLM | 2.5/6.5 | 🟡 High | M | P4 | ⬜ Odsunięty |
| 14 | Structured Outputs | 2.2 | 🟢 Medium | S | P3 | ✅ Done |
| 15 | Knowledge Graph | 6.3 | 🟡 High | XL | P3 | ⬜ |
| 16 | Workflow Automator | 6.2 | 🟡 High | XL | P3 | ⬜ |
| 17 | Auto-updater | 7.1 | 🟢 Medium | S | P3 | ✅ Done |
| 18 | MCP Client Service | 8.1 | 🟡 High | M | P2 | ✅ Done |
| 19 | i18n | 7.4 | 🟢 Medium | M | P4 | ⬜ |
| 20 | Clipboard Pipeline | 6.1 | 🟢 Medium | M | P4 | ⬜ |
| 21 | Google Calendar (CalDAV MCP) | 8.2 | 🟡 High | S | P3 | ⬜ |
| 22 | Reminder Engine | 8.4 | 🟡 High | M | P3 | ✅ Done |
| 23 | MCP Server Discovery | 8.5 | 🟢 Medium | M | P4 | ⬜ |

**Effort legend**: S = <1 dzień, M = 2-4 dni, L = 1-2 tygodnie, XL = 2+ tygodnie

---

## Zasady implementacji refactoru

1. **Backward compatible** — każda zmiana musi zachować istniejącą funkcjonalność
2. **Feature flags** — nowe systemy za flagami w config (`config.set('useNativeFunctionCalling', true)`)
3. **Incremental migration** — nie przepisuj wszystkiego na raz, migruj serwis po serwisie
4. **Test before refactor** — napisz test na obecne zachowanie ZANIM zmienisz kod
5. **One PR per step** — każdy krok to osobny PR z opisem zmian
6. **No gold plating** — zrób minimum viable, potem iteruj

---

## Quick wins (do zrobienia od razu, <30 min każdy)

- [x] Dodaj `"strict": true` do `tsconfig.main.json` (już jest, potwierdzone ✓) ✅
- [x] Dodaj `.nvmrc` z `v20` (enforce Node version) ✅
- [x] Dodaj `engines` do package.json (już jest ✓) ✅
- [x] Zamień `console.log` na tagged logger: `const log = createLogger('BrowserService')` ✅
- [x] Dodaj `process.on('unhandledRejection')` handler w main.ts ✅
- [x] Dodaj `app.on('render-process-gone')` handler ✅
- [x] Ustaw `electron-builder` `asar: true` (security — utrudnia reverse engineering) ✅
- [x] Dodaj CSP header w `session.defaultSession.webRequest` ✅
