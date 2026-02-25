import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { EmbeddingService } from './embedding-service';
import { ConfigService } from './config';
import { DatabaseService } from './database-service';
import type { HybridSearchResult } from './database-service';
import { FileIntelligenceService } from './file-intelligence';
import { createLogger } from './logger';
import { PDFParse } from 'pdf-parse';

const log = createLogger('RAGService');

// Re-export from shared types (canonical source)
export type { RAGChunk, RAGSearchResult, IndexProgress } from '../../shared/types/rag';
export type { RAGFolderInfo as IndexedFolderInfo } from '../../shared/types/rag';
import type { RAGChunk, RAGSearchResult, IndexProgress } from '../../shared/types/rag';
import type { RAGFolderInfo as IndexedFolderInfo } from '../../shared/types/rag';

// --- File type configuration ---

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyx',
  '.java',
  '.kt',
  '.scala',
  '.cpp',
  '.c',
  '.h',
  '.hpp',
  '.cc',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  '.lua',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.r',
  '.R',
]);

const DOCUMENT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.markdown',
  '.txt',
  '.text',
  '.rst',
  '.json',
  '.jsonc',
  '.json5',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.tsv',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.env.example',
  '.log',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.svg',
]);

/** Binary document formats that need special extraction */
const BINARY_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.epub']);

const DEFAULT_EXTENSIONS = new Set([...CODE_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...BINARY_DOCUMENT_EXTENSIONS]);

/** Directories always excluded from scanning */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.venv',
  'venv',
  'env',
  '.env',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.tmp',
  '.temp',
  'coverage',
  '.nyc_output',
  '.idea',
  '.vscode',
  '.vs',
  'vendor',
  'packages',
  'rag', // Our own index folder
]);

/** Max file size to index (500MB — large PDFs/docs are chunked progressively) */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/** Max text size to load into memory at once for text files (10MB — larger files are read in streams) */
const MAX_TEXT_READ = 10 * 1024 * 1024;

/** Max total files to index (safety limit) */
const MAX_TOTAL_FILES = 10000;

/**
 * RAGService  Universal Retrieval-Augmented Generation pipeline:
 * 1. Indeksuje pliki z konfigurowalnych folderow (kod, dokumenty, notatki)
 * 2. Smart chunking per typ pliku (headers dla MD, funkcje dla kodu, paragrafy dla tekstu)
 * 3. Generuje embeddingi (OpenAI lub TF-IDF fallback)
 * 4. Semantic search via cosine similarity
 * 5. File watching dla incremental reindex
 */

export class RAGService {
  private embeddingService: EmbeddingService;
  private config: ConfigService;
  private dbService: DatabaseService;
  private fileIntelligence?: FileIntelligenceService;
  private workspacePath: string;
  private legacyIndexPath: string; // for migration
  private indexed = false;
  private indexing = false;
  private watchers: fs.FSWatcher[] = [];
  private watcherDebounce: NodeJS.Timeout | null = null;
  private pendingChanges = new Set<string>();
  private lastProgressTime = 0;
  private static readonly PROGRESS_THROTTLE_MS = 500;

  /** Progress callback — set from outside (e.g. IPC handler) */
  onProgress?: (progress: IndexProgress) => void;

  constructor(
    embeddingService: EmbeddingService,
    config: ConfigService,
    dbService: DatabaseService,
    fileIntelligence?: FileIntelligenceService,
  ) {
    this.embeddingService = embeddingService;
    this.config = config;
    this.dbService = dbService;
    this.fileIntelligence = fileIntelligence;
    const userDataPath = app.getPath('userData');
    this.workspacePath = path.join(userDataPath, 'workspace');
    this.legacyIndexPath = path.join(userDataPath, 'workspace', 'rag', 'index.json');
  }

  /**
   * Initialize RAG — migrate legacy index if needed, or build new one.
   */
  async initialize(): Promise<void> {
    // Migrate legacy index.json to SQLite (one-time)
    this.migrateLegacyIndex();

    // Check if we have indexed data in SQLite
    const chunkCount = this.dbService.getRAGChunkCount();
    if (chunkCount > 0) {
      this.indexed = true;
      log.info(`Loaded ${chunkCount} chunks from SQLite`);
    } else {
      await this.reindex();
    }
    this.startWatchers();
  }

  // --- Indexed Folders Management ---

  /**
   * Get the list of user-configured indexed folders.
   */
  getIndexedFolders(): string[] {
    return (this.config.get('indexedFolders') as string[] | undefined) || [];
  }

  /**
   * Add a folder to the index.
   */
  async addFolder(folderPath: string): Promise<{ success: boolean; error?: string }> {
    const normalized = path.resolve(folderPath);

    if (!fs.existsSync(normalized)) {
      return { success: false, error: 'Folder nie istnieje' };
    }

    const stat = fs.statSync(normalized);
    if (!stat.isDirectory()) {
      return { success: false, error: 'Sciezka nie jest folderem' };
    }

    const folders = this.getIndexedFolders();
    if (folders.includes(normalized)) {
      return { success: false, error: 'Folder jest juz dodany' };
    }

    // Check for nesting
    for (const existing of folders) {
      if (normalized.startsWith(existing + path.sep)) {
        return { success: false, error: `Folder jest juz pokryty przez ${existing}` };
      }
      if (existing.startsWith(normalized + path.sep)) {
        return { success: false, error: `Folder pokrywa juz dodany ${existing}` };
      }
    }

    folders.push(normalized);
    this.config.set('indexedFolders', folders);

    // Index the new folder
    await this.indexFolder(normalized);
    this.startWatcherForFolder(normalized);

    return { success: true };
  }

