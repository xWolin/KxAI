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

// Shared file store used by both sync and async mocks
const mockStore = new Map<string, { content: string; mtime: number }>();

vi.mock('fs', () => {
  return {
    existsSync: vi.fn((p: string) => mockStore.has(p)),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn((p: string) => {
      const entry = mockStore.get(p);
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return entry.content;
    }),
    writeFileSync: vi.fn((p: string, content: string) => {
      mockStore.set(p, { content, mtime: Date.now() });
    }),
    statSync: vi.fn((p: string) => {
      const entry = mockStore.get(p);
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return { mtimeMs: entry.mtime };
    }),
    readdirSync: vi.fn((_p: string) => [] as string[]),
  };
});

vi.mock('fs/promises', () => {
  return {
    access: vi.fn(async (p: string) => {
      if (!mockStore.has(p)) throw new Error(`ENOENT: ${p}`);
    }),
    stat: vi.fn(async (p: string) => {
      const entry = mockStore.get(p);
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return { mtimeMs: entry.mtime };
    }),
    readFile: vi.fn(async (p: string) => {
      const entry = mockStore.get(p);
      if (!entry) throw new Error(`ENOENT: ${p}`);
      return entry.content;
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      mockStore.set(p, { content, mtime: Date.now() });
    }),
    readdir: vi.fn(async (_p: string) => [] as string[]),
    mkdir: vi.fn(async () => undefined),
  };
});

// Helper to set up mock file system
function setFile(filePath: string, content: string): void {
  mockStore.set(filePath, { content, mtime: Date.now() });
}

function clearFiles(): void {
  mockStore.clear();
}

// ─── Import after mocks ───
import { PromptService } from '../src/main/services/prompt-service';
import * as fsp from 'fs/promises';

