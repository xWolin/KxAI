# KxAI — Copilot Instructions

## Projekt

**KxAI** to personalny AI desktop agent (Electron 33 + React 19 + TypeScript 5.7 + Vite 6).
Agent działa jako floating widget na pulpicie, posiada czat z AI (OpenAI / Anthropic), system pamięci (markdown files), proaktywne notyfikacje, screen capture z vision, cron jobs, framework narzędzi (tools), workflow learning i time awareness.

## Architektura

```
src/
├── main/                   # Electron main process
│   ├── main.ts             # Entry point, okno, tray, inicjalizacja serwisów
│   ├── ipc.ts              # IPC handlers (bridge main ↔ renderer)
│   ├── preload.ts          # Context bridge (window.kxai API)
│   └── services/
│       ├── ai-service.ts       # OpenAI + Anthropic SDK, streaming, vision
│       ├── memory-service.ts   # Markdown-based pamięć (~userData/workspace/memory/)
│       ├── screen-service.ts   # Screenshot capture (desktopCapturer)
│       ├── cron-service.ts     # Cron jobs CRUD, scheduling, persistence
│       ├── tools-service.ts    # Extensible tools framework (10 built-in)
│       ├── workflow-service.ts # Activity logging, pattern detection, time awareness
│       └── agent-loop.ts       # Orchestrator: tool calling, heartbeat, cron execution
├── renderer/               # React frontend
│   ├── App.tsx             # Routing (widget/chat/settings/cron/onboarding)
│   ├── types.ts            # Shared types + window.kxai bridge interface
│   ├── components/
│   │   ├── FloatingWidget.tsx      # Draggable widget z manual drag detection
│   │   ├── ChatPanel.tsx           # Czat z AI, streaming, screenshot
│   │   ├── CronPanel.tsx           # UI zarządzania cron jobami
│   │   ├── SettingsPanel.tsx       # Konfiguracja (API keys, model, persona)
│   │   ├── OnboardingWizard.tsx    # Onboarding flow
│   │   └── ProactiveNotification.tsx # Proactive message popup
│   └── styles/
│       └── global.css      # Wszystkie style
```

## Konwencje

- **Język**: Komunikaty UI i komentarze w kodzie po polsku tam gdzie to naturalne (UX), nazwy zmiennych/typów po angielsku
- **Typy**: Używaj TypeScript strict mode; wszystkie interfejsy w `types.ts` (renderer) lub w plikach serwisów (main)
- **IPC**: Każdy nowy IPC handler dodaj w `ipc.ts`, expose w `preload.ts`, typuj w `types.ts` w interfejsie `KxAIBridge`
- **Styling**: Globalne CSS w `global.css`, BEM-like naming (`.component__element--modifier`)
- **AI models**: OpenAI używa `max_completion_tokens` (nie `max_tokens`); GPT-5+ używa roli `developer` zamiast `system`
- **Tool calling**: AI outputuje ```tool\n{JSON}\n``` bloki, agent-loop parsuje i wykonuje
- **Cron suggestions**: AI outputuje ```cron\n{JSON}\n``` bloki, agent-loop parsuje i proponuje użytkownikowi
- **Persistence**: Dane w `app.getPath('userData')/workspace/` (memory/, cron/, workflow/)

## Komendy

```bash
npm run dev          # Uruchom w trybie dev (Vite + Electron)
npm run build        # Zbuduj produkcyjnie
npm run dist         # Zbuduj + spakuj (electron-builder)
npx tsc --noEmit     # Sprawdź TypeScript bez emitowania
```

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`) buduje na 3 platformach: Windows (NSIS), macOS (dmg+zip), Linux (AppImage+deb).

## Roadmap — Planowane funkcje

### Priorytet wysoki
- [ ] **RAG / Vector Search** — Embeddingi + vector store (better-sqlite3 + vec0 lub chromadb) do semantic search po pamięci i plikach
- [ ] **Web Search Integration** — Integracja z DuckDuckGo API (już w tools-service) + parsing wyników + context injection
- [ ] **Desktop Automation** — Sterowanie klawiaturą/myszką via nut.js do delegowania zadań agentowi ("przejmij sterowanie")

### Priorytet średni
- [ ] **Browser Automation** — CDP/Playwright do automatyzacji przeglądarki (wypełnianie formularzy, scraping)
- [ ] **Plugin System** — Dynamiczne ładowanie narzędzi z plików JS/TS w katalogu plugins/
- [ ] **Voice Interface** — Whisper API do voice-to-text + TTS do odpowiedzi głosowych
- [ ] **Multi-agent** — Wiele agentów z różnymi specjalizacjami (dev, research, creative)

### Priorytet niski
- [ ] **Mobile companion** — API endpoint do komunikacji z telefonem
- [ ] **Drag & Drop files** — Przeciąganie plików do czatu do analizy
- [ ] **Conversation branching** — Rozgałęzienie konwersacji
- [ ] **Export/Import** — Eksport pamięci i konfiguracji
