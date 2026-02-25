import React, { useState } from 'react';
import type { OnboardingData } from '../types';
import s from './OnboardingWizard.module.css';
import { cn } from '../utils/cn';
import { useTranslation } from '../i18n';

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
  const { t } = useTranslation();
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
    { title: t('onboarding.step0.title'), subtitle: t('onboarding.step0.subtitle') },
    { title: t('onboarding.step1.title'), subtitle: t('onboarding.step1.subtitle') },
    { title: t('onboarding.step2.title'), subtitle: t('onboarding.step2.subtitle') },
    { title: t('onboarding.step3.title'), subtitle: t('onboarding.step3.subtitle') },
    { title: t('onboarding.step4.title'), subtitle: t('onboarding.step4.subtitle') },
    { title: t('onboarding.step5.title'), subtitle: t('onboarding.step5.subtitle') },
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
        setError(t('onboarding.apiKey.saveError', { error: e.message || t('onboarding.apiKey.unknownError') }));
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
        setError(t('onboarding.done.completeError', { error: e.message || t('onboarding.apiKey.unknownError') }));
        setIsLoading(false);
        return;
      }
      setIsLoading(false);
      return;
    }

    setStep(step + 1);
  };

  return (
    <div className={s.root}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.icon}>🤖</div>
        <h2 className={s.title}>
          {steps[step].title}
        </h2>
        <p className={s.subtitle}>
          {steps[step].subtitle}
        </p>

        {/* Progress dots */}
        <div className={s.dots}>
          {steps.map((_, i) => (
            <div
              key={i}
              className={i <= step ? s.dotActive : s.dot}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className={s.content}>
        {step === 0 && (
          <div className={cn('fade-in', s.welcome)}>
            <p className={s.welcomeDesc}>
              <strong>KxAI</strong> {t('onboarding.welcome.desc')}
            </p>
            <ul className={s.welcomeFeatures}>
              <li>{t('onboarding.welcome.feature1')}</li>
              <li>{t('onboarding.welcome.feature2')}</li>
              <li>{t('onboarding.welcome.feature3')}</li>
              <li>{t('onboarding.welcome.feature4')}</li>
              <li>{t('onboarding.welcome.feature5')}</li>
              <li>{t('onboarding.welcome.feature6')}</li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="fade-in">
            <label className={s.label} htmlFor="userName">{t('onboarding.user.nameLabel')}</label>
            <input
              id="userName"
              className={s.input}
              value={data.userName}
              onChange={(e) => setData({ ...data, userName: e.target.value })}
              placeholder={t('onboarding.user.namePlaceholder')}
              autoFocus
            />

            <label className={s.label} htmlFor="userRole">{t('onboarding.user.roleLabel')}</label>
            <input
              id="userRole"
              className={s.input}
              value={data.userRole}
              onChange={(e) => setData({ ...data, userRole: e.target.value })}
              placeholder={t('onboarding.user.rolePlaceholder')}
            />

            <label className={s.label} htmlFor="userDescription">{t('onboarding.user.descLabel')}</label>
            <textarea
              id="userDescription"
              className={s.textarea}
              value={data.userDescription}
              onChange={(e) => setData({ ...data, userDescription: e.target.value })}
              placeholder={t('onboarding.user.descPlaceholder')}
            />
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <label className={s.label} htmlFor="agentName">{t('onboarding.agent.nameLabel')}</label>
            <input
              id="agentName"
              className={s.input}
              value={data.agentName}
              onChange={(e) => setData({ ...data, agentName: e.target.value })}
              placeholder="KxAI"
              autoFocus
            />

            <label className={s.label}>{t('onboarding.agent.emojiLabel')}</label>
            <div className={s.emojiGrid}>
              {['🤖', '🧠', '⚡', '🔮', '🦾', '🎯', '💡', '🚀', '🛸', '🐙'].map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => setData({ ...data, agentEmoji: emoji })}
                  className={data.agentEmoji === emoji ? s.emojiBtnSelected : s.emojiBtn}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className={s.preview}>
              <div className={s.previewEmoji}>{data.agentEmoji}</div>
              <div className={s.previewName}>
                {data.agentName}
              </div>
              <div className={s.previewSubtitle}>
                {t('onboarding.agent.previewSubtitle')}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="fade-in">
            <label className={s.label}>{t('onboarding.provider.label')}</label>
            <div className={s.providers}>
              {(['openai', 'anthropic'] as const).map((provider) => (
                <button
                  key={provider}
                  onClick={() => setData({
                    ...data,
                    aiProvider: provider,
                    aiModel: MODELS[provider][0].value,
                  })}
                  className={data.aiProvider === provider ? s.providerBtnSelected : s.providerBtn}
                  aria-pressed={data.aiProvider === provider}
                >
                  <div className={s.providerIcon}>
                    {provider === 'openai' ? '🟢' : '🟠'}
                  </div>
                  <div className={s.providerName}>
                    {provider === 'openai' ? 'OpenAI' : 'Anthropic'}
                  </div>
                </button>
              ))}
            </div>

            <label className={s.label}>{t('onboarding.provider.modelLabel')}</label>
            <select
              className={s.select}
              value={data.aiModel}
              onChange={(e) => setData({ ...data, aiModel: e.target.value })}
              title={t('onboarding.provider.modelTitle')}
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
            <div className={s.securityNotice}>
              {t('onboarding.apiKey.securityNotice', { provider: data.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic' })}
            </div>

            <label className={s.label} htmlFor="apiKey">
              {t('onboarding.apiKey.label', { provider: data.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic' })}
            </label>
            <input
              id="apiKey"
              type="password"
              className={s.input}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data.aiProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              autoFocus
            />

            <p className={s.keyHint}>
              {data.aiProvider === 'openai'
                ? t('onboarding.apiKey.hintOpenai')
                : t('onboarding.apiKey.hintAnthropic')}
            </p>
          </div>
        )}

        {step === 5 && (
          <div className={cn('fade-in', s.done)}>
            <div className={s.doneEmoji}>{data.agentEmoji}</div>
            <h3 className={s.doneTitle}>
              {t('onboarding.done.title', { name: data.agentName ?? '' })}
            </h3>
            <p className={s.doneDesc}>
              {t('onboarding.done.desc', { userName: data.userName ?? '' })}
            </p>
            <div className={s.shortcuts}>
              <div><strong>{t('onboarding.done.shortcuts')}</strong></div>
              <div className={s.shortcutsItem}>• <kbd>Alt+K</kbd> — {t('onboarding.done.shortcutToggle')}</div>
              <div>• <kbd>Enter</kbd> — {t('onboarding.done.shortcutSend')}</div>
              <div>• <kbd>Shift+Enter</kbd> — {t('onboarding.done.shortcutNewline')}</div>
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className={s.error} role="alert">
          ❌ {error}
        </div>
      )}

      {/* Footer */}
      <div className={s.footer}>
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className={s.btnBack}
          >
            {t('onboarding.back')}
          </button>
        )}
        <button
          onClick={handleNext}
          disabled={!canProceed() || isLoading}
          className={canProceed() && !isLoading ? s.btnNextEnabled : s.btnNextDisabled}
        >
          {isLoading ? '...' : step === 5 ? t('onboarding.start') : t('onboarding.next')}
        </button>
      </div>
    </div>
  );
}
