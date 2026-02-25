# KxAI — Copilot Instructions

## Projekt

**KxAI** to personalny AI desktop agent (Electron 33 + React 19 + TypeScript 5.7 + Vite 6).
Agent działa jako floating widget na pulpicie, posiada czat z AI (OpenAI / Anthropic), system pamięci (SQLite + markdown files), proaktywne notyfikacje, screen capture z vision, cron jobs, framework narzędzi (tools), workflow learning, time awareness i integrację z kalendarzem (CalDAV).
RAG pipeline z SQLite-vec (hybrid search: vector + FTS5), native function calling, natywny CDP do automatyzacji przeglądarki, file intelligence (PDF/DOCX/XLSX/EPUB).

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
│   │   ├── file-intelligence.ts # FileMetadata, FileExtractionResult, FolderAnalysis (Faza 6.6 ✅)
│   │   ├── ai-provider.ts  # AIProvider interface (Faza 2.5 ✅)
│   │   ├── calendar.ts     # CalendarConfig, CalendarEvent, CalendarStatus (Faza 8.2 ✅)
│   │   ├── privacy.ts      # PrivacyDataSummary, PrivacyExportResult, PrivacyDeleteResult (Faza 7.5 ✅)
│   │   ├── clipboard.ts    # ClipboardEntry, ClipboardContentType, ClipboardConfig, ClipboardStatus (Faza 6.1 ✅)
│   │   ├── knowledge-graph.ts # KGEntity, KGRelation, KGSearchOptions, KGStats (Faza 6.3 ✅)
│   │   ├── errors.ts       # KxAIError class, ErrorCode enum, ErrorSeverity (Faza 3.5 ✅)
│   │   └── index.ts        # Barrel re-export (~95+ eksportowanych typów z 18 modułów)
│   └── constants.ts        # Stałe (limity, domyślne wartości)
│   └── ipc-schema.ts        # IPC channel/event constants: 119 Ch + 24 Ev + 2 ChSend = 145 kanały (Faza 3.1 ✅)
│   └── schemas/
│       ├── ai-responses.ts  # Zod schemas: ScreenAnalysis, CronSuggestion, MemoryUpdate, TakeControl (Faza 2.2 ✅)
│       ├── config-schema.ts  # Zod schema for KxAIConfig — single source of truth (Faza 3.6 ✅)
│       └── ipc-params.ts    # Zod schemas for 54 IPC channel params + validatedHandle (Faza 3.1 ✅)
├── main/                   # Electron main process
│   ├── main.ts             # Entry point, okno, tray, ServiceContainer init (Faza 3.2 ✅)
│   ├── ipc.ts              # IPC handlers with zod validation (validatedHandle) (Faza 3.1 ✅)
│   ├── preload.ts          # Context bridge (window.kxai API)
│   └── services/
│       ├── service-container.ts # DI container: typed ServiceMap (31 kluczy), 6-phase init/shutdown (Faza 3.2 ✅)
│       ├── ai-service.ts       # Multi-provider AI facade, streaming, vision, native FC (Faza 2.5 ✅)
│       ├── providers/
│       │   ├── openai-provider.ts   # OpenAI AIProvider implementation (Faza 2.5 ✅)
│       │   └── anthropic-provider.ts # Anthropic AIProvider implementation (Faza 2.5 ✅)
│       ├── tool-schema-converter.ts # ToolDefinition[] → OpenAI/Anthropic format (Faza 2.1 ✅)
│       ├── logger.ts           # Tagged logger: createLogger('Tag') (Quick Win ✅)
│       ├── memory.ts           # Markdown-based pamięć (~userData/workspace/memory/)
│       ├── screen-capture.ts   # Screenshot capture (desktopCapturer)
│       ├── cron-service.ts     # Cron jobs CRUD, scheduling, persistence
│       ├── tools-service.ts    # Extensible tools framework (45+ tools, 8 grup, 2500 LOC)
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
│       ├── embedding-worker.ts  # Worker thread for TF-IDF: buildIDF + embedBatch (Faza 7.2 ✅)
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
│       ├── file-intelligence.ts # File analysis: PDF/DOCX/XLSX/EPUB extraction, search, folder analysis (718 LOC, Faza 6.6 ✅)
│       ├── calendar-service.ts  # CalDAV calendar integration: tsdav + node-ical (852 LOC, Faza 8.2 ✅)
│       ├── privacy-service.ts   # GDPR compliance: data summary, export, deletion (Faza 7.5 ✅)
│       ├── clipboard-service.ts # Smart Clipboard Pipeline: monitoring, history, content detection, AI tools (860 LOC, Faza 6.1 ✅)
│       ├── knowledge-graph-service.ts # Knowledge Graph: SQLite entity-relation store, FTS5, BFS traversal, 6 AI tools (794 LOC, Faza 6.3 ✅)
│       ├── proactive-engine.ts  # Proactive Intelligence Engine: rule-based notifications, context fusion, learning loop (814 LOC, Faza 6.4 ✅)
│       └── config.ts          # Configuration v2: Zod-validated, typed, reactive, debounced (Faza 3.6 ✅)
├── renderer/               # React frontend
│   ├── App.tsx             # Routing z zustand stores (Faza 4.3 ✅)
│   ├── types.ts            # KxAIBridge interface + renderer-only types
│   ├── stores/              # Zustand state management (Faza 4.3 ✅)
│   │   ├── useNavigationStore.ts  # View routing + window resize side-effects
│   │   ├── useConfigStore.ts      # Config, proactive msgs, API key flags
│   │   ├── useAgentStore.ts       # Agent status, control, companion, RAG progress
│   │   ├── useChatStore.ts        # Messages, streaming, input state
│   │   ├── useStoreInit.ts        # Centralized IPC event subscriptions
│   │   └── index.ts               # Barrel export
│   ├── components/
│   │   ├── FloatingWidget.tsx      # Draggable widget z manual drag detection
│   │   ├── ChatPanel.tsx           # Czat z AI, streaming, screenshot
│   │   ├── CronPanel.tsx           # UI zarządzania cron jobami
│   │   ├── SettingsPanel.tsx       # Konfiguracja (API keys, model, persona)
│   │   ├── OnboardingWizard.tsx    # Onboarding flow
│   │   ├── ProactiveNotification.tsx # Proactive message popup
│   │   ├── CoachingOverlay.tsx     # Meeting coach overlay
│   │   ├── ErrorBoundary.tsx       # React error boundary per-view (Faza 3.5 ✅)
│   │   └── ui/                     # Atomic component library (Faza 4.2 ✅)
│   │       ├── ui.module.css       # Shared CSS module for all UI components
│   │       ├── Button.tsx          # Variants: primary/secondary/danger/ghost/icon
│   │       ├── Input.tsx, Select.tsx, Textarea.tsx, Toggle.tsx
│   │       ├── Label.tsx, Badge.tsx, Spinner.tsx, ProgressBar.tsx
│   │       ├── Section.tsx, PanelHeader.tsx, Tabs.tsx, EmojiPicker.tsx
│   │       ├── EmptyState.tsx      # Placeholder with icon/title/subtitle
│   │       └── index.ts            # Barrel export
│   ├── i18n/                # Internationalization (Faza 7.4 ✅)
│   │   ├── index.ts            # useTranslation() hook, standalone t(), translate()
│   │   ├── pl.ts               # Polish translations (~230 keys)
│   │   └── en.ts               # English translations (~230 keys)
│   └── styles/
│       └── global.css      # Design tokens + animations (futuristic dark theme)
```

## Konwencje

- **Język**: Komunikaty UI i komentarze w kodzie po polsku tam gdzie to naturalne (UX), nazwy zmiennych/typów po angielsku
- **Typy**: Używaj TypeScript strict mode; współdzielone typy w `src/shared/types/` (canonical source), re-exportowane w serwisach dla backward compat
- **Path aliases**: `@shared/*` → `src/shared/*`, `@main/*` → `src/main/*`, `@renderer/*` → `src/renderer/*`
- **IPC**: Kanały IPC definiowane jako stałe w `src/shared/ipc-schema.ts` (109 Ch + 24 Ev + 2 ChSend = 135 kanały). Każdy nowy handler dodaj w `ipc.ts` (1177 LOC) używając stałych, expose w `preload.ts`, typuj w `types.ts`. Parametry walidowane runtime z zod w `src/shared/schemas/ipc-params.ts` via `validatedHandle()` (54 schematy)
- **DI**: Serwisy rejestrowane w `ServiceContainer` (`service-container.ts`). ServiceMap ma 32 kluczy. Dostęp: `container.get('nazwa')`. Nowe serwisy dodaj do `ServiceMap` + `init()` + `shutdown()`
- **State management**: Zustand stores w `src/renderer/stores/`. 4 stores: `useNavigationStore`, `useConfigStore`, `useAgentStore`, `useChatStore`. IPC event subscriptions scentralizowane w `useStoreInit`. Import: `import { useAgentStore } from '../stores'`
- **Styling**: CSS Modules per-component (`*.module.css`), `cn()` utility, design tokens w `global.css` `:root`. Import: `import s from './Comp.module.css'`
- **UI components**: Reusable atomic components w `src/renderer/components/ui/`. Import: `import { Button, Input, Badge } from '../ui'`. Nie duplikuj styli — użyj istniejących komponentów
- **i18n**: Lightweight custom i18n w `src/renderer/i18n/`. Hook: `const { t } = useTranslation()` (React FC), standalone `t()` z `import { t } from '../i18n'` (class components). ~230 kluczy tłumaczeń. Fallback: locale → PL → raw key. Interpolacja: `t('key', { name: 'value' })`. Język konfigurowalny w Settings (General tab) via `config.userLanguage`
- **AI models**: OpenAI używa `max_completion_tokens` (nie `max_tokens`); GPT-5+ używa roli `developer` zamiast `system`
- **Tool calling**: Native function calling (OpenAI tools API / Anthropic tool_use) domyślnie włączone (`config.useNativeFunctionCalling`). Fallback na ```tool bloki gdy wyłączone.
- **Cron suggestions**: AI outputuje ```cron\n{JSON}\n``` bloki, agent-loop parsuje i proponuje użytkownikowi
- **Logging**: Używaj `createLogger('Tag')` z `src/main/services/logger.ts` zamiast `console.log/warn/error`
- **Testing**: Vitest z mockami electron/fs. Testy w `tests/`. Konwencja: `tests/<service-name>.test.ts`. Testy środowiskowe w `tests/environment/`. 507 testów w 13 plikach. Coverage thresholds (30/25/20% lines/functions/branches). Nowe testy uruchamiaj `npm run test:env` do preflight
- **Persistence**: SQLite (better-sqlite3, WAL) jako primary storage (sesje, RAG chunks, embeddings, cache). Markdown files dla pamięci agenta (SOUL.md, USER.md, MEMORY.md). Dane w `app.getPath('userData')/workspace/` (memory/, cron/, workflow/)

## Komendy

```bash
npm run dev          # Uruchom w trybie dev (Vite + Electron)
npm run build        # Zbuduj produkcyjnie
npm run dist         # Zbuduj + spakuj (electron-builder)
npm run typecheck    # Sprawdź TypeScript (oba tsconfigi)
npm run test         # Uruchom testy (Vitest)
npm run test:watch   # Testy w watch mode
npm run test:coverage # Testy z coverage report (lcov + text)
npm run test:env     # Testy środowiskowe (environment preflight)
npm run test:security # Testy security audit
npm run preflight    # Pełny preflight: env tests + typecheck + format
npm run audit:prod   # npm audit tylko production deps
npm run format       # Formatuj kod (Prettier)
npm run format:check # Sprawdź formatowanie
npm run lint         # ESLint
npm run lint:fix     # ESLint z auto-fix
node scripts/preflight.js  # Cross-platform preflight check (standalone)
```

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`) z 2 jobami:
- **quality** (każdy push/PR): env preflight → lint → typecheck (main+renderer) → testy z coverage → format check → npm audit (prod)
- **build** (tagi/manual): matrix build Windows (NSIS), macOS (dmg+zip), Linux (AppImage+deb) → GitHub Release

Coverage thresholds: lines 30%, functions 25%, branches 20%, statements 30%. Reporter: text + lcov.

---

# PLAN REFACTORU — "KxAI v1.0 Production Ready"

> Audyt przeprowadzony: Luty 2026
> Cel: Przekształcenie prototypu w produkt gotowy do wysłania klientom.
> Filozofia: Nie kopiujemy rozwiązań — tworzymy nowe, lepsze.

## Podsumowanie audytu — Co już mamy (mocne strony)

1. **Solidna architektura serwisów** — wyraźny podział odpowiedzialności (31 serwisów w 27-klucz. ServiceMap + 4 deferred)
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
- **Rozwiązanie**: Faza 3.1 ✅ — `ipc-schema.ts` z 132 stałymi kanałów (106 Ch, 24 Ev, 2 ChSend). Zero string literals w ipc.ts/preload.ts/main.ts. Faza 3.2 ✅ — ServiceContainer eliminuje manual wiring.

### P4: Brak testów ✅ W DUŻEJ MIERZE ROZWIĄZANO
- **Problem**: Zero testów — unit, integration, e2e
- **Rozwiązanie**: Vitest setup, 507 testów w 13 plikach: unit (IntentDetector, SecurityGuard, ContextManager, PromptService, ToolLoopDetector, ConfigService), integration (45 testów — ToolExecutor, ResponseProcessor, ContextBuilder), advanced (34 testy — SDK contract, signal propagation, concurrent access, shutdown ordering, dependency map conformance), environment preflight (112 testów — Node.js, deps, toolchain, security audit). CI z coverage thresholds + lcov.

### P5: Frontend — jeden plik CSS (global.css), brak component library ✅ CZĘŚCIOWO ROZWIĄZANO
- **Problem**: Skalowanie UI jest trudne, brak design system
- **Rozwiązanie**: Faza 4.1 ✅ — CSS Modules per-component (8 plików `*.module.css`), `cn()` utility, design tokens w `:root`. Monolityczny `global.css` (2846→181 linii). Component library (4.2) ✅ i state management (4.3) ✅.

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
- [x] Dodaj `lint-staged` + `husky` pre-commit hooks ✅ (Husky v9 + lint-staged prettier)
- [x] Dodaj `npm run typecheck` jako alias ✅

### Krok 0.3 — Dependency audit + cleanup
- [x] Usuń `playwright-core` z dependencies (zastąpiony w Fazie 1) ✅
- [x] Usuń `screenshot-desktop` — zastąp natywnym `desktopCapturer` ✅
- [x] Dodaj `better-sqlite3` + `@types/better-sqlite3` dla lokalnego storage ✅
- [x] Dodaj `zod` do runtime validation schemas (IPC params, config, tool params) ✅
- [x] Stworzono tagged logger (`logger.ts`) zamiast raw console.log ✅ (electron-log opcjonalnie później)
- [x] Dodaj `mammoth` (cross-platform DOCX parsing) ✅
- [x] Dodaj `xlsx` / SheetJS (XLSX/XLS parsing) ✅
- [x] Dodaj `tsdav` (CalDAV client, TypeScript native) ✅
- [x] Dodaj `node-ical` (ICS/iCalendar parser) ✅

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

### Krok 2.5 — Multi-provider AI abstraction ✅
> **Zaimplementowano**: `AIProvider` interface w `src/shared/types/ai-provider.ts`. Implementacje: `OpenAIProvider` (GPT-5 developer role, max_completion_tokens, tool call delta accumulation) i `AnthropicProvider` (system message extraction, prompt caching, Computer Use beta). `ai-service.ts` z `providers: Map<string, AIProvider>`, `activeProvider`, hot-swap bez restartu. Cost tracking per provider per session. Backward compatible — all 10 consumers unchanged.

- [x] `AIProvider` interface z chat, streamChat, chatWithVision, streamWithTools, continueWithToolResults ✅
- [x] `OpenAIProvider` implementation ✅
- [x] `AnthropicProvider` implementation ✅
- [x] Hot-swap providerów bez restartu ✅
- [x] Cost tracking per provider per session ✅

### Krok 2.6 — Agent Loop v2 — Modularization ✅
> **Zaimplementowano**: Agent loop rozbity na 6 wyodrębnionych modułów w `src/main/services/`. Orchestrator (`agent-loop.ts`) deleguje do: `tool-executor.ts`, `response-processor.ts`, `context-builder.ts`, `heartbeat-engine.ts`, `take-control-engine.ts`, `cron-executor.ts`. Moduły mają własne odpowiedzialności, łatwo testowalne.

- [x] Rozbij na modularną architekturę ✅ (6 modułów wyodrębnionych)
- [ ] EventEmitter-based communication między modułami (przyszła iteracja)
- [x] Cancellation via `AbortController` — signal propagated to AI SDKs, processWithTools, heartbeat, take-control ✅
- [x] Parallel tool execution gdy AI requestuje multiple tools ✅ (via native FC)

---

## Faza 3: Architektura & Stabilność (Tydzień 5-7)

### Krok 3.1 — IPC v2 — Typesafe channel constants ✅
> **Zaimplementowano**: `src/shared/ipc-schema.ts` z 132 stałymi kanałów w 3 grupach: `Ch` (106 handle channels), `Ev` (24 event channels), `ChSend` (2 send channels). Wszystkie string literals w `ipc.ts`, `preload.ts` i `main.ts` zamienione na stałe. Zero magic strings.

- [x] Stałe IPC kanałów w `ipc-schema.ts` (Ch, Ev, ChSend) ✅
- [x] Migracja `ipc.ts` — 106 handlerów na stałe Ch.* ✅
- [x] Migracja `preload.ts` — 106+ wywołań na stałe Ch.*/Ev.*/ChSend.* ✅
- [x] Migracja `main.ts` — eventy na stałe Ev.* ✅
- [x] Runtime validation parametrów IPC via zod schemas ✅ (`src/shared/schemas/ipc-params.ts`, 54 kanały, `validatedHandle()` wrapper)
- [ ] Pełny codegen bridge z typami (przyszła iteracja)

