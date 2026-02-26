import { create } from 'zustand';

export type View = 'widget' | 'chat' | 'settings' | 'onboarding' | 'cron' | 'meeting' | 'dashboard';

interface NavigationState {
  view: View;
  isLoading: boolean;
  /** Counter to signal ChatPanel to reload history (e.g. after proactive msg while chat open) */
  chatRefreshTrigger: number;

  setView: (view: View) => void;
  setLoading: (loading: boolean) => void;
  bumpChatRefresh: () => void;

  /**
   * Navigate with window resize side-effects.
   * Call this instead of setView when user-initiated navigation happens.
   */
  navigateTo: (view: View) => Promise<void>;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  view: 'widget',
  isLoading: true,
  chatRefreshTrigger: 0,

  setView: (view) => set({ view }),
  setLoading: (isLoading) => set({ isLoading }),
  bumpChatRefresh: () => set((s) => ({ chatRefreshTrigger: s.chatRefreshTrigger + 1 })),

  navigateTo: async (view) => {
    if (view === 'widget') {
      await window.kxai.setWindowSize(68, 68);
    } else {
      // Dashboard needs wider window for grids/tables
      const width = view === 'dashboard' ? 560 : 420;
      await window.kxai.setWindowSize(width, 600);
    }
    set({ view });
  },
}));