  /**
   * Remove a folder from the index.
   */
  removeFolder(folderPath: string): void {
    const normalized = path.resolve(folderPath);
    const folders = this.getIndexedFolders();
    const filtered = folders.filter((f) => f !== normalized);
    this.config.set('indexedFolders', filtered);

    // Remove chunks from this folder (SQLite)
    this.dbService.deleteChunksByFolder(normalized);
    this.dbService.deleteFolderStats(normalized);

    // Restart watchers
    this.stopWatchers();
    this.startWatchers();
  }

  /**
   * Get stats about indexed folders.
   */
  getFolderStats(): IndexedFolderInfo[] {
    const dbStats = this.dbService.getRAGFolderStats();
    return dbStats.map((s) => ({
      path: s.folder_path,
      fileCount: s.file_count,
      chunkCount: s.chunk_count,
      lastIndexed: s.last_indexed * 1000, // unix timestamp to ms
    }));
  }

  /**
   * Check if indexing is in progress.
   */
  isIndexing(): boolean {
    return this.indexing;
  }

  /**
   * Check if the index is ready (has been built at least once).
   */
  isReady(): boolean {
    return this.indexed;
  }

  /**
   * Get total chunk count.
   */
  getChunkCount(): number {
    return this.dbService.getRAGChunkCount();
  }

  /**
   * Get allowed file extensions (user-configurable).
   */
  getIndexedExtensions(): string[] {
    const custom = this.config.get('indexedExtensions') as string[] | undefined;
    return custom || Array.from(DEFAULT_EXTENSIONS);
  }

  /**
   * Set custom file extensions to index.
   */
  setIndexedExtensions(extensions: string[]): void {
    this.config.set('indexedExtensions', extensions);
  }

  // --- Full Reindex ---

