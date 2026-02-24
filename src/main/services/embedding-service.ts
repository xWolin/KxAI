import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { SecurityService } from './security';
import { ConfigService } from './config';

/**
 * EmbeddingService — generuje embeddingi tekstu.
 * Używa OpenAI text-embedding-3-small (lub innego modelu z configu).
 * Klucz API czytany z 'openai-embeddings' (dedykowany) lub fallback na 'openai' (główny).
 * Fallback: prosty TF-IDF jeśli brak klucza.
 */
export class EmbeddingService {
  private security: SecurityService;
  private config: ConfigService;
  private openaiClient: any = null;
  private embeddingModel: string = 'text-embedding-3-small';
  private cache: Map<string, number[]> = new Map();
  private cachePath: string;
  private cacheModelPath: string; // tracks which model generated the cache
  private initialized = false;
  private savePending = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private static readonly MAX_CACHE_ENTRIES = 200000; // LRU eviction threshold

  // TF-IDF fallback
  private idfMap: Map<string, number> = new Map();
  private vocabSize = 0;

  constructor(security: SecurityService, config: ConfigService) {
    this.security = security;
    this.config = config;
    const userDataPath = app.getPath('userData');
    this.cachePath = path.join(userDataPath, 'workspace', 'rag', 'embedding-cache.json');
    this.cacheModelPath = path.join(userDataPath, 'workspace', 'rag', 'embedding-cache-model.txt');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure rag directory exists
    const ragDir = path.dirname(this.cachePath);
    if (!fs.existsSync(ragDir)) {
      fs.mkdirSync(ragDir, { recursive: true });
    }

    // Read embedding model from config BEFORE cache validation
    const cfgModel = this.config.get('embeddingModel') as string | undefined;
    if (cfgModel) {
      this.embeddingModel = cfgModel;
    }

    // Load cache — validate model consistency against configured model
    this.loadCache();
    this.validateCacheModel();

    // Try to initialize OpenAI client for embeddings
    // Priority: dedicated 'openai-embeddings' key > main 'openai' key
    const embeddingKey = await this.security.getApiKey('openai-embeddings')
      ?? await this.security.getApiKey('openai');
    if (embeddingKey) {
      try {
        const OpenAI = require('openai').default;
        this.openaiClient = new OpenAI({ apiKey: embeddingKey });
      } catch (err) {
        console.warn('EmbeddingService: Failed to init OpenAI client:', err);
      }
    }

    this.initialized = true;
  }

  /**
   * Returns true if we can use OpenAI embeddings (vs TF-IDF fallback).
   */
  hasOpenAI(): boolean {
    return this.openaiClient !== null;
  }

  /**
   * Generate embedding for a single text.
   */
  async embed(text: string): Promise<number[]> {
    await this.initialize();

    const hash = this.hashContent(text);
    const cached = this.cache.get(hash);
    if (cached) return cached;

    let embedding: number[];

    if (this.openaiClient) {
      try {
        embedding = await this.embedViaOpenAI(text);
      } catch (err: any) {
        console.warn('EmbeddingService: OpenAI embedding failed, falling back to TF-IDF:', err?.message || err);
        // Permanently disable OpenAI on quota/auth errors to avoid repeated failures
        if (err?.code === 'insufficient_quota' || err?.status === 401 || err?.status === 429) {
          console.warn('EmbeddingService: Disabling OpenAI embeddings due to quota/auth error. Using TF-IDF fallback.');
          this.openaiClient = null;
        }
        embedding = this.tfidfEmbed(text);
      }
    } else {
      embedding = this.tfidfEmbed(text);
    }

    this.cache.set(hash, embedding);
    this.saveCache();
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

    // Check cache first
    for (let i = 0; i < texts.length; i++) {
      const hash = this.hashContent(texts[i]);
      const cached = this.cache.get(hash);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndexes.push(i);
      }
    }

    if (uncachedTexts.length === 0) return results;

    if (this.openaiClient) {
      // Batch via OpenAI (max 2048 per request)
      for (let start = 0; start < uncachedTexts.length; start += 2048) {
        const batch = uncachedTexts.slice(start, start + 2048)
          .map(t => t.slice(0, 8000)); // token limit safety — same as embedViaOpenAI
        try {
          const response = await this.openaiClient.embeddings.create({
            model: this.embeddingModel,
            input: batch,
          });
          for (let j = 0; j < response.data.length; j++) {
            const idx = uncachedIndexes[start + j];
            const embedding = response.data[j].embedding;
            results[idx] = embedding;
            this.cache.set(this.hashContent(batch[j]), embedding);
          }
        } catch (err: any) {
          console.error('EmbeddingService: Batch embedding failed:', err?.message || err);
          // Permanently disable OpenAI on quota/auth errors
          if (err?.code === 'insufficient_quota' || err?.status === 401 || err?.status === 429) {
            console.warn('EmbeddingService: Disabling OpenAI embeddings due to quota/auth error. Using TF-IDF fallback.');
            this.openaiClient = null;
          }
          // Fallback to TF-IDF for failed batch — also cache results
          for (let j = 0; j < batch.length; j++) {
            const idx = uncachedIndexes[start + j];
            const embedding = this.tfidfEmbed(batch[j]);
            results[idx] = embedding;
            this.cache.set(this.hashContent(batch[j]), embedding);
          }
        }
      }
    } else {
      // TF-IDF fallback
      for (let i = 0; i < uncachedTexts.length; i++) {
        const idx = uncachedIndexes[i];
        results[idx] = this.tfidfEmbed(uncachedTexts[i]);
        this.cache.set(this.hashContent(uncachedTexts[i]), results[idx]);
      }
    }

