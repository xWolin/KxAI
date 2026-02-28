import { useEffect } from 'react';
import { useNavigationStore } from './useNavigationStore';
import { useConfigStore } from './useConfigStore';
import { useAgentStore } from './useAgentStore';
import { useChatStore } from './useChatStore';
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
          window.kxai.setWindowSize(68, 68);
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

    // ── Global AI stream handler — persists across ChatPanel mount/unmount ──
    // This ensures streaming progress is visible even when the user closes
    // and reopens the chat panel mid-stream.
    const cleanupStream = window.kxai.onAIStream((data: any) => {
      const store = useChatStore.getState();
      if (data.takeControlStart) {
        store.setStreaming(true);
        store.setStreamingContent(data.chunk || '');
        return;
      }
      if (data.done) {
        store.finalizeStream();
        // After stream finishes, sync with backend to get real message IDs
        // and any messages added during tool loop processing.
        // Small delay ensures backend has persisted the message.
        setTimeout(() => {
          useChatStore.getState().loadHistory();
        }, 200);
      } else if (data.chunk) {
        store.appendStreamingContent(data.chunk);
      }
    });

    // ── Conversation updated — push-based refresh ──
    // Fires when MemoryService.addMessage() is called from any source
    // (heartbeat, cron, proactive, tool loop, etc.).
    // Ensures ChatPanel always shows the latest messages without
    // requiring the user to close and reopen it.
    const cleanupConversation = window.kxai.onConversationUpdated(() => {
      const chatStore = useChatStore.getState();
      // Skip reload while actively streaming — finalizeStream handles that
      if (!chatStore.isStreaming) {
        chatStore.loadHistory();
      }
    });

    const cleanupProactive = window.kxai.onProactiveMessage((data) => {
      // Screen observations are silent context for the heartbeat engine —
      // they should NOT appear as chat messages or notifications.
      if (data.type === 'screen-analysis') return;

      const currentView = useNavigationStore.getState().view;

      // Autonomous agent (heartbeat) and reflection messages always show as popup,
      // even if the chat is open — these are proactive insights the user should see.
      // Rule-based proactive messages only show as popup when chat is not open.
      const alwaysPopup = data.type === 'heartbeat' || data.type === 'reflection';

      if (currentView === 'chat' && !alwaysPopup) {
        bumpChatRefresh();
      } else {
        // Expand window so the notification card is visible
        if (currentView === 'widget') {
          window.kxai.setWindowSize(420, 400);
        }
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
      cleanupStream();
      cleanupConversation();
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
