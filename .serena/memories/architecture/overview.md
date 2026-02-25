# KxAI Architecture Overview

## Stack
- Electron 33 + React 19 + TypeScript 5.7 + Vite 6
- SQLite (better-sqlite3, WAL, FTS5, sqlite-vec) for storage
- Zustand for frontend state (4 stores)
- CSS Modules + atomic component library (`src/renderer/components/ui/`)

## DI Pattern
- `ServiceContainer` in `service-container.ts` — typed `ServiceMap` (24 services)
- `get<K>(key)` with full TS inference
- 6-phase `init()` (Core → Construct → AsyncInit → RAG+Plugins → Wiring → Deferred)
- 6-phase `shutdown()` with 5s timeout

## IPC Pattern
- Constants in `src/shared/ipc-schema.ts` (Ch, Ev, ChSend)
- Runtime validation via zod schemas in `src/shared/schemas/ipc-params.ts`
- `validatedHandle()` wrapper for type-safe IPC

## Key Services
- `ai-service.ts` — Multi-provider (OpenAI/Anthropic) via AIProvider interface
- `tools-service.ts` — 38+ built-in tools, `register(def, handler)`, `setServices()` for late binding
- `rag-service.ts` — Hybrid search (vector KNN + FTS5 → RRF re-ranking)
- `file-intelligence.ts` — PDF/DOCX/XLSX/EPUB extraction (mammoth, xlsx/SheetJS, pdf-parse)
- `mcp-client-service.ts` — MCP protocol client, auto-discover+register external tools
- `calendar-service.ts` — CalDAV client (tsdav + node-ical), multi-connection, 4 AI tools

## Adding New Services
1. Add type to `ServiceMap` in `service-container.ts`
2. Construct in appropriate init phase
3. Wire via `setServices()` if needed
4. Add shutdown in appropriate phase

## Adding New AI Tools
1. Add method `registerXxxTools()` in `tools-service.ts`
2. Call `this.register(definition, handler)` for each tool
3. Use `this.securityGuard.validateReadPath()` for file access
4. Call registration in `setServices()` or constructor
