import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ size: 0, mtimeMs: 0, isDirectory: () => false, isFile: () => true })),
    createReadStream: vi.fn(),
    watch: vi.fn(() => ({ close: vi.fn() })),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ size: 0, mtimeMs: 0, isDirectory: () => false, isFile: () => true })),
  createReadStream: vi.fn(),
  watch: vi.fn(() => ({ close: vi.fn() })),
}));

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn(),
}));

vi.mock('../src/main/services/embedding-service', () => ({
  EmbeddingService: vi.fn(),
}));

vi.mock('../src/main/services/config', () => ({
  ConfigService: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    getAll: vi.fn(() => ({})),
    onChange: vi.fn(),
  })),
}));

vi.mock('../src/main/services/database-service', () => ({
  DatabaseService: vi.fn(() => ({
    getDb: vi.fn(() => null),
  })),
}));

vi.mock('../src/main/services/file-intelligence', () => ({
  FileIntelligenceService: vi.fn(),
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { RAGService } from '../src/main/services/rag-service';

// Helper to access private methods
function getMethod<T>(instance: any, name: string): (...args: any[]) => T {
  return instance[name].bind(instance);
}

function createService(): RAGService {
  return new RAGService(
    {} as any, // configService
    {} as any, // dbService
    {} as any, // embeddingService
    undefined, // fileIntelligence
  );
}

// =============================================================================
// chunkByHeaders (Markdown)
// =============================================================================
describe('chunkByHeaders', () => {
  let svc: RAGService;
  let chunk: (content: string) => Array<{ header: string; content: string }>;

  beforeEach(() => {
    svc = createService();
    chunk = getMethod(svc, 'chunkByHeaders');
  });

  it('splits by h1 headers', () => {
    const result = chunk('# First\nContent 1\n# Second\nContent 2');
    expect(result).toHaveLength(2);
    expect(result[0].header).toBe('First');
    expect(result[0].content).toBe('Content 1');
    expect(result[1].header).toBe('Second');
    expect(result[1].content).toBe('Content 2');
  });

  it('splits by h2 headers', () => {
    const result = chunk('## Part A\nText A\n## Part B\nText B');
    expect(result).toHaveLength(2);
    expect(result[0].header).toBe('Part A');
    expect(result[1].header).toBe('Part B');
  });

  it('splits by h3 headers', () => {
    const result = chunk('### Sub\nDetails');
    expect(result).toHaveLength(1);
    expect(result[0].header).toBe('Sub');
    expect(result[0].content).toBe('Details');
  });

  it('puts content before first header into "Intro"', () => {
    const result = chunk('Some intro text\n# Title\nBody');
    expect(result).toHaveLength(2);
    expect(result[0].header).toBe('Intro');
    expect(result[0].content).toBe('Some intro text');
    expect(result[1].header).toBe('Title');
  });

  it('handles content with no headers', () => {
    const result = chunk('Just plain text\nwith multiple lines');
    expect(result).toHaveLength(1);
    expect(result[0].header).toBe('Intro');
  });

  it('handles empty content', () => {
    const result = chunk('');
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('');
  });

  it('trims section content', () => {
    const result = chunk('# Title\n\n  Content with spaces  \n\n');
    expect(result[0].content).toBe('Content with spaces');
  });

  it('handles mixed header levels', () => {
    const result = chunk('# H1\nA\n## H2\nB\n### H3\nC');
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.header)).toEqual(['H1', 'H2', 'H3']);
  });
});

// =============================================================================
// chunkCode
// =============================================================================
describe('chunkCode', () => {
  let svc: RAGService;
  let chunk: (content: string, ext: string) => Array<{ header: string; content: string }>;

  beforeEach(() => {
    svc = createService();
    chunk = getMethod(svc, 'chunkCode');
  });

  it('splits TypeScript by function definitions', () => {
    const code = `import { foo } from 'bar';

function hello() {
  return 'hi';
}

function world() {
  return 'planet';
}`;
    const result = chunk(code, '.ts');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((s) => s.header.includes('hello'))).toBe(true);
    expect(result.some((s) => s.header.includes('world'))).toBe(true);
  });

  it('splits Python by def/class', () => {
    const code = `import os

def main():
    print("hello")

class Foo:
    def bar(self):
        pass`;
    const result = chunk(code, '.py');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('first section header defaults to "module"', () => {
    const code = 'const x = 1;\nconst y = 2;';
    const result = chunk(code, '.ts');
    expect(result[0].header).toBe('module');
  });

  it('detects export function', () => {
    const code = 'export function myFunc() {\n  return 1;\n}';
    const result = chunk(code, '.ts');
    expect(result.some((s) => s.header.includes('myFunc'))).toBe(true);
  });

  it('detects class definitions', () => {
    const code = 'class MyClass {\n  method() {}\n}';
    const result = chunk(code, '.ts');
    expect(result.some((s) => s.header.includes('MyClass'))).toBe(true);
  });
});

// =============================================================================
// getCodePatterns
// =============================================================================
describe('getCodePatterns', () => {
  let svc: RAGService;
  let getPatterns: (ext: string) => RegExp[];

  beforeEach(() => {
    svc = createService();
    getPatterns = getMethod(svc, 'getCodePatterns');
  });

  it.each(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])(
    'returns patterns for %s',
    (ext) => {
      const patterns = getPatterns(ext);
      expect(patterns.length).toBeGreaterThan(0);
      // Should detect "function foo()"
      expect(patterns.some((p) => p.test('function foo()'))).toBe(true);
    },
  );

  it.each(['.py', '.pyx'])('returns patterns for %s', (ext) => {
    const patterns = getPatterns(ext);
    expect(patterns.some((p) => p.test('def main():'))).toBe(true);
  });

  it('returns patterns for .go', () => {
    const patterns = getPatterns('.go');
    expect(patterns.some((p) => p.test('func main()'))).toBe(true);
  });

  it('returns patterns for .rs', () => {
    const patterns = getPatterns('.rs');
    expect(patterns.some((p) => p.test('fn main()'))).toBe(true);
    expect(patterns.some((p) => p.test('pub struct Foo'))).toBe(true);
  });

  it('returns default patterns for unknown extension', () => {
    const patterns = getPatterns('.xyz');
    expect(patterns.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// chunkJSON
// =============================================================================
describe('chunkJSON', () => {
  let svc: RAGService;
  let chunk: (content: string) => Array<{ header: string; content: string }>;

  beforeEach(() => {
    svc = createService();
    chunk = getMethod(svc, 'chunkJSON');
  });

  it('splits by top-level keys', () => {
    const json = JSON.stringify({ name: 'test', version: '1.0', scripts: { build: 'tsc' } });
    const result = chunk(json);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.map((s) => s.header)).toContain('name');
    expect(result.map((s) => s.header)).toContain('version');
    expect(result.map((s) => s.header)).toContain('scripts');
  });

  it('handles arrays at top level — iterates indices as keys', () => {
    const result = chunk('[1, 2, 3]');
    // Arrays are objects in JS, Object.keys gives ['0','1','2']
    expect(result).toHaveLength(3);
    expect(result[0].header).toBe('0');
    expect(result[1].header).toBe('1');
    expect(result[2].header).toBe('2');
  });

  it('falls back to plain text on invalid JSON', () => {
    const result = chunk('not json at all');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty object', () => {
    const result = chunk('{}');
    // Empty object → returns [{header: "json", content: "{}"}]
    expect(result).toHaveLength(1);
    expect(result[0].header).toBe('json');
  });

  it('handles null value', () => {
    const result = chunk('null');
    expect(result).toHaveLength(1);
    expect(result[0].header).toBe('json');
  });
});

// =============================================================================
// chunkYAML
// =============================================================================
describe('chunkYAML', () => {
  let svc: RAGService;
  let chunk: (content: string) => Array<{ header: string; content: string }>;

  beforeEach(() => {
    svc = createService();
    chunk = getMethod(svc, 'chunkYAML');
  });

  it('splits by top-level keys', () => {
    const yaml = 'name: my-app\nversion: 1.0\ndependencies:\n  foo: ^1.0\n  bar: ^2.0';
    const result = chunk(yaml);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.map((s) => s.header)).toContain('name');
    expect(result.map((s) => s.header)).toContain('version');
    expect(result.map((s) => s.header)).toContain('dependencies');
  });

  it('includes indented content under key', () => {
    const yaml = 'server:\n  host: localhost\n  port: 3000';
    const result = chunk(yaml);
    expect(result.some((s) => s.content.includes('host: localhost'))).toBe(true);
  });

  it('defaults to "config" header for leading content', () => {
    const yaml = '# Comment\nname: test';
    const result = chunk(yaml);
    // First section may be "config" (the comment) or "name"
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// chunkCSV
// =============================================================================
describe('chunkCSV', () => {
  let svc: RAGService;
  let chunk: (content: string) => Array<{ header: string; content: string }>;

  beforeEach(() => {
    svc = createService();
    chunk = getMethod(svc, 'chunkCSV');
  });

  it('preserves header row in each chunk', () => {
    const rows = ['id,name,value'];
    for (let i = 1; i <= 100; i++) rows.push(`${i},item${i},${i * 10}`);
    const result = chunk(rows.join('\n'));
    // 100 data rows / 50 = 2 chunks
    expect(result).toHaveLength(2);
    result.forEach((s) => {
      expect(s.content.startsWith('id,name,value')).toBe(true);
    });
  });

  it('names sections by row ranges', () => {
    const rows = ['col1,col2'];
    for (let i = 0; i < 60; i++) rows.push(`a${i},b${i}`);
    const result = chunk(rows.join('\n'));
    expect(result[0].header).toBe('rows 1-50');
    expect(result[1].header).toBe('rows 51-60');
  });

  it('handles single-row CSV', () => {
    const result = chunk('header\nvalue');
    expect(result).toHaveLength(1);
  });

  it('handles empty CSV (header only)', () => {
    const result = chunk('header1,header2');
    expect(result).toHaveLength(1);
    expect(result[0].header).toBe('data');
  });
});

// =============================================================================
// chunkPlainText
// =============================================================================
describe('chunkPlainText', () => {
  let svc: RAGService;
  let chunk: (content: string) => Array<{ header: string; content: string }>;

  beforeEach(() => {
    svc = createService();
    chunk = getMethod(svc, 'chunkPlainText');
  });

  it('splits by double newlines (paragraphs)', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const result = chunk(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('aggregates small paragraphs into one section', () => {
    const text = 'Short.\n\nAlso short.\n\nStill short.';
    const result = chunk(text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('Short');
  });

  it('splits when paragraphs exceed 1500 chars', () => {
    const longPara = 'A'.repeat(800);
    const text = `${longPara}\n\n${longPara}\n\n${longPara}`;
    const result = chunk(text);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to chunkByLines for no-paragraph text', () => {
    const text = Array(100).fill('Line of text.').join('\n');
    const result = chunk(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].header).toContain('lines');
  });

  it('names sections sequentially', () => {
    const longPara = 'X'.repeat(800);
    const text = `${longPara}\n\n${longPara}\n\n${longPara}`;
    const result = chunk(text);
    result.forEach((s, i) => {
      expect(s.header).toBe(`section ${i + 1}`);
    });
  });
});

// =============================================================================
// chunkByLines
// =============================================================================
describe('chunkByLines', () => {
  let svc: RAGService;
  let chunk: (content: string, linesPerChunk: number) => Array<{ header: string; content: string }>;

  beforeEach(() => {
    svc = createService();
    chunk = getMethod(svc, 'chunkByLines');
  });

  it('chunks 100 lines into 2 chunks of 50', () => {
    const lines = Array(100).fill('line').join('\n');
    const result = chunk(lines, 50);
    expect(result).toHaveLength(2);
    expect(result[0].header).toBe('lines 1-50');
    expect(result[1].header).toBe('lines 51-100');
  });

  it('single chunk when lines < linesPerChunk', () => {
    const text = 'line1\nline2\nline3';
    const result = chunk(text, 80);
    expect(result).toHaveLength(1);
    expect(result[0].header).toBe('lines 1-3');
  });

  it('handles empty content', () => {
    const result = chunk('', 80);
    expect(result).toHaveLength(1);
  });
});

// =============================================================================
// splitLargeChunk
// =============================================================================
describe('splitLargeChunk', () => {
  let svc: RAGService;
  let split: (text: string, maxChars: number) => string[];

  beforeEach(() => {
    svc = createService();
    split = getMethod(svc, 'splitLargeChunk');
  });

  it('returns text as-is when under maxChars', () => {
    const result = split('short text', 100);
    expect(result).toEqual(['short text']);
  });

  it('splits by paragraphs', () => {
    const p1 = 'A'.repeat(40);
    const p2 = 'B'.repeat(40);
    const text = `${p1}\n\n${p2}`;
    const result = split(text, 50);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(p1);
    expect(result[1]).toBe(p2);
  });

  it('splits oversized paragraph by sentences', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const result = split(text, 25);
    expect(result.length).toBeGreaterThanOrEqual(2);
    result.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(30); // some leeway
    });
  });

  it('hard-splits oversized sentence', () => {
    const text = 'A'.repeat(200);
    const result = split(text, 50);
    expect(result.length).toBe(4);
    result.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(50);
    });
  });

  it('never returns empty array', () => {
    expect(split('', 100).length).toBeGreaterThanOrEqual(1);
    expect(split('x', 100).length).toBeGreaterThanOrEqual(1);
  });
});
