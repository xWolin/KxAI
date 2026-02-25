import React from 'react';
import { FloatingWidget } from './components/FloatingWidget';
import { ChatPanel } from './components/ChatPanel';
import { OnboardingWizard } from './components/OnboardingWizard';
import { SettingsPanel } from './components/SettingsPanel';
import { CronPanel } from './components/CronPanel';
import { DashboardPanel } from './components/DashboardPanel';
import { ProactiveNotification } from './components/ProactiveNotification';
import { CoachingOverlay } from './components/CoachingOverlay';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useNavigationStore, useConfigStore, useAgentStore, useStoreInit } from './stores';

export default function App() {
  // Initialize stores — subscribes to IPC events, loads config, etc.
  useStoreInit();

  // ── Store selectors ──
  const view = useNavigationStore((s) => s.view);
  const isLoading = useNavigationStore((s) => s.isLoading);
  const chatRefreshTrigger = useNavigationStore((s) => s.chatRefreshTrigger);
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const setView = useNavigationStore((s) => s.setView);

  const config = useConfigStore((s) => s.config);
  const proactiveMessages = useConfigStore((s) => s.proactiveMessages);
  const dismissProactive = useConfigStore((s) => s.dismissProactive);
  const reloadConfig = useConfigStore((s) => s.reloadConfig);

  const meetingActive = useAgentStore((s) => s.meetingActive);
  const controlActive = useAgentStore((s) => s.controlActive);
  const hasSuggestion = useAgentStore((s) => s.hasSuggestion);
  const wantsToSpeak = useAgentStore((s) => s.wantsToSpeak);
  const clearCompanionStates = useAgentStore((s) => s.clearCompanionStates);

  const handleOnboardingComplete = async () => {
    await reloadConfig();
    window.kxai.setClickThrough(true);
    window.kxai.setWindowSize(100, 100);
    setView('widget');
  };

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="app-loading__icon">🤖</div>
      </div>
    );
  }

  return (
    <ErrorBoundary label="App">
      <div className={`app-container${view === 'widget' ? ' app-container--transparent' : ''}`}>
        {/* Proactive notifications — hide during active meeting (compact bar mode) */}
        {!meetingActive &&
          proactiveMessages.map((msg) => (
            <ProactiveNotification
              key={msg.id}
              message={msg}
              onDismiss={() => dismissProactive(msg.id)}
              onReply={() => {
                navigateTo('chat');
                dismissProactive(msg.id);
              }}
            />
          ))}

        {/* Main content */}
        {view === 'onboarding' && (
          <ErrorBoundary label="Onboarding">
            <OnboardingWizard onComplete={handleOnboardingComplete} />
          </ErrorBoundary>
        )}

        {view === 'widget' && (
          <FloatingWidget
            emoji={config?.agentEmoji || '🤖'}
            name={config?.agentName || 'KxAI'}
            onClick={() => {
              clearCompanionStates();
              navigateTo('chat');
            }}
            hasNotification={proactiveMessages.length > 0}
            controlActive={controlActive}
            hasSuggestion={hasSuggestion}
            wantsToSpeak={wantsToSpeak}
          />
        )}

        {view === 'chat' && (
          <ErrorBoundary label="Chat">
            <ChatPanel
              config={config!}
              onClose={() => navigateTo('widget')}
              onOpenSettings={() => navigateTo('settings')}
              onOpenCron={() => navigateTo('cron')}
              onOpenMeeting={() => navigateTo('meeting')}
              onOpenDashboard={() => navigateTo('dashboard')}
              refreshTrigger={chatRefreshTrigger}
            />
          </ErrorBoundary>
        )}

        {view === 'cron' && (
          <ErrorBoundary label="Cron">
            <CronPanel onBack={() => navigateTo('chat')} />
          </ErrorBoundary>
        )}

        {/* CoachingOverlay stays mounted while meeting is active — audio capture & IPC listeners survive navigation */}
        {(view === 'meeting' || meetingActive) && config && (
          <ErrorBoundary label="Meeting">
            <div style={{ display: view === 'meeting' ? 'contents' : 'none' }}>
              <CoachingOverlay config={config} onBack={() => navigateTo('chat')} />
            </div>
          </ErrorBoundary>
        )}

        {view === 'dashboard' && (
          <ErrorBoundary label="Dashboard">
            <DashboardPanel onBack={() => navigateTo('chat')} />
          </ErrorBoundary>
        )}

        {view === 'settings' && (
          <ErrorBoundary label="Settings">
            <SettingsPanel config={config!} onBack={() => navigateTo('chat')} onConfigUpdate={reloadConfig} />
          </ErrorBoundary>
        )}
      </div>
    </ErrorBoundary>
  );
}
