/**
 * Shared RAG (Retrieval-Augmented Generation) types — used by both main process and renderer.
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

/** Internal search result (used in main process) */
export interface RAGSearchResult {
  chunk: RAGChunk;
  score: number;
}

/** Flattened search result for IPC transport to renderer */
export interface RAGSearchResultFlat {
  fileName: string;
  section: string;
  content: string;
  score: number;
}

export interface RAGFolderInfo {
  path: string;
  fileCount: number;
  chunkCount: number;
  lastIndexed: number;
}

export interface RAGStats {
  totalChunks: number;
  totalFiles: number;
  indexed: boolean;
  embeddingType: 'openai' | 'tfidf';
  folders: RAGFolderInfo[];
}

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
