/**
 * TelegramService — event-driven 2-way messaging via Telegram Bot API.
 *
 * Uses long polling (getUpdates with timeout) for near-instant message delivery.
 * When a message arrives, it's fed into AgentLoop.processWithTools() and
 * the response is sent back via sendMessage.
 *
 * Architecture:
 * 📱 Phone → Telegram Bot API → long polling → TelegramService → AgentLoop → response → sendMessage → 📱
 */

import https from 'node:https';
import { createLogger } from './logger';
import type { SecurityService } from './security';
import type { ConfigService } from './config';
import type { AgentLoop } from './agent-loop';
import type {
  TelegramStatus,
  TelegramConnectionStatus,
  TelegramIncomingMessage,
  TelegramMessageEvent,
} from '@shared/types/telegram';

const log = createLogger('Telegram');
const BOT_API = 'https://api.telegram.org';
const POLL_TIMEOUT = 30; // seconds — Telegram long polling timeout
const TOKEN_KEY = 'telegram-bot-token';

interface TelegramDeps {
  security: SecurityService;
  config: ConfigService;
  agentLoop: AgentLoop;
}

export class TelegramService {
  private deps: TelegramDeps | null = null;
  private status: TelegramConnectionStatus = 'disconnected';
  private botUsername: string | undefined;
  private polling = false;
  private pollAbort: AbortController | null = null;
  private messagesProcessed = 0;
  private lastError: string | undefined;
  private lastUpdateId = 0;
  private allowedChatIds: number[] = [];
  private allowedUsernames: string[] = [];
  private denyByDefault = true;
  private autoStart = false;
  private processingChats = new Set<number>();

  // Callback to push events to renderer
  private onMessageCallback: ((event: TelegramMessageEvent) => void) | null = null;
  private onStatusChangeCallback: ((status: TelegramStatus) => void) | null = null;

  setDependencies(deps: TelegramDeps): void {
    this.deps = deps;
  }

  /**
   * Load persisted config and optionally auto-start polling.
   * Called from ServiceContainer after setDependencies().
   */
  async initialize(): Promise<void> {
    if (!this.deps) return;

    const { config } = this.deps;
    this.allowedChatIds = config.get('telegramAllowedChatIds') ?? [];
    this.allowedUsernames = (config.get('telegramAllowedUsernames') ?? []).map((u: string) => u.toLowerCase());
    this.denyByDefault = config.get('telegramDenyByDefault') ?? true;
    this.autoStart = config.get('telegramAutoStart') ?? false;

    log.info(
      `Config loaded: ${this.allowedChatIds.length} chat IDs, ${this.allowedUsernames.length} usernames, denyByDefault=${this.denyByDefault}, autoStart=${this.autoStart}`,
    );

    if (this.autoStart) {
      const hasToken = await this.deps.security.hasApiKey(TOKEN_KEY);
      if (hasToken) {
        log.info('Auto-starting polling...');
        const result = await this.start();
        if (!result.success) {
          log.warn(`Auto-start failed: ${result.error}`);
        }
      }
    }
  }

  onMessage(callback: (event: TelegramMessageEvent) => void): void {
    this.onMessageCallback = callback;
  }

  onStatusChange(callback: (status: TelegramStatus) => void): void {
    this.onStatusChangeCallback = callback;
  }

  getStatus(): TelegramStatus {
    return {
      status: this.status,
      botUsername: this.botUsername,
      hasToken: !!(this as any).cachedHasToken, // use cached value if available
      allowedChatIds: [...this.allowedChatIds],
      allowedUsernames: [...this.allowedUsernames],
      denyByDefault: this.denyByDefault,
      autoStart: this.autoStart,
      messagesProcessed: this.messagesProcessed,
      lastError: this.lastError,
      polling: this.polling,
    };
  }

  async getStatusAsync(): Promise<TelegramStatus> {
    const hasToken = this.deps ? await this.deps.security.hasApiKey(TOKEN_KEY) : false;
    (this as any).cachedHasToken = hasToken;
    return {
      ...this.getStatus(),
      hasToken,
    };
  }

