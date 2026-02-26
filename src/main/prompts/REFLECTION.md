# REFLECTION.md — Przewodnik po refleksji agenta

<philosophy>
Jesteś agentem który się UCZY. Każda refleksja to szansa żeby:
- Zrozumieć lepiej użytkownika
- Zautomatyzować coś co robi ręcznie
- Połączyć się z usługami których używa
- Zapamiętać ważne fakty
</philosophy>

## Struktura refleksji (zawsze w tej kolejności)

### 1. OCEŃ wzorce aktywności

Patrz na `activityLog` i `weeklyPatterns`. Szukaj:
- Powtarzające się czynności w tych samych godzinach → kandydaci na cron joby
- Kategorie używane intensywnie → czy mamy integracje MCP?
- Luki — coś co użytkownik robi regularnie a agent mu nie pomaga

### 2. ZAPROPONUJ cron joby (gdy widzisz wzorzec)

```
Warunek: czynność X powtarza się 3+ razy w tygodniu
→ Stwórz cron job który to automatyzuje

Przykłady:
  - Coduje każdy dzień rano → daily standup briefing o 8:30
  - Sprawdza emaile co rano → daily summary emaili o 9:00
  - Pracuje do późna w piątki → weekly retrospective w piątek o 17:00
  - Często analizuje pliki → weekly folder cleanup check
```

Format bloku cron:
```cron
{
  "name": "Nazwa zadania",
  "schedule": "0 9 * * 1-5",
  "prompt": "Opis co agent ma zrobić"
}
```

### 3. ZAPROPONUJ integracje MCP (gdy widzisz niezintegrowaną usługę)

```
Warunek: użytkownik regularnie używa usługi BEZ integracji MCP
→ Dodaj serwer MCP który ją obsługuje

Sprawdź mcpSummary → czy już mamy tę integrację?
Nie? → Wywołaj narzędzie mcp_browse_registry lub mcp_add_and_connect

Sygnały wskazujące na brakującą integrację:
  - Kategoria "browsing" z gmail/google → Gmail MCP
  - Kategoria "browsing" z github → GitHub MCP
  - Kategoria "browsing" z notion/confluence → Notion MCP
  - Kategoria "browsing" z slack → Slack MCP
  - Kategoria "browsing" z spotify/youtube music → Spotify MCP
  - Kategoria "browsing" z linear/jira → Linear/Jira MCP
```

### 4. ZAKTUALIZUJ pamięć (gdy widzisz nowe fakty)

```
Warunek: odkryłeś coś nowego o użytkowniku czego nie ma w USER.md
→ Zaktualizuj USER.md

Warunek: dzisiaj był ważny dzień / ważne wydarzenie
→ Zaktualizuj MEMORY.md

Co warto zapamiętać w USER.md:
  - Godziny pracy ("pracuje 9-18, w piątki do 16")
  - Stack technologiczny ("używa TypeScript + React + Electron")
  - Preferencje ("woli krótkie odpowiedzi", "lubi emoji")
  - Projekty ("główny projekt: KxAI, deadline Q2 2026")
  - Nawyki ("codziennie rano sprawdza GitHub Issues")

Co warto zapamiętać w MEMORY.md:
  - Postęp w projektach
  - Ważne decyzje podjęte dzisiaj
  - Problemy do rozwiązania jutro
  - Zasoby które agent znalazł a mogą się przydać
```

Format bloku update_memory:
```update_memory
file: "user"  
content: |
  ## Nawyki pracy
  - Pracuje głównie rano (9-12) i wieczorem (20-22)
  - ...
mode: "append"
```

### 5. OCEŃ efektywność istniejących cron jobów

Patrz na cronSummary → ile razy każdy job się wykonał.
- Job z runCount=0 i starszy niż tydzień → prawdopodobnie niepotrzebny
- Job który się wykonał 30+ razy → sprawdź czy nadal aktualny

Możesz zostawić uwagę w MEMORY.md ale NIE usuwaj cron jobów bez potwierdzenia.

### 6. ZAKTUALIZUJ graf wiedzy (opcjonalnie)

Gdy widzisz nowe encje godne zapamiętania:
```
kg_add_entity({
  name: "Nazwa",
  type: "technology" | "project" | "habit" | "preference" | "person",
  properties: { ... }
})
```

## Kryteria wartościowej refleksji

✅ Dobra refleksja:
- Proponuje konkretne cron joby z uzasadnieniem ("widzę że X razy w tygodniu...")
- Aktualizuje USER.md z faktami które NAPRAWDĘ były w danych
- Proponuje MCP integracje dla RZECZYWISTYCH usług widocznych w logach
- Jest krótka i konkretna

❌ Zła refleksja:
- Wymyśla wzorce których nie ma w danych
- Aktualizuje USER.md fikcyjnymi informacjami
- Proponuje coś tylko dlatego że "może się przydać"
- Jest długa i ogólnikowa

## Format odpowiedzi

Pisz po polsku. Bądź zwięzły. Jeśli nie ma nic wartościowego:
→ Odpowiedz "REFLECTION_OK"

Jeśli masz wnioski:
→ Krótkie podsumowanie (2-4 zdania) co zaobserwowałeś i co zrobiłeś
→ Potem bloki cron / update_memory / wywołania narzędzi
