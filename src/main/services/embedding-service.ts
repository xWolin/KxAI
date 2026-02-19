import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { SecurityService } from './security';

/**
 * EmbeddingService — generuje embeddingi tekstu za pomocą OpenAI text-embedding-3-small.
 * Cachuje wyniki na dysku, aby unikać powtórnych wywołań API.
 * Fallback: prosty TF-IDF jeśli brak klucza OpenAI.
 */
export class EmbeddingService {
  private security: SecurityService;
  private openaiClient: any = null;
  private cache: Map<string, number[]> = new Map();
  private cachePath: string;
  private initialized = false;

  // TF-IDF fallback
  private idfMap: Map<string, number> = new Map();
  private vocabSize = 0;

  constructor(security: SecurityService) {
    this.security = security;
    const userDataPath = app.getPath('userData');
    this.cachePath = path.join(userDataPath, 'workspace', 'rag', 'embedding-cache.json');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure rag directory exists
    const ragDir = path.dirname(this.cachePath);
    if (!fs.existsSync(ragDir)) {
      fs.mkdirSync(ragDir, { recursive: true });
    }

    // Load cache from disk
    this.loadCache();

    // Try to initialize OpenAI client for embeddings
    const openaiKey = await this.security.getApiKey('openai');
    if (openaiKey) {
      try {
        const OpenAI = require('openai').default;
        this.openaiClient = new OpenAI({ apiKey: openaiKey });
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
      embedding = await this.embedViaOpenAI(text);
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
        const batch = uncachedTexts.slice(start, start + 2048);
        try {
          const response = await this.openaiClient.embeddings.create({
            model: 'text-embedding-3-small',
            input: batch,
          });
          for (let j = 0; j < response.data.length; j++) {
            const idx = uncachedIndexes[start + j];
            const embedding = response.data[j].embedding;
            results[idx] = embedding;
            this.cache.set(this.hashContent(batch[j]), embedding);
          }
        } catch (err) {
          console.error('EmbeddingService: Batch embedding failed:', err);
          // Fallback to TF-IDF for failed batch
          for (let j = 0; j < batch.length; j++) {
            const idx = uncachedIndexes[start + j];
            results[idx] = this.tfidfEmbed(batch[j]);
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
    if (a.length !== b.length) return 0;

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
      model: 'text-embedding-3-small',
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

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        this.cache = new Map(Object.entries(data));
      }
    } catch {
      this.cache = new Map();
    }
  }

  private saveCache(): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj: Record<string, number[]> = {};
      for (const [key, value] of this.cache) {
        obj[key] = value;
      }
      fs.writeFileSync(this.cachePath, JSON.stringify(obj), 'utf8');
    } catch (err) {
      console.error('EmbeddingService: Failed to save cache:', err);
    }
  }

  /**
   * Clear embedding cache (useful when memory files change significantly).
   */
  clearCache(): void {
    this.cache.clear();
    if (fs.existsSync(this.cachePath)) {
      fs.unlinkSync(this.cachePath);
    }
  }
}