### Krok 3.2 — Service Container / Dependency Injection ✅
> **Zaimplementowano**: `service-container.ts` z typowanym `ServiceMap` (27 kluczy). `get<K>(key)` z pełnym TS inference. 5-fazowa `init()` (dependency order) + `initDeferred()` zastepują ~100 linii ręcznego wiring. 6-fazowa `shutdown()` centralizuje graceful cleanup. `getIPCServices()` mapuje na interfejs kompatybilny z `setupIPC()`. `main.ts` zredukowany z ~685 do ~460 linii.

- [x] Typowany `ServiceContainer` z `ServiceMap` interface (27 kluczy) ✅
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
> **Zaimplementowano**: 6-fazowy sequential shutdown w `app.on('will-quit')` z 5s timeout wrapper. Fazy: 1) Stop processing (agentLoop, screenMonitor, cron, updater), 2) Close network (calendar, mcpClient, meetingCoach, transcription, browser, dashboard), 3) Stop watchers (RAG, plugins), 4) Cleanup temp (TTS), 5) Flush caches (embedding, config), 6) Close DB (memory/SQLite). Promise.race z timeout.

- [x] Sequential cleanup z 6 fazami ✅
- [x] 5s timeout wrapper (prevent hanging) ✅
- [x] 13 serwisów zamykanych (było 4) ✅
- [x] Logging każdego kroku ✅

