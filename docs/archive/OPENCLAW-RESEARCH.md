# OpenClaw vs KxAI — Mega Research

> Raport z analizy repozytorium `openclaw/openclaw` (~220k ⭐, TypeScript)
> Data: styczeń 2025

---

## 1. Architektura OpenClaw — przegląd

OpenClaw to **personal AI assistant** działający jako gateway między użytkownikiem (WhatsApp, Telegram, Discord, Signal, iMessage, Slack, Google Chat, MS Teams) a modelem AI (Claude/GPT). Kluczowe warstwy:

| Warstwa | Opis |
|---------|------|
| **Gateway** | Serwer HTTP, obsługa wielu kanałów komunikacji |
| **Pi Agent Core** | `@mariozechner/pi-agent-core` — runtime agenta (tool calling, sesje) |
| **Pi Coding Agent** | `@mariozechner/pi-coding-agent` — coding-specific agent z session management |
| **Agent Loop** | 3-warstwowy: RPC → agentCommand → runEmbeddedPiAgent |
| **Heartbeat Runner** | Periodyczne "budzenie" agenta (domyślnie co 30min) |
| **Cron Service** | Precyzyjne planowanie zadań (izolowane sesje lub main session) |
| **Sandbox** | Docker-based isolation (`openclaw-sandbox:bookworm-slim`) |
| **Sub-agents** | Spawn, list, kill, steer — wieloagentowy system |
| **Skills** | Pluginy/rozszerzenia ładowane z SKILL.md |
| **Memory** | Markdown files + bank/ + entity files |
| **Companion App** | macOS native app do exec approvals |

---

## 2. Kluczowe mechanizmy autonomii OpenClaw

### 2.1 Agent Loop — brak twardego limitu iteracji

OpenClaw ma **`while(true)` loop** w `src/agents/pi-embedded-runner/run.ts` z `MAX_RUN_LOOP_ITERATIONS` jako safety net, ale to jest **bardzo wysoki limit** — nie 5 czy 15 jak w KxAI.

```
runEmbeddedPiAgent:
  while(true) {
    // resolve model, run agent turn
    // auto-compact when context fills
    // retry on transient errors
    iterations++
    if (iterations >= MAX_RUN_LOOP_ITERATIONS) break
  }
```

Retry iterations są **skalowane** dynamicznie: `resolveMaxRunRetryIterations()` uwzględnia liczbę dostępnych profili modeli.

### 2.2 Tool Loop Detection — inteligentne zamiast sztywnego limitu

**Domyślnie WYŁĄCZONE** (`enabled: false`), ale gdy włączone:

| Detektor | Co wykrywa |
|----------|-----------|
| `genericRepeat` | Ten sam tool call powtórzony X razy (hash-based) |
| `knownPollNoProgress` | Polling bez postępu (np. ciągle `sessions_list`) |
| `pingPong` | Wzorzec A→B→A→B (alternating pattern) |

Progi:
- **WARNING**: 10 powtórzeń
- **CRITICAL**: 20 powtórzeń → blokada sesji
- **GLOBAL CIRCUIT BREAKER**: 30 → pełna blokada
- **History size**: 30 tool calls śledzonych

**Wniosek**: OpenClaw NIE ma sztywnego `maxIterations = 15`. Ma inteligentną detekcję pętli, ale domyślnie wyłączoną. Agent może robić setki tool calls jeśli nie wchodzi w pętlę.

### 2.3 Heartbeat — proaktywne "budzenie się"

Heartbeat w OpenClaw to **pełny agent turn** uruchamiany co 30 minut:

1. Agent czyta `HEARTBEAT.md` (checklist)
2. Sprawdza pending system events (cron, exec results)
3. Ma pełny kontekst main session
4. Jeśli nic ciekawego → odpowiada `HEARTBEAT_OK` → supressed
5. Jeśli coś ważnego → wysyła wiadomość do użytkownika

Specjalne prompty:
- Normalny heartbeat: czytaj HEARTBEAT.md, nie wymyślaj
- Exec event: relay wyników komendy
- Cron event: przekaż reminder użytkownikowi

Konfiguracja:
```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",           // interwał
        target: "last",         // gdzie wysyłać
        activeHours: { start: "08:00", end: "22:00" },  // godziny aktywności
        model: "provider/model", // opcjonalny override modelu
        includeReasoning: true,  // opcjonalnie pokaż reasoning
      }
    }
  }
}
```

