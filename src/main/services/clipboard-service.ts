/**
 * Smart Clipboard Pipeline — monitors clipboard, detects content type,
 * maintains searchable history in SQLite, and provides AI tools.
 *
 * Features:
 * - Background clipboard monitoring (opt-in, polling-based)
 * - Auto-detect content type (URL, email, code, JSON, path, color, phone, etc.)
 * - SQLite-backed history with FTS5 full-text search
 * - Pinning, deduplication (content hash), retention policy
 * - AI enrichment hooks (URL → summary, code → explain, JSON → format)
 * - 5 AI tools: clipboard_history, clipboard_search, clipboard_pin,
 *   clipboard_clear, clipboard_analyze
 *
 * @module clipboard-service
 * @phase 6.1
 */

import { clipboard } from 'electron';
import { createHash, randomUUID } from 'crypto';
import { createLogger } from './logger';
import type { ClipboardEntry, ClipboardContentType, ClipboardSearchOptions, ClipboardStatus } from '@shared/types';
import type { ToolDefinition, ToolResult } from '@shared/types';

const log = createLogger('Clipboard');

/** Polling interval for clipboard changes (ms) */
const POLL_INTERVAL = 1500;

/** Maximum content length to store (chars) */
const MAX_CONTENT_LENGTH = 50_000;

/** Preview length for display */
const PREVIEW_LENGTH = 200;

/** Default max history entries */
const DEFAULT_MAX_HISTORY = 1000;

/** Default retention in days */
const DEFAULT_RETENTION_DAYS = 30;

/** Min content length to track */
const DEFAULT_MIN_LENGTH = 2;