### Krok 3.5 — Error handling & crash reporting ✅
> **Zaimplementowano**: `KxAIError` class w `shared/types/errors.ts` z ~30 `ErrorCode` enum values, severity levels, JSON serialization. `ErrorBoundary.tsx` — React error boundary per-view (Onboarding, Chat, Cron, Meeting, Settings) z fallback UI i "Spróbuj ponownie" button. CSS styles matching dark theme.

- [x] React Error Boundaries (per-view w App.tsx) ✅
- [x] Main process: `process.on('uncaughtException')`, `process.on('unhandledRejection')` ✅ (Quick Wins)
- [x] Structured error types (`KxAIError`, `ErrorCode`, `ErrorSeverity`) ✅
- [ ] Optional: Sentry/crash reporting (opt-in w settings)

### Krok 3.6 — Configuration v2 ✅
> **Zaimplementowano**: `config-schema.ts` — Zod schema jako single source of truth (shape, defaults, validation). `config.ts` przepisany na typed `get<K>/set<K>` z TS inference, `setBatch()` dla atomic multi-key updates, `onChange<K>()` reactive subscriptions, debounced save (200ms coalescing), atomic write (temp+rename), config version tracking + ordered migrations, EventEmitter for IPC push. `KxAIConfig` type derived z `z.infer<>`, usunięty `[key: string]: any` index signature. SettingsPanel: 6 sequential `setConfig` → 1 `setConfigBatch`. MCP client fix. 38 unit testów.

