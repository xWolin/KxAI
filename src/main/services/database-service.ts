/**
 * DatabaseService — SQLite-backed persistent storage for KxAI.
 *
 * Replaces JSON session files with a proper SQLite database using better-sqlite3.
 * Provides: conversation storage, FTS5 full-text search, retention policies, WAL mode.
 *
 * Markdown memory files (SOUL.md, USER.md, MEMORY.md, HEARTBEAT.md) remain file-based.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { createLogger } from './logger';
import type { ConversationMessage } from '../../shared/types/ai';

const log = createLogger('DatabaseService');

// ─── Schema version for migrations ───
const SCHEMA_VERSION = 1;

// ─── Retention defaults ───
const DEFAULT_ARCHIVE_DAYS = 30;
const DEFAULT_DELETE_DAYS = 90;
const MAX_SESSION_MESSAGES = 500;

export interface MessageRow {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  type: string;
  session_date: string;
  token_count: number | null;
  importance: number;
  metadata: string | null;
}

export interface SessionInfo {
  session_date: string;
  message_count: number;
  first_message: number;
  last_message: number;
  total_tokens: number;
}

export interface SearchResult {
  message: ConversationMessage;
  rank: number;
  snippet: string;
}

export class DatabaseService {
  private db: Database.Database | null = null;
  private dbPath: string;
  private stmtCache: Map<string, Database.Statement> = new Map();

  constructor() {
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'workspace', 'kxai.db');
  }

  // ─── Lifecycle ───

  initialize(): void {
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    log.info(`Opening database at ${this.dbPath}`);

    this.db = new Database(this.dbPath);

    // Performance settings
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('temp_store = MEMORY');

    this.runMigrations();
    this.prepareStatements();

    log.info('Database initialized successfully');
  }

  close(): void {
    if (this.db) {
      this.stmtCache.clear();
      try {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        this.db.close();
        log.info('Database closed');
      } catch (err) {
        log.error('Error closing database:', err);
      }
      this.db = null;
    }
  }

  // ─── Migrations ───

  private runMigrations(): void {
    if (!this.db) return;

    // Create migrations table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const currentVersion =
      this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
    const version = currentVersion?.v ?? 0;

    if (version < 1) {
      this.migrateV1();
    }

    // Future migrations go here:
    // if (version < 2) this.migrateV2();
  }

  private migrateV1(): void {
    if (!this.db) return;

    log.info('Running migration v1: initial schema');

    this.db.exec(`
      -- Main messages table
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'developer')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'chat',
        session_date TEXT NOT NULL,
        token_count INTEGER,
        importance REAL NOT NULL DEFAULT 0.5,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_date);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
      CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
      CREATE INDEX IF NOT EXISTS idx_messages_importance ON messages(importance);

      -- FTS5 full-text search on message content
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      -- Session metadata table
      CREATE TABLE IF NOT EXISTS sessions (
        session_date TEXT PRIMARY KEY,
        summary TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        message_count INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Record schema version
      INSERT INTO schema_version (version) VALUES (1);
    `);

    log.info('Migration v1 complete');
  }

  // ─── Prepared Statements ───

  private prepareStatements(): void {
    if (!this.db) return;

    this.stmtCache.set(
      'insertMessage',
      this.db.prepare(`
        INSERT OR REPLACE INTO messages (id, role, content, timestamp, type, session_date, token_count, importance, metadata)
        VALUES (@id, @role, @content, @timestamp, @type, @session_date, @token_count, @importance, @metadata)
      `),
    );

    this.stmtCache.set(
      'getSessionMessages',
      this.db.prepare(`
        SELECT * FROM messages WHERE session_date = ? ORDER BY timestamp ASC
      `),
    );

    this.stmtCache.set(
      'getRecentMessages',
      this.db.prepare(`
        SELECT * FROM messages WHERE session_date = ? ORDER BY timestamp DESC LIMIT ?
      `),
    );

    this.stmtCache.set(
      'deleteSessionMessages',
      this.db.prepare(`
        DELETE FROM messages WHERE session_date = ?
      `),
    );

    this.stmtCache.set(
      'countSessionMessages',
      this.db.prepare(`
        SELECT COUNT(*) as count FROM messages WHERE session_date = ?
      `),
    );

    this.stmtCache.set(
      'getSessionDates',
      this.db.prepare(`
        SELECT DISTINCT session_date FROM messages ORDER BY session_date DESC
      `),
    );

    this.stmtCache.set(
      'searchMessages',
      this.db.prepare(`
        SELECT m.*, rank
        FROM messages_fts fts
        JOIN messages m ON m.rowid = fts.rowid
        WHERE messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `),
    );

    this.stmtCache.set(
      'upsertSession',
      this.db.prepare(`
        INSERT INTO sessions (session_date, message_count, total_tokens, updated_at)
        VALUES (@session_date, @message_count, @total_tokens, datetime('now'))
        ON CONFLICT(session_date) DO UPDATE SET
          message_count = @message_count,
          total_tokens = @total_tokens,
          updated_at = datetime('now')
      `),
    );

    this.stmtCache.set(
      'getSessionInfo',
      this.db.prepare(`
        SELECT session_date,
               COUNT(*) as message_count,
               MIN(timestamp) as first_message,
               MAX(timestamp) as last_message,
               COALESCE(SUM(token_count), 0) as total_tokens
        FROM messages
        WHERE session_date = ?
        GROUP BY session_date
      `),
    );

    this.stmtCache.set(
      'deleteOldMessages',
      this.db.prepare(`
        DELETE FROM messages WHERE session_date < ?
      `),
    );

    this.stmtCache.set(
      'archiveSessions',
      this.db.prepare(`
        UPDATE sessions SET archived = 1 WHERE session_date < ? AND archived = 0
      `),
    );
  }

  private getStmt(name: string): Database.Statement {
    const stmt = this.stmtCache.get(name);
    if (!stmt) throw new Error(`Prepared statement '${name}' not found`);
    return stmt;
  }

  // ─── Message Operations ───

  /**
   * Save a single message to the database.
   */
  saveMessage(message: ConversationMessage, sessionDate?: string): void {
    if (!this.db) return;

    const date = sessionDate ?? this.getTodayDate();

    try {
      this.getStmt('insertMessage').run({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        type: message.type || 'chat',
        session_date: date,
        token_count: message.tokenCount ?? null,
        importance: message.importance ?? 0.5,
        metadata: message.metadata ? JSON.stringify(message.metadata) : null,
      });
    } catch (err) {
      log.error(`Failed to save message ${message.id}:`, err);
    }
  }

  /**
   * Save multiple messages in a single transaction (much faster).
   */
  saveMessages(messages: ConversationMessage[], sessionDate?: string): void {
    if (!this.db || messages.length === 0) return;

    const date = sessionDate ?? this.getTodayDate();

    const transaction = this.db.transaction((msgs: ConversationMessage[]) => {
      for (const msg of msgs) {
        this.getStmt('insertMessage').run({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          type: msg.type || 'chat',
          session_date: date,
          token_count: msg.tokenCount ?? null,
          importance: msg.importance ?? 0.5,
          metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
        });
      }

      // Update session metadata
      const count = this.getStmt('countSessionMessages').get(date) as { count: number };
      this.getStmt('upsertSession').run({
        session_date: date,
        message_count: count.count,
        total_tokens: 0, // Will be calculated lazily
      });
    });

    try {
      transaction(messages);
    } catch (err) {
      log.error('Failed to save messages batch:', err);
    }
  }

  /**
   * Get all messages for a given session date.
   */
  getSessionMessages(sessionDate?: string): ConversationMessage[] {
    if (!this.db) return [];

    const date = sessionDate ?? this.getTodayDate();

    try {
      const rows = this.getStmt('getSessionMessages').all(date) as MessageRow[];
      return rows.map((row) => this.rowToMessage(row));
    } catch (err) {
      log.error('Failed to get session messages:', err);
      return [];
    }
  }

  /**
   * Get the N most recent messages for a given session (returned in chronological order).
   */
  getRecentMessages(count: number, sessionDate?: string): ConversationMessage[] {
    if (!this.db) return [];

    const date = sessionDate ?? this.getTodayDate();

    try {
      const rows = this.getStmt('getRecentMessages').all(date, count) as MessageRow[];
      // Reverse because query returns DESC
      return rows.reverse().map((row) => this.rowToMessage(row));
    } catch (err) {
      log.error('Failed to get recent messages:', err);
      return [];
    }
  }

  /**
   * Delete all messages for a given session date.
   */
  clearSession(sessionDate?: string): void {
    if (!this.db) return;

    const date = sessionDate ?? this.getTodayDate();

    try {
      this.getStmt('deleteSessionMessages').run(date);
      log.info(`Cleared session ${date}`);
    } catch (err) {
      log.error('Failed to clear session:', err);
    }
  }

  /**
   * Replace all messages for a session with new ones (used by compactHistory).
   */
  replaceSessionMessages(messages: ConversationMessage[], sessionDate?: string): void {
    if (!this.db) return;

    const date = sessionDate ?? this.getTodayDate();

    const transaction = this.db.transaction(() => {
      this.getStmt('deleteSessionMessages').run(date);

      for (const msg of messages) {
        this.getStmt('insertMessage').run({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          type: msg.type || 'chat',
          session_date: date,
          token_count: msg.tokenCount ?? null,
          importance: msg.importance ?? 0.5,
          metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
        });
      }
    });

    try {
      transaction();
    } catch (err) {
      log.error('Failed to replace session messages:', err);
    }
  }

  // ─── Search ───

  /**
   * Full-text search across all messages using FTS5.
   */
  searchMessages(query: string, limit: number = 20): SearchResult[] {
    if (!this.db || !query.trim()) return [];

    try {
      // Sanitize FTS5 query — escape special characters
      const sanitized = query.replace(/['"*()]/g, ' ').trim();
      if (!sanitized) return [];

      const rows = this.getStmt('searchMessages').all(sanitized, limit) as (MessageRow & { rank: number })[];

      return rows.map((row) => ({
        message: this.rowToMessage(row),
        rank: row.rank,
        snippet: this.extractSnippet(row.content, sanitized),
      }));
    } catch (err) {
      log.error('FTS search failed:', err);
      return [];
    }
  }

  // ─── Session Management ───

  /**
   * List all session dates.
   */
  getSessionDates(): string[] {
    if (!this.db) return [];

    try {
      const rows = this.getStmt('getSessionDates').all() as { session_date: string }[];
      return rows.map((r) => r.session_date);
    } catch (err) {
      log.error('Failed to get session dates:', err);
      return [];
    }
  }

  /**
   * Get info about a specific session.
   */
  getSessionInfo(sessionDate?: string): SessionInfo | null {
    if (!this.db) return null;

    const date = sessionDate ?? this.getTodayDate();

    try {
      return (this.getStmt('getSessionInfo').get(date) as SessionInfo) ?? null;
    } catch (err) {
      log.error('Failed to get session info:', err);
      return null;
    }
  }

  // ─── Retention ───

  /**
   * Apply retention policy: archive old sessions, delete very old ones.
   */
  applyRetentionPolicy(archiveDays: number = DEFAULT_ARCHIVE_DAYS, deleteDays: number = DEFAULT_DELETE_DAYS): { archived: number; deleted: number } {
    if (!this.db) return { archived: 0, deleted: 0 };

    const now = new Date();

    const archiveCutoff = new Date(now);
    archiveCutoff.setDate(archiveCutoff.getDate() - archiveDays);
    const archiveDate = this.formatDate(archiveCutoff);

    const deleteCutoff = new Date(now);
    deleteCutoff.setDate(deleteCutoff.getDate() - deleteDays);
    const deleteDate = this.formatDate(deleteCutoff);

    try {
      const deleted = this.getStmt('deleteOldMessages').run(deleteDate);
      const archived = this.getStmt('archiveSessions').run(archiveDate);

      if (deleted.changes > 0 || archived.changes > 0) {
        log.info(`Retention policy: archived ${archived.changes} sessions, deleted ${deleted.changes} old messages`);
      }

      return { archived: archived.changes, deleted: deleted.changes };
    } catch (err) {
      log.error('Failed to apply retention policy:', err);
      return { archived: 0, deleted: 0 };
    }
  }

  // ─── Migration: Import JSON Sessions ───

  /**
   * Import old JSON session files into SQLite.
   * Reads sessions/*.json from workspace and inserts into database.
   */
  importJsonSessions(workspacePath: string): number {
    const sessionsDir = path.join(workspacePath, 'sessions');
    if (!fs.existsSync(sessionsDir)) return 0;

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
    let imported = 0;

    for (const file of files) {
      const sessionDate = file.replace('.json', '');
      const filePath = path.join(sessionsDir, file);

      try {
        // Check if session already imported
        const existing = this.getStmt('countSessionMessages').get(sessionDate) as { count: number };
        if (existing.count > 0) continue;

        const data = fs.readFileSync(filePath, 'utf8');
        const messages: ConversationMessage[] = JSON.parse(data);

        if (messages.length > 0) {
          this.saveMessages(messages, sessionDate);
          imported++;
          log.info(`Imported session ${sessionDate} (${messages.length} messages)`);
        }
      } catch (err) {
        log.warn(`Failed to import session ${file}:`, err);
      }
    }

    if (imported > 0) {
      log.info(`Imported ${imported} JSON sessions into SQLite`);
    }

    return imported;
  }

  // ─── Stats ───

  /**
   * Get database statistics.
   */
  getStats(): { totalMessages: number; totalSessions: number; dbSizeBytes: number } {
    if (!this.db) return { totalMessages: 0, totalSessions: 0, dbSizeBytes: 0 };

    try {
      const messages = this.db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
      const sessions = this.db.prepare('SELECT COUNT(DISTINCT session_date) as count FROM messages').get() as { count: number };

      let dbSize = 0;
      if (fs.existsSync(this.dbPath)) {
        dbSize = fs.statSync(this.dbPath).size;
      }

      return {
        totalMessages: messages.count,
        totalSessions: sessions.count,
        dbSizeBytes: dbSize,
      };
    } catch (err) {
      log.error('Failed to get stats:', err);
      return { totalMessages: 0, totalSessions: 0, dbSizeBytes: 0 };
    }
  }

  // ─── Helpers ───

  private getTodayDate(): string {
    return this.formatDate(new Date());
  }

  private formatDate(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private rowToMessage(row: MessageRow): ConversationMessage {
    const msg: ConversationMessage = {
      id: row.id,
      role: row.role as ConversationMessage['role'],
      content: row.content,
      timestamp: row.timestamp,
      type: row.type as ConversationMessage['type'],
    };

    if (row.token_count !== null) {
      (msg as any).tokenCount = row.token_count;
    }
    if (row.importance !== 0.5) {
      (msg as any).importance = row.importance;
    }
    if (row.metadata) {
      try {
        (msg as any).metadata = JSON.parse(row.metadata);
      } catch {
        // Ignore invalid JSON metadata
      }
    }

    return msg;
  }

  private extractSnippet(content: string, query: string): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerContent.indexOf(lowerQuery);

    if (idx === -1) {
      return content.slice(0, 200);
    }

    const start = Math.max(0, idx - 80);
    const end = Math.min(content.length, idx + query.length + 80);
    let snippet = content.slice(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';

    return snippet;
  }

  /**
   * Check if database is open and operational.
   */
  isReady(): boolean {
    return this.db !== null && this.db.open;
  }
}
