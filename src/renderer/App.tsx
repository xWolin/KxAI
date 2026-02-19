import React, { useState, useEffect } from 'react';
import { FloatingWidget } from './components/FloatingWidget';
import { ChatPanel } from './components/ChatPanel';
import { OnboardingWizard } from './components/OnboardingWizard';
import { SettingsPanel } from './components/SettingsPanel';
import { CronPanel } from './components/CronPanel';
import { ProactiveNotification } from './components/ProactiveNotification';
import type { ProactiveMessage, KxAIConfig } from './types';

type View = 'widget' | 'chat' | 'settings' | 'onboarding' | 'cron';

export default function App() {
  const [view, setView] = useState<View>('widget');
  const [config, setConfig] = useState<KxAIConfig | null>(null);
  const [proactiveMessages, setProactiveMessages] = useState<ProactiveMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const isOnboarded = await window.kxai.isOnboarded();
        const cfg = await window.kxai.getConfig();
        setConfig(cfg);

        if (!isOnboarded) {
          setView('onboarding');
        }
      } catch (error) {
        console.error('Init error:', error);
      } finally {
        setIsLoading(false);
      }
    }
    init();

    // Listen for proactive messages
    window.kxai.onProactiveMessage((data) => {
      setProactiveMessages((prev) => [...prev, data]);
      // Auto-dismiss after 15 seconds
      setTimeout(() => {
        setProactiveMessages((prev) => prev.slice(1));
      }, 15000);
    });

    // Listen for navigation events (from tray menu)
    window.kxai.onNavigate((target) => {
      setView(target as View);
    });
  }, []);

  const handleOnboardingComplete = async () => {
    const cfg = await window.kxai.getConfig();
    setConfig(cfg);
    setView('widget');
  };

  const dismissProactive = (index: number) => {
    setProactiveMessages((prev) => prev.filter((_, i) => i !== index));
  };

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading__icon">🤖</div>
      </div>
    );
  }

  return (
    <div className={`app-container${view === 'widget' ? ' app-container--transparent' : ''}`}>
      {/* Proactive notifications */}
      {proactiveMessages.map((msg, i) => (
        <ProactiveNotification
          key={i}
          message={msg}
          onDismiss={() => dismissProactive(i)}
          onReply={(text: string) => {
            setView('chat');
            dismissProactive(i);
          }}
        />
      ))}

      {/* Main content */}
      {view === 'onboarding' && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}

      {view === 'widget' && (
        <FloatingWidget
          emoji={config?.agentEmoji || '🤖'}
          name={config?.agentName || 'KxAI'}
          onClick={() => {
            // Resize window for chat view before switching
            window.kxai.setWindowSize(420, 600);
            setView('chat');
          }}
          hasNotification={proactiveMessages.length > 0}
        />
      )}

      {view === 'chat' && (
        <ChatPanel
          config={config!}
          onClose={() => {
            // Shrink window back to widget size
            window.kxai.setWindowSize(100, 100);
            setView('widget');
          }}
          onOpenSettings={() => setView('settings')}
          onOpenCron={() => setView('cron')}
        />
      )}

      {view === 'cron' && (
        <CronPanel onBack={() => setView('chat')} />
      )}

      {view === 'settings' && (
        <SettingsPanel
          config={config!}
          onBack={() => setView('chat')}
          onConfigUpdate={async () => {
            const cfg = await window.kxai.getConfig();
            setConfig(cfg);
          }}
        />
      )}
    </div>
  );
}