- [x] Zod schema validation z defaults (`config-schema.ts`) ✅
- [x] Typed `get<K>/set<K>` z full TypeScript inference ✅
- [x] `setBatch()` — atomic multi-key update (SettingsPanel: 6 IPC→1) ✅
- [x] Reactive `onChange<K>()` + `onAnyChange()` subscriptions ✅
- [x] Debounced save (200ms) — multiple set() → single write ✅
- [x] Atomic write (temp file + rename) ✅
- [x] Config version tracking + ordered migrations ✅
- [x] `Ev.CONFIG_CHANGED` — push config changes to renderer (no re-fetch) ✅
- [x] Secrets NIGDY w config — zawsze w `safeStorage` (jest w security.ts, dobrze) ✅

---

## Faza 4: Frontend Redesign (Tydzień 7-9)

### Krok 4.1 — UI Framework upgrade ✅
> **Zaimplementowano**: CSS Modules z `localsConvention: 'camelCase'` w Vite. 8 komponentów wyodrębnionych z monolitycznego `global.css` (2846→181 linii): FloatingWidget, ErrorBoundary, ProactiveNotification, ChatPanel, OnboardingWizard, SettingsPanel, CronPanel, CoachingOverlay. Utility `cn()` do łączenia klas. TypeScript declarations (`css-modules.d.ts`). Design tokens zachowane w `:root` global.css.

- [x] CSS Modules zamiast monolitycznego `global.css` ✅ (8 plików `*.module.css`)
- [x] `cn()` utility (`src/renderer/utils/cn.ts`) do warunkowego łączenia klas ✅
- [x] `composes:` CSS Modules feature dla wariantów (np. `.btnActive { composes: btn; }`) ✅
- [x] Design tokens (CSS custom properties) zachowane w global.css `:root` ✅
- [ ] Dark/Light theme via CSS custom properties (przyszła iteracja)

### Krok 4.2 — Component library ✅
> **Zaimplementowano**: 15 plików w `src/renderer/components/ui/`. Shared CSS module (`ui.module.css`) z wszystkimi wariantami. Components: Button (5 variants, 3 sizes, loading/active/fullWidth), Input, Select, Textarea, Toggle, Label+Hint+FormGroup, Badge (5 variants), Spinner, ProgressBar, EmptyState, Section+Card+StatCard, PanelHeader (2 modes), Tabs, EmojiPicker. Barrel export via `index.ts`.

- [x] Wyodrębnij reusable atomic components ✅ (15 plików)
- [x] Button variants: primary/secondary/danger/ghost/icon ✅
- [x] Form components: Input, Select, Textarea, Toggle, Label ✅
- [x] Display: Badge, Spinner, ProgressBar, EmptyState ✅
- [x] Layout: Section, Card, StatCard, PanelHeader, Tabs ✅

### Krok 4.3 — State management ✅
> **Zaimplementowano**: Zustand z 4 stores + `useStoreInit` hook. `useNavigationStore` (view routing + window resize side-effects), `useConfigStore` (config, proactive msgs, API key flags), `useAgentStore` (agent status, control, companion, RAG progress, meeting), `useChatStore` (messages, streaming, input). Centralized IPC event subscriptions w `useStoreInit`. App.tsx zredukowany z 237→130 linii. ChatPanel zmigrated — agentStatus/ragProgress z global store.

- [x] 4 zustand stores + useStoreInit ✅
- [x] Refaktor App.tsx — 10 useState → store selectors ✅
- [x] ChatPanel — agentStatus i ragProgress z global store ✅
- [x] IPC event listeners scentralizowane w useStoreInit ✅

### Krok 4.4 — Dashboard SPA refactor ✅
> **Zaimplementowano**: `DashboardPanel.tsx` (~480 LOC) z 6 zakładkami (Overview, Tools, Cron, System, MCP, Activity). Direct IPC calls zamiast REST API — zero HTTP/WebSocket potrzebnych w app. CSS Module z grid layout, tablicami, metrykami. 33 klucze i18n (PL+EN). Nawigacja: widok 'dashboard' z szerszym oknem 560px. ChatPanel: przycisk dashboardu nawiguje in-app zamiast window.open. Zewnętrzny dashboard-server zachowany dla dostępu z przeglądarki.

- [x] Przenieś dashboard do osobnego React view ✅ (DashboardPanel.tsx z 6 zakładkami)
- [x] Direct IPC zamiast REST API — brak potrzeby WebSocket/HTTP w app ✅
- [ ] Responsive design (mobile-friendly — do przyszłego mobile companion)

### Krok 4.5 — Rich interactions ✅
> **Zaimplementowano**: Syntax highlighting z shiki (tokyo-night theme, 30+ języków, lazy init). Code block copy button z event delegation. Screenshot preview (thumbnail w user bubble). Drag & Drop plików do czatu (auto-analiza via AI tools). Keyboard shortcuts: Ctrl+L (focus input), Esc (zamknij), Ctrl+Shift+S (screenshot), Ctrl+Shift+X (stop agent), Ctrl+Shift+Backspace (clear chat). DOMPurify z `ADD_ATTR: ['style']` dla shiki inline styles.

- [x] Drag & Drop files do czatu → auto-upload + analiza (PDF, obrazki, kod) ✅
- [ ] Inline tool call visualization (expandable cards zamiast tekstu) — przyszła iteracja
- [x] Image previews w czacie (screenshoty) ✅
- [x] Code blocks z syntax highlighting (Shiki) ✅
- [x] Keyboard shortcuts (Ctrl+L, Esc, Ctrl+Shift+S/X/Backspace) ✅

---

## Faza 5: Testing & Quality (Tydzień 9-10)

### Krok 5.1 — Unit tests ✅
> **Zaimplementowano**: Vitest setup (`vitest.config.ts`), 8 plików testowych unit (318 testów). Pokryte: `IntentDetector` (67), `SecurityGuard` (58), `ContextManager` (28), `PromptService` (19), `ToolLoopDetector` (43), `IPC Validation` (63), `ConfigService` (38). Coverage thresholds (30/25/20%).

- [x] Setup: Vitest (szybkie, ESM-native, Vite-compatible) ✅
- [x] Priorytet testowania:
  1. `ToolLoopDetector` — hash, ping-pong, spiraling detection ✅ (43 testy)
  2. `SecurityGuard` — command injection, SSRF, path traversal ✅ (58)
  3. `ContextManager` — token budgeting, importance scoring ✅ (28)
  4. `IntentDetector` — intent recognition accuracy ✅ (67)
  5. `PromptService` — template rendering, variable substitution ✅ (19)
  6. `IPC Validation` — zod schema validation for 54 channels ✅ (63)
  7. `ConfigService` — Zod schema, typed API, reactive, debounce, migrations ✅ (38)

