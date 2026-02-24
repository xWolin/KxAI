/**
 * Shared AI / Conversation types — used by both main process and renderer.
 */

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  type?: 'chat' | 'proactive' | 'analysis';
}

export interface ProactiveMessage {
  id: string;
  type: string;
  message: string;
  context: string;
}
