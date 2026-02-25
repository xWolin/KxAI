/**
 * embedding-worker.ts — Worker thread for CPU-intensive embedding operations.
 *
 * Offloads TF-IDF computations from the main thread to avoid blocking
 * the Electron event loop during RAG reindexing.
 *
 * Handles:
 * - buildIDF: Build IDF map from document corpus
 * - embedBatch: Compute TF-IDF embeddings for a batch of texts
 */

import { parentPort } from 'worker_threads';

// ─── State ───

let idfMap: Map<string, number> = new Map();

// ─── Message Types ───

interface BuildIDFMessage {
  type: 'buildIDF';
  id: number;
  documents: string[];
}

interface EmbedBatchMessage {
  type: 'embedBatch';
  id: number;
  texts: string[];
}

type WorkerMessage = BuildIDFMessage | EmbedBatchMessage;

interface WorkerResult {
  id: number;
  type: string;
  result?: any;
  error?: string;
}

// ─── TF-IDF Implementation (mirrors EmbeddingService logic) ───

const DIMS = 256;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}

function tfidfEmbed(text: string): number[] {
  const vector = new Array(DIMS).fill(0);
  const tokens = tokenize(text);
  const tf: Map<string, number> = new Map();

  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }

  for (const [token, count] of tf) {
    const hash = simpleHash(token);
    const dim = Math.abs(hash) % DIMS;
    const sign = hash > 0 ? 1 : -1;
    const idf = idfMap.get(token) || Math.log(10);
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

function buildIDF(documents: string[]): number {
  const docCount = documents.length;
  const docFreq: Map<string, number> = new Map();

  for (const doc of documents) {
    const tokens = new Set(tokenize(doc));
    for (const token of tokens) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  idfMap.clear();
  for (const [token, df] of docFreq) {
    idfMap.set(token, Math.log((docCount + 1) / (df + 1)) + 1);
  }

  return docFreq.size; // vocabSize
}

// ─── Message Handler ───

parentPort?.on('message', (msg: WorkerMessage) => {
  const reply = (result: Omit<WorkerResult, 'id'>) => {
    parentPort?.postMessage({ ...result, id: msg.id });
  };

  try {
    switch (msg.type) {
      case 'buildIDF': {
        const vocabSize = buildIDF(msg.documents);
        reply({ type: 'buildIDF', result: { vocabSize } });
        break;
      }
      case 'embedBatch': {
        const embeddings = msg.texts.map((text) => tfidfEmbed(text));
        reply({ type: 'embedBatch', result: { embeddings } });
        break;
      }
      default:
        reply({ type: 'error', error: `Unknown message type: ${(msg as any).type}` });
    }
  } catch (err: any) {
    reply({ type: msg.type, error: err.message || String(err) });
  }
});