    this.saveCache();
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
   * Used by RAGService to restore embeddings from cache on index load.
   */
  getCachedEmbedding(text: string): number[] | undefined {
    const hash = this.hashContent(text);
    return this.cache.get(hash);
  }

  /**
   * Validates that cache was generated by the same embedding model.
   * If model changed, clears cache to avoid dimension mismatch.
   */
  private validateCacheModel(): void {
    try {
      if (fs.existsSync(this.cacheModelPath)) {
        const savedModel = fs.readFileSync(this.cacheModelPath, 'utf8').trim();
        if (savedModel !== this.embeddingModel) {
          console.warn(`EmbeddingService: Model changed (${savedModel} → ${this.embeddingModel}), clearing cache`);
          this.cache.clear();
          if (fs.existsSync(this.cachePath)) fs.unlinkSync(this.cachePath);
        }
      }
      // Save current model
      const dir = path.dirname(this.cacheModelPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.cacheModelPath, this.embeddingModel, 'utf8');
    } catch (err) {
      console.warn('EmbeddingService: validateCacheModel error:', err);
    }
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf8');
        const data = JSON.parse(raw);
        this.cache = new Map(Object.entries(data));
        console.log(`EmbeddingService: Loaded ${this.cache.size} cached embeddings`);
      }
    } catch (err) {
      console.error('EmbeddingService: Failed to load cache, starting fresh:', err);
      this.cache = new Map();
      // Delete corrupted cache file
      try { if (fs.existsSync(this.cachePath)) fs.unlinkSync(this.cachePath); } catch {}
    }
  }

  /**
   * Debounced save — schedules a write 5s after last call to avoid blocking UI.
   */
  saveCache(): void {
    this.savePending = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this._saveCacheToDisk();
    }, 5000);
  }

  /**
   * Immediate save — for shutdown. Clears pending timer.
   */
  flushCache(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.savePending) {
      this._saveCacheToDisk();
    }
  }

  /**
   * Streaming JSON write to avoid RangeError: Invalid string length
   * with large caches. Writes entry-by-entry using fs.writeSync.
   * Uses atomic rename (.tmp → final) to prevent data loss on crash.
   * Applies LRU eviction if cache exceeds MAX_CACHE_ENTRIES.
   */
  private _saveCacheToDisk(): void {
    this.savePending = false;
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // LRU eviction — keep newest entries
      if (this.cache.size > EmbeddingService.MAX_CACHE_ENTRIES) {
        const excess = this.cache.size - EmbeddingService.MAX_CACHE_ENTRIES;
        const keys = Array.from(this.cache.keys());
        for (let i = 0; i < excess; i++) {
          this.cache.delete(keys[i]);
        }
        console.log(`EmbeddingService: Evicted ${excess} old cache entries (kept ${this.cache.size})`);
      }

      // Streaming write — entry by entry to avoid single giant string
      const tmpPath = this.cachePath + '.tmp';
      const fd = fs.openSync(tmpPath, 'w');
      let first = true;
      fs.writeSync(fd, '{');
      for (const [key, value] of this.cache) {
        if (!first) fs.writeSync(fd, ',');
        first = false;
        fs.writeSync(fd, JSON.stringify(key) + ':' + JSON.stringify(value));
      }
      fs.writeSync(fd, '}');
      fs.closeSync(fd);

      // Atomic rename
      if (fs.existsSync(this.cachePath)) fs.unlinkSync(this.cachePath);
      fs.renameSync(tmpPath, this.cachePath);
      console.log(`EmbeddingService: Saved ${this.cache.size} embeddings to cache`);
    } catch (err) {
      console.error('EmbeddingService: Failed to save cache:', err);
    }
  }

  /**
   * Clear embedding cache (useful when memory files change significantly).
   */
  clearCache(): void {
    this.cache.clear();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.savePending = false;
    if (fs.existsSync(this.cachePath)) {
      fs.unlinkSync(this.cachePath);
    }
  }
}
