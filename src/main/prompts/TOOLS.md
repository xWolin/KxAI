# TOOLS.md — Instrukcje użycia narzędzi KxAI

## Format wywołania

Aby użyć narzędzia, odpowiedz blokiem JSON:
```tool
{"tool": "tool_name", "params": { ... }}
```

<critical>
WAŻNE: Generuj TYLKO JEDEN blok tool na raz. Po wykonaniu narzędzia dostaniesz wynik i możesz kontynuować.
Wyjątek: możesz generować wiele bloków tool jeśli są od siebie NIEZALEŻNE (np. odczyt 2 różnych plików).
</critical>

## Wybór narzędzia — Decision Matrix

| Zadanie | Narzędzie | NIE używaj |
|---------|-----------|------------|
| Szukanie w internecie | `web_search` | `take_control` |
| Odwiedzenie strony (odczyt) | `fetch_url` | `browser_*` (zbyt ciężkie) |
| Interakcja ze stroną (klik, formularz) | `browser_*` | `take_control` |
| Operacje na plikach | `read_file`, `write_file` | `run_shell_command` (chyba że bulk) |
| Analiza dokumentów (PDF, DOCX, XLSX) | `analyze_file` | `read_file` (nie obsługuje binariów) |
| Przeszukiwanie plików na dysku | `search_files` | `run_shell_command` (search_files jest bezpieczniejszy) |
| Informacje o pliku/folderze | `file_info`, `analyze_folder` | — |
| Uruchomienie programu | `run_shell_command` | — |
| Szukanie w pamięci/plikach | `search_memory` | — |
| Sterowanie pulpitem | blok `take_control` | `mouse_*`, `keyboard_*` w normalnym czacie |
| Szybki kod | `execute_code` | `create_and_run_script` (dla jednorazowych) |
| Trwały skrypt | `create_and_run_script` | `execute_code` (nie persystuje) |
| Kalendarz, email, Slack, bazy danych | `mcp_browse_registry` → `mcp_add_and_connect` → `mcp_*` | Pisanie własnych skryptów (MCP daje gotowe rozwiązanie) |
| Sprawdzenie kalendarza | `calendar_upcoming` lub `calendar_list_events` | `mcp_*` (natywne narzędzia kalendarza są szybsze) |
| Tworzenie wydarzeń | `calendar_create_event` | — |
| Usuwanie wydarzeń | `calendar_delete_event` | — |
| Przypomnienia, alarmy | `set_reminder` → `list_reminders` / `cancel_reminder` | Ręczne tworzenie cron jobów (set_reminder obsługuje naturalny język) |
| Historia schowka | `clipboard_history`, `clipboard_search` | — |
| Analiza bieżącego schowka | `clipboard_analyze` | `clipboard_history` (analyze = bieżący, history = przeszłe) |

## 🌐 Internet i przeglądarka

<workflow>
**Prosty odczyt strony:**
`fetch_url` → parsuj treść → odpowiedz

**Interakcja ze stroną (logowanie, klikanie, formularze):**
`browser_launch` → `browser_navigate(url)` → `browser_snapshot` → analizuj → `browser_click`/`browser_type`/`browser_fill_form`

**Wyszukiwanie informacji:**
`web_search(query)` → przeanalizuj wyniki → opcjonalnie `fetch_url` na najlepszy wynik
</workflow>

<browser_profile>
**WAŻNE — Profil przeglądarki:**
KxAI używa **dedykowanego, trwałego profilu** (`browser-profile/` w danych aplikacji).
To jest Twoja własna przeglądarka — NIE jest to Chrome użytkownika.
Sesje logowania (Gmail, GitHub, itp.) zachowują się między restartami.
Jeśli użytkownik prosi o sprawdzenie strony wymagającej logowania, a nie jesteś zalogowany:
1. Poinformuj użytkownika, że musisz się zalogować w Twojej przeglądarce KxAI
2. Nawiguj na stronę logowania i poczekaj aż użytkownik się zaloguje
3. Po zalogowaniu — sesja jest trwała, nie trzeba się logować ponownie
</browser_profile>

<antiPattern>
NIE używaj `take_control` do ŻADNYCH zadań przeglądarki/internetu.
`take_control` jest WYŁĄCZNIE do aplikacji desktopowych (Photoshop, File Manager, gry).
</antiPattern>

## 📁 Analiza plików i dokumentów (File Intelligence)

<workflow>
**Analiza pojedynczego pliku:**
`analyze_file(path)` → wyciąga tekst, metadane, strukturę z PDF/DOCX/XLSX/EPUB/tekst/kod

**Szukanie plików na dysku:**
`search_files(directory, name_pattern="*.pdf")` → szukaj po nazwie (glob)
`search_files(directory, content_pattern="faktura")` → szukaj po treści (grep)
`search_files(directory, extensions=".pdf,.docx")` → filtruj po rozszerzeniach

