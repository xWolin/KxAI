import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/user') },
}));

vi.mock('better-sqlite3', () => {
  const mockDb = {
    pragma: vi.fn(),
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    close: vi.fn(),
    open: true,
  };
  return { default: vi.fn(() => mockDb) };
});

vi.mock('sqlite-vec', () => ({
  load: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  },
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

import { DatabaseService, type MessageRow } from '../src/main/services/database-service';

function createService(): DatabaseService {
  return new DatabaseService();
}

// =============================================================================
// formatDate
// =============================================================================
describe('formatDate', () => {
  let svc: DatabaseService;
  const formatDate = (d: Date) => (svc as any).formatDate(d);

  beforeEach(() => {
    svc = createService();
  });

  it('formats date as YYYY-MM-DD', () => {
    expect(formatDate(new Date(2024, 0, 15))).toBe('2024-01-15');
  });

  it('pads single-digit month and day', () => {
    expect(formatDate(new Date(2024, 2, 5))).toBe('2024-03-05');
  });

  it('handles December', () => {
    expect(formatDate(new Date(2024, 11, 31))).toBe('2024-12-31');
  });

  it('handles year 2000', () => {
    expect(formatDate(new Date(2000, 0, 1))).toBe('2000-01-01');
  });
});

// =============================================================================
// rowToMessage
// =============================================================================
describe('rowToMessage', () => {
  let svc: DatabaseService;
  const rowToMessage = (row: MessageRow) => (svc as any).rowToMessage(row);

  beforeEach(() => {
    svc = createService();
  });

  function baseRow(overrides: Partial<MessageRow> = {}): MessageRow {
    return {
      id: 'msg-1',
      role: 'user',
      content: 'Hello world',
      timestamp: 1700000000000,
      type: 'text',
      session_date: '2024-01-15',
      token_count: null,
      importance: 0.5,
      metadata: null,
      ...overrides,
    };
  }

  it('converts basic row to message', () => {
    const msg = rowToMessage(baseRow());
    expect(msg.id).toBe('msg-1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello world');
    expect(msg.timestamp).toBe(1700000000000);
    expect(msg.type).toBe('text');
  });

  it('includes tokenCount when not null', () => {
    const msg = rowToMessage(baseRow({ token_count: 42 }));
    expect((msg as any).tokenCount).toBe(42);
  });

  it('excludes tokenCount when null', () => {
    const msg = rowToMessage(baseRow({ token_count: null }));
    expect((msg as any).tokenCount).toBeUndefined();
  });

  it('includes importance when not 0.5', () => {
    const msg = rowToMessage(baseRow({ importance: 0.9 }));
    expect((msg as any).importance).toBe(0.9);
  });

  it('excludes importance when 0.5 (default)', () => {
    const msg = rowToMessage(baseRow({ importance: 0.5 }));
    expect((msg as any).importance).toBeUndefined();
  });

  it('parses JSON metadata', () => {
    const msg = rowToMessage(baseRow({ metadata: '{"tool":"search","query":"test"}' }));
    expect((msg as any).metadata).toEqual({ tool: 'search', query: 'test' });
  });

  it('ignores invalid JSON metadata', () => {
    const msg = rowToMessage(baseRow({ metadata: 'not-json' }));
    expect((msg as any).metadata).toBeUndefined();
  });

  it('ignores null metadata', () => {
    const msg = rowToMessage(baseRow({ metadata: null }));
    expect((msg as any).metadata).toBeUndefined();
  });

  it('handles assistant role', () => {
    const msg = rowToMessage(baseRow({ role: 'assistant' }));
    expect(msg.role).toBe('assistant');
  });

  it('handles system role', () => {
    const msg = rowToMessage(baseRow({ role: 'system' }));
    expect(msg.role).toBe('system');
  });
});

// =============================================================================
// extractSnippet
// =============================================================================
describe('extractSnippet', () => {
  let svc: DatabaseService;
  const extractSnippet = (content: string, query: string) =>
    (svc as any).extractSnippet(content, query);

  beforeEach(() => {
    svc = createService();
  });

  it('returns first 200 chars when query not found', () => {
    const content = 'A'.repeat(300);
    const snippet = extractSnippet(content, 'zzz');
    expect(snippet.length).toBe(200);
  });

  it('returns snippet around query match', () => {
    const content = 'prefix '.repeat(20) + 'TARGET_WORD' + ' suffix'.repeat(20);
    const snippet = extractSnippet(content, 'TARGET_WORD');
    expect(snippet).toContain('TARGET_WORD');
  });

  it('adds ellipsis prefix when match is not at start', () => {
    const content = 'a'.repeat(200) + 'NEEDLE' + 'b'.repeat(200);
    const snippet = extractSnippet(content, 'NEEDLE');
    expect(snippet.startsWith('...')).toBe(true);
  });

  it('adds ellipsis suffix when match is not at end', () => {
    const content = 'a'.repeat(200) + 'NEEDLE' + 'b'.repeat(200);
    const snippet = extractSnippet(content, 'NEEDLE');
    expect(snippet.endsWith('...')).toBe(true);
  });

  it('no ellipsis when content is short', () => {
    const snippet = extractSnippet('Hello world', 'Hello');
    expect(snippet).toBe('Hello world');
    expect(snippet).not.toContain('...');
  });

  it('is case-insensitive', () => {
    const snippet = extractSnippet('Hello World', 'hello');
    expect(snippet).toContain('Hello World');
  });

  it('handles empty query', () => {
    const snippet = extractSnippet('Some content', '');
    expect(snippet).toContain('Some content');
  });

  it('handles short content', () => {
    const snippet = extractSnippet('Hi', 'missing');
    expect(snippet).toBe('Hi');
  });
});

// =============================================================================
// isReady / hasVectorSearch / getDb
// =============================================================================
describe('state methods', () => {
  it('isReady returns false before initialization', () => {
    const svc = createService();
    // Before initialize(), db is null
    expect(svc.isReady()).toBe(false);
  });

  it('getDb returns null before initialization', () => {
    const svc = createService();
    expect(svc.getDb()).toBeNull();
  });

  it('isReady returns true when db is set', () => {
    const svc = createService();
    (svc as any).db = { open: true };
    expect(svc.isReady()).toBe(true);
  });

  it('hasVectorSearch returns false by default', () => {
    const svc = createService();
    expect(svc.hasVectorSearch()).toBe(false);
  });
});

// =============================================================================
// Exported constants/types
// =============================================================================
describe('exported types', () => {
  it('MessageRow interface has all required fields', () => {
    // Type-level test: if this compiles, the interface is correct
    const row: MessageRow = {
      id: 'test',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
      type: 'text',
      session_date: '2024-01-01',
      token_count: 10,
      importance: 0.5,
      metadata: null,
    };
    expect(row.id).toBe('test');
  });
});
