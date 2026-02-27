/**
 * PrivacyService — GDPR compliance: data summary, export, and deletion.
 *
 * Implements:
 * - Art. 15 — Right of access (data summary)
 * - Art. 17 — Right to erasure ("delete all my data")
 * - Art. 20 — Right to data portability (export as ZIP)
 *
 * All user data is local-only — never sent to external servers by KxAI itself.
 * AI API calls go to OpenAI/Anthropic but conversation data stays on disk.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import { createLogger } from './logger';
import { DatabaseService } from './database-service';
import type {
  PrivacyDataCategory,
  PrivacyDataSummary,
  PrivacyCategorySummary,
  PrivacyExportResult,
  PrivacyDeleteResult,
  PrivacyExportOptions,
  PrivacyDeleteOptions,
} from '../../shared/types/privacy';

const log = createLogger('PrivacyService');

/** Category metadata (PL labels + descriptions) */
const CATEGORY_META: Record<PrivacyDataCategory, { label: string; description: string }> = {
  conversations: {
    label: 'Konwersacje',
    description: 'Historia rozmów z AI (wiadomości, sesje, odpowiedzi)',
  },
  memory: {
    label: 'Pamięć agenta',
    description: 'Profil użytkownika, notatki, persona (USER.md, MEMORY.md, SOUL.md, HEARTBEAT.md)',
  },
  activity: {
    label: 'Log aktywności',
    description: 'Rejestr aktywnych okien i wykryte wzorce zachowań',
  },
  meetings: {
    label: 'Spotkania',
    description: 'Transkrypcje i podsumowania spotkań',
  },
  cron: {
    label: 'Zadania cykliczne',
    description: 'Zdefiniowane cron joby, remindery i historia wykonań',
  },
  rag: {
    label: 'Zaindeksowane pliki',
    description: 'Fragmenty plików (chunki), embeddingi wektorowe, cache',
  },
  audit: {
    label: 'Log audytowy',
    description: 'Dziennik operacji bezpieczeństwa (komendy, walidacje)',
  },
  config: {
    label: 'Konfiguracja',
    description: 'Ustawienia aplikacji (model AI, persona, preferencje)',
  },
  prompts: {
    label: 'Prompty użytkownika',
    description: 'Własne nadpisania promptów systemowych',
  },
  browser: {
    label: 'Profil przeglądarki',
    description: 'Dane profilu przeglądarki CDP (cookies, cache, localStorage)',
  },
  secrets: {
    label: 'Klucze API',
    description: 'Zaszyfrowane klucze API (OpenAI, Anthropic, ElevenLabs, Deepgram)',
  },
  temp: {
    label: 'Pliki tymczasowe',
    description: 'Pliki audio TTS, screenshoty OCR',
  },
};

