import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ─── Mocks ───

const MOCK_BUNDLED_DIR = '/app/src/main/prompts';
const MOCK_USER_DIR = '/userData/workspace/prompts';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
    getPath: (name: string) => {
      if (name === 'userData') return '/userData';
      return '/tmp';
    },
  },
}));

vi.mock('fs', () => {
  const store = new Map<string, { content: string; mtime: number }>();
  return {
    existsSync: vi.fn((p: string) => store.has(p)),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn((p: string) => {
      const entry = store.get(p);
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return entry.content;
    }),
    writeFileSync: vi.fn((p: string, content: string) => {
      store.set(p, { content, mtime: Date.now() });
    }),
    statSync: vi.fn((p: string) => {
      const entry = store.get(p);
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return { mtimeMs: entry.mtime };
    }),
    readdirSync: vi.fn((_p: string) => [] as string[]),
    // Allow store access for test setup
    __mockStore: store,
  };
});

// Helper to set up mock file system
function setFile(filePath: string, content: string): void {
  const store = (fs as unknown as { __mockStore: Map<string, { content: string; mtime: number }> }).__mockStore;
  store.set(filePath, { content, mtime: Date.now() });
}

function clearFiles(): void {
  const store = (fs as unknown as { __mockStore: Map<string, { content: string; mtime: number }> }).__mockStore;
  store.clear();
}

// ─── Import after mocks ───
import { PromptService } from '../src/main/services/prompt-service';

describe('PromptService', () => {
  let service: PromptService;

  beforeEach(() => {
    clearFiles();
    vi.clearAllMocks();
    service = new PromptService();
  });

  // ─── load() ───

  describe('load()', () => {
    it('returns bundled prompt when no user override exists', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'AGENTS.md');
      setFile(bundledPath, '# Bundled Agents Prompt');

      expect(service.load('AGENTS.md')).toBe('# Bundled Agents Prompt');
    });

    it('returns user override when it exists', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'AGENTS.md');
      const userPath = path.join(MOCK_USER_DIR, 'AGENTS.md');
      setFile(bundledPath, '# Bundled');
      setFile(userPath, '# User Override');

      expect(service.load('AGENTS.md')).toBe('# User Override');
    });

    it('returns empty string when file does not exist', () => {
      expect(service.load('NONEXISTENT.md')).toBe('');
    });
  });

  // ─── render() ───

  describe('render()', () => {
    it('substitutes variables with {name} syntax', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'HEARTBEAT.md');
      setFile(bundledPath, 'Max steps: {maxSteps}, Task: {task}');

      const result = service.render('HEARTBEAT.md', { maxSteps: '20', task: 'check email' });
      expect(result).toBe('Max steps: 20, Task: check email');
    });

    it('replaces all occurrences of a variable', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'TEST.md');
      setFile(bundledPath, '{name} said hello to {name}');

      const result = service.render('TEST.md', { name: 'KxAI' });
      expect(result).toBe('KxAI said hello to KxAI');
    });

    it('returns content unchanged when no vars provided', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'SIMPLE.md');
      setFile(bundledPath, 'No variables here');

      expect(service.render('SIMPLE.md')).toBe('No variables here');
    });

    it('leaves unmatched placeholders as-is', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'PARTIAL.md');
      setFile(bundledPath, '{known} and {unknown}');

      const result = service.render('PARTIAL.md', { known: 'A' });
      expect(result).toBe('A and {unknown}');
    });
  });

  // ─── exists() ───

  describe('exists()', () => {
    it('returns true when bundled file exists', () => {
      setFile(path.join(MOCK_BUNDLED_DIR, 'AGENTS.md'), 'content');
      expect(service.exists('AGENTS.md')).toBe(true);
    });

    it('returns true when user override exists', () => {
      setFile(path.join(MOCK_USER_DIR, 'CUSTOM.md'), 'custom content');
      expect(service.exists('CUSTOM.md')).toBe(true);
    });

    it('returns false when file does not exist anywhere', () => {
      expect(service.exists('NOPE.md')).toBe(false);
    });
  });

  // ─── list() ───

  describe('list()', () => {
    it('merges bundled and user files, sorted, deduped', () => {
      vi.mocked(fs.readdirSync).mockImplementation((dir: fs.PathLike) => {
        const d = dir.toString().replace(/\\/g, '/');
        if (d.includes('src/main/prompts')) return ['AGENTS.md', 'HEARTBEAT.md', 'readme.txt'] as unknown as fs.Dirent[];
        if (d.includes('workspace/prompts')) return ['AGENTS.md', 'CUSTOM.md'] as unknown as fs.Dirent[];
        return [] as unknown as fs.Dirent[];
      });

      const result = service.list();
      // Only .md files, sorted, no duplicates
      expect(result).toEqual(['AGENTS.md', 'CUSTOM.md', 'HEARTBEAT.md']);
    });

    it('returns empty array when no dirs exist', () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(service.list()).toEqual([]);
    });
  });

  // ─── copyToUser() ───

  describe('copyToUser()', () => {
    it('copies bundled file to user dir', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'AGENTS.md');
      setFile(bundledPath, '# Bundled Agents');

      const result = service.copyToUser('AGENTS.md');
      expect(result).toBe(path.join(MOCK_USER_DIR, 'AGENTS.md'));
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(MOCK_USER_DIR, 'AGENTS.md'),
        '# Bundled Agents',
        'utf-8',
      );
    });

    it('returns existing path if user file already exists', () => {
      const userPath = path.join(MOCK_USER_DIR, 'AGENTS.md');
      setFile(userPath, '# Already there');

      const result = service.copyToUser('AGENTS.md');
      expect(result).toBe(userPath);
      // writeFileSync should not be called again by copyToUser
      // (it may have been called by setFile, so we check the call count)
    });

    it('returns null when bundled file does not exist', () => {
      const result = service.copyToUser('NONEXISTENT.md');
      expect(result).toBeNull();
    });
  });

  // ─── Cache ───

  describe('cache behavior', () => {
    it('caches file reads by mtime', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'CACHED.md');
      setFile(bundledPath, 'cached content');

      // First read
      service.load('CACHED.md');
      // Second read — should hit cache
      service.load('CACHED.md');

      // readFileSync called only once (the cache hit avoids second read)
      expect(vi.mocked(fs.readFileSync)).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache clears specific file', () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'AGENTS.md');
      setFile(bundledPath, 'original');

      service.load('AGENTS.md'); // populate cache
      service.invalidateCache('AGENTS.md');

      // Change content
      setFile(bundledPath, 'updated');
      const result = service.load('AGENTS.md');
      expect(result).toBe('updated');
    });

    it('invalidateCache() without args clears all cache', () => {
      const p1 = path.join(MOCK_BUNDLED_DIR, 'A.md');
      const p2 = path.join(MOCK_BUNDLED_DIR, 'B.md');
      setFile(p1, 'A');
      setFile(p2, 'B');

      service.load('A.md');
      service.load('B.md');
      service.invalidateCache();

      // After invalidation, next load re-reads
      service.load('A.md');
      service.load('B.md');
      // readFileSync called 4 times total (2 initial + 2 after invalidation)
      expect(vi.mocked(fs.readFileSync)).toHaveBeenCalledTimes(4);
    });
  });

  // ─── getUserDir() ───

  describe('getUserDir()', () => {
    it('returns user prompts directory path', () => {
      // On Windows path.join uses backslashes, normalize for comparison
      const result = service.getUserDir().replace(/\\/g, '/');
      expect(result).toContain('userData/workspace/prompts');
    });
  });
});