### 2.4 Cron vs Heartbeat — dualny system automatyzacji

| Cecha | Heartbeat | Cron |
|-------|-----------|------|
| Kiedy | Co 30min (domyślnie) | Dokładny czas (cron expression) |
| Sesja | Main session (pełen kontekst) | Main lub **izolowana** |
| Koszt | 1 agent turn na tick | 1 agent turn per job |
| Model | Domyślny | Może używać innego modelu |
| Batching | Wiele checków w jednym turnie | 1 task = 1 job |
| Kontekst | Pełen (wie co robił) | Izolowany (brak historii) |

Przykłady cron:
```bash
# Jednorazowe przypomnienie za 20 minut
openclaw cron add --name "Meeting" --at "20m" --session main --system-event "Spotkanie za 10 min" --wake now

# Codzienny raport poranny
openclaw cron add --name "Morning" --cron "0 7 * * *" --session isolated --model opus --announce

# Cykliczny check co 4h
openclaw cron add --name "Check" --every "4h" --session main --system-event "Health check" --wake now
```

### 2.5 Sub-agent System — delegowanie zadań

OpenClaw może **spawnować sub-agenty** z własnymi sesjami:

| Parametr | Wartość domyślna | Max |
|----------|-----------------|-----|
| `maxConcurrent` (agents) | 4 | — |
| `maxConcurrent` (subagents) | 8 | — |
| `maxSpawnDepth` | 1 | 5 |
| `maxChildrenPerAgent` | 5 | 20 |
| Auto-archive | 60 minut | — |

**Push-based completion**: Sub-agent nie jest pollowany — sam ogłasza zakończenie. System prompt mówi:
> "Completion is push-based: it will auto-announce when done."
> "Do not poll subagents list / sessions_list in a loop."

### 2.6 Exec — system poleceń z approval gateway

OpenClaw ma 3 poziomy bezpieczeństwa exec:

| Poziom | Opis |
|--------|------|
| `deny` | Blokuj wszystko |
| `allowlist` | Tylko dozwolone komendy |
| `full` | Pozwól na wszystko |

Plus `ask` mode:
- `off` — nigdy nie pytaj
- `on-miss` — pytaj gdy nie pasuje do allowlist
- `always` — zawsze pytaj

**Autoallow Skills**: znane binaria ze Skills mogą być automatycznie dozwolone.

**Background exec**: komendy mogą działać w tle, a po zakończeniu system automatycznie budzi agenta heartbeatem z wynikami.

### 2.7 Context Compaction — auto-skracanie kontekstu

Gdy context window się zapełnia, OpenClaw:
1. Automatycznie kompaktuje historię (streszcza stare wiadomości)
2. Post-compaction audit sprawdza co zostało zachowane
3. Agent kontynuuje z kompaktowanym kontekstem

**To jest kluczowe dla pracy 24/7** — agent nie traci kontekstu, jest on kompresowany.

### 2.8 System Prompt — bogaty kontekst agenta

OpenClaw buduje customowy system prompt na każdy run zawierający:

| Sekcja | Opis |
|--------|------|
| Tooling | Lista narzędzi z opisami |
| Skills | Dostępne rozszerzenia (SKILL.md) |
| Memory | Instrukcje zarządzania pamięcią |
| Workspace | Working directory, notatki |
| Sandbox | Info o sandboxie (jeśli aktywny) |
| Time | UTC + user timezone |
| Reply Tags | Format odpowiedzi |
| Safety | Guardrails bezpieczeństwa |
| Heartbeat | Prompt heartbeata |
| CLI Quick Reference | Dostępne komendy CLI |
| Subagent Context | Instrukcje dla sub-agentów |
| Messaging | Dostępne kanały komunikacji |
| Voice (TTS) | Hint głosowy |
| Project Context | Bootstrap files (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md) |

### 2.9 Workspace Bootstrap Files

| Plik | Funkcja |
|------|---------|
| `AGENTS.md` | Instrukcje operacyjne + pamięć |
| `SOUL.md` | Persona, ton, granice |
| `TOOLS.md` | Notatki o narzędziach |
| `BOOTSTRAP.md` | Jednorazowy rytuał first-run |
| `IDENTITY.md` | Imię, emoji, vibe |
| `USER.md` | Profil użytkownika |
| `HEARTBEAT.md` | Checklist dla heartbeata |
| `MEMORY.md` | Pamięć agenta |

### 2.10 OpenProse — język programowania workflowów

