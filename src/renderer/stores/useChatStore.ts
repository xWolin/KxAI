import { create } from 'zustand';
import type { ConversationMessage } from '../types';

interface ChatState {
  messages: ConversationMessage[];
  input: string;
  isStreaming: boolean;
  streamingContent: string;
  isRecording: boolean;

  setMessages: (messages: ConversationMessage[]) => void;
  addMessage: (message: ConversationMessage) => void;
  setInput: (input: string) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setRecording: (recording: boolean) => void;

  /** Load conversation history from main process */
  loadHistory: () => Promise<void>;
  /** Clear conversation history */
  clearHistory: () => Promise<void>;

  /** Reset streaming state (call after stream ends) */
  resetStreaming: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  input: '',
  isStreaming: false,
  streamingContent: '',
  isRecording: false,

  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setInput: (input) => set({ input }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setStreamingContent: (streamingContent) => set({ streamingContent }),
  appendStreamingContent: (chunk) => set((s) => ({ streamingContent: s.streamingContent + chunk })),
  setRecording: (isRecording) => set({ isRecording }),

  loadHistory: async () => {
    const messages = await window.kxai.getConversationHistory();
    set({ messages });
  },

  clearHistory: async () => {
    await window.kxai.clearConversationHistory();
    set({ messages: [] });
  },

  resetStreaming: () => set({ isStreaming: false, streamingContent: '' }),
}));
