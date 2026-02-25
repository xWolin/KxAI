# KxAI Conventions

## Naming
- UI messages/comments in Polish, variable/type names in English
- TypeScript strict mode, shared types in `src/shared/types/` (canonical)
- Path aliases: `@shared/*`, `@main/*`, `@renderer/*`

## Logging
- Use `createLogger('Tag')` from `logger.ts`, never raw console.log

## Testing
- Vitest, tests in `tests/`, convention: `tests/<service-name>.test.ts`
- 507 tests in 13 files, coverage thresholds: 30/25/20% lines/functions/branches
- Run `npm run test:env` for environment preflight

## Frontend
- CSS Modules per component (`*.module.css`), `cn()` utility
- Zustand stores in `src/renderer/stores/` (4 stores + useStoreInit)
- UI components: `import { Button, Input } from '../ui'`

## AI
- OpenAI: `max_completion_tokens` (not `max_tokens`), GPT-5+ uses `developer` role
- Native function calling default ON (`config.useNativeFunctionCalling`)
- Tool schemas via `tool-schema-converter.ts`

## npm
- Use `--legacy-peer-deps` when installing (eslint peer conflict)

## Commands
- `npm run dev` — dev mode
- `npm run preflight` — full quality check
- `npm run typecheck` — both tsconfigs
- `npm run test` — Vitest
