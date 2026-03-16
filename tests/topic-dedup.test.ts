import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TopicDedupService } from '../src/main/services/topic-dedup';
import type { CortexProposal } from '../src/shared/types/cortex';

const mockUserDataPath = '/mock/userData';
let mockFiles: Record<string, string> = {};

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((p: string) => p in mockFiles),
    readFileSync: vi.fn((p: string) => {
      if (p in mockFiles) return mockFiles[p];
      throw new Error(`ENOENT: ${p}`);
    }),
    writeFileSync: vi.fn((p: string, data: string) => { mockFiles[p] = data; }),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn((p: string) => p in mockFiles),
  readFileSync: vi.fn((p: string) => {
    if (p in mockFiles) return mockFiles[p];
    throw new Error(`ENOENT: ${p}`);
  }),
  writeFileSync: vi.fn((p: string, data: string) => { mockFiles[p] = data; }),
  mkdirSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(async (p: string, data: string) => { mockFiles[p] = data; }),
  },
  writeFile: vi.fn(async (p: string, data: string) => { mockFiles[p] = data; }),
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('TopicDedupService', () => {
  beforeEach(() => {
    mockFiles = {};
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeProposal = (title: string, description: string): CortexProposal => ({
    id: 'prop_1',
    type: 'automation',
    title,
    description,
    risk: 'safe',
  });

  it('initially returns false for a new proposal', () => {
    const svc = new TopicDedupService();
    const p = makeProposal('Test', 'Desc');
    expect(svc.isDuplicate(p)).toBe(false);
  });

  it('returns true after recording the proposal (hit)', () => {
    const svc = new TopicDedupService();
    const p = makeProposal('Test', 'Desc');
    svc.record(p);
    expect(svc.isDuplicate(p)).toBe(true);
  });

  it('returns false for a different proposal (miss)', () => {
    const svc = new TopicDedupService();
    const p1 = makeProposal('Test', 'Desc');
    const p2 = makeProposal('Different', 'Desc');
    svc.record(p1);
    expect(svc.isDuplicate(p2)).toBe(false);
  });

  it('expires the proposal after TTL (expiry)', () => {
    const now = new Date('2026-03-16T10:00:00Z');
    vi.setSystemTime(now);

    const svc = new TopicDedupService();
    const p = makeProposal('Test', 'Desc');
    svc.record(p);
    expect(svc.isDuplicate(p)).toBe(true);

    // Fast forward 2 hours and 1 ms
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);
    expect(svc.isDuplicate(p)).toBe(false);
  });

  it('persists data to disk and loads correctly', async () => {
    const now = new Date('2026-03-16T10:00:00Z');
    vi.setSystemTime(now);

    const svc1 = new TopicDedupService();
    const p = makeProposal('Test', 'Desc');
    svc1.record(p);

    // Need to await because save() is async using fsp.writeFile
    // Since we mock it and use setImmediate/Promises, let's fast forward slightly to let event loop tick
    await Promise.resolve();

    // Create a new instance which should load from disk
    const svc2 = new TopicDedupService();
    expect(svc2.isDuplicate(p)).toBe(true);
  });

  it('ignores expired entries during load', async () => {
    const now = new Date('2026-03-16T10:00:00Z');
    vi.setSystemTime(now);

    const svc1 = new TopicDedupService();
    const p = makeProposal('Test', 'Desc');
    svc1.record(p);

    await Promise.resolve();

    // Fast forward 3 hours
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);

    const svc2 = new TopicDedupService();
    expect(svc2.isDuplicate(p)).toBe(false);
  });
});
