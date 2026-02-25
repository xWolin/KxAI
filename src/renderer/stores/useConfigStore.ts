import { create } from 'zustand';
import type { KxAIConfig, ProactiveMessage } from '../types';

interface ConfigState {
  config: KxAIConfig | null;
  proactiveMessages: ProactiveMessage[];

  /** API key presence flags — cached to avoid repeated IPC calls */
  hasApiKey: boolean;
  hasDeepgramKey: boolean;
  hasEmbeddingKey: boolean;

  setConfig: (config: KxAIConfig) => void;
  updateConfig: (key: string, value: unknown) => Promise<void>;
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
    const config = await window.kxai.getConfig();
    set({ config });
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
      set((s) => ({ proactiveMessages: s.proactiveMessages.filter((m) => m.id !== id) }));
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
