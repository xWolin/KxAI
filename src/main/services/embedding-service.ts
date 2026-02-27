import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { app } from 'electron';
import { SecurityService } from './security';
import { ConfigService } from './config';
import { DatabaseService, getModelDimension } from './database-service';
import { createLogger } from './logger';

const log = createLogger('EmbeddingService');

/**
 * EmbeddingService — generuje embeddingi tekstu.
 * Używa OpenAI text-embedding-3-small (lub innego modelu z configu).
 * Klucz API czytany z 'openai-embeddings' (dedykowany) lub fallback na 'openai' (główny).
 * Fallback: prosty TF-IDF jeśli brak klucza.
 *
 * v2: Cache embeddingów w SQLite (via DatabaseService) zamiast JSON file.
 *     In-memory LRU Map jako hot cache, SQLite jako persistent store.
 */
export class EmbeddingService {
  private security: SecurityService;
  private config: ConfigService;
  private dbService: DatabaseService;
  private openaiClient: any = null;
  private embeddingModel: string = 'text-embedding-3-small';
  private hotCache: Map<string, number[]> = new Map(); // in-memory hot cache
  private static readonly MAX_HOT_CACHE = 10000; // evict from memory when exceeded
  private static readonly MAX_DB_CACHE = 200000; // evict from SQLite when exceeded
  private initialized = false;

  // Legacy cache paths (for migration)
  private legacyCachePath: string;
  private legacyCacheModelPath: string;

  // TF-IDF fallback
  private idfMap: Map<string, number> = new Map();
  private vocabSize = 0;

  // Worker thread for CPU-intensive TF-IDF operations
  private worker: Worker | null = null;
  private workerReady = false;
  private workerMsgId = 0;
  private workerCallbacks = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  constructor(security: SecurityService, config: ConfigService, dbService: DatabaseService) {
    this.security = security;
    this.config = config;
    this.dbService = dbService;
    const userDataPath = app.getPath('userData');
    this.legacyCachePath = path.join(userDataPath, 'workspace', 'rag', 'embedding-cache.json');
    this.legacyCacheModelPath = path.join(userDataPath, 'workspace', 'rag', 'embedding-cache-model.txt');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Read embedding model from config
    const cfgModel = this.config.get('embeddingModel') as string | undefined;
    if (cfgModel) {
      this.embeddingModel = cfgModel;
    }

    // Migrate legacy JSON cache to SQLite (one-time operation)
    await this.migrateLegacyCache();

    // Try to initialize OpenAI client for embeddings
    // Priority: dedicated 'openai-embeddings' key > main 'openai' key
    const embeddingKey =
      (await this.security.getApiKey('openai-embeddings')) ?? (await this.security.getApiKey('openai'));
    if (embeddingKey) {
      try {
        const OpenAI = require('openai').default;
        this.openaiClient = new OpenAI({ apiKey: embeddingKey });
      } catch (err) {
        log.warn('Failed to init OpenAI client:', err);
      }
    }

    this.initialized = true;
    log.info(
      `Initialized (model: ${this.embeddingModel}, openai: ${!!this.openaiClient}, cache: ${this.dbService.getEmbeddingCacheSize()} entries)`,
    );
  }

  /**
   * Returns true if we can use OpenAI embeddings (vs TF-IDF fallback).
   */
  hasOpenAI(): boolean {
    return this.openaiClient !== null;
  }

  /**
   * Get the currently active embedding model name.
   */
  getModelName(): string {
    return this.embeddingModel;
  }

  /**
   * Get the expected embedding dimension for the active model.
   */
  getEmbeddingDimension(): number {
    if (!this.openaiClient) return 256; // TF-IDF fallback dimension
    return getModelDimension(this.embeddingModel);
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    await this.initialize();

    const hash = this.hashContent(text);

    // Check hot cache first (in-memory)
    const hotCached = this.hotCache.get(hash);
    if (hotCached) return hotCached;

    // Check SQLite cache
    const dbCached = this.dbService.getCachedEmbedding(hash);
    if (dbCached) {
      this.hotCache.set(hash, dbCached);
      this.evictHotCacheIfNeeded();
      return dbCached;
    }

    let embedding: number[];

    if (this.openaiClient) {
      try {
        embedding = await this.embedViaOpenAI(text);
      } catch (err: any) {
        log.warn('OpenAI embedding failed, falling back to TF-IDF:', err?.message || err);
        // Permanently disable OpenAI on quota/auth errors to avoid repeated failures
        if (err?.code === 'insufficient_quota' || err?.status === 401 || err?.status === 429) {
          log.warn('Disabling OpenAI embeddings due to quota/auth error. Using TF-IDF fallback.');
          this.openaiClient = null;
        }
        embedding = this.tfidfEmbed(text);
      }
    } else {
      embedding = this.tfidfEmbed(text);
    }

    // Store in both caches
    this.hotCache.set(hash, embedding);
    this.evictHotCacheIfNeeded();
    this.dbService.setCachedEmbedding(hash, embedding, this.embeddingModel);

    return embedding;
  }