OpenClaw ma **własny język** do orkiestracji workflowów agentowych:

```
loop until **task complete** (max: 10) {
  analyze current state
  fix the issue
  run tests
}

parallel for each file in ["a.ts", "b.ts", "c.ts"] {
  review and fix the file
}
```

Gotowe produkcyjne workflow:
- **PR Auto-fix**: automatyczna naprawa CI failures
- **Feature Factory**: budowanie feature'ów od spec do PR
- **Bug Hunter**: szukanie i naprawianie bugów
- **The Forge**: budowanie całych aplikacji od zera
- **Captain's Chair**: persistentny orkiestrator

### 2.11 Memory System

- `memory/YYYY-MM-DD.md` — dzienne logi
- `memory.md` / `MEMORY.md` — stabilna pamięć
- `SOUL.md` — persona
- `bank/world.md`, `bank/experience.md`, `bank/opinions.md` — banki wiedzy
- `bank/entities/` — pliki per-encja (osoby, projekty, tematy)
- Offline-first z derived indices

---

## 3. Porównanie: OpenClaw vs KxAI

| Cecha | OpenClaw | KxAI | Gap |
|-------|----------|------|-----|
| **Tool loop limit** | Brak sztywnego (inteligentna detekcja pętli) | `maxIterations = 15` | 🔴 **KRYTYCZNE** |
| **Loop detection** | Hash-based, ping-pong, poll detection | Brak | 🔴 **KRYTYCZNE** |
| **Context compaction** | Auto-compaction gdy context się zapełnia | `maybeRunMemoryFlush()` (ograniczone) | 🟡 **WAŻNE** |
| **Heartbeat** | Co 30min, full agent turn, HEARTBEAT.md | Co 15min, z screen monitor | 🟢 Porównywalny |
| **Heartbeat suppress** | `HEARTBEAT_OK` → nie wysyła | `HEARTBEAT_OK` / `NO_REPLY` → null | 🟢 Porównywalny |
| **Active Hours** | Konfigurowalne `08:00-22:00` | Brak | 🟡 **WAŻNE** |
| **Cron system** | Pełny CLI, main/isolated sessions, wake modes | Basic CRUD, no isolation | 🟡 **WAŻNE** |
| **Sub-agents** | Spawn, kill, steer, push-based completion | Brak | 🔴 **KRYTYCZNE** |
| **Exec approvals** | 3 levels (deny/allowlist/full) + ask modes | Brak (bezpośrednie exec) | 🟡 Bezpieczeństwo |
| **Sandbox** | Docker-based isolation | Brak | 🟡 Bezpieczeństwo |
| **Skills/Plugins** | SKILL.md, auto-discovery, CLI bins | `plugin-service.ts` (basic) | 🟡 **WAŻNE** |
| **Multi-channel** | WhatsApp, Telegram, Discord, Signal, iMessage, Slack, GChat, Teams | Electron desktop only | 🟢 Inny scope |
| **Screen capture** | Brak (remote-first) | ✅ desktopCapturer, OCR, vision | 🟢 KxAI lepszy |
| **Desktop automation** | Brak | ✅ nut.js (keyboard, mouse) | 🟢 KxAI lepszy |
| **Browser automation** | Brak natywnej (sub-agent + exec) | ✅ Playwright built-in | 🟢 KxAI lepszy |
| **AFK mode** | Heartbeat adjustments | ✅ Dedykowany AFK heartbeat | 🟢 KxAI lepszy |
| **Take-control** | Brak | ✅ Autonomiczne sterowanie desktopem | 🟢 KxAI lepszy |
| **RAG/Vector search** | Brak wbudowanego (opiera się na file read) | ✅ Embeddingi + semantic search | 🟢 KxAI lepszy |
| **TTS** | Brak natywnego | ✅ Text-to-speech | 🟢 KxAI lepszy |
| **Workspace files** | 8 bootstrap files (AGENTS/SOUL/TOOLS/etc.) | AGENTS.md + prompts/ | 🟡 Warto rozbudować |
| **System prompt** | Dynamiczny, ~20 sekcji, tool-aware | Statyczny z prompt-service | 🟡 **WAŻNE** |
| **Memory citations** | Konfigurowalne tryby cytowań | Brak | 🟢 Nice-to-have |
| **OpenProse** | Język orkiestracji workflowów | Brak | 🔴 **INNOWACYJNE** |
| **Background exec** | ✅ Auto-heartbeat z wynikami | Brak | 🟡 **WAŻNE** |
| **Model aliases** | Konfiguracja, override per-agent | Jeden model globalnie | 🟡 Warto dodać |