describe('PromptService', () => {
  let service: PromptService;

  beforeEach(() => {
    clearFiles();
    vi.clearAllMocks();
    service = new PromptService();
  });

  // ─── load() ───

  describe('load()', () => {
    it('returns bundled prompt when no user override exists', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'AGENTS.md');
      setFile(bundledPath, '# Bundled Agents Prompt');

      expect(await service.load('AGENTS.md')).toBe('# Bundled Agents Prompt');
    });

    it('returns user override when it exists', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'AGENTS.md');
      const userPath = path.join(MOCK_USER_DIR, 'AGENTS.md');
      setFile(bundledPath, '# Bundled');
      setFile(userPath, '# User Override');

      expect(await service.load('AGENTS.md')).toBe('# User Override');
    });

    it('returns empty string when file does not exist', async () => {
      expect(await service.load('NONEXISTENT.md')).toBe('');
    });
  });

  // ─── render() ───

  describe('render()', () => {
    it('substitutes variables with {name} syntax', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'HEARTBEAT.md');
      setFile(bundledPath, 'Max steps: {maxSteps}, Task: {task}');

      const result = await service.render('HEARTBEAT.md', { maxSteps: '20', task: 'check email' });
      expect(result).toBe('Max steps: 20, Task: check email');
    });

    it('replaces all occurrences of a variable', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'TEST.md');
      setFile(bundledPath, '{name} said hello to {name}');

      const result = await service.render('TEST.md', { name: 'KxAI' });
      expect(result).toBe('KxAI said hello to KxAI');
    });

    it('returns content unchanged when no vars provided', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'SIMPLE.md');
      setFile(bundledPath, 'No variables here');

      expect(await service.render('SIMPLE.md')).toBe('No variables here');
    });

    it('leaves unmatched placeholders as-is', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'PARTIAL.md');
      setFile(bundledPath, '{known} and {unknown}');

      const result = await service.render('PARTIAL.md', { known: 'A' });
      expect(result).toBe('A and {unknown}');
    });
  });

  // ─── exists() ───

  describe('exists()', () => {
    it('returns true when bundled file exists', async () => {
      setFile(path.join(MOCK_BUNDLED_DIR, 'AGENTS.md'), 'content');
      expect(await service.exists('AGENTS.md')).toBe(true);
    });

    it('returns true when user override exists', async () => {
      setFile(path.join(MOCK_USER_DIR, 'CUSTOM.md'), 'custom content');
      expect(await service.exists('CUSTOM.md')).toBe(true);
    });

    it('returns false when file does not exist anywhere', async () => {
      expect(await service.exists('NOPE.md')).toBe(false);
    });
  });

  // ─── list() ───

  describe('list()', () => {
    it('merges bundled and user files, sorted, deduped', async () => {
      vi.mocked(fsp.readdir).mockImplementation(async (dir: any) => {
        const d = dir.toString().replace(/\\/g, '/');
        if (d.includes('src/main/prompts')) return ['AGENTS.md', 'HEARTBEAT.md', 'readme.txt'] as any;
        if (d.includes('workspace/prompts')) return ['AGENTS.md', 'CUSTOM.md'] as any;
        return [] as any;
      });

      const result = await service.list();
      // Only .md files, sorted, no duplicates
      expect(result).toEqual(['AGENTS.md', 'CUSTOM.md', 'HEARTBEAT.md']);
    });

    it('returns empty array when no dirs exist', async () => {
      vi.mocked(fsp.readdir).mockImplementation(async () => {
        throw new Error('ENOENT');
      });

      expect(await service.list()).toEqual([]);
    });
  });

  // ─── copyToUser() ───

  describe('copyToUser()', () => {
    it('copies bundled file to user dir', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'AGENTS.md');
      setFile(bundledPath, '# Bundled Agents');

      const result = await service.copyToUser('AGENTS.md');
      expect(result).toBe(path.join(MOCK_USER_DIR, 'AGENTS.md'));
      expect(fsp.writeFile).toHaveBeenCalledWith(
        path.join(MOCK_USER_DIR, 'AGENTS.md'),
        '# Bundled Agents',
        'utf-8',
      );
    });

    it('returns existing path if user file already exists', async () => {
      const userPath = path.join(MOCK_USER_DIR, 'AGENTS.md');
      setFile(userPath, '# Already there');

      const result = await service.copyToUser('AGENTS.md');
      expect(result).toBe(userPath);
    });

    it('returns null when bundled file does not exist', async () => {
      const result = await service.copyToUser('NONEXISTENT.md');
      expect(result).toBeNull();
    });
  });

  // ─── Cache ───

  describe('cache behavior', () => {
    it('caches file reads by mtime', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'CACHED.md');
      setFile(bundledPath, 'cached content');

      // First read
      await service.load('CACHED.md');
      // Second read — should hit cache
      await service.load('CACHED.md');

      // readFile called only once (the cache hit avoids second read)
      // Note: fsp.access and fsp.stat are called each time, but readFile only once
      expect(vi.mocked(fsp.readFile)).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache clears specific file', async () => {
      const bundledPath = path.join(MOCK_BUNDLED_DIR, 'AGENTS.md');
      setFile(bundledPath, 'original');

      await service.load('AGENTS.md'); // populate cache
      service.invalidateCache('AGENTS.md');

      // Change content
      setFile(bundledPath, 'updated');
      const result = await service.load('AGENTS.md');
      expect(result).toBe('updated');
    });

    it('invalidateCache() without args clears all cache', async () => {
      const p1 = path.join(MOCK_BUNDLED_DIR, 'A.md');
      const p2 = path.join(MOCK_BUNDLED_DIR, 'B.md');
      setFile(p1, 'A');
      setFile(p2, 'B');

      await service.load('A.md');
      await service.load('B.md');
      service.invalidateCache();

      // After invalidation, next load re-reads
      await service.load('A.md');
      await service.load('B.md');
      // readFile called 4 times total (2 initial + 2 after invalidation)
      expect(vi.mocked(fsp.readFile)).toHaveBeenCalledTimes(4);
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