### Krok 5.2 — Integration tests ✅
> **Zaimplementowano**: 45 testów integracyjnych w `tests/integration.test.ts`. ToolExecutor (parsowanie tool calls, parallel execution, loop detection, cancellation, legacy+native flow), ResponseProcessor (cron suggestions, memory updates, take_control, screen analysis), ContextBuilder (system prompt assembly z promptami i kontekstem).

- [x] ToolExecutor — legacy + native tool loop flow ✅
- [x] ResponseProcessor — cron/memory/take_control/screen parsing ✅
- [x] ContextBuilder — system prompt z tools, history, context ✅
- [ ] RAG pipeline test — index → search → result quality
- [ ] Cron scheduling accuracy

### Krok 5.3 — E2E tests
- [ ] Electron E2E z Playwright Test (osobne od browser-service!)
- [ ] Scenariusze: onboarding → chat → tool use → settings
- [ ] Screenshot regression testing

### Krok 5.5 — Advanced tests (race conditions, contracts, timing) ✅
> **Zaimplementowano**: `tests/advanced.test.ts` (34 testów w 5 grupach). SDK contract tests (9) — max_completion_tokens, developer role, signal placement w OpenAI i Anthropic providerach. Signal propagation (7) — AIService forwarding do SDK, AbortController lifecycle. Concurrent access (11) — ToolsService registry mutation safety, HeartbeatEngine timer race, TakeControlEngine start/stop. Shutdown ordering (2) — phase sequence, worker cleanup. Dependency map conformance (5) — API surface validation. Bug fix: AnthropicProvider.computerUseStep() signal forwarding.

- [x] **Concurrent access tests**: ToolsService register/unregister/unregisterByPrefix consistency, snapshot isolation, concurrent 50-tool register+unregister. HeartbeatEngine timer start/stop idempotency. TakeControlEngine concurrent start rejection, abort propagation. ✅
- [x] **Signal propagation tests**: sendMessageWithVision, computerUseStep, sendMessage → SDK signal forwarding for OpenAI and Anthropic. AbortController lifecycle. ✅
- [x] **SDK contract tests**: max_completion_tokens (not max_tokens), developer role for GPT-5+, signal in second arg (not request body) for OpenAI chat/streamChat/chatWithVision and Anthropic chat/computerUseStep. Prompt caching verification. ✅
- [x] **Shutdown ordering tests**: Phase sequence contract (agentLoop stops before memory shuts down). Worker thread terminateWorker() idempotency. ✅
- [x] **Dependency map conformance**: API surface check for ToolsService, AIService, TakeControlEngine, HeartbeatEngine. ✅

### Krok 5.4 — CI pipeline update ✅
> **Zaimplementowano**: Quality gate z 7 krokami: env preflight → lint → typecheck (main+renderer) → testy z coverage → format check → npm audit (prod). Coverage thresholds w vitest.config.ts (30/25/20%). lcov reporter. Husky v9 + lint-staged (prettier pre-commit).

- [x] Dodaj test step do GitHub Actions workflow ✅
- [x] Type checking + linting jako gate ✅
- [x] Coverage report (thresholds: 30% lines, 25% functions, 20% branches) ✅
- [x] lint-staged + husky pre-commit hooks ✅
- [x] npm audit (production deps) w CI ✅
- [x] Environment preflight tests w CI ✅
- [ ] Auto-release z semantic versioning

---

## Faza 6: Nowe funkcje — Differentiators (Tydzień 10-14)

> Te funkcje robią z KxAI produkt, którego nie ma na rynku.

### Krok 6.1 — Smart Clipboard Pipeline ✅
> **Zaimplementowano**: `clipboard-service.ts` (~860 LOC) z background monitoring (polling 1.5s, opt-in), auto-detect 12 typów treści (URL, email, kod, JSON, ścieżka, kolor, telefon, HTML, markdown, adres, liczba, unknown), SQLite-backed history z FTS5 full-text search, deduplication (SHA256 content hash, 24h window), pinning (przeżywa retention policy), retention policy (konfigurowany maxHistory + retentionDays). 5 narzędzi AI: `clipboard_history`, `clipboard_search`, `clipboard_pin`, `clipboard_clear`, `clipboard_analyze`. 8 kanałów IPC (Ch.CLIPBOARD_*). ServiceContainer wired (Phase 2 construct, Phase 5 deps, initDeferred, shutdown Phase 1).

- [x] Monitor schowka w tle (opt-in) z auto-detect type ✅
- [x] Clipboard history z FTS5 searchem i SQLite storage ✅
- [x] Deduplication, pinning, retention policy ✅
- [x] 5 AI tools (history, search, pin, clear, analyze) ✅
- [ ] AI enrichment: URL → auto-summary, code → explain (przyszła iteracja)
- [ ] "Paste with AI" — Ctrl+Shift+V transformacja (przyszła iteracja)

### Krok 6.2 — Workflow Automator (Macro Recorder)
- [ ] Nagrywaj sekwencje akcji użytkownika:
  - Kliknięcia, keyboard input, nawigacja, tool calls
  - AI analizuje i generuje powtarzalny "workflow script"
- [ ] Replay z parametryzacją:
  ```
  User: "Zrób to samo co wczoraj z raportem, ale dla Q2"
  Agent: [replay recorded workflow z podmienionymi parametrami]
  ```

### Krok 6.3 — Knowledge Graph ✅
> **Zaimplementowano**: `knowledge-graph-service.ts` (794 LOC) z SQLite storage. Tabele: `kg_entities` (id, name, type, properties JSON, confidence, source, first_seen, last_seen, mention_count, active) z FTS5 + triggers + indexes, `kg_relations` (id, source_id, target_id, relation, properties JSON, strength). 9 typów encji (person, project, technology, company, topic, place, event, habit, preference), 14 typów relacji. Upsert merge (addEntity merges properties + bumps mention_count). BFS graph traversal z depth limit. `getContextSummary()` — markdown context injection do ContextBuilder. 6 narzędzi AI: `kg_add_entity`, `kg_add_relation`, `kg_query`, `kg_get_connections`, `kg_update_entity`, `kg_delete_entity`. 8 kanałów IPC (KG_*). Typy w `shared/types/knowledge-graph.ts`. ServiceContainer wired (Phase 2 construct, Phase 5 deps, initDeferred).

- [x] Buduj graf wiedzy o użytkowniku ✅ (SQLite entity-relation store)
- [x] SQLite z FTS5 search + BFS graph traversal ✅
- [x] Agent "zna" użytkownika coraz lepiej z każdym dniem ✅ (context injection via getContextSummary)

