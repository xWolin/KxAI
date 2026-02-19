# 🤖 KxAI — Personal AI Desktop Agent

<p align="center">
  <img src="assets/banner.png" alt="KxAI Banner" width="600" />
</p>

> Twój osobisty asystent AI na pulpicie — z obserwacją ekranu, proaktywnymi podpowiedziami, czatem i trwałą pamięcią. Inspirowany [OpenClaw](https://github.com/openclaw/openclaw).

---

## ✨ Funkcje

- **🖥️ Floating Widget** — Mała, draggable ikonka agenta w rogu ekranu (always-on-top)
- **💬 Chat Panel** — Rozwijany czat po kliknięciu widgetu
- **👁️ Screen Watcher** — Proaktywna analiza ekranu (VSCode, WhatsApp, etc.)
- **🧠 Pamięć** — System plików `SOUL.md`, `USER.md`, `MEMORY.md` (wzorowany na OpenClaw)
- **⚡ Proaktywny Engine** — Agent sam zgłasza obserwacje i sugestie
- **🔒 Bezpieczeństwo** — Szyfrowane klucze API (AES-256-GCM), context isolation
- **🎯 Onboarding** — Wizard pierwszego uruchomienia
- **📂 Zarządzanie plikami** — Organizacja plików na pulpicie
- **🔑 Multi-provider** — OpenAI (GPT-4o, o3, etc.) lub Anthropic (Claude Opus 4, Sonnet)

## 🏗️ Architektura

```
KxAI/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── main.ts              # App entry, window, tray
│   │   ├── preload.ts           # Secure bridge (contextBridge)
│   │   ├── ipc.ts               # IPC handlers
│   │   └── services/
│   │       ├── ai-service.ts    # OpenAI/Anthropic API integration
│   │       ├── config.ts        # Configuration management
│   │       ├── memory.ts        # Memory system (SOUL/USER/MEMORY.md)
│   │       ├── screen-capture.ts # Screen capture & monitoring
│   │       └── security.ts      # AES-256-GCM encryption for API keys
│   │
│   └── renderer/                # React UI
│       ├── App.tsx              # Main app component
│       ├── components/
│       │   ├── FloatingWidget.tsx    # Draggable floating icon
│       │   ├── ChatPanel.tsx        # Chat interface with streaming
│       │   ├── OnboardingWizard.tsx  # First-run setup wizard
│       │   ├── SettingsPanel.tsx     # Settings & persona editor
│       │   └── ProactiveNotification.tsx  # Proactive alerts
│       ├── styles/
│       │   └── global.css       # Dark theme, animations
│       └── types.ts             # TypeScript definitions
│
├── assets/                      # Icons, images
├── package.json                 # Dependencies & build config
├── vite.config.ts               # Vite config for renderer
├── tsconfig.main.json           # TS config for Electron
└── tsconfig.json                # TS config for React
```

## 🧠 System Pamięci (inspirowany OpenClaw)

| Plik | Opis |
|------|------|
| `SOUL.md` | Persona, ton, granice agenta |
| `USER.md` | Profil użytkownika (imię, rola, preferencje) |
| `MEMORY.md` | Pamięć długoterminowa (decyzje, obserwacje) |
| `memory/YYYY-MM-DD.md` | Dziennik — automatyczne notatki per dzień |
| `sessions/YYYY-MM-DD.json` | Historia konwersacji per dzień |

## 🚀 Quick Start

### Wymagania
- Node.js 20+
- npm 9+

### Instalacja

```bash
git clone https://github.com/xWolin/KxAI.git
cd KxAI
npm install
```

### Development

```bash
npm run dev
```

### Build (.exe)

```bash
npm run dist
```

Installer `.exe` pojawi się w folderze `release/`.

## ⚙️ Konfiguracja

Przy pierwszym uruchomieniu zobaczysz wizard onboardingowy który pomoże Ci:
1. Podać swoje dane (imię, rola, czym się zajmujesz)
2. Spersonalizować agenta (nazwa, emoji)
3. Wybrać dostawcę AI (OpenAI / Anthropic) i model
4. Wkleić klucz API

### Skróty klawiszowe
| Skrót | Akcja |
|-------|-------|
| `Alt+K` | Pokaż/ukryj agenta |
| `Enter` | Wyślij wiadomość |
| `Shift+Enter` | Nowa linia |

## 🔒 Bezpieczeństwo

- **Klucze API** są szyfrowane AES-256-GCM i przechowywane lokalnie
- **Context Isolation** — renderer nie ma dostępu do Node.js
- **CSP Headers** — ochrona przed XSS
- **Path traversal protection** — zabezpieczenie dostępu do plików
- **Sandbox mode** — preload skrypt z ograniczonymi uprawnieniami
- Dane nigdy nie opuszczają komputera poza API calls do wybranego dostawcy

## 🤝 Contributing

1. Fork repo
2. Stwórz feature branch (`git checkout -b feature/nowa-funkcja`)
3. Commit zmiany (`git commit -m 'Add: nowa funkcja'`)
4. Push branch (`git push origin feature/nowa-funkcja`)
5. Otwórz Pull Request

## 📄 License

MIT

---

**Made with ❤️ by [xWolin](https://github.com/xWolin)**