  /**
   * Yield to the event loop — prevents Electron from freezing during long operations.
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /**
   * Full reindex — scan all folders, chunk, embed, store in SQLite.
   * Non-blocking: yields to event loop periodically + reports progress.
   */
  async reindex(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;
    this.indexed = false;

    const emitProgress = (p: Partial<IndexProgress> & { phase: IndexProgress['phase'] }) => {
      // Throttle progress events to avoid flooding IPC/renderer
      const now = Date.now();
      if (p.phase !== 'done' && p.phase !== 'error' && now - this.lastProgressTime < RAGService.PROGRESS_THROTTLE_MS) {
        return;
      }
      this.lastProgressTime = now;
      this.onProgress?.({
        filesProcessed: 0,
        filesTotal: 0,
        chunksCreated: 0,
        embeddingPercent: 0,
        overallPercent: 0,
        ...p,
      });
    };

    try {
      log.info('Starting full reindex...');
      emitProgress({ phase: 'scanning', overallPercent: 0 });

      // ─── Phase 0: Clear existing RAG data ───
      this.dbService.clearRAGData();

      // ─── Phase 1: Collect files (sync but fast) ───
      const allFiles: Array<{ path: string; relativePath: string; sourceFolder: string }> = [];

      const workspaceFiles = this.collectFiles(this.workspacePath, 'workspace', true);
      allFiles.push(...workspaceFiles);

      const userFolders = this.getIndexedFolders();
      for (const folder of userFolders) {
        if (!fs.existsSync(folder)) continue;
        const files = this.collectFiles(folder, folder, false);
        allFiles.push(...files);
        if (allFiles.length > MAX_TOTAL_FILES) break;
      }

      const totalFiles = allFiles.length;
      log.info(`Found ${totalFiles} files to index`);
      emitProgress({ phase: 'chunking', filesTotal: totalFiles, overallPercent: 5 });

      // ─── Phase 2: Chunk files — yield every 20 files ───
      const allChunks: RAGChunk[] = [];
      const allTexts: string[] = [];
      let filesProcessed = 0;

      for (const file of allFiles) {
        const ext = path.extname(file.path).toLowerCase();
        try {
          if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
            const binChunks = await this.chunkBinaryDocumentAsync(file.path, file.relativePath, file.sourceFolder);
            allChunks.push(...binChunks);
            allTexts.push(...binChunks.map((c) => c.content));
          } else {
            const chunks = this.chunkFile(file.path, file.relativePath, file.sourceFolder);
            allChunks.push(...chunks);
            allTexts.push(...chunks.map((c) => c.content));
          }
        } catch (err) {
          // Skip individual file errors silently
        }

        filesProcessed++;

        // Yield to event loop every 20 files to keep Electron responsive
        if (filesProcessed % 20 === 0) {
          await this.yieldToEventLoop();
          emitProgress({
            phase: 'chunking',
            currentFile: file.relativePath,
            filesProcessed,
            filesTotal: totalFiles,
            chunksCreated: allChunks.length,
            overallPercent: Math.round((filesProcessed / totalFiles) * 45) + 5,
          });
        }
      }

      log.info(`Chunking done: ${allChunks.length} chunks from ${totalFiles} files`);
      emitProgress({
        phase: 'saving',
        filesProcessed: totalFiles,
        filesTotal: totalFiles,
        chunksCreated: allChunks.length,
        overallPercent: 50,
      });

      // ─── Phase 3: Store chunks in SQLite ───
      // Batch insert chunks (metadata)
      const CHUNK_BATCH = 500;
      for (let i = 0; i < allChunks.length; i += CHUNK_BATCH) {
        const batch = allChunks.slice(i, i + CHUNK_BATCH);
        this.dbService.upsertChunks(batch);
      }

      // Update folder stats
      this.updateFolderStats(allChunks, allFiles, userFolders);

      emitProgress({
        phase: 'embedding',
        filesProcessed: totalFiles,
        filesTotal: totalFiles,
        chunksCreated: allChunks.length,
        overallPercent: 55,
      });

      // ─── Phase 4: Embeddings — batch with progress ───
      if (!this.embeddingService.hasOpenAI()) {
        // Use worker thread for IDF build (non-blocking)
        await this.embeddingService.buildIDFAsync(allTexts);
      }

      if (allChunks.length > 0) {
        const EMBED_BATCH = 100;
        const embeddingEntries: Array<{ chunkId: string; embedding: number[] }> = [];

        for (let i = 0; i < allTexts.length; i += EMBED_BATCH) {
          const batchTexts = allTexts.slice(i, i + EMBED_BATCH);
          const embeddings = await this.embeddingService.embedBatch(batchTexts);

          for (let j = 0; j < embeddings.length; j++) {
            embeddingEntries.push({
              chunkId: allChunks[i + j].id,
              embedding: embeddings[j],
            });
          }

          // Batch insert embeddings into vec0 every 500
          if (embeddingEntries.length >= 500) {
            this.dbService.upsertChunkEmbeddings(embeddingEntries);
            embeddingEntries.length = 0;
          }

          await this.yieldToEventLoop();
          const embedPercent = Math.round(((i + batchTexts.length) / allTexts.length) * 100);
          const overallPercent = 55 + Math.round(embedPercent * 0.4); // 55-95%
          emitProgress({
            phase: 'embedding',
            filesProcessed: totalFiles,
            filesTotal: totalFiles,
            chunksCreated: allChunks.length,
            embeddingPercent: embedPercent,
            overallPercent,
          });
        }

        // Flush remaining embeddings
        if (embeddingEntries.length > 0) {
          this.dbService.upsertChunkEmbeddings(embeddingEntries);
        }
      }

      // ─── Phase 5: Done ───
      this.indexed = true;

      log.info(`Indexing complete. ${allChunks.length} chunks indexed in SQLite.`);
      emitProgress({
        phase: 'done',
        filesProcessed: totalFiles,
        filesTotal: totalFiles,
        chunksCreated: allChunks.length,
        embeddingPercent: 100,
        overallPercent: 100,
      });
    } catch (err: any) {
      log.error('Reindex failed:', err);
      emitProgress({ phase: 'error', error: err?.message || 'Unknown error' });
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Update folder stats after indexing (stores in SQLite).
   */
  private updateFolderStats(
    allChunks: RAGChunk[],
    allFiles: Array<{ path: string; sourceFolder: string }>,
    userFolders: string[],
  ): void {
    const wsFiles = allFiles.filter((f) => f.sourceFolder === 'workspace');
    const wsChunks = allChunks.filter((c) => !c.sourceFolder || c.sourceFolder === 'workspace');
    this.dbService.upsertFolderStats('workspace', wsFiles.length, wsChunks.length);

    for (const folder of userFolders) {
      const folderFiles = allFiles.filter((f) => f.sourceFolder === folder);
      const folderChunks = allChunks.filter((c) => c.sourceFolder === folder);
      this.dbService.upsertFolderStats(folder, folderFiles.length, folderChunks.length);
    }
  }

  /**
   * Index a single folder (incremental — add to existing index).
   * Non-blocking with progress reporting.
   */
  private async indexFolder(folderPath: string): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;

    try {
      // Remove existing chunks for this folder
      this.dbService.deleteChunksByFolder(folderPath);

      const files = this.collectFiles(folderPath, folderPath, false);
      log.info(`Indexing folder ${folderPath}: ${files.length} files`);

      this.onProgress?.({
        phase: 'chunking',
        filesProcessed: 0,
        filesTotal: files.length,
        chunksCreated: 0,
        embeddingPercent: 0,
        overallPercent: 5,
      });

      const newChunks: RAGChunk[] = [];
      const texts: string[] = [];
      let processed = 0;

      for (const file of files) {
        try {
          const ext = path.extname(file.path).toLowerCase();
          if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
            const binChunks = await this.chunkBinaryDocumentAsync(file.path, file.relativePath, file.sourceFolder);
            newChunks.push(...binChunks);
            texts.push(...binChunks.map((c) => c.content));
          } else {
            const chunks = this.chunkFile(file.path, file.relativePath, file.sourceFolder);
            newChunks.push(...chunks);
            texts.push(...chunks.map((c) => c.content));
          }
        } catch {
          /* skip */
        }

        processed++;
        if (processed % 50 === 0) {
          await this.yieldToEventLoop();
          this.onProgress?.({
            phase: 'chunking',
            currentFile: file.relativePath,
            filesProcessed: processed,
            filesTotal: files.length,
            chunksCreated: newChunks.length,
            embeddingPercent: 0,
            overallPercent: 5 + Math.round((processed / files.length) * 45),
          });
        }
      }

      if (newChunks.length > 0) {
        // Store chunks in SQLite
        this.dbService.upsertChunks(newChunks);

        // Generate and store embeddings
        if (!this.embeddingService.hasOpenAI()) {
          await this.embeddingService.buildIDFAsync(texts);
        }

        const embeddings = await this.embeddingService.embedBatch(texts);
        const embeddingEntries = newChunks.map((chunk, i) => ({
          chunkId: chunk.id,
          embedding: embeddings[i],
        }));
        this.dbService.upsertChunkEmbeddings(embeddingEntries);
      }

      // Update folder stats
      this.dbService.upsertFolderStats(folderPath, files.length, newChunks.length);

      this.indexed = true;
      log.info(`Folder indexed: ${newChunks.length} new chunks`);
    } catch (err) {
      log.error(`Failed to index folder ${folderPath}:`, err);
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Incremental reindex — only reindex changed files.
   */
  async incrementalReindex(changedPaths: string[]): Promise<void> {
    if (this.indexing || changedPaths.length === 0) return;
    this.indexing = true;

    try {
      log.info(`Incremental reindex: ${changedPaths.length} files changed`);

      for (const filePath of changedPaths) {
        const ext = path.extname(filePath).toLowerCase();
        const allowedExtensions = this.getIndexedExtensions();
        if (!allowedExtensions.includes(ext)) continue;

        // Remove old chunks for this file
        const normalizedPath = path.resolve(filePath);
        const sourceFolder = this.findSourceFolder(normalizedPath);
        if (!sourceFolder) continue;

        const basePath = sourceFolder === 'workspace' ? this.workspacePath : sourceFolder;
        const relativePath = path.relative(basePath, normalizedPath);

        // Delete old chunks for this file from SQLite
        this.dbService.deleteChunksByFile(relativePath);

        // Re-chunk if file still exists
        if (fs.existsSync(filePath)) {
          let newChunks: RAGChunk[];
          if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
            newChunks = await this.chunkBinaryDocumentAsync(filePath, relativePath, sourceFolder);
          } else {
            newChunks = this.chunkFile(filePath, relativePath, sourceFolder);
          }

          if (newChunks.length > 0) {
            // Store chunks
            this.dbService.upsertChunks(newChunks);

            // Generate and store embeddings
            const texts = newChunks.map((c) => c.content);
            const embeddings = await this.embeddingService.embedBatch(texts);
            const embeddingEntries = newChunks.map((chunk, i) => ({
              chunkId: chunk.id,
              embedding: embeddings[i],
            }));
            this.dbService.upsertChunkEmbeddings(embeddingEntries);
          }
        }
      }
    } catch (err) {
      log.error('Incremental reindex failed:', err);
    } finally {
      this.indexing = false;
    }
  }

