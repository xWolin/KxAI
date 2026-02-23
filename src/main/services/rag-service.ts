import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { EmbeddingService } from './embedding-service';
import { ConfigService } from './config';
import { PDFParse } from 'pdf-parse';

/**
 * Chunk  fragment pliku z metadanymi.
 */
export interface RAGChunk {
  id: string;
  filePath: string;        // Relative path within source folder
  fileName: string;
  section: string;
  content: string;
  embedding?: number[];
  charCount: number;
  sourceFolder?: string;   // Which indexed folder this came from
  fileType?: string;       // Extension: 'md', 'ts', 'py', etc.
  mtime?: number;          // File modification time for incremental reindex
}

export interface RAGSearchResult {
  chunk: RAGChunk;
  score: number;
}

export interface IndexedFolderInfo {
  path: string;
  fileCount: number;
  chunkCount: number;
  lastIndexed: number;
}

// --- File type configuration ---

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyx',
  '.java', '.kt', '.scala',
  '.cpp', '.c', '.h', '.hpp', '.cc',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  '.lua',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql',
  '.r', '.R',
]);

const DOCUMENT_EXTENSIONS = new Set([
  '.md', '.mdx', '.markdown',
  '.txt', '.text', '.rst',
  '.json', '.jsonc', '.json5',
  '.yaml', '.yml',
  '.toml',
  '.xml',
  '.csv', '.tsv',
  '.ini', '.cfg', '.conf',
  '.env', '.env.example',
  '.log',
  '.html', '.htm',
  '.css', '.scss', '.less',
  '.svg',
]);

/** Binary document formats that need special extraction */
const BINARY_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.epub',
]);

const DEFAULT_EXTENSIONS = new Set([...CODE_EXTENSIONS, ...DOCUMENT_EXTENSIONS, ...BINARY_DOCUMENT_EXTENSIONS]);

/** Directories always excluded from scanning */
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  '__pycache__', '.pytest_cache', '.mypy_cache',
  '.venv', 'venv', 'env', '.env',
  '.next', '.nuxt', '.output',
  '.cache', '.tmp', '.temp',
  'coverage', '.nyc_output',
  '.idea', '.vscode', '.vs',
  'vendor', 'packages',
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
/**
 * Progress callback for indexing operations.
 * Emitted periodically so the UI can show a loading bar.
 */
export interface IndexProgress {
  phase: 'scanning' | 'chunking' | 'embedding' | 'saving' | 'done' | 'error';
  /** Current file being processed (for chunking phase) */
  currentFile?: string;
  /** Files processed so far */
  filesProcessed: number;
  /** Total files discovered */
  filesTotal: number;
  /** Chunks created so far */
  chunksCreated: number;
  /** Embedding progress (0-100) */
  embeddingPercent: number;
  /** Overall percent 0-100 */
  overallPercent: number;
  /** Error message if phase === 'error' */
  error?: string;
}

export class RAGService {
  private embeddingService: EmbeddingService;
  private config: ConfigService;
  private workspacePath: string;
  private indexPath: string;
  private chunks: RAGChunk[] = [];
  private indexed = false;
  private indexing = false;
  private watchers: fs.FSWatcher[] = [];
  private watcherDebounce: NodeJS.Timeout | null = null;
  private pendingChanges = new Set<string>();
  private folderStats = new Map<string, IndexedFolderInfo>();

  /** Progress callback — set from outside (e.g. IPC handler) */
  onProgress?: (progress: IndexProgress) => void;

  constructor(embeddingService: EmbeddingService, config: ConfigService) {
    this.embeddingService = embeddingService;
    this.config = config;
    const userDataPath = app.getPath('userData');
    this.workspacePath = path.join(userDataPath, 'workspace');
    this.indexPath = path.join(userDataPath, 'workspace', 'rag', 'index.json');
  }

