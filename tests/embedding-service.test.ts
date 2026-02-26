import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock') },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('crypto', () => ({
  default: {
    createHash: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => 'mock-hash'),
    })),
    randomUUID: vi.fn(() => 'test-uuid'),
  },
  createHash: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'mock-hash'),
  })),
  randomUUID: vi.fn(() => 'test-uuid'),
}));

vi.mock('worker_threads', () => ({
  Worker: vi.fn(),
}));

vi.mock('../src/main/services/security', () => ({
  SecurityService: vi.fn(),
}));

vi.mock('../src/main/services/config', () => ({
  ConfigService: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn(() => ({})),
  })),
}));

vi.mock('../src/main/services/database-service', () => ({
  DatabaseService: vi.fn(() => ({
    getDb: vi.fn(() => null),
  })),
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

import { EmbeddingService } from '../src/main/services/embedding-service';

function priv<T>(instance: any, name: string): (...args: any[]) => T {
  return instance[name].bind(instance);
}

function createService(): EmbeddingService {
  return new EmbeddingService({} as any, {} as any, {} as any);
}

// =============================================================================
// tokenize
// =============================================================================
describe('tokenize', () => {
  let svc: EmbeddingService;
  let tokenize: (text: string) => string[];

  beforeEach(() => {
    svc = createService();
    tokenize = priv(svc, 'tokenize');
  });

  it('lowercases text', () => {
    expect(tokenize('Hello WORLD')).toEqual(['hello', 'world']);
  });

  it('removes punctuation', () => {
    expect(tokenize('hello, world! foo.')).toEqual(['hello', 'world', 'foo']);
  });

  it('filters single-char tokens', () => {
    expect(tokenize('I am a developer')).toEqual(['am', 'developer']);
  });

  it('handles unicode', () => {
    const tokens = tokenize('zażółć gęślą jaźń');
    expect(tokens).toContain('zażółć');
    expect(tokens).toContain('gęślą');
    expect(tokens).toContain('jaźń');
  });

  it('splits on whitespace', () => {
    expect(tokenize('one   two\tthree\nfour')).toEqual(['one', 'two', 'three', 'four']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });
});

// =============================================================================
// simpleHash
// =============================================================================
describe('simpleHash', () => {
  let svc: EmbeddingService;
  let hash: (str: string) => number;

  beforeEach(() => {
    svc = createService();
    hash = priv(svc, 'simpleHash');
  });

  it('returns integer', () => {
    expect(Number.isInteger(hash('hello'))).toBe(true);
  });

  it('is deterministic', () => {
    expect(hash('test')).toBe(hash('test'));
  });

  it('varies for different inputs', () => {
    expect(hash('abc')).not.toBe(hash('xyz'));
  });

  it('handles empty string', () => {
    expect(hash('')).toBe(0);
  });
});

// =============================================================================
// cosineSimilarity
// =============================================================================
describe('cosineSimilarity', () => {
  let svc: EmbeddingService;

  beforeEach(() => {
    svc = createService();
  });

  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(svc.cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(svc.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns -1 for opposite vectors', () => {
    expect(svc.cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('returns 0 for different length vectors', () => {
    expect(svc.cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(svc.cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it('computes correct similarity for non-trivial vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // Expected: (4+10+18) / (sqrt(14) * sqrt(77)) ≈ 0.9746
    expect(svc.cosineSimilarity(a, b)).toBeCloseTo(0.9746, 3);
  });
});

// =============================================================================
// buildIDF
// =============================================================================
describe('buildIDF', () => {
  let svc: EmbeddingService;

  beforeEach(() => {
    svc = createService();
  });

  it('builds IDF map from documents', () => {
    svc.buildIDF(['hello world', 'hello there', 'world peace']);
    const idfMap = (svc as any).idfMap as Map<string, number>;
    expect(idfMap.size).toBeGreaterThan(0);
    expect(idfMap.has('hello')).toBe(true);
    expect(idfMap.has('world')).toBe(true);
  });

  it('rare terms have higher IDF', () => {
    svc.buildIDF(['common term', 'common thing', 'common stuff', 'rare unique special']);
    const idfMap = (svc as any).idfMap as Map<string, number>;
    const commonIdf = idfMap.get('common')!;
    const rareIdf = idfMap.get('rare')!;
    expect(rareIdf).toBeGreaterThan(commonIdf);
  });

  it('clears old IDF on rebuild', () => {
    svc.buildIDF(['alpha beta']);
    svc.buildIDF(['gamma delta']);
    const idfMap = (svc as any).idfMap as Map<string, number>;
    expect(idfMap.has('alpha')).toBe(false);
    expect(idfMap.has('gamma')).toBe(true);
  });

  it('updates vocabSize', () => {
    svc.buildIDF(['one two three', 'four five']);
    expect((svc as any).vocabSize).toBe(5);
  });

  it('handles empty documents', () => {
    svc.buildIDF([]);
    expect((svc as any).idfMap.size).toBe(0);
  });
});

// =============================================================================
// tfidfEmbed
// =============================================================================
describe('tfidfEmbed', () => {
  let svc: EmbeddingService;
  let embed: (text: string) => number[];

  beforeEach(() => {
    svc = createService();
    svc.buildIDF(['hello world test', 'another document here', 'third sample text']);
    embed = priv(svc, 'tfidfEmbed');
  });

  it('returns vector of length 256', () => {
    const vec = embed('hello world');
    expect(vec).toHaveLength(256);
  });

  it('returns normalized vector (L2 norm ≈ 1)', () => {
    const vec = embed('hello world test');
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it('similar texts have higher cosine similarity', () => {
    const v1 = embed('hello world');
    const v2 = embed('hello test');
    const v3 = embed('completely different unrelated content');
    const sim12 = svc.cosineSimilarity(v1, v2);
    const sim13 = svc.cosineSimilarity(v1, v3);
    expect(sim12).toBeGreaterThan(sim13);
  });

  it('returns zero vector for empty text', () => {
    const vec = embed('');
    expect(vec.every((v) => v === 0)).toBe(true);
  });
});

// =============================================================================
// evictHotCacheIfNeeded
// =============================================================================
describe('evictHotCacheIfNeeded', () => {
  let svc: EmbeddingService;

  beforeEach(() => {
    svc = createService();
  });

  it('does not evict when under limit', () => {
    const cache = (svc as any).hotCache as Map<string, number[]>;
    cache.set('a', [1]);
    cache.set('b', [2]);
    priv(svc, 'evictHotCacheIfNeeded')();
    expect(cache.size).toBe(2);
  });

  it('evicts 20% when over MAX_HOT_CACHE', () => {
    const cache = (svc as any).hotCache as Map<string, number[]>;
    const max = (EmbeddingService as any).MAX_HOT_CACHE || 10000;
    for (let i = 0; i <= max; i++) cache.set(`key-${i}`, [i]);
    priv(svc, 'evictHotCacheIfNeeded')();
    const expected = Math.ceil(max * 0.8) + 1; // after removing 20%
    expect(cache.size).toBeLessThanOrEqual(expected);
  });
});