  // --- Search ---

  /**
   * Hybrid search — combines vector KNN (sqlite-vec) + FTS5 keyword search.
   * Falls back to FTS5-only if no vec0, or vector-only if query is very short.
   */
  async search(query: string, topK: number = 5, minScore: number = 0.0): Promise<RAGSearchResult[]> {
    if (!this.indexed || this.dbService.getRAGChunkCount() === 0) {
      await this.reindex();
      if (!this.indexed) {
        throw new Error('RAG service not indexed: reindex failed');
      }
    }

    const queryEmbedding = await this.embeddingService.embed(query);
    const hybridResults = this.dbService.hybridSearch(queryEmbedding, query, topK);

    // Convert HybridSearchResult to RAGSearchResult for backward compatibility
    return hybridResults
      .filter((r) => r.combinedScore >= minScore)
      .map((r) => ({
        chunk: {
          id: r.chunkId,
          filePath: r.filePath,
          fileName: r.fileName,
          section: r.section,
          content: r.content,
          charCount: r.charCount,
          sourceFolder: r.sourceFolder,
          fileType: r.fileType,
          mtime: r.mtime,
        },
        score: r.combinedScore,
      }));
  }

  /**
   * Build RAG context for AI — inject relevant memory into system prompt.
   */
  async buildRAGContext(query: string, maxTokens: number = 2000): Promise<string> {
    const results = await this.search(query, 8);
    if (results.length === 0) return '';

    const lines: string[] = ['## Relevantne fragmenty wiedzy (RAG)\n'];
    let currentTokens = 0;

    for (const { chunk, score } of results) {
      const source =
        chunk.sourceFolder && chunk.sourceFolder !== 'workspace' ? path.basename(chunk.sourceFolder) : 'memory';
      const typeLabel = chunk.fileType ? `[${chunk.fileType}]` : '';
      const chunkText = `### [${source}] ${typeLabel} ${chunk.fileName} > ${chunk.section}\n${chunk.content}\n(score: ${score.toFixed(4)})\n`;
      const approxTokens = chunkText.length / 4;

      if (currentTokens + approxTokens > maxTokens) break;

      lines.push(chunkText);
      currentTokens += approxTokens;
    }

    return lines.join('\n');
  }