  /**
   * Initialize RAG  load existing index or build new one.
   */
  async initialize(): Promise<void> {
    const loaded = this.loadIndex();
    if (!loaded) {
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

    // Remove chunks from this folder
    this.chunks = this.chunks.filter((c) => c.sourceFolder !== normalized);
    this.folderStats.delete(normalized);
    this.saveIndex();

    // Restart watchers
    this.stopWatchers();
    this.startWatchers();
  }

  /**
   * Get stats about indexed folders.
   */
  getFolderStats(): IndexedFolderInfo[] {
    const folders = this.getIndexedFolders();
    const stats: IndexedFolderInfo[] = [];

    // Workspace (always indexed)
    const wsChunks = this.chunks.filter((c) => !c.sourceFolder || c.sourceFolder === 'workspace');
    stats.push({
      path: this.workspacePath,
      fileCount: new Set(wsChunks.map((c) => c.filePath)).size,
      chunkCount: wsChunks.length,
      lastIndexed: this.folderStats.get('workspace')?.lastIndexed || 0,
    });

    // User folders
    for (const folder of folders) {
      const folderChunks = this.chunks.filter((c) => c.sourceFolder === folder);
      const info = this.folderStats.get(folder);
      stats.push({
        path: folder,
        fileCount: new Set(folderChunks.map((c) => c.filePath)).size,
        chunkCount: folderChunks.length,
        lastIndexed: info?.lastIndexed || 0,
      });
    }

    return stats;
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
    return this.chunks.length;
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
   * Full reindex — scan all folders, chunk, embed.
   * Non-blocking: yields to event loop periodically + reports progress.
   */
  async reindex(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;
    this.indexed = false;

    const emitProgress = (p: Partial<IndexProgress> & { phase: IndexProgress['phase'] }) => {
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
      console.log('[RAG] Starting full reindex...');
      emitProgress({ phase: 'scanning', overallPercent: 0 });

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
      console.log(`[RAG] Found ${totalFiles} files to index`);
      emitProgress({ phase: 'chunking', filesTotal: totalFiles, overallPercent: 5 });

      // ─── Phase 2: Chunk files — yield every 50 files ───
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

        // Yield to event loop every 50 files to keep Electron responsive
        if (filesProcessed % 50 === 0) {
          await this.yieldToEventLoop();
          const chunkPercent = Math.round((filesProcessed / totalFiles) * 45) + 5; // 5-50%
          emitProgress({
            phase: 'chunking',
            currentFile: file.relativePath,
            filesProcessed,
            filesTotal: totalFiles,
            chunksCreated: allChunks.length,
            overallPercent: chunkPercent,
          });
        }
      }

      // Update folder stats
      this.updateFolderStats(allChunks, allFiles, userFolders);

      // Safety check
      if (allChunks.length > MAX_TOTAL_FILES * 5) {
        console.warn(`[RAG] Chunk limit reached: ${allChunks.length}`);
      }

      console.log(`[RAG] Chunking done: ${allChunks.length} chunks from ${totalFiles} files`);
      emitProgress({
        phase: 'embedding',
        filesProcessed: totalFiles,
        filesTotal: totalFiles,
        chunksCreated: allChunks.length,
        overallPercent: 50,
      });

      // ─── Phase 3: Embeddings — batch with progress ───
      if (!this.embeddingService.hasOpenAI()) {
        this.embeddingService.buildIDF(allTexts);
      }

      if (allChunks.length > 0) {
        const EMBED_BATCH = 200; // Process embeddings in small batches
        for (let i = 0; i < allTexts.length; i += EMBED_BATCH) {
          const batchTexts = allTexts.slice(i, i + EMBED_BATCH);
          const embeddings = await this.embeddingService.embedBatch(batchTexts);
          for (let j = 0; j < embeddings.length; j++) {
            allChunks[i + j].embedding = embeddings[j];
          }

          await this.yieldToEventLoop();
          const embedPercent = Math.round(((i + batchTexts.length) / allTexts.length) * 100);
          const overallPercent = 50 + Math.round(embedPercent * 0.45); // 50-95%
          emitProgress({
            phase: 'embedding',
            filesProcessed: totalFiles,
            filesTotal: totalFiles,
            chunksCreated: allChunks.length,
            embeddingPercent: embedPercent,
            overallPercent,
          });
        }
      }

      // ─── Phase 4: Save ───
      emitProgress({
        phase: 'saving',
        filesProcessed: totalFiles,
        filesTotal: totalFiles,
        chunksCreated: allChunks.length,
        embeddingPercent: 100,
        overallPercent: 95,
      });

      this.chunks = allChunks;
      this.indexed = true;
      this.saveIndex();

      console.log(`[RAG] Indexing complete. ${this.chunks.length} chunks indexed.`);
      emitProgress({
        phase: 'done',
        filesProcessed: totalFiles,
        filesTotal: totalFiles,
        chunksCreated: allChunks.length,
        embeddingPercent: 100,
        overallPercent: 100,
      });
    } catch (err: any) {
      console.error('[RAG] Reindex failed:', err);
      emitProgress({ phase: 'error', error: err?.message || 'Unknown error' });
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Update folder stats after indexing.
   */
  private updateFolderStats(
    allChunks: RAGChunk[],
    allFiles: Array<{ path: string; sourceFolder: string }>,
    userFolders: string[]
  ): void {
    const wsFiles = allFiles.filter(f => f.sourceFolder === 'workspace');
    const wsChunks = allChunks.filter(c => !c.sourceFolder || c.sourceFolder === 'workspace');
    this.folderStats.set('workspace', {
      path: this.workspacePath,
      fileCount: wsFiles.length,
      chunkCount: wsChunks.length,
      lastIndexed: Date.now(),
    });
    for (const folder of userFolders) {
      const folderFiles = allFiles.filter(f => f.sourceFolder === folder);
      const folderChunks = allChunks.filter(c => c.sourceFolder === folder);
      this.folderStats.set(folder, {
        path: folder,
        fileCount: folderFiles.length,
        chunkCount: folderChunks.length,
        lastIndexed: Date.now(),
      });
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
      this.chunks = this.chunks.filter((c) => c.sourceFolder !== folderPath);
      const files = this.collectFiles(folderPath, folderPath, false);
      console.log(`[RAG] Indexing folder ${folderPath}: ${files.length} files`);

      this.onProgress?.({
        phase: 'chunking', filesProcessed: 0, filesTotal: files.length,
        chunksCreated: 0, embeddingPercent: 0, overallPercent: 5,
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
        } catch { /* skip */ }

        processed++;
        if (processed % 50 === 0) {
          await this.yieldToEventLoop();
          this.onProgress?.({
            phase: 'chunking', currentFile: file.relativePath,
            filesProcessed: processed, filesTotal: files.length,
            chunksCreated: newChunks.length, embeddingPercent: 0,
            overallPercent: 5 + Math.round((processed / files.length) * 45),
          });
        }
      }

      if (newChunks.length > 0) {
        if (!this.embeddingService.hasOpenAI()) {
          const allTexts = this.chunks.map((c) => c.content).concat(texts);
          this.embeddingService.buildIDF(allTexts);
        }

        const embeddings = await this.embeddingService.embedBatch(texts);
        for (let i = 0; i < newChunks.length; i++) {
          newChunks[i].embedding = embeddings[i];
        }

        this.chunks.push(...newChunks);
      }

      this.folderStats.set(folderPath, {
        path: folderPath,
        fileCount: files.length,
        chunkCount: newChunks.length,
        lastIndexed: Date.now(),
      });

      this.indexed = true;
      this.saveIndex();
      console.log(`[RAG] Folder indexed: ${newChunks.length} new chunks`);
    } catch (err) {
      console.error(`[RAG] Failed to index folder ${folderPath}:`, err);
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Incremental reindex  only reindex changed files.
   */
  async incrementalReindex(changedPaths: string[]): Promise<void> {
    if (this.indexing || changedPaths.length === 0) return;
    this.indexing = true;

    try {
      console.log(`[RAG] Incremental reindex: ${changedPaths.length} files changed`);

      for (const filePath of changedPaths) {
        const ext = path.extname(filePath).toLowerCase();
        const allowedExtensions = this.getIndexedExtensions();
        if (!allowedExtensions.includes(ext)) continue;

        // Remove old chunks for this file
        const normalizedPath = path.resolve(filePath);
        this.chunks = this.chunks.filter((c) => {
          const chunkAbsolute = c.sourceFolder
            ? path.resolve(c.sourceFolder === 'workspace' ? this.workspacePath : c.sourceFolder, c.filePath)
            : path.resolve(this.workspacePath, c.filePath);
          return chunkAbsolute !== normalizedPath;
        });

        // Re-chunk if file still exists
        if (fs.existsSync(filePath)) {
          const sourceFolder = this.findSourceFolder(filePath);
          if (!sourceFolder) continue;

          const basePath = sourceFolder === 'workspace' ? this.workspacePath : sourceFolder;
          const relativePath = path.relative(basePath, filePath);

          const ext = path.extname(filePath).toLowerCase();
          let newChunks: RAGChunk[];
          if (BINARY_DOCUMENT_EXTENSIONS.has(ext)) {
            newChunks = await this.chunkBinaryDocumentAsync(filePath, relativePath, sourceFolder);
          } else {
            newChunks = this.chunkFile(filePath, relativePath, sourceFolder);
          }

          if (newChunks.length > 0) {
            const texts = newChunks.map((c) => c.content);
            const embeddings = await this.embeddingService.embedBatch(texts);
            for (let i = 0; i < newChunks.length; i++) {
              newChunks[i].embedding = embeddings[i];
            }
            this.chunks.push(...newChunks);
          }
        }
      }

      this.saveIndex();
    } catch (err) {
      console.error('[RAG] Incremental reindex failed:', err);
    } finally {
      this.indexing = false;
    }
  }

  // --- Search ---

  /**
   * Semantic search  find most relevant chunks for a query.
   */
  async search(query: string, topK: number = 5, minScore: number = 0.3): Promise<RAGSearchResult[]> {
    if (!this.indexed || this.chunks.length === 0) {
      await this.reindex();
      if (!this.indexed) {
        throw new Error('RAG service not indexed: reindex failed');
      }
    }

    const queryEmbedding = await this.embeddingService.embed(query);

    const scored: RAGSearchResult[] = [];
    for (const chunk of this.chunks) {
      if (!chunk.embedding) continue;
      const score = this.embeddingService.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= minScore) {
        scored.push({ chunk, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Build RAG context for AI  inject relevant memory into system prompt.
   */
  async buildRAGContext(query: string, maxTokens: number = 2000): Promise<string> {
    const results = await this.search(query, 8);
    if (results.length === 0) return '';

    const lines: string[] = ['## Relevantne fragmenty wiedzy (RAG)\n'];
    let currentTokens = 0;

    for (const { chunk, score } of results) {
      const source = chunk.sourceFolder && chunk.sourceFolder !== 'workspace'
        ? path.basename(chunk.sourceFolder)
        : 'memory';
      const typeLabel = chunk.fileType ? `[${chunk.fileType}]` : '';
      const chunkText = `### [${source}] ${typeLabel} ${chunk.fileName} > ${chunk.section}\n${chunk.content}\n(score: ${score.toFixed(2)})\n`;
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
  } {
    const files = new Set(this.chunks.map((c) => `${c.sourceFolder || 'workspace'}|${c.filePath}`));
    return {
      totalChunks: this.chunks.length,
      totalFiles: files.size,
      indexed: this.indexed,
      embeddingType: this.embeddingService.hasOpenAI() ? 'openai' : 'tfidf',
      folders: this.getFolderStats(),
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
    isWorkspace: boolean
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
    recursive: boolean
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
          } catch { continue; }

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
    } catch { /* ignore unreadable dirs */ }
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
    content: string, ext: string, fileName: string,
    relativePath: string, sourceFolder: string, filePath: string,
  ): RAGChunk[] {
    const chunks: RAGChunk[] = [];

    let mtime = 0;
    try { mtime = fs.statSync(filePath).mtimeMs; } catch { /* ok */ }

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
        const subSection = subChunks.length > 1
          ? `${section.header} (${i + 1}/${subChunks.length})`
          : section.header;

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
    filePath: string, relativePath: string, sourceFolder: string,
    ext: string, fileName: string,
  ): RAGChunk[] {
    // We must use sync approach here; extraction is async so we cache results
    // The actual extraction happens in chunkBinaryDocumentAsync, called during indexing
    return [];
  }

  /** Async extraction for binary documents — called during indexAll/incrementalReindex */
  async chunkBinaryDocumentAsync(
    filePath: string, relativePath: string, sourceFolder: string,
  ): Promise<RAGChunk[]> {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    let mtime = 0;
    try { mtime = fs.statSync(filePath).mtimeMs; } catch { /* ok */ }

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
        const subSection = subChunks.length > 1
          ? `${section.header} (${i + 1}/${subChunks.length})`
          : section.header;

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

  /** Extract text from DOCX (ZIP with XML inside) */
  private async extractDOCXText(filePath: string): Promise<string> {
    // DOCX is a ZIP archive — word/document.xml contains the text
    const { execSync } = await import('child_process');
    try {
      // Use PowerShell to extract text from DOCX (no extra deps needed)
      const script = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead('${filePath.replace(/'/g, "''")}')
        $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
        if ($entry) {
          $reader = New-Object System.IO.StreamReader($entry.Open())
          $xml = $reader.ReadToEnd()
          $reader.Close()
          # Strip XML tags, keep text
          $xml -replace '<[^>]+>', ' ' -replace '\\s+', ' '
        }
        $zip.Dispose()
      `;
      const result = execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60000,
      });
      return result.trim();
    } catch {
      return '';
    }
  }

  /** Extract text from EPUB (ZIP with XHTML inside) */
  private async extractEPUBText(filePath: string): Promise<string> {
    const { execSync } = await import('child_process');
    try {
      const script = `
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead('${filePath.replace(/'/g, "''")}')
        $text = ''
        foreach ($entry in $zip.Entries) {
          if ($entry.FullName -match '\\.(xhtml|html|htm)$') {
            $reader = New-Object System.IO.StreamReader($entry.Open())
            $content = $reader.ReadToEnd()
            $reader.Close()
            $text += ($content -replace '<[^>]+>', ' ' -replace '\\s+', ' ') + \" \"
          }
        }
        $zip.Dispose()
        $text
      `;
      const result = execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60000,
      });
      return result.trim();
    } catch {
      return '';
    }
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
      case '.ts': case '.tsx': case '.js': case '.jsx': case '.mjs': case '.cjs':
        return [
          /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
          /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
          /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/,
          /^(?:export\s+)?interface\s+(\w+)/,
          /^(?:export\s+)?type\s+(\w+)/,
          /^(?:export\s+)?enum\s+(\w+)/,
        ];
      case '.py': case '.pyx':
        return [
          /^(?:async\s+)?def\s+(\w+)/,
          /^class\s+(\w+)/,
        ];
      case '.java': case '.kt': case '.scala':
        return [
          /^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/,
          /^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?interface\s+(\w+)/,
          /^(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+(\w+)\s*\(/,
        ];
      case '.go':
        return [
          /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/,
          /^type\s+(\w+)\s+(?:struct|interface)/,
        ];
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
        return [
          /^(?:\s*)def\s+(\w+)/,
          /^(?:\s*)class\s+(\w+)/,
          /^(?:\s*)module\s+(\w+)/,
        ];
      case '.php':
        return [
          /^(?:public|private|protected)?\s*(?:static\s+)?function\s+(\w+)/,
          /^class\s+(\w+)/,
        ];
      default:
        return [
          /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
          /^class\s+(\w+)/,
          /^def\s+(\w+)/,
        ];
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
      try { w.close(); } catch { /* ok */ }
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

  // --- Index Persistence ---

  private loadIndex(): boolean {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
        if (Array.isArray(data.chunks)) {
          this.chunks = data.chunks;
          this.indexed = true;
          if (data.folderStats) {
            this.folderStats = new Map(Object.entries(data.folderStats));
          }
          return true;
        }
      }
    } catch {
      /* corrupt index, will rebuild */
    }
    return false;
  }

  private saveIndex(): void {
    try {
      const dir = path.dirname(this.indexPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.indexPath, JSON.stringify({
        timestamp: Date.now(),
        chunks: this.chunks,
        folderStats: Object.fromEntries(this.folderStats),
      }), 'utf8');
    } catch (err) {
      console.error('[RAG] Failed to save index:', err);
    }
  }
}