export class PrivacyService {
  private userDataPath: string;
  private workspacePath: string;
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
    this.userDataPath = app.getPath('userData');
    this.workspacePath = path.join(this.userDataPath, 'workspace');
  }

  // ─── Data Summary (Art. 15 — Right of access) ───

  async getDataSummary(): Promise<PrivacyDataSummary> {
    log.info('Generating data summary...');

    const categories: PrivacyCategorySummary[] = [];
    let totalSize = 0;
    let earliestTimestamp: number | null = null;
    let latestTimestamp: number | null = null;

    // Conversations (SQLite)
    const convSummary = await this.summarizeConversations();
    categories.push(convSummary);
    totalSize += convSummary.sizeBytes;

    // Memory files
    const memSummary = await this.summarizeDirectory('memory', path.join(this.workspacePath, 'memory'), [
      'SOUL.md',
      'USER.md',
      'MEMORY.md',
      'HEARTBEAT.md',
    ]);
    categories.push(memSummary);
    totalSize += memSummary.sizeBytes;

    // Activity log
    const actSummary = await this.summarizeDirectory('activity', path.join(this.workspacePath, 'workflow'));
    categories.push(actSummary);
    totalSize += actSummary.sizeBytes;

    // Meetings
    const meetSummary = await this.summarizeDirectory('meetings', path.join(this.workspacePath, 'meetings'));
    categories.push(meetSummary);
    totalSize += meetSummary.sizeBytes;

    // Cron
    const cronSummary = await this.summarizeDirectory('cron', path.join(this.workspacePath, 'cron'));
    categories.push(cronSummary);
    totalSize += cronSummary.sizeBytes;

    // RAG (SQLite tables)
    const ragSummary = await this.summarizeRAG();
    categories.push(ragSummary);
    totalSize += ragSummary.sizeBytes;

    // Audit log
    const auditSummary = await this.summarizeFile('audit', path.join(this.workspacePath, 'audit-log.json'));
    categories.push(auditSummary);
    totalSize += auditSummary.sizeBytes;

    // Config
    const configSummary = await this.summarizeFile('config', path.join(this.userDataPath, 'kxai-config.json'));
    categories.push(configSummary);
    totalSize += configSummary.sizeBytes;

    // Custom prompts
    const promptsSummary = await this.summarizeDirectory('prompts', path.join(this.workspacePath, 'prompts'));
    categories.push(promptsSummary);
    totalSize += promptsSummary.sizeBytes;

    // Browser profile
    const browserSummary = await this.summarizeDirectory('browser', path.join(this.userDataPath, 'browser-profile'));
    categories.push(browserSummary);
    totalSize += browserSummary.sizeBytes;

    // Secrets
    const secretsSummary = await this.summarizeSecrets();
    categories.push(secretsSummary);
    totalSize += secretsSummary.sizeBytes;

    // Temp files
    const tempSummary = await this.summarizeDirectory('temp', path.join(os.tmpdir(), 'kxai-tts'));
    categories.push(tempSummary);
    totalSize += tempSummary.sizeBytes;

    // Find earliest/latest timestamps from conversations
    if (this.db.isReady()) {
      try {
        const earliest = (this.db as any).db?.prepare('SELECT MIN(timestamp) as ts FROM messages').get() as
          | { ts: number | null }
          | undefined;
        const latest = (this.db as any).db?.prepare('SELECT MAX(timestamp) as ts FROM messages').get() as
          | { ts: number | null }
          | undefined;
        if (earliest?.ts) earliestTimestamp = earliest.ts;
        if (latest?.ts) latestTimestamp = latest.ts;
      } catch {
        // DB not ready or no messages
      }
    }

    const summary: PrivacyDataSummary = {
      totalSizeBytes: totalSize,
      categories,
      dataCollectionStart: earliestTimestamp ? new Date(earliestTimestamp).toISOString() : null,
      lastActivity: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
    };

    log.info(`Data summary: ${totalSize} bytes across ${categories.length} categories`);
    return summary;
  }

  // ─── Data Export (Art. 20 — Right to data portability) ───

  async exportData(options?: PrivacyExportOptions): Promise<PrivacyExportResult> {
    const categories = options?.categories ?? this.getAllCategories();
    const includeRAG = options?.includeRAG ?? false;
    const outputDir = options?.outputDir ?? app.getPath('documents');

    // Filter out RAG if not explicitly requested (can be very large)
    const exportCategories = includeRAG ? categories : categories.filter((c) => c !== 'rag');

    log.info(`Exporting data: ${exportCategories.join(', ')} to ${outputDir}`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const exportDirName = `kxai-data-export-${timestamp}`;
    const exportPath = path.join(outputDir, exportDirName);

    try {
      await fsp.mkdir(exportPath, { recursive: true });

      // Export manifest
      const manifest = {
        exportDate: new Date().toISOString(),
        application: 'KxAI',
        version: app.getVersion(),
        categories: exportCategories,
        dataLocalOnly: true,
        note: 'Wszystkie dane KxAI są przechowywane wyłącznie lokalnie na Twoim urządzeniu.',
      };
      await fsp.writeFile(path.join(exportPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

      // Export each category
      for (const category of exportCategories) {
        await this.exportCategory(category, exportPath);
      }

      // Calculate total export size
      const sizeBytes = await this.getDirectorySize(exportPath);

      log.info(`Data exported to ${exportPath} (${sizeBytes} bytes)`);

      return {
        success: true,
        exportPath,
        sizeBytes,
        categories: exportCategories,
      };
    } catch (error: any) {
      log.error('Data export failed:', error);
      return {
        success: false,
        categories: exportCategories,
        error: error.message,
      };
    }
  }

  // ─── Data Deletion (Art. 17 — Right to erasure) ───

  async deleteData(options?: PrivacyDeleteOptions): Promise<PrivacyDeleteResult> {
    const categories = options?.categories ?? this.getAllCategories();
    const keepConfig = options?.keepConfig ?? false;
    const keepPersona = options?.keepPersona ?? false;

    log.info(`Deleting data: ${categories.join(', ')} (keepConfig=${keepConfig}, keepPersona=${keepPersona})`);

    const deletedCategories: PrivacyDataCategory[] = [];
    const failedCategories: { category: PrivacyDataCategory; error: string }[] = [];
    let requiresRestart = false;

    for (const category of categories) {
      // Skip config if keepConfig is set
      if (category === 'config' && keepConfig) continue;

      try {
        await this.deleteCategory(category, keepPersona);
        deletedCategories.push(category);

        // Some deletions require restart
        if (['conversations', 'rag', 'secrets', 'config'].includes(category)) {
          requiresRestart = true;
        }
      } catch (error: any) {
        log.error(`Failed to delete ${category}:`, error);
        failedCategories.push({ category, error: error.message });
      }
    }

    log.info(`Deletion complete: ${deletedCategories.length} deleted, ${failedCategories.length} failed`);

    return {
      success: failedCategories.length === 0,
      deletedCategories,
      failedCategories,
      requiresRestart,
    };
  }

  // ─── Private: Category-specific export ───

  private async exportCategory(category: PrivacyDataCategory, exportPath: string): Promise<void> {
    const catDir = path.join(exportPath, category);
    await fsp.mkdir(catDir, { recursive: true });

    switch (category) {
      case 'conversations':
        await this.exportConversations(catDir);
        break;
      case 'memory':
        await this.copyDirectory(path.join(this.workspacePath, 'memory'), catDir);
        break;
      case 'activity':
        await this.copyDirectory(path.join(this.workspacePath, 'workflow'), catDir);
        break;
      case 'meetings':
        await this.copyDirectory(path.join(this.workspacePath, 'meetings'), catDir);
        break;
      case 'cron':
        await this.copyDirectory(path.join(this.workspacePath, 'cron'), catDir);
        break;
      case 'rag':
        await this.exportRAG(catDir);
        break;
      case 'audit':
        await this.copyFile(path.join(this.workspacePath, 'audit-log.json'), catDir);
        break;
      case 'config':
        await this.exportConfig(catDir);
        break;
      case 'prompts':
        await this.copyDirectory(path.join(this.workspacePath, 'prompts'), catDir);
        break;
      case 'browser':
        // Only export summary, not full browser profile (cookies could be sensitive)
        await this.exportBrowserSummary(catDir);
        break;
      case 'secrets':
        // Never export actual secrets — just a manifest
        await fsp.writeFile(
          path.join(catDir, 'secrets-manifest.json'),
          JSON.stringify(
            {
              note: 'Klucze API nie są eksportowane ze względów bezpieczeństwa.',
              storedKeys: await this.listSecretKeys(),
            },
            null,
            2,
          ),
          'utf-8',
        );
        break;
      case 'temp':
        await this.copyDirectory(path.join(os.tmpdir(), 'kxai-tts'), catDir);
        break;
    }
  }

  // ─── Private: Category-specific deletion ───

  private async deleteCategory(category: PrivacyDataCategory, keepPersona: boolean): Promise<void> {
    switch (category) {
      case 'conversations':
        await this.deleteConversations();
        break;
      case 'memory':
        await this.deleteMemoryFiles(keepPersona);
        break;
      case 'activity':
        await this.removeDirectory(path.join(this.workspacePath, 'workflow'));
        break;
      case 'meetings':
        await this.removeDirectory(path.join(this.workspacePath, 'meetings'));
        break;
      case 'cron':
        await this.removeDirectory(path.join(this.workspacePath, 'cron'));
        break;
      case 'rag':
        await this.deleteRAG();
        break;
      case 'audit':
        await this.removeFile(path.join(this.workspacePath, 'audit-log.json'));
        break;
      case 'config':
        await this.removeFile(path.join(this.userDataPath, 'kxai-config.json'));
        break;
      case 'prompts':
        await this.removeDirectory(path.join(this.workspacePath, 'prompts'));
        break;
      case 'browser':
        await this.removeDirectory(path.join(this.userDataPath, 'browser-profile'));
        break;
      case 'secrets':
        await this.deleteSecrets();
        break;
      case 'temp':
        await this.removeDirectory(path.join(os.tmpdir(), 'kxai-tts'));
        break;
    }
  }

  // ─── Private: Summarize helpers ───

  private async summarizeConversations(): Promise<PrivacyCategorySummary> {
    const meta = CATEGORY_META.conversations;
    if (!this.db.isReady()) {
      return {
        category: 'conversations',
        label: meta.label,
        itemCount: 0,
        sizeBytes: 0,
        description: meta.description,
      };
    }

    const stats = await this.db.getStats();
    return {
      category: 'conversations',
      label: meta.label,
      itemCount: stats.totalMessages,
      sizeBytes: stats.dbSizeBytes,
      description: meta.description,
    };
  }

  private async summarizeRAG(): Promise<PrivacyCategorySummary> {
    const meta = CATEGORY_META.rag;
    if (!this.db.isReady()) {
      return { category: 'rag', label: meta.label, itemCount: 0, sizeBytes: 0, description: meta.description };
    }

    try {
      const chunks = (this.db as any).db?.prepare('SELECT COUNT(*) as count FROM rag_chunks').get() as
        | { count: number }
        | undefined;

      const embeddings = (this.db as any).db?.prepare('SELECT COUNT(*) as count FROM embedding_cache').get() as
        | { count: number }
        | undefined;

      return {
        category: 'rag',
        label: meta.label,
        itemCount: (chunks?.count ?? 0) + (embeddings?.count ?? 0),
        sizeBytes: 0, // Size is counted in DB total
        description: meta.description,
      };
    } catch {
      return { category: 'rag', label: meta.label, itemCount: 0, sizeBytes: 0, description: meta.description };
    }
  }

  private async summarizeSecrets(): Promise<PrivacyCategorySummary> {
    const meta = CATEGORY_META.secrets;
    const secretsPath = path.join(this.userDataPath, '.kxai-secrets');
    const keyPath = path.join(this.userDataPath, '.kxai-key');
    let count = 0;
    let size = 0;

    if (fs.existsSync(secretsPath)) {
      const files = await fsp.readdir(secretsPath);
      count = files.length;
      for (const f of files) {
        try {
          const stat = await fsp.stat(path.join(secretsPath, f));
          size += stat.size;
        } catch {
          /* ignore */
        }
      }
    }
    if (fs.existsSync(keyPath)) {
      count++;
      try {
        size += (await fsp.stat(keyPath)).size;
      } catch {
        /* ignore */
      }
    }

    return { category: 'secrets', label: meta.label, itemCount: count, sizeBytes: size, description: meta.description };
  }

  private async summarizeDirectory(
    category: PrivacyDataCategory,
    dirPath: string,
    specificFiles?: string[],
  ): Promise<PrivacyCategorySummary> {
    const meta = CATEGORY_META[category];
    if (!fs.existsSync(dirPath)) {
      return { category, label: meta.label, itemCount: 0, sizeBytes: 0, description: meta.description };
    }

    let count = 0;
    let size = 0;

    if (specificFiles) {
      for (const f of specificFiles) {
        const fp = path.join(dirPath, f);
        if (fs.existsSync(fp)) {
          count++;
          try {
            size += (await fsp.stat(fp)).size;
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      try {
        const files = await this.listFilesRecursive(dirPath);
        count = files.length;
        for (const f of files) {
          try {
            size += (await fsp.stat(f)).size;
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }

    return { category, label: meta.label, itemCount: count, sizeBytes: size, description: meta.description };
  }

  private async summarizeFile(category: PrivacyDataCategory, filePath: string): Promise<PrivacyCategorySummary> {
    const meta = CATEGORY_META[category];
    if (!fs.existsSync(filePath)) {
      return { category, label: meta.label, itemCount: 0, sizeBytes: 0, description: meta.description };
    }

    try {
      const stat = await fsp.stat(filePath);
      return { category, label: meta.label, itemCount: 1, sizeBytes: stat.size, description: meta.description };
    } catch {
      return { category, label: meta.label, itemCount: 0, sizeBytes: 0, description: meta.description };
    }
  }

  // ─── Private: Export helpers ───

  private async exportConversations(dir: string): Promise<void> {
    if (!this.db.isReady()) return;

    try {
      // Export all messages grouped by session date
      const rows = (this.db as any).db
        ?.prepare('SELECT * FROM messages ORDER BY session_date, timestamp')
        .all() as any[];

      if (!rows || rows.length === 0) return;

      // Group by session_date
      const sessions: Record<string, any[]> = {};
      for (const row of rows) {
        const date = row.session_date || 'unknown';
        if (!sessions[date]) sessions[date] = [];
        sessions[date].push({
          role: row.role,
          content: row.content,
          timestamp: new Date(row.timestamp).toISOString(),
          type: row.type,
        });
      }

      await fsp.writeFile(path.join(dir, 'conversations.json'), JSON.stringify(sessions, null, 2), 'utf-8');

      // Also export as readable markdown
      let markdown = '# Historia konwersacji KxAI\n\n';
      for (const [date, msgs] of Object.entries(sessions)) {
        markdown += `## Sesja: ${date}\n\n`;
        for (const msg of msgs) {
          const time = msg.timestamp.slice(11, 19);
          const roleLabel = msg.role === 'user' ? '👤 Użytkownik' : '🤖 Agent';
          markdown += `**${roleLabel}** (${time}):\n${msg.content}\n\n---\n\n`;
        }
      }
      await fsp.writeFile(path.join(dir, 'conversations.md'), markdown, 'utf-8');
    } catch (err) {
      log.error('Failed to export conversations:', err);
    }
  }

  private async exportRAG(dir: string): Promise<void> {
    if (!this.db.isReady()) return;

    try {
      const chunks = (this.db as any).db
        ?.prepare(
          'SELECT file_path, content, chunk_index, file_type, created_at FROM rag_chunks ORDER BY file_path, chunk_index',
        )
        .all() as any[];

      if (chunks && chunks.length > 0) {
        await fsp.writeFile(path.join(dir, 'indexed-chunks.json'), JSON.stringify(chunks, null, 2), 'utf-8');
      }

      const folders = (this.db as any).db?.prepare('SELECT * FROM rag_folders').all() as any[];

      if (folders && folders.length > 0) {
        await fsp.writeFile(path.join(dir, 'indexed-folders.json'), JSON.stringify(folders, null, 2), 'utf-8');
      }
    } catch (err) {
      log.error('Failed to export RAG data:', err);
    }
  }

  private async exportConfig(dir: string): Promise<void> {
    const configPath = path.join(this.userDataPath, 'kxai-config.json');
    if (!fs.existsSync(configPath)) return;

    try {
      const raw = await fsp.readFile(configPath, 'utf-8');
      const config = JSON.parse(raw);

      // Strip any accidental secrets from config
      const safeConfig = { ...config };
      delete safeConfig.openaiApiKey;
      delete safeConfig.anthropicApiKey;
      delete safeConfig.elevenLabsApiKey;
      delete safeConfig.deepgramApiKey;

      await fsp.writeFile(path.join(dir, 'config.json'), JSON.stringify(safeConfig, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to export config:', err);
    }
  }

  private async exportBrowserSummary(dir: string): Promise<void> {
    const browserPath = path.join(this.userDataPath, 'browser-profile');
    if (!fs.existsSync(browserPath)) return;

    try {
      const files = await this.listFilesRecursive(browserPath);
      const summary = {
        note: 'Pełny profil przeglądarki nie jest eksportowany ze względów bezpieczeństwa.',
        fileCount: files.length,
        totalSizeBytes: 0 as number,
        fileTypes: {} as Record<string, number>,
      };

      for (const f of files) {
        try {
          summary.totalSizeBytes += (await fsp.stat(f)).size;
          const ext = path.extname(f) || 'no-ext';
          summary.fileTypes[ext] = (summary.fileTypes[ext] || 0) + 1;
        } catch {
          /* ignore */
        }
      }

      await fsp.writeFile(path.join(dir, 'browser-profile-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to export browser summary:', err);
    }
  }

  // ─── Private: Delete helpers ───

  private async deleteConversations(): Promise<void> {
    if (!this.db.isReady()) return;

    try {
      const db = (this.db as any).db;
      if (!db) return;

      db.exec('DELETE FROM messages');
      db.exec('DELETE FROM sessions');
      // Rebuild FTS index
      db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");

      log.info('All conversations deleted');
    } catch (err) {
      log.error('Failed to delete conversations:', err);
      throw err;
    }
  }

  private async deleteMemoryFiles(keepPersona: boolean): Promise<void> {
    const memoryDir = path.join(this.workspacePath, 'memory');

    const filesToDelete = ['USER.md', 'MEMORY.md', 'HEARTBEAT.md'];
    if (!keepPersona) {
      filesToDelete.push('SOUL.md');
    }

    for (const f of filesToDelete) {
      await this.removeFile(path.join(memoryDir, f));
    }

    // Also delete BOOTSTRAP.md if exists
    await this.removeFile(path.join(this.workspacePath, 'BOOTSTRAP.md'));

    log.info(`Memory files deleted (keepPersona=${keepPersona})`);
  }

  private async deleteRAG(): Promise<void> {
    if (!this.db.isReady()) return;

    try {
      const db = (this.db as any).db;
      if (!db) return;

      db.exec('DELETE FROM rag_chunks');
      db.exec('DELETE FROM embedding_cache');
      db.exec('DELETE FROM rag_folders');
      // Rebuild FTS index
      db.exec("INSERT INTO rag_chunks_fts(rag_chunks_fts) VALUES('rebuild')");
      // vec0 table — delete all embeddings
      try {
        db.exec('DELETE FROM rag_embeddings');
      } catch {
        // vec0 table may not exist if extension failed to load
      }

      log.info('All RAG data deleted');
    } catch (err) {
      log.error('Failed to delete RAG data:', err);
      throw err;
    }
  }

  private async deleteSecrets(): Promise<void> {
    const secretsPath = path.join(this.userDataPath, '.kxai-secrets');
    const keyPath = path.join(this.userDataPath, '.kxai-key');

    await this.removeDirectory(secretsPath);
    await this.removeFile(keyPath);

    log.info('Secrets deleted');
  }

  // ─── Private: Utility helpers ───

  private getAllCategories(): PrivacyDataCategory[] {
    return [
      'conversations',
      'memory',
      'activity',
      'meetings',
      'cron',
      'rag',
      'audit',
      'config',
      'prompts',
      'browser',
      'secrets',
      'temp',
    ];
  }

  private async listSecretKeys(): Promise<string[]> {
    const secretsPath = path.join(this.userDataPath, '.kxai-secrets');
    if (!fs.existsSync(secretsPath)) return [];

    try {
      const files = await fsp.readdir(secretsPath);
      return files.map((f) => f.replace('.enc', ''));
    } catch {
      return [];
    }
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    if (!fs.existsSync(src)) return;

    try {
      const entries = await fsp.readdir(src, { withFileTypes: true });
      await fsp.mkdir(dest, { recursive: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          await this.copyDirectory(srcPath, destPath);
        } else {
          await fsp.copyFile(srcPath, destPath);
        }
      }
    } catch (err) {
      log.warn(`Failed to copy ${src} → ${dest}:`, err);
    }
  }

  private async copyFile(src: string, destDir: string): Promise<void> {
    if (!fs.existsSync(src)) return;

    try {
      await fsp.copyFile(src, path.join(destDir, path.basename(src)));
    } catch (err) {
      log.warn(`Failed to copy file ${src}:`, err);
    }
  }

  private async removeDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) return;

    try {
      await fsp.rm(dirPath, { recursive: true, force: true });
      log.info(`Removed directory: ${dirPath}`);
    } catch (err) {
      log.warn(`Failed to remove directory ${dirPath}:`, err);
      throw err;
    }
  }

  private async removeFile(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) return;

    try {
      await fsp.unlink(filePath);
      log.info(`Removed file: ${filePath}`);
    } catch (err) {
      log.warn(`Failed to remove file ${filePath}:`, err);
      throw err;
    }
  }

  private async listFilesRecursive(dir: string): Promise<string[]> {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;

    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await this.listFilesRecursive(fullPath)));
        } else {
          files.push(fullPath);
        }
      }
    } catch {
      /* ignore */
    }

    return files;
  }

  private async getDirectorySize(dir: string): Promise<number> {
    const files = await this.listFilesRecursive(dir);
    let total = 0;
    for (const f of files) {
      try {
        total += (await fsp.stat(f)).size;
      } catch {
        /* ignore */
      }
    }
    return total;
  }
}