  /**
   * Generate embeddings for a batch of texts (max 2048 per request).
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.initialize();

    const results: number[][] = [];
    const uncachedTexts: string[] = [];
    const uncachedIndexes: number[] = [];
    const uncachedHashes: string[] = [];

    // Check hot cache + SQLite cache first
    for (let i = 0; i < texts.length; i++) {
      const hash = this.hashContent(texts[i]);

      // Hot cache
      const hotCached = this.hotCache.get(hash);
      if (hotCached) {
        results[i] = hotCached;
        continue;
      }

      // SQLite cache
      const dbCached = this.dbService.getCachedEmbedding(hash);
      if (dbCached) {
        results[i] = dbCached;
        this.hotCache.set(hash, dbCached);
        continue;
      }

      uncachedTexts.push(texts[i]);
      uncachedIndexes.push(i);
      uncachedHashes.push(hash);
    }

    if (uncachedTexts.length === 0) return results;

    // Batch for SQLite bulk insert after generating
    const newEmbeddings: Array<{ hash: string; embedding: number[]; model: string }> = [];

    if (this.openaiClient) {
      // Batch via OpenAI (max 2048 per request)
      for (let start = 0; start < uncachedTexts.length; start += 2048) {
        const batch = uncachedTexts.slice(start, start + 2048).map((t) => t.slice(0, 8000)); // token limit safety
        try {
          const response = await this.openaiClient.embeddings.create({
            model: this.embeddingModel,
            input: batch,
          });
          for (let j = 0; j < response.data.length; j++) {
            const idx = uncachedIndexes[start + j];
            const hash = uncachedHashes[start + j];
            const embedding = response.data[j].embedding;
            results[idx] = embedding;
            this.hotCache.set(hash, embedding);
            newEmbeddings.push({ hash, embedding, model: this.embeddingModel });
          }
        } catch (err: any) {
          log.error('Batch embedding failed:', err?.message || err);
          if (err?.code === 'insufficient_quota' || err?.status === 401 || err?.status === 429) {
            log.warn('Disabling OpenAI embeddings due to quota/auth error. Using TF-IDF fallback.');
            this.openaiClient = null;
          }
          // Fallback to TF-IDF for failed batch
          for (let j = 0; j < batch.length; j++) {
            const idx = uncachedIndexes[start + j];
            const hash = uncachedHashes[start + j];
            const embedding = this.tfidfEmbed(batch[j]);
            results[idx] = embedding;
            this.hotCache.set(hash, embedding);
            newEmbeddings.push({ hash, embedding, model: 'tfidf' });
          }
        }
      }
    } else {
      // TF-IDF fallback — use worker thread for large batches (>50 texts)
      if (uncachedTexts.length > 50) {
        try {
          const embeddings = await this.tfidfEmbedBatchAsync(uncachedTexts);
          for (let i = 0; i < embeddings.length; i++) {
            const idx = uncachedIndexes[i];
            const hash = uncachedHashes[i];
            results[idx] = embeddings[i];
            this.hotCache.set(hash, embeddings[i]);
            newEmbeddings.push({ hash, embedding: embeddings[i], model: 'tfidf' });
          }
        } catch {
          // Final fallback: inline TF-IDF
          for (let i = 0; i < uncachedTexts.length; i++) {
            const idx = uncachedIndexes[i];
            const hash = uncachedHashes[i];
            const embedding = this.tfidfEmbed(uncachedTexts[i]);
            results[idx] = embedding;
            this.hotCache.set(hash, embedding);
            newEmbeddings.push({ hash, embedding, model: 'tfidf' });
          }
        }
      } else {
        for (let i = 0; i < uncachedTexts.length; i++) {
          const idx = uncachedIndexes[i];
          const hash = uncachedHashes[i];
          const embedding = this.tfidfEmbed(uncachedTexts[i]);
          results[idx] = embedding;
          this.hotCache.set(hash, embedding);
          newEmbeddings.push({ hash, embedding, model: 'tfidf' });
        }
      }
    }

    // Bulk insert new embeddings into SQLite cache
    if (newEmbeddings.length > 0) {
      this.dbService.setCachedEmbeddings(newEmbeddings);
    }

    this.evictHotCacheIfNeeded();
    return results;
  }

  /**
   * Cosine similarity between two vectors.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      // Gracefully return 0 instead of crashing — mixed models or corrupted data
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  // ─── OpenAI Embedding ───

  private async embedViaOpenAI(text: string): Promise<number[]> {
    const response = await this.openaiClient.embeddings.create({
      model: this.embeddingModel,
      input: text.slice(0, 8000), // token limit safety
    });
    return response.data[0].embedding;
  }

  // ─── TF-IDF Fallback ───

  /**
   * Simple TF-IDF based embedding as fallback when no OpenAI key.
   * Produces a fixed-size vector (256 dims) using feature hashing.
   */
  private tfidfEmbed(text: string): number[] {
    const DIMS = 256;
    const vector = new Array(DIMS).fill(0);

    const tokens = this.tokenize(text);
    const tf: Map<string, number> = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    for (const [token, count] of tf) {
      // Feature hashing: map token to dimension
      const hash = this.simpleHash(token);
      const dim = Math.abs(hash) % DIMS;
      const sign = hash > 0 ? 1 : -1;

      // TF * IDF approximation
      const idf = this.idfMap.get(token) || Math.log(10); // default IDF
      const tfidf = (count / tokens.length) * idf;
      vector[dim] += sign * tfidf;
    }

    // L2 normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < DIMS; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /**
   * Build IDF map from a corpus of documents.
   * Call this before using TF-IDF fallback for better quality.
   */
  buildIDF(documents: string[]): void {
    const docCount = documents.length;
    const docFreq: Map<string, number> = new Map();

    for (const doc of documents) {
      const tokens = new Set(this.tokenize(doc));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    this.idfMap.clear();
    for (const [token, df] of docFreq) {
      this.idfMap.set(token, Math.log((docCount + 1) / (df + 1)) + 1);
    }
    this.vocabSize = docFreq.size;
  }

  // ─── Helpers ───

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return hash;
  }

  private hashContent(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * Look up a cached embedding without triggering API calls.
   * Checks hot cache first, then SQLite.
   */
  getCachedEmbedding(text: string): number[] | undefined {
    const hash = this.hashContent(text);
    const hot = this.hotCache.get(hash);
    if (hot) return hot;

    const db = this.dbService.getCachedEmbedding(hash);
    if (db) {
      this.hotCache.set(hash, db);
      return db;
    }
    return undefined;
  }

  /**
   * Migrate legacy JSON embedding cache to SQLite.
   * Runs once — deletes JSON file after successful import.
   */
  private async migrateLegacyCache(): Promise<void> {
    try {
      try {
        await fs.promises.access(this.legacyCachePath);
      } catch {
        return;
      }

      // Check model consistency — if model changed, don't import old cache
      let modelFileExists = false;
      try {
        await fs.promises.access(this.legacyCacheModelPath);
        modelFileExists = true;
      } catch {
        /* file does not exist */
      }
      if (modelFileExists) {
        const savedModel = (await fs.promises.readFile(this.legacyCacheModelPath, 'utf8')).trim();
        if (savedModel !== this.embeddingModel) {
          log.warn(`Legacy cache model (${savedModel}) differs from current (${this.embeddingModel}), skipping import`);
          // Clean up legacy files
          try {
            await fs.promises.unlink(this.legacyCachePath);
          } catch {
            /* ignore cleanup errors */
          }
          try {
            await fs.promises.unlink(this.legacyCacheModelPath);
          } catch {
            /* ignore cleanup errors */
          }
          return;
        }
      }

      const imported = await this.dbService.importEmbeddingCache(this.legacyCachePath, this.embeddingModel);
      if (imported > 0) {
        log.info(`Migrated ${imported} embeddings from JSON to SQLite`);
        // Remove legacy files after successful migration
        try {
          await fs.promises.unlink(this.legacyCachePath);
        } catch {
          /* ignore cleanup errors */
        }
        try {
          await fs.promises.unlink(this.legacyCacheModelPath);
        } catch {
          /* ignore cleanup errors */
        }
        // Also remove .tmp files if exist
        try {
          const tmpPath = this.legacyCachePath + '.tmp';
          try {
            await fs.promises.access(tmpPath);
            await fs.promises.unlink(tmpPath);
          } catch {
            /* file does not exist or cleanup error */
          }
        } catch {
          /* ignore cleanup errors */
        }
      }
    } catch (err) {
      log.warn('Legacy cache migration error:', err);
    }
  }

  /**
   * Evict from hot cache if it exceeds the limit.
   * Removes the oldest 20% of entries (FIFO via Map insertion order).
   */
  private evictHotCacheIfNeeded(): void {
    if (this.hotCache.size <= EmbeddingService.MAX_HOT_CACHE) return;
    const toRemove = Math.floor(this.hotCache.size * 0.2);
    const keys = Array.from(this.hotCache.keys());
    for (let i = 0; i < toRemove; i++) {
      this.hotCache.delete(keys[i]);
    }
  }

  /**
   * Flush: evict SQLite cache if needed. No-op for hot cache (volatile).
   */
  flushCache(): void {
    this.dbService.evictEmbeddingCache(EmbeddingService.MAX_DB_CACHE);
  }

  /**
   * Clear all embedding caches (hot + SQLite).
   */
  clearCache(): void {
    this.hotCache.clear();
    this.dbService.clearEmbeddingCache();
  }

  // ─── Worker Thread Management ───

  /**
   * Initialize the worker thread for CPU-intensive TF-IDF operations.
   * Called lazily on first batch TF-IDF operation.
   */
  private async ensureWorker(): Promise<Worker> {
    if (this.worker && this.workerReady) return this.worker;

    const workerPath = path.join(__dirname, 'embedding-worker.js');
    try {
      await fs.promises.access(workerPath);
    } catch {
      throw new Error(`Worker file not found: ${workerPath}`);
    }

    this.worker = new Worker(workerPath);
    this.workerReady = true;

    this.worker.on('message', (msg: { id: number; type: string; result?: any; error?: string }) => {
      const cb = this.workerCallbacks.get(msg.id);
      if (!cb) return;
      this.workerCallbacks.delete(msg.id);

      if (msg.error) {
        cb.reject(new Error(msg.error));
      } else {
        cb.resolve(msg.result);
      }
    });

    this.worker.on('error', (err: Error) => {
      log.error('Embedding worker error:', err);
      this.workerReady = false;
      // Reject all pending callbacks
      for (const [, cb] of this.workerCallbacks) {
        cb.reject(err);
      }
      this.workerCallbacks.clear();
    });

    this.worker.on('exit', (code) => {
      if (code !== 0) {
        log.warn(`Embedding worker exited with code ${code}`);
      }
      this.workerReady = false;
      this.worker = null;
    });

    log.info('TF-IDF worker thread started');
    return this.worker;
  }

  /**
   * Send a message to the worker and await the result.
   */
  private async workerCall<T>(msg: Record<string, any>): Promise<T> {
    const id = ++this.workerMsgId;
    const worker = await this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.workerCallbacks.set(id, { resolve, reject });
      try {
        worker.postMessage({ ...msg, id });
      } catch (err: any) {
        this.workerCallbacks.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Build IDF via worker thread (non-blocking main thread).
   */
  async buildIDFAsync(documents: string[]): Promise<void> {
    try {
      const result = await this.workerCall<{ vocabSize: number }>({
        type: 'buildIDF',
        documents,
      });
      this.vocabSize = result.vocabSize;
      // Also build locally for single embed() calls (fast for small corpora)
      this.buildIDF(documents);
    } catch (err) {
      log.warn('Worker buildIDF failed, falling back to main thread:', err);
      this.buildIDF(documents);
    }
  }

  /**
   * Batch TF-IDF embeddings via worker thread (non-blocking main thread).
   */
  async tfidfEmbedBatchAsync(texts: string[]): Promise<number[][]> {
    try {
      const result = await this.workerCall<{ embeddings: number[][] }>({
        type: 'embedBatch',
        texts,
      });
      return result.embeddings;
    } catch (err) {
      log.warn('Worker embedBatch failed, falling back to main thread:', err);
      return texts.map((t) => this.tfidfEmbed(t));
    }
  }

  /**
   * Terminate the worker thread (called during shutdown).
   */
  terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
      this.workerCallbacks.clear();
    }
  }
}
