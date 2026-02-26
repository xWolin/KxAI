import { create } from 'zustand';
import type { KxAIConfig, ProactiveMessage } from '../types';
import { useNavigationStore } from './useNavigationStore';

interface ConfigState {
  config: KxAIConfig | null;
  proactiveMessages: ProactiveMessage[];

  /** API key presence flags — cached to avoid repeated IPC calls */
  hasApiKey: boolean;
  hasDeepgramKey: boolean;
  hasEmbeddingKey: boolean;

  setConfig: (config: KxAIConfig) => void;
  updateConfig: (key: string, value: unknown) => Promise<void>;
  updateConfigBatch: (updates: Partial<KxAIConfig>) => Promise<void>;
  /** Apply partial changes pushed from main process (no IPC round-trip) */
  applyConfigChanges: (changes: Partial<KxAIConfig>) => void;
  reloadConfig: () => Promise<void>;

  addProactiveMessage: (msg: ProactiveMessage) => void;
  dismissProactive: (id: string) => void;

  /** Reload API key flags from main process */
  refreshApiKeyFlags: () => Promise<void>;
  setApiKeyFlag: (provider: 'main' | 'deepgram' | 'embedding', hasKey: boolean) => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  proactiveMessages: [],
  hasApiKey: false,
  hasDeepgramKey: false,
  hasEmbeddingKey: false,

  setConfig: (config) => set({ config }),

  updateConfig: async (key, value) => {
    await window.kxai.setConfig(key, value);
    // No need to re-fetch — CONFIG_CHANGED event will push the update
  },

  updateConfigBatch: async (updates) => {
    await window.kxai.setConfigBatch(updates);
    // No need to re-fetch — CONFIG_CHANGED event will push the update
  },

  applyConfigChanges: (changes) => {
    const current = get().config;
    if (current) {
      set({ config: { ...current, ...changes } });
    }
  },

  reloadConfig: async () => {
    const config = await window.kxai.getConfig();
    set({ config });
  },

  addProactiveMessage: (msg) => {
    const msgWithId: ProactiveMessage = {
      ...msg,
      id: msg.id || `proactive-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    set((s) => ({ proactiveMessages: [...s.proactiveMessages, msgWithId] }));

    // Auto-dismiss after 15s
    const id = msgWithId.id;
    setTimeout(() => {
      const remaining = get().proactiveMessages.filter((m) => m.id !== id);
      set({ proactiveMessages: remaining });
      // Shrink window back if we're in widget view and no more notifications
      if (remaining.length === 0) {
        const currentView = useNavigationStore.getState().view;
        if (currentView === 'widget') {
          window.kxai.setWindowSize(68, 68);
        }
      }
    }, 15000);
  },

  dismissProactive: (id) => {
    set((s) => ({ proactiveMessages: s.proactiveMessages.filter((m) => m.id !== id) }));
  },

  refreshApiKeyFlags: async () => {
    const [hasApiKey, hasDeepgramKey, hasEmbeddingKey] = await Promise.all([
      window.kxai.hasApiKey(get().config?.aiProvider || 'openai'),
      window.kxai.hasApiKey('deepgram'),
      window.kxai.hasApiKey('embedding'),
    ]);
    set({ hasApiKey, hasDeepgramKey, hasEmbeddingKey });
  },

  setApiKeyFlag: (provider, hasKey) => {
    if (provider === 'main') set({ hasApiKey: hasKey });
    else if (provider === 'deepgram') set({ hasDeepgramKey: hasKey });
    else if (provider === 'embedding') set({ hasEmbeddingKey: hasKey });
  },
}));
