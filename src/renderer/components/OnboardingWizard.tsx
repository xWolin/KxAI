import React, { useState } from 'react';
import type { OnboardingData } from '../types';

interface OnboardingWizardProps {
  onComplete: () => void;
}

const MODELS = {
  openai: [
    { value: 'gpt-5', label: 'GPT-5 (recommended)' },
    { value: 'gpt-5.2', label: 'GPT-5.2 (flagship)' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini (cheaper)' },
    { value: 'gpt-5-nano', label: 'GPT-5 Nano (cheapest)' },
    { value: 'o3', label: 'o3 (reasoning)' },
    { value: 'o4-mini', label: 'o4-mini (reasoning, cheaper)' },
    { value: 'gpt-4.1', label: 'GPT-4.1 (legacy)' },
    { value: 'gpt-4o', label: 'GPT-4o (legacy)' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (most powerful)' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  ],
};

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingData>({
    userName: '',
    userRole: '',
    userDescription: '',
    agentName: 'KxAI',
    agentEmoji: '🤖',
    aiProvider: 'openai',
    aiModel: 'gpt-5',
  });
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = [
    { title: 'Witaj!', subtitle: 'Skonfigurujmy Twojego osobistego agenta AI' },
    { title: 'Kim jesteś?', subtitle: 'Powiedz mi o sobie' },
    { title: 'Twój Agent', subtitle: 'Spersonalizuj swojego asystenta' },
    { title: 'AI Provider', subtitle: 'Wybierz dostawcę AI i model' },
    { title: 'Klucz API', subtitle: 'Podaj klucz API do wybranego dostawcy' },
    { title: 'Gotowe!', subtitle: 'Wszystko jest skonfigurowane' },
  ];

  const canProceed = (): boolean => {
    switch (step) {
      case 0: return true;
      case 1: return data.userName.trim().length > 0 && data.userRole.trim().length > 0;
      case 2: return data.agentName!.trim().length > 0;
      case 3: return data.aiProvider !== undefined;
      case 4: return apiKey.trim().length > 10;
      case 5: return true;
      default: return false;
    }
  };

  const handleNext = async () => {
    setError(null);

    if (step === 4) {
      // Save API key
      setIsLoading(true);
      try {
        await window.kxai.setApiKey(data.aiProvider, apiKey);
      } catch (e: any) {
        setError(`Nie udało się zapisać klucza API: ${e.message || 'Nieznany błąd'}`);
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
    }

    if (step === 5) {
      // Complete onboarding
      setIsLoading(true);
      try {
        await window.kxai.completeOnboarding(data);

        // Update USER.md with onboarding data
        const userMd = `# USER.md — Profil Użytkownika

## Podstawowe informacje
- Imię: ${data.userName}
- Rola: ${data.userRole}
- Opis: ${data.userDescription}

## Preferencje
- Język: polski
- Styl komunikacji: bezpośredni, merytoryczny
`;
        await window.kxai.setMemory('USER.md', userMd);

        onComplete();
      } catch (e: any) {
        setError(`Nie udało się zakończyć konfiguracji: ${e.message || 'Nieznany błąd'}`);
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
      return;
    }

    setStep(step + 1);
  };

  return (
    <div className="onboarding">
      {/* Header */}
      <div className="onboarding__header">
        <div className="onboarding__icon">🤖</div>
        <h2 className="onboarding__title">
          {steps[step].title}
        </h2>
        <p className="onboarding__subtitle">
          {steps[step].subtitle}
        </p>

        {/* Progress dots */}
        <div className="onboarding__dots">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`onboarding__dot${i <= step ? ' onboarding__dot--active' : ''}`}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="onboarding__content">
        {step === 0 && (
          <div className="fade-in onboarding-welcome">
            <p className="onboarding-welcome__desc">
              <strong>KxAI</strong> to Twój osobisty asystent AI, który:
            </p>
            <ul className="onboarding-welcome__features">
              <li>👁️ Obserwuje Twój ekran i proaktywnie pomaga</li>
              <li>💬 Analizuje konwersacje (WhatsApp, Slack, etc.)</li>
              <li>💻 Pomaga w kodowaniu i debugowaniu</li>
              <li>🧠 Pamięta Twoje decyzje i preferencje</li>
              <li>📂 Może organizować Twoje pliki</li>
              <li>🔒 Wszystko działa lokalnie z szyfrowanymi kluczami</li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="fade-in">
            <label className="onboarding-label">Jak masz na imię?</label>
            <input
              className="onboarding-input"
              value={data.userName}
              onChange={(e) => setData({ ...data, userName: e.target.value })}
              placeholder="np. Kacper"
              autoFocus
            />

            <label className="onboarding-label">Czym się zajmujesz?</label>
            <input
              className="onboarding-input"
              value={data.userRole}
              onChange={(e) => setData({ ...data, userRole: e.target.value })}
              placeholder="np. Fullstack Developer, CTO, Przedsiębiorca"
            />

            <label className="onboarding-label">Opisz czym się zajmujesz i w czym chcesz pomocy</label>
            <textarea
              className="onboarding-input onboarding-textarea"
              value={data.userDescription}
              onChange={(e) => setData({ ...data, userDescription: e.target.value })}
              placeholder="np. Prowadzę software house, koduję w React/Node, dużo rozmawiam z klientami na WhatsApp, potrzebuję pomocy z analizą konwersacji i kodowaniem..."
            />
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <label className="onboarding-label">Nazwa agenta</label>
            <input
              className="onboarding-input"
              value={data.agentName}
              onChange={(e) => setData({ ...data, agentName: e.target.value })}
              placeholder="KxAI"
              autoFocus
            />

            <label className="onboarding-label">Emoji agenta</label>
            <div className="onboarding-emoji-grid">
              {['🤖', '🧠', '⚡', '🔮', '🦾', '🎯', '💡', '🚀', '🛸', '🐙'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => setData({ ...data, agentEmoji: emoji })}
                  className={`onboarding-emoji-btn${data.agentEmoji === emoji ? ' onboarding-emoji-btn--selected' : ''}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="onboarding-preview">
              <div className="onboarding-preview__emoji">{data.agentEmoji}</div>
              <div className="onboarding-preview__name">
                {data.agentName}
              </div>
              <div className="onboarding-preview__subtitle">
                Twój osobisty agent AI
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="fade-in">
            <label className="onboarding-label">Dostawca AI</label>
            <div className="onboarding-providers">
              {(['openai', 'anthropic'] as const).map((provider) => (
                <button
                  key={provider}
                  onClick={() => setData({
                    ...data,
                    aiProvider: provider,
                    aiModel: MODELS[provider][0].value,
                  })}
                  className={`onboarding-provider-btn${data.aiProvider === provider ? ' onboarding-provider-btn--selected' : ''}`}
                >
                  <div className="onboarding-provider__icon">
                    {provider === 'openai' ? '🟢' : '🟠'}
                  </div>
                  <div className="onboarding-provider__name">
                    {provider === 'openai' ? 'OpenAI' : 'Anthropic'}
                  </div>
                </button>
              ))}
            </div>

            <label className="onboarding-label">Model</label>
            <select
              className="onboarding-input settings-select"
              value={data.aiModel}
              onChange={(e) => setData({ ...data, aiModel: e.target.value })}
              title="Wybierz model AI"
            >
              {MODELS[data.aiProvider].map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {step === 4 && (
          <div className="fade-in">
            <div className="onboarding-security-notice">
              🔒 Klucz API jest szyfrowany i przechowywany lokalnie.
              Nigdzie nie jest wysyłany poza oficjalne API {data.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'}.
            </div>

            <label className="onboarding-label">
              Klucz API {data.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'}
            </label>
            <input
              type="password"
              className="onboarding-input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data.aiProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              autoFocus
            />

            <p className="onboarding-key-hint">
              {data.aiProvider === 'openai'
                ? 'Wygeneruj klucz na platform.openai.com → API Keys'
                : 'Wygeneruj klucz na console.anthropic.com → API Keys'}
            </p>
          </div>
        )}

        {step === 5 && (
          <div className="fade-in onboarding-done">
            <div className="onboarding-done__emoji">{data.agentEmoji}</div>
            <h3 className="onboarding-done__title">
              {data.agentName} jest gotowy!
            </h3>
            <p className="onboarding-done__desc">
              Hej <strong>{data.userName}</strong>! Twój agent jest skonfigurowany.<br/>
              Możesz zacząć czatować, włączyć tryb proaktywny (👁️)<br/>
              lub kliknąć 📸 żeby przeanalizować ekran.
            </p>
            <div className="onboarding-shortcuts">
              <div><strong>Skróty:</strong></div>
              <div className="onboarding-shortcuts__item">• <kbd>Alt+K</kbd> — pokaż/ukryj agenta</div>
              <div>• <kbd>Enter</kbd> — wyślij wiadomość</div>
              <div>• <kbd>Shift+Enter</kbd> — nowa linia</div>
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="onboarding__error" style={{ color: '#ff6b6b', padding: '8px 24px', fontSize: '13px', textAlign: 'center' }}>
          ❌ {error}
        </div>
      )}

      {/* Footer */}
      <div className="onboarding__footer">
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="onboarding__btn-back"
          >
            Wstecz
          </button>
        )}
        <button
          onClick={handleNext}
          disabled={!canProceed() || isLoading}
          className={`onboarding__btn-next ${canProceed() && !isLoading ? 'onboarding__btn-next--enabled' : 'onboarding__btn-next--disabled'}`}
        >
          {isLoading ? '...' : step === 5 ? 'Zacznijmy!' : 'Dalej →'}
        </button>
      </div>
    </div>
  );
}