---

## 4. Co KxAI powinien dodać dla pracy 24/7

### 🔴 Priorytet krytyczny — musi być

#### 4.1 Usunięcie twardego limitu `maxIterations = 15`

**Problem**: Agent nie może skończyć złożonego zadania jeśli wymaga >15 tool calls.

**Rozwiązanie OpenClaw**: Inteligentna detekcja pętli zamiast sztywnego limitu.

**Implementacja dla KxAI**:
```typescript
// Zamiast: while (iterations < maxIterations)
// Użyj: inteligentnej detekcji pętli

class ToolLoopDetector {
  private history: string[] = [];
  private readonly HISTORY_SIZE = 30;
  private readonly WARNING_THRESHOLD = 10;
  private readonly CRITICAL_THRESHOLD = 20;

  addCall(toolName: string, params: any): 'ok' | 'warning' | 'critical' {
    const hash = this.hashCall(toolName, params);
    this.history.push(hash);
    if (this.history.length > this.HISTORY_SIZE) {
      this.history.shift();
    }

    // Check for generic repeat
    const lastHash = this.history[this.history.length - 1];
    const repeatCount = this.history.filter(h => h === lastHash).length;
    if (repeatCount >= this.CRITICAL_THRESHOLD) return 'critical';
    if (repeatCount >= this.WARNING_THRESHOLD) return 'warning';

    // Check for ping-pong (A-B-A-B pattern)
    if (this.history.length >= 4) {
      const last4 = this.history.slice(-4);
      if (last4[0] === last4[2] && last4[1] === last4[3] && last4[0] !== last4[1]) {
        const pingPongCount = this.countPingPong();
        if (pingPongCount >= this.WARNING_THRESHOLD / 2) return 'warning';
      }
    }

    return 'ok';
  }

  private hashCall(tool: string, params: any): string {
    return `${tool}:${JSON.stringify(params)}`.slice(0, 200);
  }

  private countPingPong(): number {
    if (this.history.length < 4) return 0;
    let count = 0;
    for (let i = this.history.length - 4; i >= 0; i -= 2) {
      if (this.history[i] === this.history[i + 2]) count++;
      else break;
    }
    return count;
  }
}
```

#### 4.2 Context Compaction — auto-kompresja kontekstu

**Problem**: Po wielu tool calls / długiej pracy, context window się zapełnia i agent "traci pamięć".

**Rozwiązanie OpenClaw**: Automatyczna kompakcja — streszczenie starych wiadomości, zachowanie najnowszego kontekstu.

**Implementacja dla KxAI**:
```typescript
async compactContext(): Promise<void> {
  const history = this.ai.getHistory();
  if (history.length < 20) return; // za mało do kompakcji

  // Weź pierwsze 70% historii i poproś AI o streszczenie
  const toCompact = history.slice(0, Math.floor(history.length * 0.7));
  const summary = await this.ai.sendMessage(
    'Streść poniższą konwersację w max 500 słowach, zachowując kluczowe decyzje i kontekst:\n\n' +
    toCompact.map(m => `${m.role}: ${m.content}`).join('\n\n'),
    undefined, undefined, { skipHistory: true }
  );

  // Replace old messages with summary
  this.ai.replaceHistory([
    { role: 'system', content: `[Kompaktowany kontekst]\n${summary}` },
    ...history.slice(Math.floor(history.length * 0.7))
  ]);
}
```

#### 4.3 Sub-agent System — delegowanie zadań

**Problem**: KxAI nie może rozdzielać pracy. Jeden agent = jeden wątek.

**Rozwiązanie OpenClaw**: Spawn sub-agentów z dedykowanymi zadaniami, push-based completion.

**Koncepcja dla KxAI** (uproszczona wersja):
```typescript
class SubAgent {
  id: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  result?: string;
  startedAt: number;

  // Sub-agent ma własną instancję AI z minimalnym system promptem
  private ai: AIService;

  async run(): Promise<string> {
    // Wykonaj task z ograniczonym kontekstem
    // Po zakończeniu — zapisz wynik i powiadom main agenta
  }
}
```

### 🟡 Priorytet ważny — znacznie poprawi autonomię

#### 4.4 Background Exec z auto-heartbeat

Gdy agent uruchomi długotrwałą komendę (build, test suite), powinien:
1. Uruchomić ją w tle
2. Kontynuować inne zadania
3. Automatycznie dostać wynik przez heartbeat event

