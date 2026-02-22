import React, { useState, useEffect, useRef } from 'react';
import { FloatingWidget } from './components/FloatingWidget';
import { ChatPanel } from './components/ChatPanel';
import { OnboardingWizard } from './components/OnboardingWizard';
import { SettingsPanel } from './components/SettingsPanel';
import { CronPanel } from './components/CronPanel';
import { ProactiveNotification } from './components/ProactiveNotification';
import { CoachingOverlay } from './components/CoachingOverlay';
import { initTTS, speak } from './utils/tts';
import type { ProactiveMessage, KxAIConfig } from './types';

type View = 'widget' | 'chat' | 'settings' | 'onboarding' | 'cron' | 'meeting';

export default function App() {
  const [view, setView] = useState<View>('widget');
  const [config, setConfig] = useState<KxAIConfig | null>(null);
  const [proactiveMessages, setProactiveMessages] = useState<ProactiveMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Track view in a ref so the proactive listener always sees current value
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  // Counter to signal ChatPanel to reload history when proactive msg arrives while chat is open
  const [chatRefreshTrigger, setChatRefreshTrigger] = useState(0);
  // Take-control state from Ctrl+Shift+K
  const [controlActive, setControlActive] = useState(false);
  // Smart companion states
  const [hasSuggestion, setHasSuggestion] = useState(false);
  const [wantsToSpeak, setWantsToSpeak] = useState(false);

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

    // Initialize TTS
    initTTS();

    // Listen for proactive messages
    const cleanupProactive = window.kxai.onProactiveMessage((data) => {
      const msgWithId: ProactiveMessage = { ...data, id: data.id || `proactive-${Date.now()}-${Math.random().toString(36).slice(2)}` };

      // Speak the proactive message via TTS
      if (data.message) {
        speak(data.message);
      }

      if (viewRef.current === 'chat') {
        // Chat is open — don't show popup, just refresh chat to show the saved message
        setChatRefreshTrigger((n) => n + 1);
      } else {
        // Widget/other view — show popup notification
        setProactiveMessages((prev) => [...prev, msgWithId]);
        const msgId = msgWithId.id;
        setTimeout(() => {
          setProactiveMessages((prev) => prev.filter((m) => m.id !== msgId));
        }, 15000);
      }
    });

    // Listen for navigation events (from tray menu)
    const cleanupNavigate = window.kxai.onNavigate((target) => {
      setView(target as View);
    });

    // Listen for take-control state changes (from Ctrl+Shift+K)
    const cleanupControl = window.kxai.onControlState((data) => {
      setControlActive(data.active);
    });

    // Listen for companion state changes (suggestion / wantsToSpeak)
    const cleanupCompanion = window.kxai.onCompanionState((data) => {
      if (data.hasSuggestion !== undefined) setHasSuggestion(data.hasSuggestion);
      if (data.wantsToSpeak !== undefined) setWantsToSpeak(data.wantsToSpeak);
    });

    return () => {
      cleanupProactive();
      cleanupNavigate();
      cleanupControl();
      cleanupCompanion();
    };
  }, []);

  const handleOnboardingComplete = async () => {
    const cfg = await window.kxai.getConfig();
    setConfig(cfg);
    setView('widget');
  };

  const dismissProactive = (id: string) => {
    setProactiveMessages((prev) => prev.filter((m) => m.id !== id));
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
      {proactiveMessages.map((msg) => (
        <ProactiveNotification
          key={msg.id}
          message={msg}
          onDismiss={() => dismissProactive(msg.id)}
          onReply={(text: string) => {
            setView('chat');
            dismissProactive(msg.id);
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
            // Clear companion states when opening chat
            setHasSuggestion(false);
            setWantsToSpeak(false);
            // Resize window for chat view before switching
            window.kxai.setWindowSize(420, 600);
            setView('chat');
          }}
          hasNotification={proactiveMessages.length > 0}
          controlActive={controlActive}
          hasSuggestion={hasSuggestion}
          wantsToSpeak={wantsToSpeak}
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
          onOpenMeeting={() => setView('meeting')}
          refreshTrigger={chatRefreshTrigger}
        />
      )}

      {view === 'cron' && (
        <CronPanel onBack={() => setView('chat')} />
      )}

      {view === 'meeting' && (
        <CoachingOverlay
          config={config!}
          onBack={() => setView('chat')}
        />
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