  /**
   * Get index stats.
   */
  getStats(): {
    totalChunks: number;
    totalFiles: number;
    indexed: boolean;
    embeddingType: 'openai' | 'tfidf';
    folders: IndexedFolderInfo[];
    vectorSearchAvailable: boolean;
  } {
    const folders = this.getFolderStats();
    const totalFiles = folders.reduce((sum, f) => sum + f.fileCount, 0);
    return {
      totalChunks: this.dbService.getRAGChunkCount(),
      totalFiles,
      indexed: this.indexed,
      embeddingType: this.embeddingService.hasOpenAI() ? 'openai' : 'tfidf',
      folders,
      vectorSearchAvailable: this.dbService.hasVectorSearch(),
    };
  }

  /**
   * Cleanup  stop watchers.
   */
  destroy(): void {
    this.stopWatchers();
  }

  // --- File Collection ---

  private collectFiles(
    rootDir: string,
    sourceFolder: string,
    isWorkspace: boolean,
  ): Array<{ path: string; relativePath: string; sourceFolder: string }> {
    const files: Array<{ path: string; relativePath: string; sourceFolder: string }> = [];
    const allowedExtensions = new Set(this.getIndexedExtensions());

    if (isWorkspace) {
      // Workspace mode: scan root .md files + memory/ subdirectory
      this.scanDirGeneric(rootDir, files, allowedExtensions, sourceFolder, rootDir, false);
      const memoryDir = path.join(rootDir, 'memory');
      if (fs.existsSync(memoryDir)) {
        this.scanDirGeneric(memoryDir, files, allowedExtensions, sourceFolder, rootDir, true);
      }
    } else {
      // External folder: recursive scan with exclusions
      this.scanDirGeneric(rootDir, files, allowedExtensions, sourceFolder, rootDir, true);
    }

    return files;
  }

  private scanDirGeneric(
    dir: string,
    files: Array<{ path: string; relativePath: string; sourceFolder: string }>,
    allowedExtensions: Set<string>,
    sourceFolder: string,
    rootDir: string,
    recursive: boolean,
  ): void {
    if (files.length >= MAX_TOTAL_FILES) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= MAX_TOTAL_FILES) return;