### Krok 6.4 — Proactive Intelligence Engine ✅
> **Zaimplementowano**: `proactive-engine.ts` (814 LOC) z rule-based notification engine. 10 wbudowanych reguł: meeting-reminder (P10), low-battery (P9), disk-full (P8), high-cpu (P7), no-network (P7), high-memory (P6), daily-briefing (P6), focus-break (P5), evening-summary (P4), weekend-chill (P2). Context fusion z 6+ źródeł: kalendarz (upcoming+today events), system health (snapshot+warnings), screen monitor (context+currentWindow), Knowledge Graph (summary), workflow (timeContext), pamięć (session duration). Per-rule cooldowns (5min do 22h). Learning loop: feedbackMap tracks fired/accepted/dismissed per rule, suppresses rules dismissed >85% po 5+ próbkach. Active hours enforcement + AFK awareness. Konfigurowalne via `config.proactiveIntervalMs` (default 60s). IPC: PROACTIVE_FEEDBACK, PROACTIVE_GET_STATS + zod validation. ProactiveNotification.tsx: feedback z ruleId na dismiss/reply.

- [x] **Context Fusion**: łączenie informacji z: ✅
  - Ekranu (T0/T1/T2 monitoring) ✅
  - Kalendarza (CalDAV) ✅
  - System state (battery, disk, CPU, RAM, network) ✅
  - Knowledge Graph (entity summary) ✅
  - Workflow (time context, session duration) ✅
- [x] **Predictive Actions**: 10 reguł z priorytetami + cooldowns ✅
- [x] **Learning Loop**: accept/dismiss tracking per rule, auto-suppress ✅
- [ ] Email/pogoda/news context fusion (przyszła iteracja)
- [ ] AI-generated briefings (przyszła iteracja)

### ~~Krok 6.5 — Local LLM Support (Ollama)~~ ❌ USUNIĘTY
> **Decyzja**: Usunięty z planu. Lokalne modele LLM wymagają GPU z min. 8-16 GB VRAM — większość użytkowników nie ma takiego sprzętu. Koszt implementacji nie uzasadnia wąskiej grupy odbiorców. Cloud-only (OpenAI + Anthropic) to właściwa strategia dla desktop agenta.

### Krok 6.6 — File Intelligence ✅
> **Zaimplementowano**: `file-intelligence.ts` (718 LOC) — serwis do inteligentnej analizy plików. Parsery: PDF (pdf-parse), DOCX (mammoth — cross-platform, zastępuje PowerShell), XLSX/XLS (SheetJS — CSV output per arkusz), EPUB (PowerShell/unzip fallback), tekst/kod (fs.readFile). 4 nowe narzędzia AI: `analyze_file` (ekstrakcja tekstu + metadane z dowolnego pliku), `file_info` (metadane bez czytania treści), `search_files` (glob + grep rekurencyjnie), `analyze_folder` (dystrybucja typów, największe pliki, drzewo). SecurityGuard path validation na każdym narzędziu. RAG service DOCX/EPUB extraction przeniesione na mammoth (cross-platform). Typy w `shared/types/file-intelligence.ts`. Wire w ServiceContainer Phase 2/5. TOOLS.md z Decision Matrix i workflow.

- [x] Agent "rozumie" pliki na komputerze ✅:
  - PDF extraction via pdf-parse ✅
  - DOCX via mammoth (cross-platform, zastępuje PowerShell) ✅
  - XLSX/XLS via SheetJS (arkusze → CSV) ✅
  - EPUB via PowerShell/unzip ✅
  - Image/Audio → metadane (analiza via existing vision/transcription) ✅
- [x] "Przeanalizuj ten folder" → `analyze_folder` z raportem ✅
- [x] "Znajdź wszystkie dokumenty o umowie z X" → `search_files` z content grep ✅

---

## Faza 7: Production Hardening (Tydzień 14-16)

### Krok 7.1 — Auto-updater ✅
> **Zaimplementowano**: `updater-service.ts` (~220 LOC) z `electron-updater`. `autoUpdater.autoDownload = false` (user decyduje). Auto-check 10s po starcie + co 4h. Event handling: checking/available/not-available/downloading/downloaded/error. Push state do renderera via `Ev.UPDATE_STATE`. IPC: `Ch.UPDATE_CHECK`, `Ch.UPDATE_DOWNLOAD`, `Ch.UPDATE_INSTALL`, `Ch.UPDATE_GET_STATE`. Wired w ServiceContainer + shutdown Phase 1. CI/CD: `--publish always` + `GH_TOKEN` + `*.yml`/`*.blockmap` w GitHub Releases. `package.json` publish config: GitHub provider.

- [x] `electron-updater` z GitHub Releases ✅
- [x] Release notes w app ✅ (pushed via UpdateState.releaseNotes)
- [x] Update check na starcie + periodic (co 4h) ✅
- [ ] Delta updates (nie cały installer) — wymaga code signing (przyszła iteracja)

### Krok 7.2 — Performance optimization ✅
> **Zaimplementowano**: ServiceContainer `init()` zoptymalizowany z per-phase timing. Phase 3: `Promise.all([memory.initialize(), embedding.initialize()])`. Phase 4: `Promise.all([rag.initialize(), plugins.initialize()])`. Nowa metoda `initDeferred()` — dashboard, diagnostic, MCP auto-connect, self_test tool rejestrowane po pokazaniu okna. Worker thread (`embedding-worker.ts`) dla TF-IDF: `buildIDF()` i `embedBatch()` offloaded do `worker_threads` (lazy spawn, graceful fallback). RAG service używa `buildIDFAsync()`.

- [x] Parallelized init phases (memory‖embedding, rag‖plugins) ✅
- [x] Deferred init for non-critical services (dashboard, diagnostic, MCP) ✅
- [x] Worker threads dla TF-IDF embedding computation ✅ (`embedding-worker.ts`)
- [x] Per-phase timing logs for startup profiling ✅
- [ ] Memory leak detection (WeakRef + FinalizationRegistry) (przyszła iteracja)
- [ ] Profiling script (`npm run profile`) (przyszła iteracja)

### Krok 7.3 — Accessibility ✅
> **Zaimplementowano**: Comprehensive a11y upgrade. CSS: `:focus-visible` outlines na wszystkich interactive elements (btn, input, textarea, select, tab, toggle) w 7 plikach CSS module + globalny `*:focus-visible`. `@media (prefers-reduced-motion: reduce)` w `global.css` (wyłącza 16 animacji) i `ui.module.css`. Atomic UI: WAI-ARIA Tabs pattern (`role="tablist/tab"`, `aria-selected`, arrow key navigation w `Tabs.tsx`), `role="progressbar"` + `aria-valuenow/min/max` w `ProgressBar.tsx`, `role="status"` + `aria-label` w `Spinner.tsx`, `role="radiogroup/radio"` + `aria-checked` w `EmojiPicker.tsx`, `htmlFor` w `Label.tsx`, `aria-busy` w `Button.tsx`, `aria-hidden` w `EmptyState.tsx`. Main components: `role="log"` + `aria-live` na czacie, `role="alertdialog"` na notyfikacjach, `role="alert"` na błędach, `role="button"` + `tabIndex` + `onKeyDown` na widgetcie, `aria-expanded` na expand/collapse, `aria-label` na 20+ icon-only buttons, `htmlFor`/`id` powiązania label→input w OnboardingWizard. Pokrycie: 15 plików (8 komponentów + 7 CSS modules).

