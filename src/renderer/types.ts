// Type definitions for the KxAI preload bridge

export interface KxAIBridge {
  // Chat & AI
  sendMessage: (message: string, context?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  streamMessage: (message: string, context?: string) => Promise<{ success: boolean; error?: string }>;
  onAIResponse: (callback: (data: any) => void) => void;
  onAIStream: (callback: (data: { chunk?: string; done?: boolean }) => void) => void;
  onProactiveMessage: (callback: (data: ProactiveMessage) => void) => void;

  // Screen capture
  captureScreen: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
  startScreenWatch: (intervalMs: number) => Promise<{ success: boolean }>;
  stopScreenWatch: () => Promise<{ success: boolean }>;

  // Memory
  getMemory: (key: string) => Promise<string | null>;
  setMemory: (key: string, value: string) => Promise<{ success: boolean }>;
  getConversationHistory: () => Promise<ConversationMessage[]>;
  clearConversationHistory: () => Promise<{ success: boolean }>;

  // Config
  getConfig: () => Promise<KxAIConfig>;
  setConfig: (key: string, value: any) => Promise<{ success: boolean }>;
  isOnboarded: () => Promise<boolean>;
  completeOnboarding: (data: OnboardingData) => Promise<{ success: boolean }>;

  // Security
  setApiKey: (provider: string, key: string) => Promise<{ success: boolean }>;
  hasApiKey: (provider: string) => Promise<boolean>;
  deleteApiKey: (provider: string) => Promise<{ success: boolean }>;

  // Window control
  hideWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  setWindowPosition: (x: number, y: number) => Promise<void>;
  getWindowPosition: () => Promise<[number, number]>;

  // Navigation
  onNavigate: (callback: (view: string) => void) => void;

  // File operations
  organizeFiles: (directory: string, rules?: any) => Promise<{ success: boolean; data?: any }>;
  listFiles: (directory: string) => Promise<any[]>;

  // Proactive
  setProactiveMode: (enabled: boolean) => Promise<{ success: boolean }>;
  getProactiveMode: () => Promise<boolean>;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  type?: 'chat' | 'proactive' | 'analysis';
}

export interface ProactiveMessage {
  type: string;
  message: string;
  context: string;
}

export interface KxAIConfig {
  userName?: string;
  userRole?: string;
  userDescription?: string;
  userLanguage?: string;
  aiProvider?: 'openai' | 'anthropic';
  aiModel?: string;
  proactiveMode?: boolean;
  proactiveIntervalMs?: number;
  theme?: 'dark' | 'light';
  onboarded?: boolean;
  agentName?: string;
  agentEmoji?: string;
  screenWatchEnabled?: boolean;
  [key: string]: any;
}

export interface OnboardingData {
  userName: string;
  userRole: string;
  userDescription: string;
  agentName?: string;
  agentEmoji?: string;
  aiProvider: 'openai' | 'anthropic';
  aiModel: string;
}

declare global {
  interface Window {
    kxai: KxAIBridge;
  }
}
