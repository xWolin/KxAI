# KxAI Changelog

> Auto-generated from [Conventional Commits](https://www.conventionalcommits.org/).

## v0.1.0 (Unreleased) (2026-02-25)

### ✨ New Features

- **5.3:** E2E tests  Playwright Test + Electron fixtures (`59af17a9`)
- **1.4+1.5:** CDP anti-detection (7 stealth scripts, humanized delays) + streaming page observation (7 event types, 4 AI tools) (`8d7296be`)
- **6.2:** Workflow Automator  macro recording, replay with param substitution, 5 AI tools (~480 LOC) (`b6834797`)
- **6.4:** Proactive Intelligence Engine  rule-based notifications, context fusion, learning loop, 10 built-in rules (`24b02b6f`)
- **6.3:** Knowledge Graph  SQLite entity-relation store, FTS5 search, BFS traversal, 6 AI tools, IPC bridge, context injection (`efee1663`)
- **4.4:** Dashboard SPA  React view replaces external browser dashboard (`1b8b4951`)
- **4.5:** Rich interactions  syntax highlighting, screenshot preview, D&D, shortcuts (`3282bebb`)
- **8.5:** MCP Server Discovery  50 serwerów, search + category filter UI (`2b420664`)
- **7.3:** Accessibility (a11y)  comprehensive upgrade (`cecf375d`)
- **7.4:** i18n internationalization (PL + EN) (`70513cd8`)
- **6.1:** Smart Clipboard Pipeline (`1845b1e1`)
- **8.3:** Gmail + Outlook email via MCP (`7edfc5e0`)
- wire FileIntelligence, Calendar, Privacy into ServiceContainer + IPC + tools (`692b1be8`)
- **7.5:** Privacy/GDPR service  data summary, export, deletion (`7da3cafd`)
- **8.2:** Calendar service (CalDAV) + Settings UI (`9d26bb61`)
- **6.6:** File Intelligence service  PDF/DOCX/XLSX/EPUB extraction (`63db8dd8`)
- IPC channels + config schema + validation for calendar & privacy (`d53cbb86`)
- add shared types for file-intelligence, calendar, privacy (`7fe5870c`)
- **#21:** AbortController cancellation  signal propagation through entire AI pipeline (`ad253947`)
- **config:** Configuration v2  Zod-validated, typed, reactive, debounced (Faza 3.6) (`29ee2ffd`)
- **tests:** comprehensive environment, dependency & security test suite (`5f0fee9f`)
- **state:** zustand state management with 4 stores (Phase 4.3) (`fc98c515`)
- **ui:** component library with 15 reusable components (Phase 4.2) (`27666cbd`)
- **ipc:** runtime validation with zod schemas (Phase 3.1) (`3e1dbfba`)
- **2.5:** Multi-provider AI abstraction  AIProvider interface + OpenAI/Anthropic providers (`7b5e887f`)
- **Phase 8.4+UI:** Reminder Engine + MCP Settings panel (`04c01c51`)
- **Phase 8.1:** Agent self-management MCP tools + prompts (`863021dd`)
- **Phase 8.1:** MCP Client Service  Integration Hub (`e76ede14`)
- **Phase 7.1:** Auto-updater via electron-updater + GitHub Releases (`587e9ac5`)
- **ai:** Phase 2.2  Structured Outputs + zod validation + dedup (`38bc1cfa`)
- **rag:** Phase 2.4  SQLite vec + hybrid search (RRF) (`ef91e7c1`)
- **frontend:** Phase 4.1  CSS Modules migration (`a7dea48b`)
- **ipc:** Phase 3.1  centralized IPC channel constants (`7d97e028`)
- **meeting:** pre-meeting briefing  kontekst przed spotkaniem (`fb2385b8`)
- event-driven Meeting Coach with real-time question detection + streaming coaching (`361d8873`)
- multi-monitor vision, real browser profile, voice input, dashboard button (`57fd267f`)
- dashboard SPA, agent status, RAG progress, intent detection, TTS improvements (`8bf17282`)
- intelligent agent loop (OpenClaw-inspired) (`f9f5154d`)
- separate embedding API key and configurable model (`048a76d2`)
- self-programming agent + RAG large file support (`4e3e8e44`)
- markdown-based prompt system (OpenClaw pattern) (`4b79f8fd`)
- multi-monitor screen capture + hide heartbeat from chat (`d93a9c33`)
- heartbeat observation history  agent remembers what it already saw (`3646eabe`)
- self-test diagnostic tool  self_test command for comprehensive agent health check (`29e06c8b`)
- AFK autonomous mode + critical bug fixes (race conditions, browser, idle) (`080b3d83`)
- meeting coach, browser automation (Playwright), security fixes, ElevenLabs TTS (`ecee690b`)
- OpenClaw features + take-control fix + markdown chat (`20fa82c0`)
- self-learning memory, vision take-control, Ctrl+Shift+K, TTS (`ee23107e`)
- proactive msgs in chat, take_control AI block, dev workflow fixes (`1a35f6fd`)
- Agent Intelligence Layer  Context Manager, Security Guard, System Monitor, Retry Handler (`1cf674f8`)
- Phase 1-3  RAG, Desktop Automation, Browser Automation, Plugin System (`475097ab`)
- add cross-platform build support, icons, and CI/CD (`f45b0d36`)

### 🐛 Bug Fixes

- signal propagation across AI pipeline (dependency map findings #1-#4) (`489260a2`)
- hide tool output from chat + AudioWorklet + user gesture fix (`75d94426`)
- display media rejection + transcript speaker timestamp logic (`02e2f8f2`)
- use getDisplayMedia instead of deprecated getUserMedia for system audio (`d577df23`)
- renderer crash (reason 263) on meeting start + crash recovery (`4114d984`)
- window click-through area + meeting coach survives navigation (`ac513c6f`)
- transcription infinite reconnect loop + base64 validation (`cc425899`)
- dashboard & notification hardening  broadcast try-catch, activity error handling, XSS escape, TTS try/finally, tooltip cleanup (`fd79176e`)
- cross-platform compatibility (macOS/Linux) (`8415525b`)
- 8 issues  corrupted emojis, punctuation, SSRF IPv6, command injection, stale docs, constructor safety, watcher coverage, dedup (`ae798b96`)
- graceful RAG/embedding fallback on OpenAI quota errors (`f42f54f3`)
- TTS audio playback  use base64 data URL instead of file:// protocol (`95d2aa23`)
- screen observer self-awareness, weekly patterns, browser_get_content, cron proactivity (`9c8cca01`)
- browser priority over take_control + replace Edge TTS with OpenAI TTS (`ee0f9978`)
- messages disappearing after AI response + config persisting after uninstall (`8792eade`)
- message disappearing, single instance lock, screenshot reliability (`e9c8b590`)
- reset indexed flag before reindex to prevent stale state on failure (`52a43b21`)
- CodeRabbit review  security hardening, cleanup, injection prevention (`50561fb9`)
- add author email and linux category for .deb build (`93706ec4`)
- LF line endings, add Linux CI build, 1024px icon support (`422eeecd`)
- add --publish never to CI builds, fail-fast false (`feba1b2b`)
- resolve all lint errors - extract inline styles to CSS, fix TS types, add accessibility (`5d76629d`)
- add WebkitAppRegion type declarations for Electron CSS (`4d49382d`)

### ⚡ Performance

- parallelize init phases, defer non-critical services, worker thread for TF-IDF (`1b3f11b6`)

### ♻️ Refactoring

- **chat:** migrate ChatPanel to zustand stores (`1976a546`)
- **agent-loop:** replace cancelProcessing + takeControlAbort with AbortController (`580ed685`)
- **context:** OpenClaw 2.0  conditional loading, structured context, Anthropic prompt caching, dedup (`7c3657df`)
- Phase 0 + Phase 2.1  shared types, tooling, native function calling (`0f1bf278`)

### 📝 Documentation

- mark E2E tests (5.3) as completed  46/47 tasks done (`39b1dc75`)
- update roadmap  Faza 6.4 Proactive Intelligence Engine done (43/47) (`2e65529e`)
- update roadmap  Knowledge Graph 6.3 complete (42/47) (`4a96053e`)
- update roadmap  mark 4.4 Dashboard SPA as done (41/47) (`2924a62d`)
- update roadmap  Krok 5.5 advanced tests complete (507 tests, 13 files) (`da2e4f8a`)
- add SERVICE-DEPENDENCY-MAP.md + advanced tests (5.5) to roadmap (`cfd4698b`)
- update roadmap  mark Faza 7.2 Performance as done (`a10f6c25`)
- update backlog  #21 AbortController cancellation done (`e2f58ada`)
- update copilot-instructions with Phase 2.5, 3.1, 4.2, 4.3 status (`c5dcc0cb`)
- remove Ollama/local LLM from plan, update backlog with AI agent effort estimates (`a0861ebd`)
- update copilot-instructions after Phase 2.4 completion (`8966f860`)
- update copilot-instructions for Phase 3.1 + 3.2 (`6c2d0505`)
- Update copilot-instructions.md with completed phases (`de4a84a1`)

### ✅ Tests

- add advanced tests (Krok 5.5) + fix AnthropicProvider.computerUseStep signal (`d9f2d052`)
- **5.2:** Integration tests  ToolExecutor + ResponseProcessor (45 tests) (`ccfb9d33`)
- ToolLoopDetector  43 tests covering all 4 detection strategies (`e73b2237`)

### 🔧 Chores

- add husky + lint-staged pre-commit hooks (`63d2ed46`)

### 🔁 CI/CD

- add quality gate (typecheck + tests) to GitHub Actions workflow (`bea19d02`)

### 📋 Other Changes

- Phase 3.2: Service Container / DI (`a8c84ec3`)
- Phase 3.4: Graceful shutdown - sequential cleanup with timeout (`6ce94108`)
- Phase 3.3: Async file operations - convert 7 services from sync to async FS (`a6a41156`)
- Phase 3.5: Error Boundaries + Structured Error Types (`d20cab9b`)
- Phase 2.6: Agent Loop modularization  extract 6 modules (`515b7a5e`)
- Phase 5.1: Unit tests setup + 172 tests for safety-critical modules (`929cd422`)
- Phase 2.3: SQLite-backed memory storage (`61db45a3`)
- Phase 1: Browser CDP Bypass  replace playwright-core with native CDP client (`425731b4`)
- multi-strategy CDP connection (existing session, port scan, profile copy) (`64efc02d`)
- Speaker diarization, dashboard fixes, coaching bar improvements (`8690e178`)
- Meeting Coach UX overhaul: compact coaching bar, rich dashboard summary, live transcription (`36c288db`)
- fix+feat: screen vision base64 fix, IPC Buffer crash fix, screen-based speaker identification (`4c14ffcf`)
- Initial commit: KxAI Personal AI Desktop Agent (`762f5632`)