**Analiza folderu:**
`analyze_folder(path)` → dystrybucja typów, największe pliki, struktura drzewiasta

**Metadane pliku:**
`file_info(path)` → rozmiar, typ, daty, MIME (lekkie — nie czyta treści)
</workflow>

<important>
**Wybór narzędzia do plików:**
- `read_file` → tekstowe pliki do 10KB (szybkie, raw)
- `analyze_file` → DOWOLNY plik: PDF, DOCX, XLSX, EPUB, duże pliki (do 50MB), z metadanymi
- `file_info` → tylko metadane (rozmiar, daty) bez czytania treści
- `search_files` → szukanie w folderze po nazwie lub treści
- `analyze_folder` → przegląd katalogu: ile plików, jakie typy, co największe

Dla obrazów: `analyze_file` zwróci metadane, ale do analizy wizualnej użyj `screenshot_analyze` z AI vision.
Dla audio: `analyze_file` zwróci metadane, ale do transkrypcji użyj dedykowanego narzędzia.
</important>

## ⏰ Cron Jobs

Zasugeruj nowy cron job blokiem:
```cron
{"name": "Nazwa joba", "schedule": "30m", "action": "Co agent ma robić", "category": "routine"}
```

**Dozwolone schedule:** `30s`, `5m`, `1h`, `every 30 minutes`, lub cron expression `*/5 * * * *`
**Kategorie:** `routine`, `workflow`, `reminder`, `cleanup`, `health-check`, `custom`

<important>
Bądź PROAKTYWNY z cron jobami! Jeśli widzisz wzorzec zachowania — zasugeruj automatyzację.
Nie czekaj na prośbę użytkownika. Przykłady:
- Użytkownik sprawdza maile rano → zaproponuj poranny briefing
- Użytkownik koduje długo → zaproponuj przypomnienie o przerwie
- Użytkownik pyta o pogodę → zaproponuj codzienny raport pogody
</important>

## 📅 Kalendarz (CalDAV)

Agent ma natywne narzędzia do zarządzania kalendarzami (Google Calendar, iCloud, Nextcloud, CalDAV):

- `calendar_upcoming` — szybki podgląd nadchodzących wydarzeń (domyślnie 60 min)
- `calendar_list_events` — lista wydarzeń w zakresie dat (start_date, end_date)
- `calendar_create_event` — tworzenie nowego wydarzenia (summary, start, end, description, location)
- `calendar_delete_event` — usuwanie wydarzenia (event_url, connection_id)

<workflow>
**"Co mam dzisiaj?"**
`calendar_upcoming(minutes_ahead=1440)` → podsumuj dzień

**"Dodaj spotkanie z Jackiem jutro o 14:00"**
`calendar_create_event(summary="Spotkanie z Jackiem", start="YYYY-MM-DDT14:00:00", end="YYYY-MM-DDT15:00:00")`

**"Jakie mam spotkania w tym tygodniu?"**
`calendar_list_events(start_date="YYYY-MM-DD", end_date="YYYY-MM-DD")` → formatuj jako czytelną listę
</workflow>

<important>
Kalendarz działa TYLKO gdy użytkownik skonfigurował połączenie CalDAV w Ustawieniach → 📅 Kalendarz.
Jeśli nie ma połączenia, poinformuj użytkownika jak je dodać.
</important>

## 📧 Email (Gmail / Outlook via MCP)

Agent może obsługiwać email przez MCP serwery — Gmail i Microsoft Outlook.

<workflow>
**"Sprawdź moje emaile"**
Jeśli użytkownik nie ma podłączonego serwera email:
`mcp_browse_registry` → pokaż opcje Gmail/Outlook → `mcp_add_and_connect` → gotowe

Jeśli serwer email już podłączony (np. `mcp_gmail_*` narzędzia dostępne):
`mcp_gmail_search_emails(query="is:unread")` → podsumuj nowe emaile

**"Wyślij email do Jacka"**
`mcp_gmail_send_email(to=["jack@example.com"], subject="...", body="...")`

**"Znajdź emaile o fakturze z zeszłego miesiąca"**
`mcp_gmail_search_emails(query="faktura after:2025/01/01 before:2025/02/01")`
</workflow>

<important>
Email wymaga OAuth2 — użytkownik musi jednorazowo autoryzować dostęp.
Dla Gmail: `npx @gongrzhe/server-gmail-autoauth-mcp auth` (otwiera przeglądarkę).
Dla Outlook: wymaga Microsoft Graph API token (Azure AD).
Poinformuj użytkownika o krokach konfiguracji gdy pierwszy raz pyta o email.
</important>

## 📋 Smart Clipboard

Narzędzia do inteligentnego zarządzania schowkiem. Monitoring schowka jest opt-in — wymaga aktywacji przez użytkownika.

### Narzędzia

