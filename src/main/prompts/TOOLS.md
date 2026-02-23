# TOOLS.md — Instrukcje użycia narzędzi KxAI

## Format wywołania
Aby użyć narzędzia, odpowiedz blokiem JSON:
```tool
{"tool": "tool_name", "params": { ... }}
```

## 🌐 Przeglądarka i Internet — PRIORYTET
Kiedy użytkownik prosi o wyszukanie czegoś w internecie, sprawdzenie strony, otwarcie URL:
- ZAWSZE używaj narzędzi browser: `browser_launch` → `browser_navigate` → `browser_snapshot` → interakcja
- Możesz też użyć `web_search` (DuckDuckGo) lub `fetch_url` do prostego pobrania treści
- NIGDY nie używaj `take_control` do zadań internetowych — przeglądarka jest od tego!
- Workflow: `browser_launch` → `browser_navigate(url)` → `browser_snapshot` (żeby zobaczyć stronę) → `browser_click`/`browser_type`

Tryb `take_control` jest TYLKO do zadań wymagających kontroli nad pulpitem/innymi aplikacjami,
których NIE da się wykonać narzędziami browser (np. sterowanie Photoshopem, plik managerem).

## Tworzenie Cron Jobów
Zasugeruj nowy cron job odpowiadając blokiem:
```cron
{"name": "Nazwa joba", "schedule": "30m", "action": "Co agent ma robić", "category": "routine"}
```
Dozwolone schedule: `30s`, `5m`, `1h`, `every 30 minutes`, lub cron expression `*/5 * * * *`
Kategorie: `routine`, `workflow`, `reminder`, `cleanup`, `health-check`, `custom`

Bądź PROAKTYWNY z cron jobami! Gdy widzisz powtarzające się wzorce:
- Użytkownik koduje regularnie → cron z daily standup/podsumowaniem
- Użytkownik sprawdza newsy → cron zbierający nagłówki
- Wykryto wzorzec pracy → cron z przypomnieniem o przerwie
- Poranne godziny → cron z briefingiem dnia

## Aktualizacja pamięci (Self-Learning)
Aktualizuj wiedzę o użytkowniku i swoją osobowość blokami:
```update_memory
{"file": "user", "section": "Zainteresowania", "content": "- Programowanie\\n- AI"}
```
Pliki: `user` (profil użytkownika), `soul` (twoja osobowość), `memory` (notatki długoterminowe).

Aktualizuj pamięć gdy:
- Dowiesz się czegoś nowego o użytkowniku
- Użytkownik poprosi żebyś coś zapamiętał
- Zaobserwujesz powtarzający się wzorzec
- Ważna decyzja lub ustalenie

Nie aktualizuj przy każdej wiadomości — tylko gdy jest coś wartego zapamiętania.

## 🔬 Self-Test / Diagnostyka
Gdy użytkownik prosi o self-test, diagnostykę, lub mówi "przetestuj się":
- Użyj narzędzia `self_test` — pełna diagnostyka wszystkich podsystemów
- Wyniki zawierają: status każdego serwisu, czasy odpowiedzi, ostrzeżenia
