/**
 * Telegram Bot types — event-driven 2-way messaging (long polling).
 * Agent receives messages from Telegram and responds via Bot API.
 */

/** Telegram service connection status */
export type TelegramConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Telegram service status exposed to renderer */
export interface TelegramStatus {
  /** Current connection state */
  status: TelegramConnectionStatus;
  /** Bot username (e.g. @MyBot) */
  botUsername?: string;
  /** Whether bot token is stored */
  hasToken: boolean;
  /** Allowed chat IDs (empty = any when denyByDefault is off) */
  allowedChatIds: number[];
  /** Allowed usernames (without @, e.g. ['john_doe', 'jane']) */
  allowedUsernames: string[];
  /** When true, reject all messages not in allowlist (default: true) */
  denyByDefault: boolean;
  /** Auto-start polling on app launch */
  autoStart: boolean;
  /** Total messages processed since start */
  messagesProcessed: number;
  /** Last error message (if status === 'error') */
  lastError?: string;
  /** Whether polling is actively running */
  polling: boolean;
}

/** Incoming Telegram message (simplified) */
export interface TelegramIncomingMessage {
  /** Telegram message ID */
  messageId: number;
  /** Chat ID */
  chatId: number;
  /** Sender info */
  from: {
    id: number;
    firstName: string;
    lastName?: string;
    username?: string;
  };
  /** Message text */
  text: string;
  /** Timestamp (unix) */
  date: number;
}

/** Telegram message event pushed to renderer */
export interface TelegramMessageEvent {
  /** Direction */
  direction: 'incoming' | 'outgoing';
  /** Chat ID */
  chatId: number;
  /** Message text */
  text: string;
  /** Timestamp */
  timestamp: number;
  /** Whether agent is still processing (for incoming) */
  processing?: boolean;
}
