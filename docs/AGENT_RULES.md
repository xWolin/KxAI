# KxAI — Zasady Współpracy Agentów (Agent Rules)

Ten dokument definiuje standardy operacyjne, zasady współpracy i procedury dla agentów AI pracujących nad projektem KxAI. Dążymy do pełnej autonomii, ale z zachowaniem rygorystycznej jakości i spójności.

## 1. Struktura Projektu i Odpowiedzialności
*   **src/main:** Backend Electrona (Node.js/TypeScript). Logika usług, IPC, SQLite.
*   **src/renderer:** Frontend Electrona (React/TypeScript). UI, stan (Zustand), i18n.
*   **src/shared:** Współdzielone typy, stałe i schematy (Zod).

## 2. Standardy Pracy nad Kodem i PR
Aby unikać konfliktów (merge conflicts) i błędów regresyjnych:
1.  **Branching Strategy:** Każda zmiana powinna odbywać się na osobnym branchu (`feat/`, `fix/`, `docs/`, `test/`).
2.  **Commit Messages:** Używaj standardów [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (np. `feat(cortex): add reflection logic`, `fix(ui): unify save buttons`).
3.  **Local Quality Gate:** Przed zgłoszeniem gotowości do merge'a, autor PR MUSI uruchomić lokalnie (i upewnić się, że przechodzą):
    *   `npx vitest run tests/environment/`
    *   `npm run typecheck`
    *   `npx vitest run --coverage` (Coverage w linii i instrukcjach musi wynosić >= 30%. Z uwagi na to, że jest to wczesna faza rozwoju, próg jest niski, ale z czasem będzie rósł).

## 3. Zasady Merge'owania do `main`
1.  **Approval (Zatwierdzenie):** Merge do `main` wymaga ZATWIERDZENIA (APPROVE) od przynajmniej jednego innego agenta (nie-autora PR) lub użytkownika. ZABRONIONE SĄ "self-merges".
2.  **Czysty Git:** Merguj PR tylko wtedy, gdy wszystkie testy CI są zielone i CodeRabbit nie zgłasza krytycznych uwag.
3.  **Rebase:** Jeśli `main` zostanie zaktualizowany, aktywne PR-y muszą zostać zrebase'owane (`git rebase main`), a testy (w tym coverage) uruchomione ponownie.

## 4. Ograniczanie Halucynacji i Spójność Architektury
1.  **Sprawdź, zanim napiszesz:** Zawsze używaj `grep_search`, `read_file` lub `list_directory`, aby sprawdzić istniejącą implementację, ścieżki i konwencje nazewnictwa. Nie "zgaduj" nazw plików ani struktury interfejsów.
2.  **TypeScript First:** Rozwiązuj konflikty na poziomie typów. Jeśli modyfikujesz sygnaturę metody (np. w `agent-loop.ts`), zaktualizuj wszystkie miejsca wywołań. Zawsze polegaj na `npm run typecheck`.
3.  **Wzorce Projektowe:**
    *   Unikaj gigantycznych klas (np. `agent-loop.ts`). Dążymy do kompozycji (np. delegacja do `TakeControlEngine`, `CortexEngine`, `CronExecutor`).
    *   Wszystkie nowe usługi muszą być rejestrowane w `ServiceContainer` i mieć wyraźnie zdefiniowane zależności (Dependency Injection).

## 5. Współpraca Agentów w agentchattr
1.  **Respond in Chat:** Gdy zostaniesz wspomniany (@yourname), odpowiadaj w kanale chat_send. Inni agenci i użytkownik nie widzą Twojego terminala.
2.  **Status Reporting:** Po wykonaniu zadania (np. mergu PR) krótko poinformuj w czacie o rezultacie.
3.  **Rule Proposals:** Jeśli zauważysz powtarzający się błąd lub potrzebę nowej konwencji, zaproponuj regułę używając `chat_rules(action='propose')`.

## 6. Wizja Produktu — KxAI jako "Zawsze Pomocny Asystent"
Naszym celem jest budowa agenta, który jest:
*   Świadomy kontekstu (Screen awareness via `ScreenMonitorService`).
*   Proaktywny (Działający w tle poprzez `CortexEngine`, dający sugestie i propozycje cronów).
*   Oferujące pomoc bez pytania, jeśli intencja jest jasna (intent detection).
*   Zapamiętujące preferencje (persistence) — by użytkownik nie musiał powtarzać tych samych akcji (np. ręczne włączanie Telegrama przy starcie).
