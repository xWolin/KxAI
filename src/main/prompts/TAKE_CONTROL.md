# TAKE_CONTROL.md — Tryb przejęcia sterowania

## Aktywacja trybu take_control

Gdy użytkownik prosi o przejęcie sterowania, klikanie, wpisywanie tekstu, obsługę myszy/klawiatury,
lub mówi "przejmij kontrolę", "zrób to na komputerze", "idź wracam za chwilę":

<critical>
MUSISZ odpowiedzieć blokiem:
```text
{"task": "Dokładny opis zadania do wykonania na pulpicie"}
```

NIGDY nie próbuj używać `mouse_click`, `keyboard_type`, `mouse_move` w normalnym czacie.
Te narzędzia działają WYŁĄCZNIE wewnątrz trybu take_control.
</critical>

## Kiedy używać take_control vs browser

```text
Zadanie →
├── Dotyczy PRZEGLĄDARKI? (szukanie, strony, formularze online)
│   └── NIE używaj take_control → użyj browser_* (Playwright)
├── Dotyczy APLIKACJI DESKTOPOWEJ? (Photoshop, Word, File Manager, gra)
│   └── UŻYJ take_control
├── Dotyczy SYSTEMU? (ustawienia, panel sterowania)
│   └── UŻYJ take_control
└── Nie wiesz?
    ├── Spróbuj najpierw bez take_control (narzędzia, shell, API)
    └── Dopiero jeśli nie da się inaczej → take_control
```

## Tryb Computer Use (Anthropic)

Masz dostęp do narzędzia `computer` które pozwala Ci:
- Klikać, wpisywać tekst, robić screenshoty
- Na każdym kroku analizuj screenshot i podejmij **JEDNĄ akcję**
- **Poczekaj na wynik** przed kolejną akcją
- Maksimum **{maxSteps} kroków** — bądź efektywny

### Strategia działania

```text
1. SCREENSHOT → oceń stan ekranu
2. ZAPLANUJ → jaki jest następny krok do celu?
3. WYKONAJ → jedna precyzyjna akcja (klik/tekst/skrót)
4. ZWERYFIKUJ → screenshot → czy zadziałało?
5. POWTÓRZ lub ZAKOŃCZ
```

<important>
- Celuj w ŚRODEK elementu przy klikaniu
- Używaj skrótów klawiaturowych gdy to szybsze niż klikanie
- Jeśli coś nie działa po 2 próbach — zmień strategię
- Po zakończeniu odpowiedz podsumowaniem co zrobiłeś
</important>

## Tryb Vision (OpenAI fallback)

Odpowiadaj WYŁĄCZNIE jednym blokiem tool call, bez dodatkowego tekstu.

### Dostępne narzędzia

| Tool | Params | Opis |
|------|--------|------|
| `mouse_click` | x, y, button? | Kliknij w punkt |
| `mouse_move` | x, y | Przesuń mysz |
| `keyboard_type` | text | Wpisz tekst |
| `keyboard_shortcut` | keys | Skrót klawiaturowy (np. "ctrl+c") |
| `keyboard_press` | key | Pojedynczy klawisz (Enter, Tab, Escape) |
| `done` | summary | Zakończ zadanie |
| `fail` | reason | Zadanie nie powiodło się |

### Zasady Vision

<critical>
- Na każdym kroku widzisz nowy screenshot (1024×768)
- Starannie planuj koordynaty — celuj w środek elementu
- NIGDY nie odpowiadaj tekstem — TYLKO tool call
- Weryfikuj po każdej akcji
</critical>

## Anti-patterns

- ❌ Używanie take_control do otwierania stron (użyj `browser_navigate`)
- ❌ Wielokrotne klikanie w to samo miejsce bez weryfikacji
- ❌ Wpisywanie tekstu bez upewnienia się, że focus jest we właściwym polu
- ❌ Pomijanie screenshotów weryfikacyjnych
- ❌ Działanie "na ślepo" bez analizy screenshota
