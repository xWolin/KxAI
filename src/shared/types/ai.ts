/**
 * Shared AI / Conversation types — used by both main process and renderer.
 */

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string;
  timestamp: number;
  type?: 'chat' | 'proactive' | 'analysis';
  /** Estimated token count for context budgeting */
  tokenCount?: number;
  /** Importance score 0-1 for context window prioritization */
  importance?: number;
  /** Arbitrary metadata (tool calls, screenshots, etc.) */
  metadata?: Record<string, unknown>;
}

export interface ProactiveMessage {
  id: string;
  type: string;
  message: string;
  context: string;
}