        const fullPath = path.join(dir, entry.name);

        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!allowedExtensions.has(ext)) continue;

          // Skip large files
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > MAX_FILE_SIZE) continue;
          } catch {
            continue;
          }

          files.push({
            path: fullPath,
            relativePath: path.relative(rootDir, fullPath),
            sourceFolder,
          });
        } else if (entry.isDirectory() && recursive) {
          // Skip excluded directories
          if (EXCLUDED_DIRS.has(entry.name)) continue;
          if (entry.name.startsWith('.')) continue;

          this.scanDirGeneric(fullPath, files, allowedExtensions, sourceFolder, rootDir, true);
        }
      }
    } catch {
      /* ignore unreadable dirs */
    }
  }

  // --- Smart Chunking ---

  private chunkFile(filePath: string, relativePath: string, sourceFolder: string): RAGChunk[] {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    // Binary document formats — need special extraction
    if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
      return this.chunkBinaryDocument(filePath, relativePath, sourceFolder, ext, fileName);
    }

    let content: string;
    try {
      // For large text files, read only first MAX_TEXT_READ bytes
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_TEXT_READ) {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(MAX_TEXT_READ);
        fs.readSync(fd, buffer, 0, MAX_TEXT_READ, 0);
        fs.closeSync(fd);
        content = buffer.toString('utf8');
      } else {
        content = fs.readFileSync(filePath, 'utf8');
      }
    } catch {
      return [];
    }

    // Skip empty / binary-looking files
    if (content.length < 20) return [];
    if (content.includes('\0')) return []; // Binary file

    return this.chunkTextContent(content, ext, fileName, relativePath, sourceFolder, filePath);
  }

  /** Chunk already-extracted text content using format-appropriate strategy */
  private chunkTextContent(
    content: string,
    ext: string,
    fileName: string,
    relativePath: string,
    sourceFolder: string,
    filePath: string,
  ): RAGChunk[] {
    const chunks: RAGChunk[] = [];

    let mtime = 0;
    try {
      mtime = fs.statSync(filePath).mtimeMs;
    } catch {
      /* ok */
    }

    // Choose chunking strategy based on file type
    let sections: Array<{ header: string; content: string }>;

    if (ext === '.md' || ext === '.mdx' || ext === '.markdown' || ext === '.rst') {
      sections = this.chunkByHeaders(content);
    } else if (CODE_EXTENSIONS.has(ext)) {
      sections = this.chunkCode(content, ext);
    } else if (ext === '.json' || ext === '.jsonc' || ext === '.json5') {
      sections = this.chunkJSON(content);
    } else if (ext === '.yaml' || ext === '.yml' || ext === '.toml') {
      sections = this.chunkYAML(content);
    } else if (ext === '.csv' || ext === '.tsv') {
      sections = this.chunkCSV(content);
    } else {
      sections = this.chunkPlainText(content);
    }

    for (const section of sections) {
      if (section.content.trim().length < 20) continue;

      const subChunks = this.splitLargeChunk(section.content, 1500);

      for (let i = 0; i < subChunks.length; i++) {
        const subSection = subChunks.length > 1 ? `${section.header} (${i + 1}/${subChunks.length})` : section.header;

        chunks.push({
          id: `${sourceFolder}:${relativePath}:${subSection}:${i}`,
          filePath: relativePath,
          fileName,
          section: subSection,
          content: subChunks[i],
          charCount: subChunks[i].length,
          sourceFolder,
          fileType: ext.slice(1),
          mtime,
        });
      }
    }

    return chunks;
  }

  // --- Binary Document Extraction ---

  /** Extract text from binary documents (PDF, DOCX, EPUB) and chunk them */
  private chunkBinaryDocument(
    filePath: string,
    relativePath: string,
    sourceFolder: string,
    ext: string,
    fileName: string,
  ): RAGChunk[] {
    // We must use sync approach here; extraction is async so we cache results
    // The actual extraction happens in chunkBinaryDocumentAsync, called during indexing
    return [];
  }

  /** Async extraction for binary documents — called during indexAll/incrementalReindex */
  async chunkBinaryDocumentAsync(filePath: string, relativePath: string, sourceFolder: string): Promise<RAGChunk[]> {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    let mtime = 0;
    try {
      mtime = fs.statSync(filePath).mtimeMs;
    } catch {
      /* ok */
    }

    let text = '';

    try {
      if (ext === '.pdf') {
        text = await this.extractPDFText(filePath);
      } else if (ext === '.docx') {
        text = await this.extractDOCXText(filePath);
      } else if (ext === '.epub') {
        text = await this.extractEPUBText(filePath);
      }
    } catch (err) {
      console.warn(`[RAG] Failed to extract text from ${relativePath}:`, err);
      return [];
    }

    if (text.length < 20) return [];

    // Use plain text chunking for extracted content
    const sections = this.chunkPlainText(text);
    const chunks: RAGChunk[] = [];

    for (const section of sections) {
      if (section.content.trim().length < 20) continue;

      const subChunks = this.splitLargeChunk(section.content, 1500);

      for (let i = 0; i < subChunks.length; i++) {
        const subSection = subChunks.length > 1 ? `${section.header} (${i + 1}/${subChunks.length})` : section.header;

        chunks.push({
          id: `${sourceFolder}:${relativePath}:${subSection}:${i}`,
          filePath: relativePath,
          fileName,
          section: subSection,
          content: subChunks[i],
          charCount: subChunks[i].length,
          sourceFolder,
          fileType: ext.slice(1),
          mtime,
        });
      }
    }

    return chunks;
  }

  /** Extract text from PDF using pdf-parse */
  private async extractPDFText(filePath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    const pdf = new PDFParse({ data: new Uint8Array(dataBuffer) });
    const result = await pdf.getText();
    await pdf.destroy();
    return result.text;
  }

  /** Extract text from DOCX via mammoth (cross-platform, replaces PowerShell approach) */
  private async extractDOCXText(filePath: string): Promise<string> {
    if (this.fileIntelligence) {
      try {
        const result = await this.fileIntelligence.extractText(filePath);
        return result.text;
      } catch (err) {
        log.warn(`FileIntelligence DOCX extraction failed for ${filePath}:`, err);
        return '';
      }
    }
    // Fallback: mammoth bezpośrednio
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    } catch {
      return '';
    }
  }

  /** Extract text from EPUB via FileIntelligenceService */
  private async extractEPUBText(filePath: string): Promise<string> {
    if (this.fileIntelligence) {
      try {
        const result = await this.fileIntelligence.extractText(filePath);
        return result.text;
      } catch (err) {
        log.warn(`FileIntelligence EPUB extraction failed for ${filePath}:`, err);
        return '';
      }
    }
    return '';
  }

  // --- Chunking Strategies ---

  /** Markdown/RST: split by headers */
  private chunkByHeaders(content: string): Array<{ header: string; content: string }> {
    const lines = content.split('\n');
    const sections: Array<{ header: string; content: string }> = [];
    let currentHeader = 'Intro';
    let currentLines: string[] = [];

    for (const line of lines) {
      const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (headerMatch) {
        if (currentLines.length > 0) {
          sections.push({
            header: currentHeader,
            content: currentLines.join('\n').trim(),
          });
        }
        currentHeader = headerMatch[1].trim();
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        header: currentHeader,
        content: currentLines.join('\n').trim(),
      });
    }

    return sections;
  }

  /** Source code: split by function/class definitions */
  private chunkCode(content: string, ext: string): Array<{ header: string; content: string }> {
    const lines = content.split('\n');
    const sections: Array<{ header: string; content: string }> = [];

    const patterns = this.getCodePatterns(ext);

    let currentHeader = 'module';
    let currentLines: string[] = [];
    let braceDepth = 0;

    for (const line of lines) {
      // Check if this line starts a new top-level definition
      let matched = false;
      if (braceDepth <= 1) {
        for (const pattern of patterns) {
          const m = line.match(pattern);
          if (m) {
            // Save previous section
            if (currentLines.length > 0) {
              sections.push({
                header: currentHeader,
                content: currentLines.join('\n').trim(),
              });
            }
            currentHeader = m[1] || m[0].trim().slice(0, 60);
            currentLines = [line];
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        currentLines.push(line);
      }

      // Track brace depth for block detection
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        header: currentHeader,
        content: currentLines.join('\n').trim(),
      });
    }

    // If no code patterns matched, fallback to line-based chunks
    if (sections.length <= 1 && content.length > 2000) {
      return this.chunkByLines(content, 80);
    }

    return sections;
  }

  /** Get regex patterns for code symbol detection based on file extension */
  private getCodePatterns(ext: string): RegExp[] {
    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return [
          /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
          /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
          /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
          /^(?:export\s+)?interface\s+(\w+)/,
          /^(?:export\s+)?type\s+(\w+)/,
          /^(?:export\s+)?enum\s+(\w+)/,
        ];
      case '.py':
      case '.pyx':
        return [/^(?:async\s+)?def\s+(\w+)/, /^class\s+(\w+)/];
      case '.java':
      case '.kt':
      case '.scala':
        return [
          /^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/,
          /^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?interface\s+(\w+)/,
          /^(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/,
        ];
      case '.go':
        return [/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/, /^type\s+(\w+)\s+(?:struct|interface)/];
      case '.rs':
        return [
          /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
          /^(?:pub\s+)?struct\s+(\w+)/,
          /^(?:pub\s+)?enum\s+(\w+)/,
          /^(?:pub\s+)?trait\s+(\w+)/,
          /^impl(?:<[^>]+>)?\s+(\w+)/,
        ];
      case '.cs':
        return [
          /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:partial\s+)?class\s+(\w+)/,
          /^(?:public|private|protected|internal)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/,
        ];
      case '.rb':
        return [/^(?:\s*)def\s+(\w+)/, /^(?:\s*)class\s+(\w+)/, /^(?:\s*)module\s+(\w+)/];
      case '.php':
        return [/^(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)/, /^class\s+(\w+)/];
      default:
        return [/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, /^class\s+(\w+)/, /^def\s+(\w+)/];
    }
  }

  /** JSON: split by top-level keys */
  private chunkJSON(content: string): Array<{ header: string; content: string }> {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) {
        return [{ header: 'json', content }];
      }

      const sections: Array<{ header: string; content: string }> = [];
      for (const [key, value] of Object.entries(parsed)) {
        const serialized = JSON.stringify(value, null, 2);
        sections.push({
          header: key,
          content: `${key}: ${serialized}`,
        });
      }
      return sections.length > 0 ? sections : [{ header: 'json', content }];
    } catch {
      return this.chunkPlainText(content);
    }
  }

  /** YAML/TOML: split by top-level keys (simplified) */
  private chunkYAML(content: string): Array<{ header: string; content: string }> {
    const lines = content.split('\n');
    const sections: Array<{ header: string; content: string }> = [];
    let currentKey = 'config';
    let currentLines: string[] = [];

    for (const line of lines) {
      const keyMatch = line.match(/^(\w[\w.-]*)\s*:/);
      if (keyMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
        if (currentLines.length > 0) {
          sections.push({
            header: currentKey,
            content: currentLines.join('\n').trim(),
          });
        }
        currentKey = keyMatch[1];
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        header: currentKey,
        content: currentLines.join('\n').trim(),
      });
    }

    return sections;
  }

  /** CSV/TSV: chunk by rows (50 rows per chunk) */
  private chunkCSV(content: string): Array<{ header: string; content: string }> {
    const lines = content.split('\n');
    const header = lines[0] || '';
    const sections: Array<{ header: string; content: string }> = [];
    const ROWS_PER_CHUNK = 50;

    for (let i = 1; i < lines.length; i += ROWS_PER_CHUNK) {
      const slice = lines.slice(i, i + ROWS_PER_CHUNK);
      sections.push({
        header: `rows ${i}-${i + slice.length - 1}`,
        content: header + '\n' + slice.join('\n'),
      });
    }

    return sections.length > 0 ? sections : [{ header: 'data', content }];
  }

  /** Plain text: split by paragraphs or lines */
  private chunkPlainText(content: string): Array<{ header: string; content: string }> {
    const paragraphs = content.split(/\n\n+/);
    if (paragraphs.length > 1) {
      const sections: Array<{ header: string; content: string }> = [];
      let current = '';
      let idx = 0;

      for (const para of paragraphs) {
        if (current.length + para.length > 1500 && current.length > 0) {
          sections.push({ header: `section ${idx + 1}`, content: current.trim() });
          current = '';
          idx++;
        }
        current += para + '\n\n';
      }

      if (current.trim().length > 0) {
        sections.push({ header: `section ${idx + 1}`, content: current.trim() });
      }

      return sections;
    }

    return this.chunkByLines(content, 80);
  }

  /** Line-based chunking (fallback) */
  private chunkByLines(content: string, linesPerChunk: number): Array<{ header: string; content: string }> {
    const lines = content.split('\n');
    const sections: Array<{ header: string; content: string }> = [];

    for (let i = 0; i < lines.length; i += linesPerChunk) {
      const slice = lines.slice(i, i + linesPerChunk);
      sections.push({
        header: `lines ${i + 1}-${i + slice.length}`,
        content: slice.join('\n'),
      });
    }

    return sections;
  }

  private splitLargeChunk(text: string, maxChars: number): string[] {
    if (text.length <= maxChars) return [text];

    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);
    let current = '';

    for (const para of paragraphs) {
      // If a single paragraph exceeds maxChars, split it by sentences or hard limit
      if (para.length > maxChars) {
        // Flush current buffer first
        if (current.trim().length > 0) {
          chunks.push(current.trim());
          current = '';
        }
        // Split oversized paragraph by sentences
        const sentences = para.split(/(?<=[.!?])\s+/);
        let sentBuf = '';
        for (const sent of sentences) {
          if (sentBuf.length + sent.length + 1 > maxChars && sentBuf.length > 0) {
            chunks.push(sentBuf.trim());
            sentBuf = '';
          }
          // If a single sentence still exceeds maxChars, hard-split it
          if (sent.length > maxChars) {
            for (let i = 0; i < sent.length; i += maxChars) {
              chunks.push(sent.slice(i, i + maxChars));
            }
          } else {
            sentBuf += sent + ' ';
          }
        }
        if (sentBuf.trim().length > 0) {
          chunks.push(sentBuf.trim());
        }
        continue;
      }

      if (current.length + para.length + 2 > maxChars && current.length > 0) {
        chunks.push(current.trim());
        current = '';
      }
      current += para + '\n\n';
    }

    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
  }

  // --- File Watching ---

  private startWatchers(): void {
    this.stopWatchers();

    // Watch entire workspace (includes memory/ and top-level files)
    if (fs.existsSync(this.workspacePath)) {
      this.startWatcherForFolder(this.workspacePath);
    }

    // Watch user folders (external, outside workspace)
    for (const folder of this.getIndexedFolders()) {
      // Skip if already covered by workspace watcher
      if (folder.startsWith(this.workspacePath)) continue;
      if (fs.existsSync(folder)) {
        this.startWatcherForFolder(folder);
      }
    }
  }

  private startWatcherForFolder(folderPath: string): void {
    try {
      const watcher = fs.watch(folderPath, { recursive: true }, (_event, filename) => {
        if (!filename) return;

        const fullPath = path.join(folderPath, filename);
        const ext = path.extname(filename).toLowerCase();
        const allowedExtensions = new Set(this.getIndexedExtensions());

        if (!allowedExtensions.has(ext)) return;
        if (EXCLUDED_DIRS.has(filename.split(path.sep)[0])) return;

        this.pendingChanges.add(fullPath);

        // Debounce: wait 5s after last change before reindexing
        if (this.watcherDebounce) clearTimeout(this.watcherDebounce);
        this.watcherDebounce = setTimeout(async () => {
          const changes = Array.from(this.pendingChanges);
          this.pendingChanges.clear();
          if (changes.length > 0) {
            console.log(`[RAG] File watcher: ${changes.length} files changed, incremental reindex`);
            await this.incrementalReindex(changes);
          }
        }, 5000);
      });

      this.watchers.push(watcher);
    } catch (err) {
      console.warn(`[RAG] Failed to watch ${folderPath}:`, err);
    }
  }

  private stopWatchers(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ok */
      }
    }
    this.watchers = [];
    if (this.watcherDebounce) {
      clearTimeout(this.watcherDebounce);
      this.watcherDebounce = null;
    }
  }

  // --- Helpers ---

  private findSourceFolder(filePath: string): string | null {
    const normalized = path.resolve(filePath);
    if (normalized.startsWith(this.workspacePath)) return 'workspace';
    for (const folder of this.getIndexedFolders()) {
      if (normalized.startsWith(folder)) return folder;
    }
    return null;
  }

  // --- Legacy Index Migration ---

  /**
   * Migrate legacy index.json to SQLite (one-time operation).
   * Reads chunks from JSON, inserts into rag_chunks table,
   * then renames the old file to .migrated.
   */
  private migrateLegacyIndex(): void {
    try {
      if (!fs.existsSync(this.legacyIndexPath)) return;

      // Don't migrate if SQLite already has data
      if (this.dbService.getRAGChunkCount() > 0) {
        log.info('SQLite already has RAG data, skipping legacy migration');
        // Rename legacy file to avoid re-checking
        try {
          fs.renameSync(this.legacyIndexPath, this.legacyIndexPath + '.migrated');
        } catch {}
        return;
      }

      log.info('Migrating legacy index.json to SQLite...');
      const data = JSON.parse(fs.readFileSync(this.legacyIndexPath, 'utf8'));

      if (Array.isArray(data.chunks) && data.chunks.length > 0) {
        const chunks: RAGChunk[] = data.chunks;
        this.dbService.upsertChunks(chunks);
        log.info(`Migrated ${chunks.length} chunks from legacy index.json`);

        // Migrate folder stats if present
        if (data.folderStats) {
          for (const [key, stats] of Object.entries(data.folderStats) as [string, any][]) {
            this.dbService.upsertFolderStats(stats.path || key, stats.fileCount || 0, stats.chunkCount || 0);
          }
        }
      }

      // Rename legacy file
      try {
        fs.renameSync(this.legacyIndexPath, this.legacyIndexPath + '.migrated');
      } catch {}
      log.info('Legacy index migration complete');
    } catch (err) {
      log.warn('Legacy index migration failed (will rebuild on next reindex):', err);
    }
  }
}