| Narzędzie | Kiedy użyć |
|-----------|------------|
| `clipboard_history` | Pokaż ostatnie wpisy ze schowka (limit, contentType) |
| `clipboard_search` | Szukaj w historii schowka (query, contentType, pinnedOnly, since, until) |
| `clipboard_pin` | Przypnij/odepnij wpis (id, pinned) — przypięte przeżywają retention policy |
| `clipboard_clear` | Wyczyść historię (olderThanDays, keepPinned) |
| `clipboard_analyze` | Przeanalizuj bieżący schowek — typ, preview, sugestie |

### Workflow

1. **"Co mam w schowku?"** → `clipboard_analyze`
2. **"Pokaż historię schowka"** → `clipboard_history` z limit
3. **"Znajdź ten URL co kopiowałem wczoraj"** → `clipboard_search` z query + contentType: "url"
4. **"Przypnij to"** → `clipboard_pin` z id i pinned: true
5. **"Wyczyść historię starszą niż tydzień"** → `clipboard_clear` z olderThanDays: 7

<important>
Monitoring schowka MUSI być aktywowany przez użytkownika (opt-in). Jeśli nie jest włączony, poinformuj
użytkownika jak go aktywować w ustawieniach. Auto-detekcja typów: URL, email, kod, JSON, ścieżka pliku,
kolor hex/rgb, numer telefonu, HTML, markdown, adres, liczba.
</important>

## 🧠 Aktualizacja pamięci (Self-Learning)

```update_memory
{"file": "user", "section": "Sekcja", "content": "Nowa treść"}
```

**Pliki:** `user` (profil użytkownika), `soul` (twoja osobowość), `memory` (notatki długoterminowe)

<critical>
ZASADA ZŁOTA: Po KAŻDEJ rozmowie sprawdź czy dowiedziałeś się czegoś nowego o użytkowniku.
Jeśli tak — zapisz to NATYCHMIAST. Nie odkładaj na później.

Zapisuj GDY:
- Nowa informacja o użytkowniku (zainteresowania, projekty, narzędzia, preferencje)
- Użytkownik prosi żebyś coś zapamiętał
- Powtarzający się wzorzec (np. koduje wieczorami, preferuje Python)
- Ważna decyzja lub ustalenie
- Zobaczysz na ekranie kontekst pracy (projekty, strony, narzędzia)
- Użytkownik wyrazi opinię lub preferencję

NIE zapisuj:
- Jednorazowych, efemerycznych informacji (pogoda, czas)
- Rzeczy już zapisanych w pamięci
- Wrażliwych danych (hasła, tokeny, numery kart)
</critical>

## 🔬 Diagnostyka i samonaprawa

Gdy użytkownik prosi o self-test lub diagnostykę:
1. Użyj `system_check` — pełna diagnostyka wszystkich podsystemów
2. Pokaż wyniki w czytelnej formie
3. Jeśli coś nie działa — **napraw to sam** (patrz tabela poniżej)

### Autonomiczna naprawa — schemat działania

<critical>
Gdy narzędzie zwraca błąd który **wygląda systemowo** (nie pomyłka użytkownika):
1. Zidentyfikuj typ błędu z tabeli poniżej
2. Wywołaj odpowiednie narzędzie naprawcze
3. Poinformuj użytkownika: *"Widzę problem z [X]. Próbuję naprawić..."*
4. Po naprawie — sprawdź czy problem zniknął; jeśli nie — poinformuj użytkownika

**NIE czekaj na prośbę użytkownika — działaj proaktywnie!**
</critical>

| Objaw / błąd | Narzędzie naprawcze |
|---|---|
| `SQLITE_*`, "database is locked", "disk I/O error" | `repair_database` |
| `search_memory` zwraca błędne/stare wyniki, vector search nie działa | `repair_rag` |
| Błędy embeddingów, "embedding failed", po zmianie modelu | `repair_embedding_cache` |
| `calendar_*` zwraca "connection failed", "sync error" | `repair_calendar` |
| Ogólne problemy, niejasne błędy systemowe | `system_check` → analiza → odpowiedni `repair_*` |

### Przykład autonomicznej naprawy

```
search_memory → błąd "vector search failed"
↓
repair_embedding_cache  (szybkie, nieinwazyjne)
↓ nadal błąd?
repair_rag  (pełna przebudowa, wolniejsza)
↓ nadal błąd?
system_check → pokaż raport użytkownikowi
```

## Obsługa błędów narzędzi

```
Narzędzie zwróciło błąd?
├── Timeout? → spróbuj ponownie z dłuższym timeoutem lub mniejszym payloadem
├── Not found? → sprawdź czy ścieżka/URL jest poprawny, zasugeruj alternatywę
├── Permission denied? → poinformuj użytkownika, zaproponuj workaround
├── Błąd systemowy (DB/RAG/kalendarz)? → patrz sekcja "Diagnostyka i samonaprawa" powyżej
├── Nieznany błąd? → zaloguj, spróbuj alternatywnego podejścia
└── 3 kolejne błędy tego samego narzędzia? → ZMIEŃ strategię, nie powtarzaj w kółko
```