  /**
   * Store bot token in encrypted storage and optionally start polling.
   */
  async setToken(token: string): Promise<{ success: boolean; botUsername?: string; error?: string }> {
    if (!this.deps) return { success: false, error: 'Service not initialized' };

    // Validate token format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
    if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
      return { success: false, error: 'Invalid bot token format' };
    }

    // Test token by calling getMe
    try {
      const me = await this.apiCall<{ id: number; first_name: string; username: string }>(token, 'getMe');
      this.botUsername = me.username;
      await this.deps.security.setApiKey(TOKEN_KEY, token);
      log.info(`Bot token saved: @${me.username}`);
      this.emitStatus();
      return { success: true, botUsername: me.username };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to validate token' };
    }
  }

  /**
   * Remove stored bot token and stop polling.
   */
  async removeToken(): Promise<void> {
    await this.stop();
    if (this.deps) {
      await this.deps.security.setApiKey(TOKEN_KEY, '');
    }
    this.botUsername = undefined;
    this.emitStatus();
  }

  /**
   * Set allowed chat IDs and persist to config.
   */
  setAllowedChatIds(chatIds: number[]): void {
    this.allowedChatIds = chatIds;
    if (this.deps) {
      void this.deps.config.set('telegramAllowedChatIds', chatIds);
    }
    this.emitStatus();
  }

  /**
   * Set allowed usernames (without @) and persist to config.
   */
  setAllowedUsernames(usernames: string[]): void {
    this.allowedUsernames = usernames.map((u) => u.replace(/^@/, '').toLowerCase());
    if (this.deps) {
      void this.deps.config.set('telegramAllowedUsernames', this.allowedUsernames);
    }
    this.emitStatus();
  }

  /**
   * Set deny-by-default mode and persist to config.
   * When true, reject all messages not in allowlist.
   */
  setDenyByDefault(enabled: boolean): void {
    this.denyByDefault = enabled;
    if (this.deps) {
      void this.deps.config.set('telegramDenyByDefault', enabled);
    }
    this.emitStatus();
  }

  /**
   * Set auto-start and persist to config.
   */
  setAutoStart(enabled: boolean): void {
    this.autoStart = enabled;
    if (this.deps) {
      void this.deps.config.set('telegramAutoStart', enabled);
    }
    this.emitStatus();
  }

  /**
   * Start long polling loop.
   */
  async start(): Promise<{ success: boolean; error?: string }> {
    if (!this.deps) return { success: false, error: 'Service not initialized' };
    if (this.polling) return { success: true };

    const token = await this.deps.security.getApiKey(TOKEN_KEY);
    if (!token) return { success: false, error: 'No bot token configured' };

    // Validate token
    try {
      const me = await this.apiCall<{ id: number; username: string }>(token, 'getMe');
      this.botUsername = me.username;
    } catch (err: any) {
      this.setError(err.message || 'Invalid bot token');
      return { success: false, error: this.lastError };
    }

    this.polling = true;
    this.status = 'connected';
    this.lastError = undefined;
    this.pollAbort = new AbortController();
    log.info(`Started polling as @${this.botUsername}`);
    this.emitStatus();

    // Start polling loop (fire-and-forget)
    void this.pollLoop(token);

    return { success: true };
  }

  /**
   * Stop long polling.
   */
  async stop(): Promise<void> {
    if (!this.polling) return;
    this.polling = false;
    this.pollAbort?.abort();
    this.pollAbort = null;
    this.status = 'disconnected';
    log.info('Polling stopped');
    this.emitStatus();
  }

  /**
   * Send a message to a specific chat (manual, from UI).
   */
  async sendMessage(chatId: number, text: string): Promise<boolean> {
    if (!this.deps) return false;

    const token = await this.deps.security.getApiKey(TOKEN_KEY);
    if (!token) return false;

    try {
      await this.apiCall(token, 'sendMessage', {
        chat_id: chatId,
        text: this.truncateForTelegram(text),
        parse_mode: 'Markdown',
      });
      return true;
    } catch (err: any) {
      // Retry without parse_mode if Markdown fails
      try {
        await this.apiCall(token, 'sendMessage', {
          chat_id: chatId,
          text: this.truncateForTelegram(text),
        });
        return true;
      } catch {
        log.error(`Failed to send message to chat ${chatId}:`, err.message);
        return false;
      }
    }
  }

  shutdown(): void {
    this.polling = false;
    this.pollAbort?.abort();
    this.pollAbort = null;
    this.status = 'disconnected';
  }

  // ─── Private ───

  private async pollLoop(token: string): Promise<void> {
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    while (this.polling) {
      try {
        const updates = await this.apiCall<any[]>(
          token,
          'getUpdates',
          {
            offset: this.lastUpdateId + 1,
            timeout: POLL_TIMEOUT,
            allowed_updates: ['message'],
          },
          (POLL_TIMEOUT + 5) * 1000, // HTTP timeout slightly longer than poll timeout
        );

        consecutiveErrors = 0;

        for (const update of updates) {
          this.lastUpdateId = update.update_id;
          if (update.message?.text) {
            await this.handleMessage(token, update.message);
          }
        }
      } catch (err: any) {
        if (!this.polling) break; // Expected abort during shutdown

        consecutiveErrors++;
        const errMsg = err.message || 'Unknown polling error';
        log.warn(`Polling error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, errMsg);

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.setError(`Too many polling errors: ${errMsg}`);
          this.polling = false;
          break;
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, consecutiveErrors - 1), 30000);
        await this.sleep(delay);
      }
    }

    if (this.status !== 'error') {
      this.status = 'disconnected';
    }
    this.polling = false;
    this.emitStatus();
  }

  private async handleMessage(token: string, msg: any): Promise<void> {
    const chatId: number = msg.chat.id;
    const text: string = msg.text;
    const from = msg.from;
    const senderUsername = from?.username?.toLowerCase();

    // Security: check allowlists (chat ID + username)
    const hasChatIdAllowlist = this.allowedChatIds.length > 0;
    const hasUsernameAllowlist = this.allowedUsernames.length > 0;
    const chatIdAllowed = hasChatIdAllowlist && this.allowedChatIds.includes(chatId);
    const usernameAllowed = hasUsernameAllowlist && senderUsername && this.allowedUsernames.includes(senderUsername);

    if (hasChatIdAllowlist || hasUsernameAllowlist) {
      // Allowlists configured — sender must match at least one
      if (!chatIdAllowed && !usernameAllowed) {
        log.warn(`Rejected message from unauthorized chat ${chatId} (user: ${from?.username || from?.id})`);
        await this.apiCall(token, 'sendMessage', {
          chat_id: chatId,
          text: '⛔ Unauthorized. This chat ID / username is not in the allowed list.',
        });
        return;
      }
    } else if (this.denyByDefault) {
      // No allowlists configured but deny-by-default is ON — reject everything
      log.warn(
        `Denied message from chat ${chatId} (user: ${from?.username || from?.id}) — deny-by-default, no allowlist configured`,
      );
      await this.apiCall(token, 'sendMessage', {
        chat_id: chatId,
        text: '⛔ Bot is in deny-by-default mode. Ask the owner to add your chat ID or username to the allowlist.',
      });
      return;
    }

    // Skip if already processing a message from this chat (prevent queue-up)
    if (this.processingChats.has(chatId)) {
      await this.apiCall(token, 'sendMessage', {
        chat_id: chatId,
        text: '⏳ Przetwarzam poprzednią wiadomość, poczekaj...',
      });
      return;
    }

    log.info(`Message from ${from?.username || from?.first_name} (chat ${chatId}): ${text.substring(0, 100)}`);

    const incomingEvent: TelegramMessageEvent = {
      direction: 'incoming',
      chatId,
      text,
      timestamp: Date.now(),
      processing: true,
    };
    this.onMessageCallback?.(incomingEvent);

    this.processingChats.add(chatId);

    try {
      // Send typing indicator
      void this.apiCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });

      // Process via agent loop — include source hint for tool routing
      const extraContext =
        `[Źródło: Telegram] Wiadomość od: ${from?.first_name || 'Unknown'}${from?.username ? ` (@${from.username})` : ''} (chat ID: ${chatId})\n` +
        `Użytkownik pisze z telefonu/Telegram. Brak aktywnej przeglądarki CDP.\n` +
        `Dla screenshotów użyj: screenshot (desktopCapturer), NIE browser_screenshot.`;
      const response = await this.deps!.agentLoop.processWithTools(text, extraContext);

      // Send response back to Telegram
      await this.sendLongMessage(token, chatId, response);
      this.messagesProcessed++;

      const outgoingEvent: TelegramMessageEvent = {
        direction: 'outgoing',
        chatId,
        text: response.substring(0, 500),
        timestamp: Date.now(),
      };
      this.onMessageCallback?.(outgoingEvent);
    } catch (err: any) {
      log.error(`Failed to process message from chat ${chatId}:`, err.message);
      await this.apiCall(token, 'sendMessage', {
        chat_id: chatId,
        text: `❌ Błąd: ${err.message || 'Nie udało się przetworzyć wiadomości'}`,
      }).catch(() => {});
    } finally {
      this.processingChats.delete(chatId);
    }
  }

  /**
   * Send a long message by splitting into 4096-char chunks (Telegram limit).
   */
  private async sendLongMessage(token: string, chatId: number, text: string): Promise<void> {
    const MAX_LEN = 4000; // slightly under 4096 to be safe
    const chunks = this.splitMessage(text, MAX_LEN);

    for (const chunk of chunks) {
      try {
        await this.apiCall(token, 'sendMessage', {
          chat_id: chatId,
          text: chunk,
          parse_mode: 'Markdown',
        });
      } catch {
        // Retry without Markdown if parsing fails
        await this.apiCall(token, 'sendMessage', {
          chat_id: chatId,
          text: chunk,
        });
      }
    }
  }

  private splitMessage(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      // Try to split at newline
      let splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt < maxLen * 0.3) {
        // No good newline found, split at space
        splitAt = remaining.lastIndexOf(' ', maxLen);
      }
      if (splitAt < maxLen * 0.3) {
        // No good split point, hard cut
        splitAt = maxLen;
      }

      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
  }

  private truncateForTelegram(text: string): string {
    return text.length > 4000 ? text.substring(0, 3997) + '...' : text;
  }

  /**
   * Call Telegram Bot API via HTTPS.
   * Uses native Node.js https — no external dependency needed.
   */
  private apiCall<T>(token: string, method: string, body?: any, timeoutMs = 15000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : undefined;
      const url = `${BOT_API}/bot${token}/${method}`;

      const timeout = setTimeout(() => {
        req.destroy();
        reject(new Error(`Telegram API timeout: ${method}`));
      }, timeoutMs);

      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
          },
          signal: this.pollAbort?.signal,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            clearTimeout(timeout);
            try {
              const parsed = JSON.parse(data);
              if (parsed.ok) {
                resolve(parsed.result);
              } else {
                reject(new Error(parsed.description || `Telegram API error: ${method}`));
              }
            } catch {
              reject(new Error(`Invalid JSON response from Telegram API: ${method}`));
            }
          });
        },
      );

      req.on('error', (err: any) => {
        clearTimeout(timeout);
        if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
          reject(new Error('Request aborted'));
        } else {
          reject(err);
        }
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  private setError(msg: string): void {
    this.status = 'error';
    this.lastError = msg;
    log.error(msg);
    this.emitStatus();
  }

  private emitStatus(): void {
    // Async status fetch — fire and forget
    void this.getStatusAsync().then((s) => {
      this.onStatusChangeCallback?.(s);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