- [x] Keyboard navigation w całym UI ✅ (focus-visible, tabIndex, onKeyDown, arrow keys w Tabs)
- [x] Screen reader support (aria-labels) ✅ (20+ aria-label, role, aria-live, aria-expanded, aria-checked)
- [ ] High contrast mode (przyszła iteracja)
- [x] Reduced motion mode ✅ (prefers-reduced-motion w global.css + ui.module.css)

### Krok 7.4 — Internationalization (i18n) ✅
> **Zaimplementowano**: Lightweight custom i18n (bez zewnętrznej biblioteki). `src/renderer/i18n/index.ts` — `useTranslation()` hook (React FC) + standalone `t()` (class components/utilities), `translate()` core z fallback chain (locale → PL → raw key), `{param}` interpolation via `String.replaceAll`. ~230 kluczy tłumaczeń w `pl.ts` i `en.ts` pokrywających wszystkie 8 komponentów UI. Language selector w SettingsPanel (General tab) — `🇵🇱 Polski` / `🇬🇧 English`. Reaktywne przełączanie via `useConfigStore` → `config.userLanguage`.

- [x] Wyodrębnij stringi UI do translation files ✅ (~230 kluczy w 8 komponentach)
- [x] Support: PL (primary), EN (secondary) ✅
- [x] Język agenta = język UI (konfigurowalny) ✅ (Settings → General → Language selector)

### Krok 7.5 — Privacy & compliance ✅
> **Zaimplementowano**: `privacy-service.ts` z pełną obsługą GDPR. `PrivacyDataSummary` — przegląd 12 kategorii danych (konwersacje, pamięć, aktywność, spotkania, cron, RAG, audit, config, prompty, przeglądarka, sekrety, temp). `exportData()` — eksport do folderu z JSON/Markdown + manifest, bez kluczy API. `deleteData()` — selektywne usuwanie z opcjami `keepConfig`/`keepPersona`. 3 narzędzia AI: `data_summary`, `data_export`, `data_delete`. 3 kanały IPC: Ch.PRIVACY_*. Dialogi potwierdzenia przed eksportem/usuwaniem. Typy w `shared/types/privacy.ts`. Wired w ServiceContainer Phase 2.

- [x] "Data stays local" guarantee — wszystko w userData, nic na serwerze ✅
- [x] Data export (GDPR compliance) — "Eksportuj wszystkie moje dane" ✅
- [x] Data deletion — "Usuń wszystko o mnie" ✅
- [ ] Opcjonalny telemetry z explicit opt-in
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
> **Zaimplementowano**: `mcp-client-service.ts` (~350 LOC) z `@modelcontextprotocol/sdk`. 3 typy transportu (Streamable HTTP, SSE, stdio). Auto-discover tools via `client.listTools()`. Auto-register w ToolsService z prefiksem `mcp_{server}_{tool}`. Curated registry 14 popularnych serwerów (w tym Gmail i Outlook). Dashboard MCP Hub z grafem + rejestrem serwerów.

- [x] `@modelcontextprotocol/sdk` zainstalowany ✅
- [x] Shared types (`McpServerConfig`, `McpServerStatus`, `McpHubStatus`, `McpRegistryEntry`) ✅
- [x] 3 transporty: StreamableHTTP (z SSE fallback), SSE, stdio ✅
- [x] Auto-discover + auto-register tools w ToolsService ✅
- [x] `ToolsService.unregister()` + `unregisterByPrefix()` — dynamic tool removal ✅
- [x] IPC: 9 kanałów Ch.MCP_* + 1 event Ev.MCP_STATUS ✅
- [x] ServiceContainer wiring (init Phase 5, shutdown Phase 2) ✅
- [x] Dashboard: MCP Hub page + serwery w grafie agenta (`.graph-node--mcp`) ✅
- [x] Curated registry: 14 serwerów (CalDAV, GitHub, Slack, Notion, Brave Search, Gmail, Outlook, etc.) ✅
- [x] Env vars UI — konfiguracja API keys/env per serwer (Settings panel → zakładka 🔌 MCP) ✅
- [ ] Auto-reconnect z exponential backoff
- [ ] MCP server health monitoring (ping interval)

### Krok 8.2 — Google Calendar via CalDAV ✅
> **Zaimplementowano**: `calendar-service.ts` (852 LOC) z `tsdav` + `node-ical`. Multi-connection CalDAV client. Credential management via `safeStorage`. Auto-sync co 15 min. 4 narzędzia AI: `calendar_list_events`, `calendar_create_event`, `calendar_delete_event`, `calendar_upcoming`. UI w Settings (zakładka 📅 Kalendarz). IPC: 8 kanałów Ch.CALENDAR_* + Ev.CALENDAR_STATUS. Zod validation parametrów. Obsługa providerów: Google (OAuth placeholder), iCloud (Basic + App Password), Nextcloud, generic CalDAV.

- [x] Integracja z tsdav — CRUD eventów, ICS building/parsing ✅
- [x] UI w Settings do konfiguracji CalDAV URL + credentials ✅
- [x] Agent może: tworzyć eventy, sprawdzać kalendarz, przypominać o spotkaniach ✅
- [ ] Proaktywne: "Za 15 min masz spotkanie z Jackiem" (wymaga heartbeat integration)
- [ ] Google OAuth 2.0 flow (BrowserWindow popup)

### Krok 8.3 — Gmail / Email via MCP ✅
> **Zaimplementowano**: Gmail (`@gongrzhe/server-gmail-autoauth-mcp`, 63K+ pobrań, 18 narzędzi) i Microsoft Outlook (`outlook-mcp`, Graph API) dodane do curated registry MCP. Agent prompt (TOOLS.md) zaktualizowany z workflow emailowym. Auto-rejestracja narzędzi `mcp_gmail_*` / `mcp_outlook_*` przez istniejący MCP framework. OAuth2 auto-auth dla Gmail, Microsoft Graph dla Outlook.

- [x] Gmail MCP server w curated registry ✅ (`@gongrzhe/server-gmail-autoauth-mcp`)
- [x] Outlook MCP server w curated registry ✅ (`outlook-mcp`)
- [x] Agent może: czytać emaile, wysyłać, szukać, etykiety, filtry, batch ops ✅ (18 narzędzi Gmail)
- [x] TOOLS.md zaktualizowany z email workflow i instrukcją konfiguracji ✅
- [ ] Proaktywne: "Masz 3 nowe emaile od klienta X" (wymaga heartbeat integration)

