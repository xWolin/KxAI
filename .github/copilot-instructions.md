# KxAI — Copilot Instructions

## Projekt

**KxAI** to personalny AI desktop agent (Electron 33 + React 19 + TypeScript 5.7 + Vite 6).
Agent działa jako floating widget na pulpicie, posiada czat z AI (OpenAI / Anthropic), system pamięci (markdown files), proaktywne notyfikacje, screen capture z vision, cron jobs, framework narzędzi (tools), workflow learning i time awareness.

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
│   │   └── index.ts        # Barrel re-export
│   └── constants.ts        # Stałe (limity, domyślne wartości)
├── main/                   # Electron main process
│   ├── main.ts             # Entry point, okno, tray, inicjalizacja serwisów
│   ├── ipc.ts              # IPC handlers (bridge main ↔ renderer)
│   ├── preload.ts          # Context bridge (window.kxai API)
│   └── services/
│       ├── ai-service.ts       # OpenAI + Anthropic SDK, streaming, vision, native FC
│       ├── tool-schema-converter.ts # ToolDefinition[] → OpenAI/Anthropic format (Faza 2.1 ✅)
│       ├── logger.ts           # Tagged logger: createLogger('Tag') (Quick Win ✅)
│       ├── memory.ts           # Markdown-based pamięć (~userData/workspace/memory/)
│       ├── screen-capture.ts   # Screenshot capture (desktopCapturer)
│       ├── cron-service.ts     # Cron jobs CRUD, scheduling, persistence
│       ├── tools-service.ts    # Extensible tools framework (30+ built-in)
│       ├── workflow-service.ts # Activity logging, pattern detection, time awareness
│       ├── agent-loop.ts       # Orchestrator: tool calling, heartbeat, cron execution
│       ├── cdp-client.ts        # Native CDP client (WebSocket) — replaces playwright-core (Faza 1.1 ✅)
│       ├── browser-service.ts  # CDP browser automation — native CDP (Faza 1.2 ✅)
│       ├── automation-service.ts # Desktop automation (mouse/keyboard via OS APIs)
│       ├── rag-service.ts      # RAG pipeline (chunking + embedding + search)
│       ├── embedding-service.ts # OpenAI embeddings + TF-IDF fallback
│       ├── context-manager.ts  # Inteligentne okno kontekstowe (token budget)
│       ├── screen-monitor.ts   # Tiered monitoring (T0/T1/T2)
│       ├── sub-agent.ts        # Multi-agent system
│       ├── meeting-coach.ts    # Real-time meeting coaching (Deepgram)
│       ├── plugin-service.ts   # Dynamic plugin loading
│       ├── security-guard.ts   # Security layer (SSRF, injection, rate limiting)
│       ├── prompt-service.ts   # Markdown-based prompt management
│       ├── intent-detector.ts  # User intent recognition (regex-based)
│       ├── tts-service.ts      # TTS (ElevenLabs / OpenAI / Web Speech)
│       ├── transcription-service.ts # Deepgram STT
│       ├── dashboard-server.ts # Localhost dashboard (Express + WebSocket)
│       └── config.ts          # Configuration persistence
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
│   │   └── CoachingOverlay.tsx     # Meeting coach overlay
│   └── styles/
│       └── global.css      # Wszystkie style (futuristic dark theme)
```

## Konwencje

- **Język**: Komunikaty UI i komentarze w kodzie po polsku tam gdzie to naturalne (UX), nazwy zmiennych/typów po angielsku
- **Typy**: Używaj TypeScript strict mode; współdzielone typy w `src/shared/types/` (canonical source), re-exportowane w serwisach dla backward compat
- **Path aliases**: `@shared/*` → `src/shared/*`, `@main/*` → `src/main/*`, `@renderer/*` → `src/renderer/*`
- **IPC**: Każdy nowy IPC handler dodaj w `ipc.ts`, expose w `preload.ts`, typuj w `types.ts` w interfejsie `KxAIBridge`
- **Styling**: Globalne CSS w `global.css`, BEM-like naming (`.component__element--modifier`), CSS custom properties (design tokens)
- **AI models**: OpenAI używa `max_completion_tokens` (nie `max_tokens`); GPT-5+ używa roli `developer` zamiast `system`
- **Tool calling**: Native function calling (OpenAI tools API / Anthropic tool_use) domyślnie włączone (`config.useNativeFunctionCalling`). Fallback na ```tool bloki gdy wyłączone.
- **Cron suggestions**: AI outputuje ```cron\n{JSON}\n``` bloki, agent-loop parsuje i proponuje użytkownikowi
- **Logging**: Używaj `createLogger('Tag')` z `src/main/services/logger.ts` zamiast `console.log/warn/error`
- **Persistence**: Dane w `app.getPath('userData')/workspace/` (memory/, cron/, workflow/)

## Komendy

```bash
npm run dev          # Uruchom w trybie dev (Vite + Electron)
npm run build        # Zbuduj produkcyjnie
npm run dist         # Zbuduj + spakuj (electron-builder)
npm run typecheck    # Sprawdź TypeScript (oba tsconfigi)
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
7. **RAG pipeline** — smart chunking per file type, embedding cache, incremental reindex
8. **Meeting Coach** — real-time Deepgram transcription + streaming AI coaching
9. **Sub-agent system** — izolowane zadania z własnym tool loop
10. **IntentDetector** — regex-based rozpoznawanie intencji (PL + EN)

## Zidentyfikowane problemy krytyczne

### P1: Browser Service — Playwright jako hard dependency ✅ ROZWIĄZANO
- **Problem**: `playwright-core` wymaga dodatkowych binariów chromium (~200MB), jest ciężki, problematyczny w packaging
- **Problem**: Korzysta z dedykowanego profilu — nie widzi cookies/sesji użytkownika
- **Rozwiązanie**: Faza 1 ✅ — Native CDP client (`cdp-client.ts`) + BrowserService przepisany na natywny CDP. `playwright-core` usunięty z dependencies.

### P2: Tool calling — niestandardowy format (```tool bloki)
- **Problem**: Zamiast native function calling API (OpenAI/Anthropic), AI musi generować markdown code blocks
- **Problem**: Łatwy do złamania, wymaga custom parsingu, nie działa z parallel tool calls
- **Rozwiązanie**: Patrz Faza 2, krok 1

### P3: Monolityczny ipc.ts (970 linii) i preload.ts (292 linie)
- **Problem**: Każda nowa funkcja to zmiany w 3 plikach (ipc + preload + types)
- **Problem**: Brak walidacji parametrów IPC, brak typesafe bridge
- **Rozwiązanie**: Patrz Faza 3, krok 2

### P4: Brak testów
- **Problem**: Zero testów — unit, integration, e2e
- **Rozwiązanie**: Patrz Faza 5

### P5: Frontend — jeden plik CSS (global.css), brak component library
- **Problem**: Skalowanie UI jest trudne, brak design system
- **Rozwiązanie**: Patrz Faza 4

### P6: Brak error boundaries i crash reporting
- **Problem**: Uncaught error = biały ekran, brak telemetrii
- **Rozwiązanie**: Patrz Faza 3, krok 5

### P7: Synchronous fs operations blokujące main process
- **Problem**: `fs.readFileSync`, `fs.writeFileSync` w wielu serwisach blokują event loop
- **Rozwiązanie**: Patrz Faza 3, krok 3

### P8: Memory service — flat file based, nie skaluje się
- **Problem**: JSON session files, brak search, brak retention policy
- **Rozwiązanie**: Patrz Faza 2, krok 3

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

### Krok 2.2 — Structured Outputs
- [ ] Użyj OpenAI Structured Outputs (`response_format: { type: 'json_schema' }`) dla:
  - Screen analysis responses (`{hasInsight, message, context}`)
  - Cron suggestions (schema zamiast ```cron bloków)
  - Memory updates (schema zamiast ```update_memory bloków)
  - Intent classification
- [ ] Eliminuje potrzebę custom parsingu — AI MUSI zwrócić valid JSON

### Krok 2.3 — Memory v2 — SQLite-backed
> **Problem**: Flat files nie skalują się, brak search, brak retention.

- [ ] Migruj conversation storage z JSON files do SQLite:
  ```sql
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    type TEXT DEFAULT 'chat',
    session_date TEXT NOT NULL,
    embedding BLOB,           -- optional embedding for semantic search
    token_count INTEGER,
    importance REAL DEFAULT 0.5
  );
  CREATE INDEX idx_messages_session ON messages(session_date);
  CREATE INDEX idx_messages_timestamp ON messages(timestamp);
  ```
- [ ] Zachowaj markdown memory files (SOUL.md, USER.md, MEMORY.md) — to jest dobre
- [ ] SQLite daje: transakcje, indexy, FTS5 full-text search, WAL mode
- [ ] Retention policy: auto-archive sessions >30 dni, kompresuj stare do summaries

### Krok 2.4 — RAG v2 — SQLite vec + hybrid search
> **Problem**: Obecny RAG trzyma embeddingi w pamięci (JSON cache) — nie skaluje.

- [ ] Zamień in-memory embedding storage na SQLite vec extension:
  ```sql
  CREATE VIRTUAL TABLE vec_chunks USING vec0(
    embedding float[1536]   -- OpenAI text-embedding-3-small dimension
  );
  ```
- [ ] Hybrid search: vector similarity + FTS5 keyword search → re-ranking
- [ ] Incremental indexing z `mtime` tracking (już jest!) ale persystowany w SQLite
- [ ] Streaming chunking — nie ładuj całego pliku do RAM, streamuj i chunkuj

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

### Krok 2.6 — Agent Loop v2 — Event-driven architecture
> **Problem**: Obecny agent-loop to 2056-linijkowy monolit.

- [ ] Rozbij na modularną architekturę event-driven:
  ```
  agent/
  ├── orchestrator.ts          # Event bus + lifecycle
  ├── tool-executor.ts         # Tool calling + parallel execution
  ├── context-builder.ts       # System prompt assembly
  ├── heartbeat-engine.ts      # Autonomous mode
  ├── take-control-engine.ts   # Desktop automation mode
  ├── cron-executor.ts         # Cron job runner
  └── memory-manager.ts        # Context compaction + flush
  ```
- [ ] EventEmitter-based communication między modułami
- [ ] Cancellation via `AbortController` (zamiast custom `cancelProcessing` flag)
- [ ] Parallel tool execution gdy AI requestuje multiple tools

---

## Faza 3: Architektura & Stabilność (Tydzień 5-7)

### Krok 3.1 — IPC v2 — Typesafe bridge generator
> **Problem**: 970 linii ipc.ts, 292 linie preload.ts — ręczna synchronizacja.

- [ ] Stwórz system auto-generowania IPC bridge:
  ```typescript
  // Definicja w jednym miejscu:
  const ipcSchema = defineIPC({
    'ai:stream-message': {
      params: z.object({ message: z.string(), context: z.string().optional() }),
      returns: z.object({ success: z.boolean(), error: z.string().optional() }),
    },
    // ...
  });

  // Auto-generowane: preload bridge, renderer types, main handlers
  ```
- [ ] Alternatywnie: `electron-trpc` lub custom codegen script
- [ ] Runtime validation parametrów IPC via zod schemas
- [ ] Eliminuje 90% boilerplate w ipc.ts/preload.ts

### Krok 3.2 — Service Container / Dependency Injection
> **Problem**: main.ts tworzy 22 serwisy ręcznie, wiring jest manualny.

- [ ] Stwórz prosty service container:
  ```typescript
  const container = new ServiceContainer();
  container.register('config', ConfigService);
  container.register('security', SecurityService, ['config']);
  container.register('ai', AIService, ['config', 'security', 'memory']);
  // Auto-resolve dependencies, lazy init, singleton by default
  ```
- [ ] Services deklarują swoje zależności — container je wstrzykuje
- [ ] Lifecycle hooks: `onInit()`, `onReady()`, `onShutdown()`
- [ ] Eliminuje 100+ linii manual wiring w main.ts

### Krok 3.3 — Async-first file operations
- [ ] Zastąp wszystkie `fs.readFileSync`/`fs.writeFileSync` asynchronicznymi odpowiednikami
- [ ] Dla krytycznych ścieżek (config load on startup) użyj `fs.readFileSync` z komentarzem
- [ ] Dodaj file operation queue z debouncing (config save, session save)
- [ ] `electron-log` z async file rotation

### Krok 3.4 — Graceful shutdown
- [ ] Zamknij wszystkie zasoby poprawnie:
  - SQLite connections (WAL checkpoint)
  - CDP WebSocket connections
  - Dashboard HTTP server
  - Deepgram WebSocket
  - Pending cron jobs
  - Running sub-agents
  - File watchers (RAG)
- [ ] `app.on('before-quit')` → sequential cleanup z timeout

### Krok 3.5 — Error handling & crash reporting
- [ ] React Error Boundaries (per-component, nie globalny)
- [ ] Main process: `process.on('uncaughtException')`, `process.on('unhandledRejection')`
- [ ] Structured error types:
  ```typescript
  class KxAIError extends Error {
    constructor(
      message: string,
      public code: ErrorCode,
      public recoverable: boolean,
      public context?: Record<string, unknown>
    ) { super(message); }
  }
  ```
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

### Krok 4.1 — UI Framework upgrade
- [ ] Dodaj CSS-in-JS lub CSS Modules zamiast monolitycznego `global.css`:
  - Opcja A: `CSS Modules` (zero runtime overhead, natural for React)
  - Opcja B: `Tailwind CSS` (rapid prototyping, design system)
  - **Rekomendacja**: CSS Modules + design tokens
- [ ] Design system — stałe kolory, spacing, typografia jako CSS custom properties
- [ ] Dark/Light theme via CSS custom properties (jest partial support, dociągnij)

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

### Krok 5.1 — Unit tests
- [ ] Setup: Vitest (szybkie, ESM-native, Vite-compatible)
- [ ] Priorytet testowania:
  1. `ToolLoopDetector` — critical safety mechanism
  2. `SecurityGuard` — command injection, SSRF, path traversal
  3. `ContextManager` — token budgeting, importance scoring
  4. `IntentDetector` — intent recognition accuracy
  5. `PromptService` — template rendering, variable substitution
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

### Krok 7.1 — Auto-updater
- [ ] `electron-updater` z GitHub Releases
- [ ] Delta updates (nie cały installer)
- [ ] Release notes w app
- [ ] Update check na starcie + periodic (co 4h)

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

## Kolejność implementacji (prioritized backlog)

| # | Zadanie | Faza | Impact | Effort | Priorytet |
|---|---------|------|--------|--------|-----------|
| 1 | Native Function Calling | 2.1 | 🔴 Critical | M | P0 |
| 2 | Browser CDP Bypass ✅ | 1.1-1.3 | 🔴 Critical | L | P0 ✅ |
| 3 | Shared types + path aliases | 0.1 | 🟡 High | S | P0 |
| 4 | SQLite memory + RAG | 2.3-2.4 | 🟡 High | L | P1 |
| 5 | Agent Loop modularization | 2.6 | 🟡 High | L | P1 |
| 6 | Unit tests (safety-critical) | 5.1 | 🟡 High | M | P1 |
| 7 | Async file operations | 3.3 | 🟢 Medium | M | P2 |
| 8 | IPC typesafe bridge | 3.1 | 🟢 Medium | M | P2 |
| 9 | Service container | 3.2 | 🟢 Medium | M | P2 |
| 10 | Frontend CSS Modules | 4.1 | 🟢 Medium | M | P2 |
| 11 | Ollama local LLM | 2.5/6.5 | 🟡 High | M | P2 |
| 12 | Error boundaries | 3.5 | 🟢 Medium | S | P2 |
| 13 | Structured Outputs | 2.2 | 🟢 Medium | S | P3 |
| 14 | Knowledge Graph | 6.3 | 🟡 High | XL | P3 |
| 15 | Workflow Automator | 6.2 | 🟡 High | XL | P3 |
| 16 | Auto-updater | 7.1 | 🟢 Medium | S | P3 |
| 17 | i18n | 7.4 | 🟢 Medium | M | P4 |
| 18 | Clipboard Pipeline | 6.1 | 🟢 Medium | M | P4 |

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
