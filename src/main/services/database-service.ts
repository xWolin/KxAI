/**
 * DatabaseService — SQLite-backed persistent storage for KxAI.
 *
 * Replaces JSON session files with a proper SQLite database using better-sqlite3.
 * Provides: conversation storage, FTS5 full-text search, retention policies, WAL mode.
 * v2: RAG chunk storage, embedding cache (BLOB), vector search via sqlite-vec (vec0).
 *
 * Markdown memory files (SOUL.md, USER.md, MEMORY.md, HEARTBEAT.md) remain file-based.
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { createLogger } from './logger';
import type { ConversationMessage } from '../../shared/types/ai';
import type { RAGChunk } from '../../shared/types/rag';

const log = createLogger('DatabaseService');

// ─── Schema version for migrations ───
const SCHEMA_VERSION = 2;

// ─── Embedding dimensions ───
const EMBEDDING_DIM_OPENAI = 1536; // text-embedding-3-small
const EMBEDDING_DIM_TFIDF = 256;   // TF-IDF fallback

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

// ─── RAG types ───

export interface RAGChunkRow {
  id: string;
  file_path: string;
  file_name: string;
  section: string;
  content: string;
  char_count: number;
  source_folder: string;
  file_type: string;
  mtime: number;
  created_at: string;
}

export interface EmbeddingCacheRow {
  content_hash: string;
  embedding: Buffer;
  dimension: number;
  model: string;
  last_used: number;
}

export interface HybridSearchResult {
  chunkId: string;
  filePath: string;
  fileName: string;
  section: string;
  content: string;
  charCount: number;
  sourceFolder: string;
  fileType: string;
  mtime: number;
  vectorScore: number;   // 0-1 (converted from distance)
  keywordScore: number;  // 0-1 (from FTS5 rank)
  combinedScore: number; // weighted fusion
}

export class DatabaseService {
  private db: Database.Database | null = null;
  private dbPath: string;
  private stmtCache: Map<string, Database.Statement> = new Map();
  private vec0Loaded = false;
  private embeddingDim: number = EMBEDDING_DIM_OPENAI;

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

    // Load sqlite-vec extension for vector search
    try {
      sqliteVec.load(this.db);
      this.vec0Loaded = true;
      log.info('sqlite-vec extension loaded');
    } catch (err) {
      log.error('Failed to load sqlite-vec extension:', err);
      this.vec0Loaded = false;
    }

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

    if (version < 2) {
      this.migrateV2();
    }

    // Future migrations go here:
    // if (version < 3) this.migrateV3();
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

  private migrateV2(): void {
    if (!this.db) return;

    log.info('Running migration v2: RAG tables + embedding cache + sqlite-vec');

    // ─── RAG chunks table ───
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        section TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        char_count INTEGER NOT NULL DEFAULT 0,
        source_folder TEXT NOT NULL DEFAULT 'workspace',
        file_type TEXT NOT NULL DEFAULT '',
        mtime INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_rag_chunks_file ON rag_chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_folder ON rag_chunks(source_folder);
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_type ON rag_chunks(file_type);

      -- FTS5 for keyword search on chunk content
      CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
        content,
        section,
        file_name,
        content='rag_chunks',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS rag_fts_ai AFTER INSERT ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rowid, content, section, file_name)
        VALUES (new.rowid, new.content, new.section, new.file_name);
      END;

      CREATE TRIGGER IF NOT EXISTS rag_fts_ad AFTER DELETE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content, section, file_name)
        VALUES('delete', old.rowid, old.content, old.section, old.file_name);
      END;

      CREATE TRIGGER IF NOT EXISTS rag_fts_au AFTER UPDATE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content, section, file_name)
        VALUES('delete', old.rowid, old.content, old.section, old.file_name);
        INSERT INTO rag_chunks_fts(rowid, content, section, file_name)
        VALUES (new.rowid, new.content, new.section, new.file_name);
      END;

      -- Embedding cache: replaces JSON file (embedding-cache.json)
      CREATE TABLE IF NOT EXISTS embedding_cache (
        content_hash TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        dimension INTEGER NOT NULL,
        model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
        last_used INTEGER NOT NULL DEFAULT (unixepoch()),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_embedding_cache_used ON embedding_cache(last_used);

      -- RAG folder tracking
      CREATE TABLE IF NOT EXISTS rag_folders (
        folder_path TEXT PRIMARY KEY,
        file_count INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        last_indexed INTEGER NOT NULL DEFAULT 0
      );
    `);

    // ─── sqlite-vec virtual table for vector search ───
    if (this.vec0Loaded) {
      try {
        // vec0 table with cosine distance metric for semantic search
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS rag_embeddings USING vec0(
            chunk_id TEXT PRIMARY KEY,
            embedding float[${EMBEDDING_DIM_OPENAI}] distance_metric=cosine
          );
        `);
        log.info('Created rag_embeddings vec0 table (cosine, float[1536])');
      } catch (err) {
        log.error('Failed to create vec0 table:', err);
      }
    } else {
      log.warn('sqlite-vec not loaded — vector search will use fallback linear scan');
    }

    // Record schema version
    this.db.exec(`INSERT INTO schema_version (version) VALUES (2);`);
    log.info('Migration v2 complete');
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

  /**
   * Check if sqlite-vec extension is loaded (vec0 available).
   */
  hasVectorSearch(): boolean {
    return this.vec0Loaded;
  }

  /**
   * Get the raw better-sqlite3 database handle (for advanced queries).
   */
  getDb(): Database.Database | null {
    return this.db;
  }

  // ═══════════════════════════════════════════════════════
  // ─── RAG Chunk Operations ───
  // ═══════════════════════════════════════════════════════

  /**
   * Insert or replace a single RAG chunk (metadata only, no embedding).
   */
  upsertChunk(chunk: RAGChunk): void {
    if (!this.db) return;

    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO rag_chunks (id, file_path, file_name, section, content, char_count, source_folder, file_type, mtime)
        VALUES (@id, @file_path, @file_name, @section, @content, @char_count, @source_folder, @file_type, @mtime)
      `).run({
        id: chunk.id,
        file_path: chunk.filePath,
        file_name: chunk.fileName,
        section: chunk.section,
        content: chunk.content,
        char_count: chunk.charCount,
        source_folder: chunk.sourceFolder ?? 'workspace',
        file_type: chunk.fileType ?? '',
        mtime: chunk.mtime ?? 0,
      });
    } catch (err) {
      log.error(`Failed to upsert chunk ${chunk.id}:`, err);
    }
  }

  /**
   * Bulk insert RAG chunks in a single transaction (much faster).
   */
  upsertChunks(chunks: RAGChunk[]): void {
    if (!this.db || chunks.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO rag_chunks (id, file_path, file_name, section, content, char_count, source_folder, file_type, mtime)
      VALUES (@id, @file_path, @file_name, @section, @content, @char_count, @source_folder, @file_type, @mtime)
    `);

    const transaction = this.db.transaction((chs: RAGChunk[]) => {
      for (const chunk of chs) {
        stmt.run({
          id: chunk.id,
          file_path: chunk.filePath,
          file_name: chunk.fileName,
          section: chunk.section,
          content: chunk.content,
          char_count: chunk.charCount,
          source_folder: chunk.sourceFolder ?? 'workspace',
          file_type: chunk.fileType ?? '',
          mtime: chunk.mtime ?? 0,
        });
      }
    });

    try {
      transaction(chunks);
      log.info(`Upserted ${chunks.length} RAG chunks`);
    } catch (err) {
      log.error('Failed to upsert chunks batch:', err);
    }
  }

  /**
   * Store vector embedding for a chunk in vec0 table.
   */
  upsertChunkEmbedding(chunkId: string, embedding: number[]): void {
    if (!this.db || !this.vec0Loaded) return;

    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO rag_embeddings (chunk_id, embedding)
        VALUES (?, ?)
      `).run(chunkId, new Float32Array(embedding));
    } catch (err) {
      log.error(`Failed to upsert embedding for chunk ${chunkId}:`, err);
    }
  }

  /**
   * Bulk insert chunk embeddings in a transaction.
   */
  upsertChunkEmbeddings(entries: Array<{ chunkId: string; embedding: number[] }>): void {
    if (!this.db || !this.vec0Loaded || entries.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO rag_embeddings (chunk_id, embedding)
      VALUES (?, ?)
    `);

    const transaction = this.db.transaction((items: typeof entries) => {
      for (const { chunkId, embedding } of items) {
        stmt.run(chunkId, new Float32Array(embedding));
      }
    });

    try {
      transaction(entries);
      log.info(`Upserted ${entries.length} chunk embeddings`);
    } catch (err) {
      log.error('Failed to upsert chunk embeddings batch:', err);
    }
  }

  /**
   * KNN vector search — finds nearest chunks using sqlite-vec (cosine distance).
   * Returns chunk IDs and distances.
   */
  vectorSearch(queryEmbedding: number[], topK: number = 10): Array<{ chunkId: string; distance: number }> {
    if (!this.db || !this.vec0Loaded) return [];

    try {
      const rows = this.db.prepare(`
        SELECT chunk_id, distance
        FROM rag_embeddings
        WHERE embedding MATCH ?
          AND k = ?
        ORDER BY distance
      `).all(new Float32Array(queryEmbedding), topK) as Array<{ chunk_id: string; distance: number }>;

      return rows.map(r => ({ chunkId: r.chunk_id, distance: r.distance }));
    } catch (err) {
      log.error('Vector search failed:', err);
      return [];
    }
  }

  /**
   * FTS5 keyword search on RAG chunks.
   * Returns chunk rowids and rank scores.
   */
  keywordSearchChunks(query: string, limit: number = 20): Array<{ chunkId: string; rank: number }> {
    if (!this.db || !query.trim()) return [];

    try {
      const sanitized = query.replace(/['"*()]/g, ' ').trim();
      if (!sanitized) return [];

      const rows = this.db.prepare(`
        SELECT rc.id as chunk_id, fts.rank
        FROM rag_chunks_fts fts
        JOIN rag_chunks rc ON rc.rowid = fts.rowid
        WHERE rag_chunks_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(sanitized, limit) as Array<{ chunk_id: string; rank: number }>;

      return rows.map(r => ({ chunkId: r.chunk_id, rank: r.rank }));
    } catch (err) {
      log.error('FTS chunk search failed:', err);
      return [];
    }
  }

  /**
   * Hybrid search — combines vector KNN + FTS5 keyword search with Reciprocal Rank Fusion.
   * This is the primary search method for RAG v2.
   *
   * @param queryEmbedding - Vector embedding of the query
   * @param queryText - Raw text query for keyword matching
   * @param topK - Number of results to return
   * @param vectorWeight - Weight for vector results (0-1), keyword weight = 1 - vectorWeight
   */
  hybridSearch(
    queryEmbedding: number[],
    queryText: string,
    topK: number = 10,
    vectorWeight: number = 0.7,
  ): HybridSearchResult[] {
    if (!this.db) return [];

    // ─── Vector search ───
    const vectorResults = this.vec0Loaded
      ? this.vectorSearch(queryEmbedding, topK * 2) // fetch more for fusion
      : [];

    // ─── Keyword search ───
    const keywordResults = this.keywordSearchChunks(queryText, topK * 2);

    // ─── Reciprocal Rank Fusion ───
    const RRF_K = 60; // standard RRF constant
    const fusionScores = new Map<string, { vectorRank: number; keywordRank: number }>();

    // Assign ranks from vector results
    vectorResults.forEach((r, idx) => {
      fusionScores.set(r.chunkId, { vectorRank: idx + 1, keywordRank: 0 });
    });

    // Assign ranks from keyword results
    keywordResults.forEach((r, idx) => {
      const existing = fusionScores.get(r.chunkId);
      if (existing) {
        existing.keywordRank = idx + 1;
      } else {
        fusionScores.set(r.chunkId, { vectorRank: 0, keywordRank: idx + 1 });
      }
    });

    // Calculate RRF scores
    const scored: Array<{ chunkId: string; score: number; vectorScore: number; keywordScore: number }> = [];
    for (const [chunkId, ranks] of fusionScores) {
      const vScore = ranks.vectorRank > 0 ? 1 / (RRF_K + ranks.vectorRank) : 0;
      const kScore = ranks.keywordRank > 0 ? 1 / (RRF_K + ranks.keywordRank) : 0;
      const combined = vectorWeight * vScore + (1 - vectorWeight) * kScore;
      scored.push({
        chunkId,
        score: combined,
        vectorScore: vScore * (RRF_K + 1), // normalize to ~0-1 range
        keywordScore: kScore * (RRF_K + 1),
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const topIds = scored.slice(0, topK);

    if (topIds.length === 0) return [];

    // ─── Fetch full chunk data ───
    const placeholders = topIds.map(() => '?').join(',');
    const chunkRows = this.db.prepare(`
      SELECT * FROM rag_chunks WHERE id IN (${placeholders})
    `).all(...topIds.map(s => s.chunkId)) as RAGChunkRow[];

    const chunkMap = new Map(chunkRows.map(r => [r.id, r]));

    return topIds
      .map(s => {
        const row = chunkMap.get(s.chunkId);
        if (!row) return null;
        return {
          chunkId: row.id,
          filePath: row.file_path,
          fileName: row.file_name,
          section: row.section,
          content: row.content,
          charCount: row.char_count,
          sourceFolder: row.source_folder,
          fileType: row.file_type,
          mtime: row.mtime,
          vectorScore: s.vectorScore,
          keywordScore: s.keywordScore,
          combinedScore: s.score,
        };
      })
      .filter((r): r is HybridSearchResult => r !== null);
  }

  /**
   * Get a chunk by ID.
   */
  getChunk(id: string): RAGChunkRow | null {
    if (!this.db) return null;
    try {
      return this.db.prepare('SELECT * FROM rag_chunks WHERE id = ?').get(id) as RAGChunkRow | null;
    } catch (err) {
      log.error(`Failed to get chunk ${id}:`, err);
      return null;
    }
  }

  /**
   * Get all chunks for a specific file path.
   */
  getChunksByFile(filePath: string): RAGChunkRow[] {
    if (!this.db) return [];
    try {
      return this.db.prepare('SELECT * FROM rag_chunks WHERE file_path = ?').all(filePath) as RAGChunkRow[];
    } catch (err) {
      log.error(`Failed to get chunks for file ${filePath}:`, err);
      return [];
    }
  }

  /**
   * Delete all chunks for a source folder.
   */
  deleteChunksByFolder(sourceFolder: string): number {
    if (!this.db) return 0;
    try {
      // Get chunk IDs before deleting (for vec0 cleanup)
      const ids = this.db.prepare(
        'SELECT id FROM rag_chunks WHERE source_folder = ?'
      ).all(sourceFolder) as Array<{ id: string }>;

      const result = this.db.prepare(
        'DELETE FROM rag_chunks WHERE source_folder = ?'
      ).run(sourceFolder);

      // Delete from vec0 table
      if (this.vec0Loaded && ids.length > 0) {
        const delStmt = this.db.prepare('DELETE FROM rag_embeddings WHERE chunk_id = ?');
        const tx = this.db.transaction((chunkIds: string[]) => {
          for (const id of chunkIds) {
            delStmt.run(id);
          }
        });
        tx(ids.map(r => r.id));
      }

      return result.changes;
    } catch (err) {
      log.error(`Failed to delete chunks for folder ${sourceFolder}:`, err);
      return 0;
    }
  }

  /**
   * Delete all chunks for a specific file.
   */
  deleteChunksByFile(filePath: string): number {
    if (!this.db) return 0;
    try {
      const ids = this.db.prepare(
        'SELECT id FROM rag_chunks WHERE file_path = ?'
      ).all(filePath) as Array<{ id: string }>;

      const result = this.db.prepare(
        'DELETE FROM rag_chunks WHERE file_path = ?'
      ).run(filePath);

      if (this.vec0Loaded && ids.length > 0) {
        const delStmt = this.db.prepare('DELETE FROM rag_embeddings WHERE chunk_id = ?');
        const tx = this.db.transaction((chunkIds: string[]) => {
          for (const id of chunkIds) {
            delStmt.run(id);
          }
        });
        tx(ids.map(r => r.id));
      }

      return result.changes;
    } catch (err) {
      log.error(`Failed to delete chunks for file ${filePath}:`, err);
      return 0;
    }
  }

  /**
   * Clear ALL RAG data (chunks + embeddings + folders).
   */
  clearRAGData(): void {
    if (!this.db) return;
    try {
      this.db.exec('DELETE FROM rag_chunks');
      if (this.vec0Loaded) {
        this.db.exec('DELETE FROM rag_embeddings');
      }
      this.db.exec('DELETE FROM rag_folders');
      log.info('All RAG data cleared');
    } catch (err) {
      log.error('Failed to clear RAG data:', err);
    }
  }

  /**
   * Get RAG chunk count.
   */
  getRAGChunkCount(): number {
    if (!this.db) return 0;
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM rag_chunks').get() as { count: number };
      return row.count;
    } catch {
      return 0;
    }
  }

  /**
   * Get RAG stats per source folder.
   */
  getRAGFolderStats(): Array<{ folder_path: string; file_count: number; chunk_count: number; last_indexed: number }> {
    if (!this.db) return [];
    try {
      return this.db.prepare('SELECT * FROM rag_folders').all() as Array<{
        folder_path: string; file_count: number; chunk_count: number; last_indexed: number;
      }>;
    } catch {
      return [];
    }
  }

  /**
   * Update folder stats after indexing.
   */
  upsertFolderStats(folderPath: string, fileCount: number, chunkCount: number): void {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO rag_folders (folder_path, file_count, chunk_count, last_indexed)
        VALUES (?, ?, ?, unixepoch())
      `).run(folderPath, fileCount, chunkCount);
    } catch (err) {
      log.error(`Failed to update folder stats for ${folderPath}:`, err);
    }
  }

  /**
   * Delete folder stats entry.
   */
  deleteFolderStats(folderPath: string): void {
    if (!this.db) return;
    try {
      this.db.prepare('DELETE FROM rag_folders WHERE folder_path = ?').run(folderPath);
    } catch (err) {
      log.error(`Failed to delete folder stats for ${folderPath}:`, err);
    }
  }

  // ═══════════════════════════════════════════════════════
  // ─── Embedding Cache Operations ───
  // ═══════════════════════════════════════════════════════

  /**
   * Get a cached embedding by content hash.
   */
  getCachedEmbedding(contentHash: string): number[] | null {
    if (!this.db) return null;
    try {
      const row = this.db.prepare(`
        SELECT embedding, dimension FROM embedding_cache WHERE content_hash = ?
      `).get(contentHash) as { embedding: Buffer; dimension: number } | undefined;

      if (!row) return null;

      // Update last_used timestamp (fire-and-forget)
      this.db.prepare('UPDATE embedding_cache SET last_used = unixepoch() WHERE content_hash = ?').run(contentHash);

      // Convert BLOB back to number[]
      const float32 = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dimension);
      return Array.from(float32);
    } catch (err) {
      log.error(`Failed to get cached embedding for ${contentHash}:`, err);
      return null;
    }
  }

  /**
   * Store an embedding in the cache.
   */
  setCachedEmbedding(contentHash: string, embedding: number[], model: string): void {
    if (!this.db) return;
    try {
      const blob = Buffer.from(new Float32Array(embedding).buffer);
      this.db.prepare(`
        INSERT OR REPLACE INTO embedding_cache (content_hash, embedding, dimension, model, last_used)
        VALUES (?, ?, ?, ?, unixepoch())
      `).run(contentHash, blob, embedding.length, model);
    } catch (err) {
      log.error(`Failed to cache embedding for ${contentHash}:`, err);
    }
  }

  /**
   * Bulk insert embeddings into cache (single transaction).
   */
  setCachedEmbeddings(entries: Array<{ hash: string; embedding: number[]; model: string }>): void {
    if (!this.db || entries.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO embedding_cache (content_hash, embedding, dimension, model, last_used)
      VALUES (?, ?, ?, ?, unixepoch())
    `);

    const transaction = this.db.transaction((items: typeof entries) => {
      for (const { hash, embedding, model } of items) {
        const blob = Buffer.from(new Float32Array(embedding).buffer);
        stmt.run(hash, blob, embedding.length, model);
      }
    });

    try {
      transaction(entries);
    } catch (err) {
      log.error('Failed to bulk cache embeddings:', err);
    }
  }

  /**
   * Get embedding cache size.
   */
  getEmbeddingCacheSize(): number {
    if (!this.db) return 0;
    try {
      const row = this.db.prepare('SELECT COUNT(*) as count FROM embedding_cache').get() as { count: number };
      return row.count;
    } catch {
      return 0;
    }
  }

  /**
   * Evict old embeddings from cache (LRU by last_used).
   * Keeps at most maxEntries entries.
   */
  evictEmbeddingCache(maxEntries: number = 200000): number {
    if (!this.db) return 0;
    try {
      const count = this.getEmbeddingCacheSize();
      if (count <= maxEntries) return 0;

      const toDelete = count - maxEntries;
      const result = this.db.prepare(`
        DELETE FROM embedding_cache WHERE content_hash IN (
          SELECT content_hash FROM embedding_cache ORDER BY last_used ASC LIMIT ?
        )
      `).run(toDelete);

      log.info(`Evicted ${result.changes} old embeddings from cache (kept ${maxEntries})`);
      return result.changes;
    } catch (err) {
      log.error('Failed to evict embedding cache:', err);
      return 0;
    }
  }

  /**
   * Clear embedding cache for a specific model (or all if model is null).
   */
  clearEmbeddingCache(model?: string): void {
    if (!this.db) return;
    try {
      if (model) {
        this.db.prepare('DELETE FROM embedding_cache WHERE model = ?').run(model);
      } else {
        this.db.exec('DELETE FROM embedding_cache');
      }
      log.info(`Embedding cache cleared${model ? ` for model ${model}` : ''}`);
    } catch (err) {
      log.error('Failed to clear embedding cache:', err);
    }
  }

  /**
   * Import embeddings from old JSON cache file into SQLite.
   * Used for migration from EmbeddingService's embedding-cache.json.
   */
  importEmbeddingCache(cachePath: string, model: string): number {
    if (!this.db || !fs.existsSync(cachePath)) return 0;

    try {
      const raw = fs.readFileSync(cachePath, 'utf8');
      const data = JSON.parse(raw) as Record<string, number[]>;
      const entries = Object.entries(data);

      if (entries.length === 0) return 0;

      log.info(`Importing ${entries.length} embeddings from JSON cache...`);

      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO embedding_cache (content_hash, embedding, dimension, model, last_used)
        VALUES (?, ?, ?, ?, unixepoch())
      `);

      const BATCH_SIZE = 5000;
      let imported = 0;

      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const tx = this.db.transaction((items: [string, number[]][]) => {
          for (const [hash, embedding] of items) {
            const blob = Buffer.from(new Float32Array(embedding).buffer);
            stmt.run(hash, blob, embedding.length, model);
            imported++;
          }
        });
        tx(batch);
      }

      log.info(`Imported ${imported} embeddings from JSON cache`);
      return imported;
    } catch (err) {
      log.error('Failed to import embedding cache:', err);
      return 0;
    }
  }
}