// ─── Content type detection patterns ───

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const JSON_PATTERN = /^[\s]*[[{]/;
const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3,8})$/;
const RGB_COLOR_PATTERN = /^rgba?\(\s*\d+/i;
const PHONE_PATTERN = /^[+]?[\d\s()-]{7,20}$/;
const PATH_WIN_PATTERN = /^[a-zA-Z]:\\[\w\\. -]+/; // eslint-disable-line no-useless-escape
const PATH_UNIX_PATTERN = /^\/[\w/. -]+/;
const MARKDOWN_PATTERN = /^(#{1,6}\s|[-*+]\s|\d+\.\s|```|>\s|\|.*\|)/m;
const HTML_PATTERN = /^<(!DOCTYPE|html|div|span|p|a|h[1-6]|ul|ol|table|img)\b/i;
const CODE_INDICATORS = [
  /\b(function|const|let|var|class|import|export|return|if|else|for|while)\b/,
  /[{};]\s*$/m,
  /^\s*(def |class |import |from |#include|package |public |private )/m,
  /=>\s*{/,
  /\(\)\s*{/,
];

export class ClipboardService {
  private db: any = null; // DatabaseService
  private toolsService: any = null;
  private configService: any = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastContent: string = '';
  private lastContentHash: string = '';
  private monitoring = false;
  private startedAt: string | null = null;
  private tableCreated = false;

  /**
   * Set dependencies after construction (DI wiring phase).
   */
  setDependencies(opts: { database?: any; toolsService?: any; configService?: any }): void {
    if (opts.database) this.db = opts.database;
    if (opts.toolsService) this.toolsService = opts.toolsService;
    if (opts.configService) this.configService = opts.configService;
  }

  /**
   * Initialize — create tables, register tools, optionally start monitoring.
   */
  async initialize(): Promise<void> {
    log.info('Initializing Smart Clipboard Pipeline...');

    this.ensureTable();
    this.registerTools();
    this.applyRetentionPolicy();

    // Auto-start monitoring if enabled in config
    const enabled = this.getConfigValue('clipboardMonitoring', false);
    if (enabled) {
      this.startMonitoring();
    }

    log.info('Clipboard service initialized');
  }

  /**
   * Shutdown — stop monitoring.
   */
  shutdown(): void {
    this.stopMonitoring();
    log.info('Clipboard service shut down');
  }

  // ─── Public API ───

  /**
   * Start clipboard monitoring (polling).
   */
  startMonitoring(): void {
    if (this.monitoring) return;

    // Capture current clipboard content to avoid recording it as "new"
    this.lastContent = clipboard.readText() || '';
    this.lastContentHash = this.hashContent(this.lastContent);
    this.monitoring = true;
    this.startedAt = new Date().toISOString();

    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL);
    log.info('Clipboard monitoring started');
  }

  /**
   * Stop clipboard monitoring.
   */
  stopMonitoring(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.monitoring = false;
    this.startedAt = null;
    log.info('Clipboard monitoring stopped');
  }

  /**
   * Get clipboard history (most recent first).
   */
  getHistory(limit = 50, offset = 0): ClipboardEntry[] {
    this.ensureTable();
    if (!this.db) return [];

    try {
      const raw = this.db.getDb();
      if (!raw) return [];

      const rows = raw
        .prepare(
          `SELECT * FROM clipboard_history
           ORDER BY pinned DESC, copied_at DESC
           LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as any[];

      return rows.map((r: any) => this.rowToEntry(r));
    } catch (err) {
      log.error('Failed to get clipboard history:', err);
      return [];
    }
  }

  /**
   * Search clipboard history with full-text search.
   */
  search(options: ClipboardSearchOptions): ClipboardEntry[] {
    this.ensureTable();
    if (!this.db) return [];

    try {
      const raw = this.db.getDb();
      if (!raw) return [];

      const conditions: string[] = [];
      const params: any[] = [];

      if (options.query) {
        // FTS5 search
        conditions.push(`id IN (SELECT id FROM clipboard_history_fts WHERE clipboard_history_fts MATCH ?)`);
        params.push(options.query);
      }

      if (options.contentType) {
        conditions.push(`content_type = ?`);
        params.push(options.contentType);
      }

      if (options.pinnedOnly) {
        conditions.push(`pinned = 1`);
      }

      if (options.since) {
        conditions.push(`copied_at >= ?`);
        params.push(options.since);
      }

      if (options.until) {
        conditions.push(`copied_at <= ?`);
        params.push(options.until);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = options.limit || 50;
      params.push(limit);

      const rows = raw
        .prepare(
          `SELECT * FROM clipboard_history
           ${where}
           ORDER BY pinned DESC, copied_at DESC
           LIMIT ?`,
        )
        .all(...params) as any[];

      return rows.map((r: any) => this.rowToEntry(r));
    } catch (err) {
      log.error('Failed to search clipboard history:', err);
      return [];
    }
  }

  /**
   * Pin/unpin a clipboard entry.
   */
  togglePin(entryId: string): boolean {
    this.ensureTable();
    if (!this.db) return false;

    try {
      const raw = this.db.getDb();
      if (!raw) return false;

      raw.prepare(`UPDATE clipboard_history SET pinned = NOT pinned WHERE id = ?`).run(entryId);

      return true;
    } catch (err) {
      log.error('Failed to toggle pin:', err);
      return false;
    }
  }

  /**
   * Delete a specific entry from history.
   */
  deleteEntry(entryId: string): boolean {
    this.ensureTable();
    if (!this.db) return false;

    try {
      const raw = this.db.getDb();
      if (!raw) return false;

      raw.prepare(`DELETE FROM clipboard_history WHERE id = ?`).run(entryId);
      return true;
    } catch (err) {
      log.error('Failed to delete entry:', err);
      return false;
    }
  }

  /**
   * Clear all non-pinned clipboard history.
   */
  clearHistory(): number {
    this.ensureTable();
    if (!this.db) return 0;

    try {
      const raw = this.db.getDb();
      if (!raw) return 0;

      const result = raw.prepare(`DELETE FROM clipboard_history WHERE pinned = 0`).run();

      log.info(`Cleared ${result.changes} clipboard entries`);
      return result.changes;
    } catch (err) {
      log.error('Failed to clear history:', err);
      return 0;
    }
  }

  /**
   * Get clipboard status.
   */
  getStatus(): ClipboardStatus {
    this.ensureTable();

    let totalEntries = 0;
    let pinnedEntries = 0;

    try {
      const raw = this.db?.getDb();
      if (raw) {
        const stats = raw
          .prepare(
            `SELECT
               COUNT(*) as total,
               SUM(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) as pinned
             FROM clipboard_history`,
          )
          .get() as any;
        totalEntries = stats?.total ?? 0;
        pinnedEntries = stats?.pinned ?? 0;
      }
    } catch {
      // ignore
    }

    return {
      monitoring: this.monitoring,
      totalEntries,
      pinnedEntries,
      startedAt: this.startedAt ?? undefined,
    };
  }

  /**
   * Manually add current clipboard content to history.
   * Used by clipboard_read tool enhancement.
   */
  captureNow(): ClipboardEntry | null {
    const text = clipboard.readText();
    if (!text || text.length < DEFAULT_MIN_LENGTH) return null;

    return this.recordEntry(text);
  }

  // ─── Content Type Detection ───

  /**
   * Detect the type of clipboard content.
   */
  static detectContentType(text: string): ClipboardContentType {
    const trimmed = text.trim();

    if (!trimmed) return 'unknown';

    // URL
    if (URL_PATTERN.test(trimmed)) return 'url';

    // Email
    if (EMAIL_PATTERN.test(trimmed)) return 'email';

    // Color (hex or rgb)
    if (HEX_COLOR_PATTERN.test(trimmed) || RGB_COLOR_PATTERN.test(trimmed)) return 'color';

    // Phone number
    if (PHONE_PATTERN.test(trimmed) && /\d{3,}/.test(trimmed)) return 'phone';

    // File path
    if (PATH_WIN_PATTERN.test(trimmed) || PATH_UNIX_PATTERN.test(trimmed)) return 'path';

    // JSON
    if (JSON_PATTERN.test(trimmed)) {
      try {
        JSON.parse(trimmed);
        return 'json';
      } catch {
        // Not valid JSON, might be code
      }
    }

    // HTML
    if (HTML_PATTERN.test(trimmed)) return 'html';

    // Markdown
    if (MARKDOWN_PATTERN.test(trimmed)) return 'markdown';

    // Number
    if (/^-?[\d,. ]+([eE][+-]?\d+)?$/.test(trimmed) && trimmed.length < 30) return 'number';

    // Code — check multiple indicators
    const codeScore = CODE_INDICATORS.reduce((score, pattern) => score + (pattern.test(trimmed) ? 1 : 0), 0);
    if (codeScore >= 2) return 'code';

    return 'text';
  }

  // ─── Private: Polling ───

  private poll(): void {
    try {
      const text = clipboard.readText();
      if (!text) return;

      const hash = this.hashContent(text);

      // Skip if same as last content
      if (hash === this.lastContentHash) return;

      this.lastContent = text;
      this.lastContentHash = hash;

      // Skip if too short
      const minLength = this.getConfigValue('clipboardMinLength', DEFAULT_MIN_LENGTH);
      if (text.length < minLength) return;

      // Skip if too long
      if (text.length > MAX_CONTENT_LENGTH) {
        log.warn(`Clipboard content too long (${text.length} chars), skipping`);
        return;
      }

      this.recordEntry(text);
    } catch (err) {
      // Silent — polling should never crash
    }
  }

  private recordEntry(text: string): ClipboardEntry | null {
    this.ensureTable();
    if (!this.db) return null;

    try {
      const raw = this.db.getDb();
      if (!raw) return null;

      const hash = this.hashContent(text);

      // Deduplication — skip if same content already exists recently (last 24h)
      const existing = raw
        .prepare(
          `SELECT id FROM clipboard_history
           WHERE content_hash = ? AND copied_at > datetime('now', '-1 day')`,
        )
        .get(hash) as any;

      if (existing) {
        // Update timestamp of existing entry instead of creating duplicate
        raw.prepare(`UPDATE clipboard_history SET copied_at = datetime('now') WHERE id = ?`).run(existing.id);
        return null;
      }

      const id = randomUUID();
      const contentType = ClipboardService.detectContentType(text);
      const preview = text.slice(0, PREVIEW_LENGTH).replace(/\n/g, ' ');

      const entry: ClipboardEntry = {
        id,
        content: text,
        contentType,
        preview,
        byteLength: Buffer.byteLength(text, 'utf-8'),
        charCount: text.length,
        copiedAt: new Date().toISOString(),
        pinned: false,
        contentHash: hash,
      };

      raw
        .prepare(
          `INSERT INTO clipboard_history
           (id, content, content_type, preview, byte_length, char_count, copied_at, pinned, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(
          entry.id,
          entry.content,
          entry.contentType,
          entry.preview,
          entry.byteLength,
          entry.charCount,
          entry.copiedAt,
          entry.contentHash,
        );

      // Enforce max history limit
      const maxHistory = this.getConfigValue('clipboardMaxHistory', DEFAULT_MAX_HISTORY);
      raw
        .prepare(
          `DELETE FROM clipboard_history
           WHERE pinned = 0 AND id NOT IN (
             SELECT id FROM clipboard_history ORDER BY pinned DESC, copied_at DESC LIMIT ?
           )`,
        )
        .run(maxHistory);

      return entry;
    } catch (err) {
      log.error('Failed to record clipboard entry:', err);
      return null;
    }
  }

  // ─── Private: Database ───

  private ensureTable(): void {
    if (this.tableCreated || !this.db) return;

    try {
      const raw = this.db.getDb();
      if (!raw) return;

      raw.exec(`
        CREATE TABLE IF NOT EXISTS clipboard_history (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'text',
          preview TEXT NOT NULL DEFAULT '',
          byte_length INTEGER NOT NULL DEFAULT 0,
          char_count INTEGER NOT NULL DEFAULT 0,
          copied_at TEXT NOT NULL DEFAULT (datetime('now')),
          source_app TEXT,
          pinned INTEGER NOT NULL DEFAULT 0,
          enrichment TEXT,
          content_hash TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_clipboard_copied
          ON clipboard_history(copied_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clipboard_type
          ON clipboard_history(content_type);
        CREATE INDEX IF NOT EXISTS idx_clipboard_hash
          ON clipboard_history(content_hash);
        CREATE INDEX IF NOT EXISTS idx_clipboard_pinned
          ON clipboard_history(pinned);

        -- FTS5 full-text search on clipboard content
        CREATE VIRTUAL TABLE IF NOT EXISTS clipboard_history_fts USING fts5(
          content,
          preview,
          content='clipboard_history',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS clipboard_fts_ai AFTER INSERT ON clipboard_history BEGIN
          INSERT INTO clipboard_history_fts(rowid, content, preview)
          VALUES (new.rowid, new.content, new.preview);
        END;

        CREATE TRIGGER IF NOT EXISTS clipboard_fts_ad AFTER DELETE ON clipboard_history BEGIN
          INSERT INTO clipboard_history_fts(clipboard_history_fts, rowid, content, preview)
          VALUES('delete', old.rowid, old.content, old.preview);
        END;

        CREATE TRIGGER IF NOT EXISTS clipboard_fts_au AFTER UPDATE ON clipboard_history BEGIN
          INSERT INTO clipboard_history_fts(clipboard_history_fts, rowid, content, preview)
          VALUES('delete', old.rowid, old.content, old.preview);
          INSERT INTO clipboard_history_fts(rowid, content, preview)
          VALUES (new.rowid, new.content, new.preview);
        END;
      `);

      this.tableCreated = true;
    } catch (err) {
      log.error('Failed to create clipboard tables:', err);
    }
  }

  private applyRetentionPolicy(): void {
    if (!this.db) return;

    try {
      const raw = this.db.getDb();
      if (!raw) return;

      const retentionDays = this.getConfigValue('clipboardRetentionDays', DEFAULT_RETENTION_DAYS);
      if (retentionDays <= 0) return;

      const result = raw
        .prepare(
          `DELETE FROM clipboard_history
           WHERE pinned = 0 AND copied_at < datetime('now', '-' || ? || ' days')`,
        )
        .run(retentionDays);

      if (result.changes > 0) {
        log.info(`Retention policy: deleted ${result.changes} old clipboard entries`);
      }
    } catch (err) {
      log.error('Failed to apply retention policy:', err);
    }
  }

  // ─── Private: Helpers ───

  private hashContent(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
  }

  private getConfigValue<T>(key: string, fallback: T): T {
    try {
      if (this.configService?.get) {
        return this.configService.get(key) ?? fallback;
      }
    } catch {
      // ignore
    }
    return fallback;
  }

  private rowToEntry(row: any): ClipboardEntry {
    return {
      id: row.id,
      content: row.content,
      contentType: row.content_type as ClipboardContentType,
      preview: row.preview,
      byteLength: row.byte_length,
      charCount: row.char_count,
      copiedAt: row.copied_at,
      sourceApp: row.source_app ?? undefined,
      pinned: row.pinned === 1,
      enrichment: row.enrichment ?? undefined,
      contentHash: row.content_hash,
    };
  }

  // ─── AI Tools Registration ───

  private registerTools(): void {
    if (!this.toolsService) return;

    const register = (def: ToolDefinition, handler: (params: any) => Promise<ToolResult>) => {
      this.toolsService.register(def, handler);
    };

    register(
      {
        name: 'clipboard_history',
        description:
          'Pobiera historię schowka. Pokazuje ostatnio skopiowane teksty z wykrytym typem (URL, email, kod, JSON, itp.). Opt-in: użytkownik musi włączyć monitoring w ustawieniach.',
        category: 'system',
        parameters: {
          limit: {
            type: 'number',
            description: 'Maksymalna liczba wyników (domyślnie 20)',
            required: false,
          },
          content_type: {
            type: 'string',
            description: 'Filtruj po typie: url, email, code, json, path, color, phone, text, markdown, html',
            required: false,
          },
        },
      },
      async (params) => {
        const options: ClipboardSearchOptions = {
          limit: params.limit || 20,
          contentType: params.content_type,
        };

        const entries = this.search(options);

        if (entries.length === 0) {
          const status = this.getStatus();
          if (!status.monitoring) {
            return {
              success: true,
              data: 'Monitoring schowka jest wyłączony. Użytkownik może go włączyć w ustawieniach. Bieżącą zawartość schowka możesz odczytać narzędziem clipboard_read.',
            };
          }
          return { success: true, data: 'Historia schowka jest pusta.' };
        }

        const formatted = entries.map((e, i) => {
          const pinIcon = e.pinned ? '📌 ' : '';
          const time = new Date(e.copiedAt).toLocaleString('pl-PL');
          return `${i + 1}. ${pinIcon}[${e.contentType}] (${time})\n   ${e.preview}`;
        });

        return {
          success: true,
          data: `Historia schowka (${entries.length} wpisów):\n\n${formatted.join('\n\n')}`,
        };
      },
    );

    register(
      {
        name: 'clipboard_search',
        description:
          'Wyszukuje w historii schowka — pełnotekstowe wyszukiwanie w skopiowanych treściach. Przydatne do znalezienia wcześniej skopiowanego URL, fragmentu kodu, numeru telefonu itp.',
        category: 'system',
        parameters: {
          query: {
            type: 'string',
            description: 'Fraza do wyszukania w historii schowka',
            required: true,
          },
          limit: {
            type: 'number',
            description: 'Maksymalna liczba wyników (domyślnie 10)',
            required: false,
          },
        },
      },
      async (params) => {
        const entries = this.search({
          query: params.query,
          limit: params.limit || 10,
        });

        if (entries.length === 0) {
          return {
            success: true,
            data: `Nie znaleziono wyników dla: "${params.query}"`,
          };
        }

        const formatted = entries.map((e, i) => {
          const pinIcon = e.pinned ? '📌 ' : '';
          const time = new Date(e.copiedAt).toLocaleString('pl-PL');
          return `${i + 1}. ${pinIcon}[${e.contentType}] (${time})\n   ${e.preview}\n   ID: ${e.id}`;
        });

        return {
          success: true,
          data: `Wyniki wyszukiwania "${params.query}" (${entries.length}):\n\n${formatted.join('\n\n')}`,
        };
      },
    );

    register(
      {
        name: 'clipboard_pin',
        description: 'Przypina/odpina wpis w historii schowka. Przypięte wpisy nie są usuwane przez politykę retencji.',
        category: 'system',
        parameters: {
          entry_id: {
            type: 'string',
            description: 'ID wpisu do przypięcia/odpięcia (z clipboard_history/clipboard_search)',
            required: true,
          },
        },
      },
      async (params) => {
        const success = this.togglePin(params.entry_id);
        return {
          success,
          data: success ? 'Zmieniono status przypięcia.' : 'Nie znaleziono wpisu o podanym ID.',
        };
      },
    );

    register(
      {
        name: 'clipboard_clear',
        description:
          'Czyści historię schowka (nie usuwa przypiętych wpisów). Użyj gdy użytkownik chce wyczyścić historię.',
        category: 'system',
        parameters: {},
      },
      async () => {
        const count = this.clearHistory();
        return {
          success: true,
          data: `Usunięto ${count} wpisów z historii schowka. Przypięte wpisy zostały zachowane.`,
        };
      },
    );

    register(
      {
        name: 'clipboard_analyze',
        description:
          'Analizuje bieżącą zawartość schowka — wykrywa typ (URL, email, JSON, kod, ścieżka, kolor, telefon, markdown), formatuje, i zwraca szczegóły. Przydatne jako "co mam w schowku?".',
        category: 'system',
        parameters: {},
      },
      async () => {
        const text = clipboard.readText();
        if (!text || text.trim().length === 0) {
          return { success: true, data: 'Schowek jest pusty.' };
        }

        const contentType = ClipboardService.detectContentType(text);
        const byteLength = Buffer.byteLength(text, 'utf-8');
        const lines = text.split('\n').length;

        let analysis = `**Typ:** ${contentType}\n`;
        analysis += `**Długość:** ${text.length} znaków, ${byteLength} bajtów, ${lines} linii\n\n`;

        // Type-specific analysis
        switch (contentType) {
          case 'url':
            try {
              const url = new URL(text.trim());
              analysis += `**Protokół:** ${url.protocol}\n`;
              analysis += `**Host:** ${url.hostname}\n`;
              analysis += `**Ścieżka:** ${url.pathname}\n`;
              if (url.search) analysis += `**Query:** ${url.search}\n`;
            } catch {
              analysis += `**URL:** ${text.trim()}\n`;
            }
            break;

          case 'json':
            try {
              const parsed = JSON.parse(text.trim());
              const type = Array.isArray(parsed) ? 'tablica' : 'obiekt';
              const keys = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
              analysis += `**JSON ${type}:** ${keys} ${Array.isArray(parsed) ? 'elementów' : 'kluczy'}\n`;
              analysis += `**Sformatowany:**\n\`\`\`json\n${JSON.stringify(parsed, null, 2).slice(0, 500)}\n\`\`\`\n`;
            } catch {
              analysis += `**Uwaga:** Wygląda jak JSON, ale ma błąd składni.\n`;
            }
            break;

          case 'email':
            analysis += `**Adres email:** ${text.trim()}\n`;
            break;

          case 'color':
            analysis += `**Kolor:** ${text.trim()}\n`;
            break;

          case 'code':
            analysis += `**Fragment kodu** (${lines} linii)\n`;
            analysis += `\`\`\`\n${text.slice(0, 500)}\n\`\`\`\n`;
            break;

          case 'path':
            analysis += `**Ścieżka do pliku:** ${text.trim()}\n`;
            break;

          case 'phone':
            analysis += `**Numer telefonu:** ${text.trim()}\n`;
            break;

          default:
            analysis += `**Podgląd:**\n${text.slice(0, 300)}\n`;
        }

        // Also record it if monitoring is on
        if (this.monitoring) {
          this.recordEntry(text);
        }

        return { success: true, data: analysis };
      },
    );

    log.info('Registered 5 clipboard AI tools');
  }
}