#### 4.5 Izolowane sesje Cron

Cron joby powinny móc działać w izolowanych sesjach (nie zaśmiecając main kontekstu):
```typescript
interface CronJobEnhanced extends CronJob {
  sessionMode: 'main' | 'isolated';
  wakeMode: 'now' | 'next-heartbeat';
  model?: string; // opcjonalny override modelu
}
```

#### 4.6 Active Hours dla Heartbeat

Heartbeat nie powinien działać w nocy (chyba że urgent):
```typescript
const activeHours = { start: '08:00', end: '23:00' };

startHeartbeat() {
  setInterval(() => {
    if (!this.isWithinActiveHours(activeHours)) {
      console.log('[Heartbeat] Poza godzinami aktywności');
      return;
    }
    this.heartbeat();
  }, intervalMs);
}
```

#### 4.7 Dynamiczny System Prompt

Zamiast statycznych plików promptów, budować system prompt dynamicznie:
- Inject dostępne narzędzia
- Inject aktywny workspace
- Inject runtime info (OS, model, czas)
- Inject bootstrap files

#### 4.8 Push-based Notifications zamiast Polling

Wzorzec z OpenClaw: sub-agenty i background exec **same ogłaszają** zakończenie zamiast być pollowane.

### 🟢 Nice-to-have — innowacyjne funkcje

#### 4.9 OpenProse-like Workflow Language

Możliwość definiowania wielokrokowych workflowów:
```
loop until **testy przechodzą** (max: 5) {
  przeanalizuj błędy testów
  napraw kod
  uruchom testy ponownie
}
```

#### 4.10 Workspace Bootstrap Files

Rozszerzyć system plików konfiguracyjnych:
- `SOUL.md` — persona agenta (oddzielona od AGENTS.md)
- `TOOLS.md` — notatki o narzędziach
- `USER.md` — profil użytkownika
- `IDENTITY.md` — imię/emoji/vibe

#### 4.11 Model Aliases i Per-task Model Override

Możliwość użycia lepszego modelu do trudnych zadań:
```typescript
// Dla cron job "weekly analysis" → użyj Opus
// Dla heartbeat → użyj tańszego modelu
```

---

## 5. Podsumowanie — co OpenClaw robi lepiej

1. **Brak twardego limitu tool calls** — inteligentna detekcja pętli zamiast `maxIterations`
2. **Context compaction** — auto-kompresja pozwala na nieskończoną pracę
3. **Sub-agents** — delegowanie podzadań, równoległe przetwarzanie
4. **Background exec + auto-notify** — agent nie czeka na wyniki
5. **Izolowane sesje cron** — nie zaśmiecają głównego kontekstu
6. **Push-based completion** — brak pollowania
7. **Dynamiczny system prompt** — kontekstowy, tool-aware
8. **OpenProse** — deklaratywne workflow

## 6. Co KxAI robi lepiej

1. **Screen capture + OCR** — widzi ekran użytkownika w real-time
2. **Desktop automation** — sterowanie myszką/klawiaturą (nut.js)
3. **Browser automation** — Playwright wbudowany
4. **AFK mode** — dedykowane zadania gdy użytkownik jest nieaktywny
5. **Take-control mode** — autonomiczne sterowanie desktopem
6. **RAG/Vector search** — embeddingi + semantic search
7. **TTS** — głosowe odpowiedzi
8. **Floating widget** — natywny desktop UI

## 7. Strategia rozwoju KxAI dla pracy 24/7

### Faza 1 (natychmiast): Usunięcie blokad autonomii
- [ ] Zamienić `maxIterations = 15` na inteligentną detekcję pętli
- [ ] Dodać auto-context compaction
- [ ] Dodać active hours dla heartbeata

### Faza 2 (krótkoterminowa): Zaawansowana automatyzacja
- [ ] Background exec z auto-notify
- [ ] Izolowane sesje cron
- [ ] Dynamiczny system prompt z runtime info

### Faza 3 (średnioterminowa): Multi-agent
- [ ] Sub-agent system (uproszczona wersja)
- [ ] Push-based completion notifications
- [ ] Model aliases per-task

### Faza 4 (długoterminowa): Zaawansowane workflowy
- [ ] Workflow language (inspirowany OpenProse)
- [ ] Workspace bootstrap files (SOUL.md, TOOLS.md, USER.md)
- [ ] Per-agent konfiguracja
