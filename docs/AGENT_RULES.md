# KxAI — Zasady Współpracy Agentów (Agent Rules)

Ten dokument definiuje standardy operacyjne, zasady współpracy i procedury dla agentów AI pracujących nad projektem KxAI. Dążymy do pełnej autonomii, ale z zachowaniem rygorystycznej jakości i spójności.

## 1. Role i Podział Pracy (Division of Labor)
Aby unikać konfliktów (merge conflicts) i dublowania pracy, agenci powinni deklarować na czacie `#general` (lub w wątku Joba) obszar, którym się aktualnie zajmują.
*   **Designer (Gemini):** UI/UX, spójność interfejsu (Settings, Chat, Widgets), architektura dokumentacji, persistence (zapisywanie ustawień UI, np. auto-start).
*   **Core/Backend (Claude/Codex):** Architektura systemowa, integracje platformowe (Mac OS, Windows native), zaawansowana logika narzędzi (Meeting Coach, rejestrowanie audio/wideo), stabilność CI/CD.

## 2. Procedura Pull Requestów (PR Hygiene)
1.  **Jeden problem = Jeden PR:** Nie łączymy refaktoryzacji z nowymi funkcjami.
2.  **Czystość PR-ów:** Nie commitujemy artefaktów badawczych (np. `transkrypt-czat.md`), zrzutów logów ani plików testowych/pomocniczych nienależących do repozytorium KxAI (np. skryptów `agentchattr`). Pliki z planami po zakończeniu implementacji przenosimy do `docs/archive/`.
3.  **Local Quality Gate:** Przed zgłoszeniem gotowości do merge'a, autor PR MUSI uruchomić lokalnie (i upewnić się, że przechodzą):
    *   `npx vitest run tests/environment/`
    *   `npm run typecheck`
    *   `npx vitest run --coverage` (Coverage w linii i instrukcjach musi wynosić $\ge$ 30%).

## 3. Zasady Merge'owania do `main`
1.  **Approval (Zatwierdzenie):** Merge do `main` wymaga ZATWIERDZENIA (APPROVE) od przynajmniej jednego innego agenta (nie-autora PR) lub użytkownika. ZABRONIONE SĄ "self-merges".
2.  **Zielone CI/CD:** Kategoryczny zakaz merge'owania, gdy zdalne CI (GitHub Actions) jest w stanie "pending" lub "failed".
3.  **Rebase:** Jeśli `main` zostanie zaktualizowany, aktywne PR-y muszą zostać zrebase'owane (`git rebase main`), a testy (w tym coverage) uruchomione ponownie.

## 4. Ograniczanie Halucynacji i Spójność Architektury
1.  **Sprawdź zanim napiszesz:** Zawsze używaj `grep_search`, `read_file` lub `list_directory`, aby sprawdzić istniejącą implementację, ścieżki i konwencje nazewnictwa. Nie "zgaduj" nazw plików ani struktury interfejsów.
2.  **TypeScript First:** Rozwiązuj konflikty na poziomie typów. Jeśli modyfikujesz sygnaturę metody (np. w `agent-loop.ts`), zaktualizuj wszystkie miejsca wywołań. Zawsze polegaj na `npm run typecheck`.
3.  **Wzorce Projektowe:** 
    *   Unikaj gigantycznych klas (np. `agent-loop.ts`). Dążymy do kompozycji (np. delegacja do `TakeControlEngine`, `CortexEngine`, `CronExecutor`).
    *   Używaj wbudowanego `createLogger` do logowania (`import { createLogger } from './logger';`).
    *   Zarządzanie stanem UI w Reakcie realizuj przez dedykowane store'y Zustand (np. `useConfigStore`, `useAgentStore`).

## 5. Dokumentacja
*   Główna mapa architektury to `SERVICE-DEPENDENCY-MAP.md`. Każdy duży refactor lub dodanie nowego serwisu wymaga aktualizacji tego pliku.
*   Instrukcje dla agenta autonomicznego (Cortex) znajdują się w `src/main/prompts/`. Każda zmiana logiki autonomicznej musi być odzwierciedlona w promptach (np. `TOOLS.md`).

## 6. Proaktywność Agenta (Cel KxAI)
Celem nadrzędnym projektu jest agent, który **ułatwia workflow użytkownika**. Należy implementować mechanizmy:
*   Wykrywające powtarzające się schematy (np. propozycje cronów).
*   Oferujące pomoc bez pytania, jeśli intencja jest jasna (intent detection).
*   Zapamiętujące preferencje (persistence) — by użytkownik nie musiał powtarzać tych samych akcji (np. ręczne włączanie Telegrama przy starcie).
