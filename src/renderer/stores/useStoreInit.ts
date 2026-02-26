import { useEffect } from 'react';
import { useNavigationStore } from './useNavigationStore';
import { useConfigStore } from './useConfigStore';
import { useAgentStore } from './useAgentStore';
import { initTTS } from '../utils/tts';
import type { MeetingStateInfo } from '../types';

/**
 * Initialize all zustand stores: load initial data and subscribe to IPC events.
 * Call once in App component. Returns cleanup function via useEffect.
 */
export function useStoreInit(): void {
  const navigateTo = useNavigationStore((s) => s.navigateTo);
  const setView = useNavigationStore((s) => s.setView);
  const setLoading = useNavigationStore((s) => s.setLoading);
  const bumpChatRefresh = useNavigationStore((s) => s.bumpChatRefresh);

  const setConfig = useConfigStore((s) => s.setConfig);
  const applyConfigChanges = useConfigStore((s) => s.applyConfigChanges);
  const addProactiveMessage = useConfigStore((s) => s.addProactiveMessage);

  const setAgentStatus = useAgentStore((s) => s.setAgentStatus);
  const setControlActive = useAgentStore((s) => s.setControlActive);
  const setHasSuggestion = useAgentStore((s) => s.setHasSuggestion);
  const setWantsToSpeak = useAgentStore((s) => s.setWantsToSpeak);
  const setRagProgress = useAgentStore((s) => s.setRagProgress);
  const setMeetingActive = useAgentStore((s) => s.setMeetingActive);

  useEffect(() => {
    // ── Bootstrap ──
    async function init() {
      try {
        const isOnboarded = await window.kxai.isOnboarded();
        const cfg = await window.kxai.getConfig();
        setConfig(cfg);

        if (!isOnboarded) {
          setView('onboarding');
        } else {
          window.kxai.setWindowSize(100, 100);
          window.kxai.setClickThrough(true);
        }
      } catch (error) {
        console.error('Init error:', error);
      } finally {
        setLoading(false);
      }
    }
    init();
    initTTS();

    // ── IPC Event Subscriptions ──

    const cleanupProactive = window.kxai.onProactiveMessage((data) => {
      const currentView = useNavigationStore.getState().view;
      if (currentView === 'chat') {
        bumpChatRefresh();
      } else {
        addProactiveMessage(data);
      }
    });

    const cleanupNavigate = window.kxai.onNavigate((target) => {
      navigateTo(target as Parameters<typeof navigateTo>[0]);
    });

    const cleanupMeeting = window.kxai.onMeetingState((state: MeetingStateInfo) => {
      setMeetingActive(state.active);
    });
    window.kxai
      .meetingGetState()
      .then((state: MeetingStateInfo) => {
        setMeetingActive(state?.active ?? false);
      })
      .catch((err: unknown) => {
        console.error('[App] Failed to get meeting state:', err);
      });

    const cleanupControl = window.kxai.onControlState((data) => {
      setControlActive(data.active);
    });

    const cleanupCompanion = window.kxai.onCompanionState((data) => {
      if (data.hasSuggestion !== undefined) setHasSuggestion(data.hasSuggestion);
      if (data.wantsToSpeak !== undefined) setWantsToSpeak(data.wantsToSpeak);
    });

    const cleanupAgentStatus = window.kxai.onAgentStatus((status) => {
      setAgentStatus(status);
    });

    const cleanupRagProgress = window.kxai.onRagProgress((progress) => {
      if (progress.phase === 'done' || progress.phase === 'error') {
        setRagProgress(null);
      } else {
        setRagProgress(progress);
      }
    });

    const cleanupConfigChanged = window.kxai.onConfigChanged((changes) => {
      applyConfigChanges(changes);
    });

    return () => {
      cleanupProactive();
      cleanupNavigate();
      cleanupMeeting();
      cleanupControl();
      cleanupCompanion();
      cleanupAgentStatus();
      cleanupRagProgress();
      cleanupConfigChanged();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
