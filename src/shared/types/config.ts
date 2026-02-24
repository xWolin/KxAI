/**
 * Shared configuration types — used by both main process and renderer.
 */

export interface KxAIConfig {
  // User profile
  userName?: string;
  userRole?: string;
  userDescription?: string;
  userLanguage?: string;

  // AI settings
  aiProvider?: 'openai' | 'anthropic';
  aiModel?: string;
  embeddingModel?: string;

  // Proactive mode
  proactiveMode?: boolean;
  proactiveIntervalMs?: number;

  // UI
  widgetPosition?: { x: number; y: number };
  theme?: 'dark' | 'light';

  // Onboarding
  onboarded?: boolean;

  // Agent persona
  agentName?: string;
  agentEmoji?: string;

  // Screen watching
  screenWatchEnabled?: boolean;
  monitorIndexes?: number[];

  // Knowledge indexing
  indexedFolders?: string[];
  indexedExtensions?: string[];

  // Feature flags
  /** Use native function calling (OpenAI tools API / Anthropic tool_use) instead of ```tool blocks. Default: true */
  useNativeFunctionCalling?: boolean;

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