### Krok 8.4 — Reminder Engine ✅
> **Zaimplementowano**: 3 narzędzia AI: `set_reminder`, `list_reminders`, `cancel_reminder`. Naturalny język PL/EN do cron: "jutro o 9:00", "za 2 godziny", "w piątek o 15:30", "codziennie o 8:00", "2025-03-15 10:00". One-shot scheduling z auto-disable (`CronJob.oneShot` + `runAt`). Prompte zaktualizowane (RESOURCEFUL.md + TOOLS.md). CronService rozszerzony o `runAt`-based scheduling.

- [x] Agent zapamiętuje reminders w cron jobs ✅ (set_reminder → CronJob z category:'reminder')
- [x] "Przypomnij mi jutro o 9:00 żeby wysłać raport" ✅ (parseReminderTime z PL/EN)
- [x] One-shot reminders z auto-disable po wykonaniu ✅ (CronJob.oneShot + runAt)
- [ ] Integration z kalendarzem — auto-tworzenie eventów z reminderów (wymaga Phase 8.2)

### Krok 8.5 — MCP Server Discovery ✅
> **Zaimplementowano**: Rozszerzony `McpRegistryEntry` o `McpCategory` (12 kategorii), `tags?: string[]`, `featured?: boolean`. CURATED_REGISTRY rozbudowany z 14 do 50 serwerów (12 kategorii: Komunikacja, Developer, Produktywność, Web, Bazy danych, System, AI, Finanse, Bezpieczeństwo, Monitoring, Dane, Inne). Nowe metody: `searchRegistry(query?, category?)` — filtrowanie po name/description/tags + kategoria, featured first; `getRegistryCategories()`. 2 nowe kanały IPC: `MCP_SEARCH_REGISTRY`, `MCP_GET_CATEGORIES`. UI w SettingsPanel: search input + category dropdown + featured badge (⭐) + category badge. i18n: 4 nowe klucze PL+EN. CSS: discovery bar, category select, featured highlight, empty state.

- [x] Curated registry rozbudowany z 14 do 50 serwerów ✅ (12 kategorii, tags, featured)
- [x] Search + filter w Settings UI ✅ (search input + category dropdown)
- [x] One-click install z auto-detect wymaganych env vars ✅ (istniejący handleMcpAddFromRegistry)
- [ ] Dynamiczny fetch rejestru z GitHub awesome-mcp-servers (przyszła iteracja)
- [ ] Community rating / popularity sorting (przyszła iteracja)

---

## Kolejność implementacji (prioritized backlog)

> **Estymacje**: Effort podany w sesjach AI agenta (1 sesja ≈ 1 konwersacja z Copilot ≈ 1-3h wall time).
> Historyczne tempo: OpenClaw 2.0 refactor = 1 sesja, MCP Client = 1 sesja, Phase 8.4 = 1 sesja.

### ✅ Ukończone (43/47)

| # | Zadanie | Faza | Status |
|---|---------|------|--------|
| 1 | Native Function Calling | 2.1 | ✅ |
| 2 | Browser CDP Bypass | 1.1-1.3 | ✅ |
| 3 | Shared types + path aliases | 0.1 | ✅ |
| 4 | SQLite memory + RAG | 2.3-2.4 | ✅ |
| 5 | Agent Loop modularization | 2.6 | ✅ |
| 6 | Unit tests (507 w 13 plikach) | 5.1 | ✅ |
| 7 | Async file operations | 3.3 | ✅ |
| 8 | Error boundaries | 3.5 | ✅ |
| 9 | Graceful shutdown | 3.4 | ✅ |
| 10 | IPC typesafe bridge + zod validation | 3.1 | ✅ |
| 11 | Service container (DI) | 3.2 | ✅ |
| 12 | Frontend CSS Modules | 4.1 | ✅ |
| 13 | Structured Outputs (Zod) | 2.2 | ✅ |
| 14 | Auto-updater | 7.1 | ✅ |
| 15 | MCP Client Service | 8.1 | ✅ |
| 16 | Reminder Engine | 8.4 | ✅ |
| 17 | OpenClaw 2.0 context upgrade | — | ✅ |
| 18 | CI quality gate | 5.4 | ✅ |
| 19 | Multi-provider AI abstraction | 2.5 | ✅ |
| 20 | Configuration v2 (Zod + reactive) | 3.6 | ✅ |
| 21 | AbortController cancellation | 2.6 | ✅ |
| 22 | IPC runtime validation (zod) | 3.1 | ✅ |
| 23 | ToolLoopDetector tests (43) | 5.1 | ✅ |
| 24 | Integration tests (45) | 5.2 | ✅ |
| 26 | CI coverage gate + env tests | 5.4+5.5 | ✅ |
| 27 | lint-staged + husky | 0.2 | ✅ |
| 28 | Component library (ui/) | 4.2 | ✅ |
| 29 | State management (zustand) | 4.3 | ✅ |
| 36 | File Intelligence (PDF/DOCX/XLSX/EPUB) | 6.6 | ✅ |
| 40 | Performance (lazy load, workers) | 7.2 | ✅ |
| 48 | Advanced tests (race, contracts) | 5.5 | ✅ |
| 37 | Google Calendar (CalDAV) | 8.2 | ✅ |
| 43 | Privacy & compliance (GDPR) | 7.5 | ✅ |
| 38 | Gmail / Email via MCP | 8.3 | ✅ |
| 32 | Smart Clipboard Pipeline | 6.1 | ✅ |
| 42 | i18n (PL + EN) | 7.4 | ✅ |
| 41 | Accessibility (a11y) | 7.3 | ✅ |
| 39 | MCP Server Discovery | 8.5 | ✅ |
| 31 | Rich interactions (D&D, highlight) | 4.5 | ✅ |
| 30 | Dashboard SPA refactor | 4.4 | ✅ |
| 34 | Knowledge Graph | 6.3 | ✅ |
| 35 | Proactive Intelligence Engine | 6.4 | ✅ |

### ⬜ Remaining (4 tasks) — posortowane wg priorytetu

| # | Zadanie | Faza | Impact | Effort | Priorytet |
|---|---------|------|--------|--------|-----------|
| 25 | E2E tests (Playwright Test) | 5.3 | 🟢 Medium | 2 sesje | P4 |
| 33 | Workflow Automator (Macro Recorder) | 6.2 | 🟡 High | 3-4 sesje | P4 |
| 44 | Code signing + distribution | 7.6 | 🟢 Medium | 1 sesja | P4 |
| 45-47 | CDP anti-detection, streaming, network | 1.4-1.5 | 🟢 Medium | 3 sesje | P4 |

**Effort legend**: 1 sesja = 1 konwersacja z AI agentem (~1-3h).

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
