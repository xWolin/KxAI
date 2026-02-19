import React, { useState } from 'react';
import type { OnboardingData } from '../types';

interface OnboardingWizardProps {
  onComplete: () => void;
}

const MODELS = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (recommended)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (tańszy)' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'o3', label: 'o3 (reasoning)' },
    { value: 'o4-mini', label: 'o4-mini (reasoning, tańszy)' },
  ],
  anthropic: [
    { value: 'claude-opus-4-0', label: 'Claude Opus 4 (najpotężniejszy)' },
    { value: 'claude-sonnet-4-0', label: 'Claude Sonnet 4' },
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
    aiModel: 'gpt-4o',
  });
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
    if (step === 4) {
      // Save API key
      setIsLoading(true);
      try {
        await window.kxai.setApiKey(data.aiProvider, apiKey);
      } catch (e) {
        console.error('Failed to save API key:', e);
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
      } catch (e) {
        console.error('Failed to complete onboarding:', e);
      }
      setIsLoading(false);
      return;
    }

    setStep(step + 1);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px',
    color: 'var(--text-primary)',
    fontSize: 14,
    fontFamily: 'var(--font)',
    outline: 'none',
    marginBottom: 12,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: 'var(--text-secondary)',
    marginBottom: 4,
    fontWeight: 500,
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'var(--bg-primary)',
      borderRadius: 'var(--radius)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: 'var(--shadow)',
      border: '1px solid var(--border)',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px',
        textAlign: 'center',
        WebkitAppRegion: 'drag',
      }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🤖</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
          {steps[step].title}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {steps[step].subtitle}
        </p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 16 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: i <= step ? 'var(--accent)' : 'var(--border)',
                transition: 'var(--transition)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        padding: '0 24px',
        overflowY: 'auto',
      }}>
        {step === 0 && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '20px 0' }}>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <strong>KxAI</strong> to Twój osobisty asystent AI, który:
            </p>
            <ul style={{
              textAlign: 'left',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 2,
              listStyle: 'none',
              marginTop: 16,
            }}>
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
            <label style={labelStyle}>Jak masz na imię?</label>
            <input
              style={inputStyle}
              value={data.userName}
              onChange={(e) => setData({ ...data, userName: e.target.value })}
              placeholder="np. Kacper"
              autoFocus
            />

            <label style={labelStyle}>Czym się zajmujesz?</label>
            <input
              style={inputStyle}
              value={data.userRole}
              onChange={(e) => setData({ ...data, userRole: e.target.value })}
              placeholder="np. Fullstack Developer, CTO, Przedsiębiorca"
            />

            <label style={labelStyle}>Opisz czym się zajmujesz i w czym chcesz pomocy</label>
            <textarea
              style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
              value={data.userDescription}
              onChange={(e) => setData({ ...data, userDescription: e.target.value })}
              placeholder="np. Prowadzę software house, koduję w React/Node, dużo rozmawiam z klientami na WhatsApp, potrzebuję pomocy z analizą konwersacji i kodowaniem..."
            />
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <label style={labelStyle}>Nazwa agenta</label>
            <input
              style={inputStyle}
              value={data.agentName}
              onChange={(e) => setData({ ...data, agentName: e.target.value })}
              placeholder="KxAI"
              autoFocus
            />

            <label style={labelStyle}>Emoji agenta</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {['🤖', '🧠', '⚡', '🔮', '🦾', '🎯', '💡', '🚀', '🛸', '🐙'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => setData({ ...data, agentEmoji: emoji })}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 'var(--radius-sm)',
                    border: data.agentEmoji === emoji
                      ? '2px solid var(--accent)'
                      : '1px solid var(--border)',
                    background: data.agentEmoji === emoji
                      ? 'var(--accent-light)'
                      : 'var(--bg-secondary)',
                    cursor: 'pointer',
                    fontSize: 24,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'var(--transition)',
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div style={{
              textAlign: 'center',
              padding: 20,
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius)',
              marginTop: 16,
            }}>
              <div style={{ fontSize: 48 }}>{data.agentEmoji}</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>
                {data.agentName}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Twój osobisty agent AI
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="fade-in">
            <label style={labelStyle}>Dostawca AI</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['openai', 'anthropic'] as const).map((provider) => (
                <button
                  key={provider}
                  onClick={() => setData({
                    ...data,
                    aiProvider: provider,
                    aiModel: MODELS[provider][0].value,
                  })}
                  style={{
                    flex: 1,
                    padding: '16px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: data.aiProvider === provider
                      ? '2px solid var(--accent)'
                      : '1px solid var(--border)',
                    background: data.aiProvider === provider
                      ? 'var(--accent-light)'
                      : 'var(--bg-secondary)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    color: 'var(--text-primary)',
                    transition: 'var(--transition)',
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>
                    {provider === 'openai' ? '🟢' : '🟠'}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {provider === 'openai' ? 'OpenAI' : 'Anthropic'}
                  </div>
                </button>
              ))}
            </div>

            <label style={labelStyle}>Model</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={data.aiModel}
              onChange={(e) => setData({ ...data, aiModel: e.target.value })}
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
            <div style={{
              padding: 12,
              background: 'var(--accent-light)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 16,
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}>
              🔒 Klucz API jest szyfrowany i przechowywany lokalnie.
              Nigdzie nie jest wysyłany poza oficjalne API {data.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'}.
            </div>

            <label style={labelStyle}>
              Klucz API {data.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'}
            </label>
            <input
              type="password"
              style={inputStyle}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data.aiProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              autoFocus
            />

            <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {data.aiProvider === 'openai'
                ? 'Wygeneruj klucz na platform.openai.com → API Keys'
                : 'Wygeneruj klucz na console.anthropic.com → API Keys'}
            </p>
          </div>
        )}

        {step === 5 && (
          <div className="fade-in" style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>{data.agentEmoji}</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              {data.agentName} jest gotowy!
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              Hej <strong>{data.userName}</strong>! Twój agent jest skonfigurowany.<br/>
              Możesz zacząć czatować, włączyć tryb proaktywny (👁️)<br/>
              lub kliknąć 📸 żeby przeanalizować ekran.
            </p>
            <div style={{
              marginTop: 20,
              padding: 16,
              background: 'var(--bg-secondary)',
              borderRadius: 'var(--radius)',
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'left',
            }}>
              <div><strong>Skróty:</strong></div>
              <div style={{ marginTop: 4 }}>• <kbd>Alt+K</kbd> — pokaż/ukryj agenta</div>
              <div>• <kbd>Enter</kbd> — wyślij wiadomość</div>
              <div>• <kbd>Shift+Enter</kbd> — nowa linia</div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 24px',
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end',
      }}>
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 20px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Wstecz
          </button>
        )}
        <button
          onClick={handleNext}
          disabled={!canProceed() || isLoading}
          style={{
            background: canProceed() && !isLoading ? 'var(--accent)' : 'var(--bg-tertiary)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 24px',
            color: 'var(--text-primary)',
            cursor: canProceed() && !isLoading ? 'pointer' : 'not-allowed',
            fontSize: 13,
            fontWeight: 600,
            transition: 'var(--transition)',
          }}
        >
          {isLoading ? '...' : step === 5 ? 'Zacznijmy!' : 'Dalej →'}
        </button>
      </div>
    </div>
  );
}
