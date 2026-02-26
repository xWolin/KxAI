import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return '/mock/userData';
      if (key === 'documents') return '/mock/documents';
      return '/mock/' + key;
    }),
    getVersion: vi.fn(() => '0.1.0'),
  },
}));

vi.mock('os', () => ({
  tmpdir: vi.fn(() => '/mock/tmp'),
  default: { tmpdir: vi.fn(() => '/mock/tmp') },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  default: { existsSync: vi.fn(() => false) },
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(() => Promise.resolve([])),
  readFile: vi.fn(() => Promise.resolve('')),
  writeFile: vi.fn(() => Promise.resolve()),
  stat: vi.fn(() => Promise.resolve({ size: 100, isDirectory: () => false })),
  mkdir: vi.fn(() => Promise.resolve()),
  rm: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
  copyFile: vi.fn(() => Promise.resolve()),
  default: {
    readdir: vi.fn(() => Promise.resolve([])),
    readFile: vi.fn(() => Promise.resolve('')),
    writeFile: vi.fn(() => Promise.resolve()),
    stat: vi.fn(() => Promise.resolve({ size: 100 })),
    mkdir: vi.fn(() => Promise.resolve()),
    rm: vi.fn(() => Promise.resolve()),
    unlink: vi.fn(() => Promise.resolve()),
    copyFile: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

import { PrivacyService } from '../src/main/services/privacy-service';
import * as fs from 'fs';

function createMockDb(ready = false) {
  return {
    isReady: vi.fn(() => ready),
    getStats: vi.fn(() => ({
      totalMessages: 42,
      totalSessions: 5,
      dbSizeBytes: 12345,
    })),
    db: ready
      ? {
          prepare: vi.fn(() => ({
            get: vi.fn(() => ({ ts: null, count: 0 })),
            all: vi.fn(() => []),
          })),
          exec: vi.fn(),
        }
      : null,
  };
}

// =============================================================================
// CATEGORY_META
// =============================================================================
describe('CATEGORY_META coverage', () => {
  it('has all 12 categories', () => {
    const svc = new PrivacyService(createMockDb() as any);
    const cats = (svc as any).getAllCategories();
    expect(cats).toHaveLength(12);
    expect(cats).toContain('conversations');
    expect(cats).toContain('memory');
    expect(cats).toContain('activity');
    expect(cats).toContain('meetings');
    expect(cats).toContain('cron');
    expect(cats).toContain('rag');
    expect(cats).toContain('audit');
    expect(cats).toContain('config');
    expect(cats).toContain('prompts');
    expect(cats).toContain('browser');
    expect(cats).toContain('secrets');
    expect(cats).toContain('temp');
  });
});

// =============================================================================
// summarizeConversations (DB not ready)
// =============================================================================
describe('summarizeConversations', () => {
  it('returns zero when DB not ready', async () => {
    const svc = new PrivacyService(createMockDb(false) as any);
    const result = await (svc as any).summarizeConversations();
    expect(result.category).toBe('conversations');
    expect(result.itemCount).toBe(0);
    expect(result.sizeBytes).toBe(0);
    expect(result.label).toBe('Konwersacje');
  });

  it('returns DB stats when ready', async () => {
    const svc = new PrivacyService(createMockDb(true) as any);
    const result = await (svc as any).summarizeConversations();
    expect(result.category).toBe('conversations');
    expect(result.itemCount).toBe(42);
    expect(result.sizeBytes).toBe(12345);
  });
});

// =============================================================================
// summarizeRAG
// =============================================================================
describe('summarizeRAG', () => {
  it('returns zero when DB not ready', async () => {
    const svc = new PrivacyService(createMockDb(false) as any);
    const result = await (svc as any).summarizeRAG();
    expect(result.category).toBe('rag');
    expect(result.itemCount).toBe(0);
  });

  it('returns chunk+embedding count when DB ready', async () => {
    const db = createMockDb(true);
    db.db!.prepare = vi.fn((sql: string) => ({
      get: vi.fn(() => {
        if (sql.includes('rag_chunks')) return { count: 150 };
        if (sql.includes('embedding_cache')) return { count: 50 };
        return { count: 0 };
      }),
      all: vi.fn(() => []),
    }));
    const svc = new PrivacyService(db as any);
    const result = await (svc as any).summarizeRAG();
    expect(result.itemCount).toBe(200); // 150 + 50
  });
});

// =============================================================================
// summarizeSecrets
// =============================================================================
describe('summarizeSecrets', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('returns zero when secrets dir not found', async () => {
    const svc = new PrivacyService(createMockDb() as any);
    const result = await (svc as any).summarizeSecrets();
    expect(result.category).toBe('secrets');
    expect(result.itemCount).toBe(0);
    expect(result.sizeBytes).toBe(0);
  });

  it('counts files when secrets dir exists', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsp.readdir).mockResolvedValue(['openai.enc', 'anthropic.enc'] as any);
    vi.mocked(fsp.stat).mockResolvedValue({ size: 256 } as any);

    const svc = new PrivacyService(createMockDb() as any);
    const result = await (svc as any).summarizeSecrets();
    // 2 files + key file = 3 items
    expect(result.itemCount).toBe(3);
    expect(result.sizeBytes).toBe(256 * 3); // 3 stat calls × 256
  });
});

// =============================================================================
// summarizeFile
// =============================================================================
describe('summarizeFile', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('returns zero when file not found', async () => {
    const svc = new PrivacyService(createMockDb() as any);
    const result = await (svc as any).summarizeFile('audit', '/fake/audit.json');
    expect(result.category).toBe('audit');
    expect(result.itemCount).toBe(0);
  });

  it('returns stats when file exists', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsp.stat).mockResolvedValue({ size: 1024 } as any);

    const svc = new PrivacyService(createMockDb() as any);
    const result = await (svc as any).summarizeFile('audit', '/fake/audit.json');
    expect(result.itemCount).toBe(1);
    expect(result.sizeBytes).toBe(1024);
  });
});

// =============================================================================
// summarizeDirectory
// =============================================================================
describe('summarizeDirectory', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('returns zero when dir not found', async () => {
    const svc = new PrivacyService(createMockDb() as any);
    const result = await (svc as any).summarizeDirectory('activity', '/fake/workflow');
    expect(result.category).toBe('activity');
    expect(result.itemCount).toBe(0);
  });

  it('counts specific files when provided', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsp.stat).mockResolvedValue({ size: 512 } as any);

    const svc = new PrivacyService(createMockDb() as any);
    const result = await (svc as any).summarizeDirectory('memory', '/fake/memory', ['SOUL.md', 'USER.md']);
    expect(result.itemCount).toBe(2);
    expect(result.sizeBytes).toBe(1024);
  });
});

// =============================================================================
// deleteMemoryFiles
// =============================================================================
describe('deleteMemoryFiles', () => {
  beforeEach(async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const fsp = await import('fs/promises');
    vi.mocked(fsp.unlink).mockClear();
  });

  it('deletes all memory files when keepPersona=false', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fsp.unlink).mockResolvedValue();
    const svc = new PrivacyService(createMockDb() as any);
    await (svc as any).deleteMemoryFiles(false);

    const calls = vi.mocked(fsp.unlink).mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('USER.md'))).toBe(true);
    expect(calls.some((c) => c.includes('MEMORY.md'))).toBe(true);
    expect(calls.some((c) => c.includes('HEARTBEAT.md'))).toBe(true);
    expect(calls.some((c) => c.includes('SOUL.md'))).toBe(true);
  });

  it('keeps SOUL.md when keepPersona=true', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fsp.unlink).mockResolvedValue();
    const svc = new PrivacyService(createMockDb() as any);
    await (svc as any).deleteMemoryFiles(true);

    const calls = vi.mocked(fsp.unlink).mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('SOUL.md'))).toBe(false);
    expect(calls.some((c) => c.includes('USER.md'))).toBe(true);
  });
});

// =============================================================================
// listSecretKeys
// =============================================================================
describe('listSecretKeys', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('returns empty when dir not found', async () => {
    const svc = new PrivacyService(createMockDb() as any);
    const keys = await (svc as any).listSecretKeys();
    expect(keys).toEqual([]);
  });

  it('strips .enc and returns key names', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsp.readdir).mockResolvedValue(['openai.enc', 'anthropic.enc'] as any);

    const svc = new PrivacyService(createMockDb() as any);
    const keys = await (svc as any).listSecretKeys();
    expect(keys).toEqual(['openai', 'anthropic']);
  });
});

// =============================================================================
// deleteConversations
// =============================================================================
describe('deleteConversations', () => {
  it('skips when DB not ready', async () => {
    const db = createMockDb(false);
    const svc = new PrivacyService(db as any);
    await (svc as any).deleteConversations();
    // No error, no calls
  });

  it('deletes messages and sessions when DB ready', async () => {
    const db = createMockDb(true);
    const svc = new PrivacyService(db as any);
    await (svc as any).deleteConversations();
    expect(db.db!.exec).toHaveBeenCalledWith('DELETE FROM messages');
    expect(db.db!.exec).toHaveBeenCalledWith('DELETE FROM sessions');
  });
});

// =============================================================================
// deleteRAG
// =============================================================================
describe('deleteRAG', () => {
  it('skips when DB not ready', async () => {
    const svc = new PrivacyService(createMockDb(false) as any);
    await (svc as any).deleteRAG();
  });

  it('deletes all RAG tables when DB ready', async () => {
    const db = createMockDb(true);
    const svc = new PrivacyService(db as any);
    await (svc as any).deleteRAG();
    expect(db.db!.exec).toHaveBeenCalledWith('DELETE FROM rag_chunks');
    expect(db.db!.exec).toHaveBeenCalledWith('DELETE FROM embedding_cache');
    expect(db.db!.exec).toHaveBeenCalledWith('DELETE FROM rag_folders');
  });
});

// =============================================================================
// removeDirectory / removeFile
// =============================================================================
describe('removeDirectory', () => {
  it('no-op when dir does not exist', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const svc = new PrivacyService(createMockDb() as any);
    await (svc as any).removeDirectory('/fake/path');
    expect(fsp.rm).not.toHaveBeenCalled();
  });

  it('calls rm recursive when dir exists', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsp.rm).mockResolvedValue();
    const svc = new PrivacyService(createMockDb() as any);
    await (svc as any).removeDirectory('/fake/path');
    expect(fsp.rm).toHaveBeenCalledWith('/fake/path', { recursive: true, force: true });
  });
});

describe('removeFile', () => {
  it('no-op when file does not exist', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fsp.unlink).mockClear();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const svc = new PrivacyService(createMockDb() as any);
    await (svc as any).removeFile('/fake/file');
    expect(fsp.unlink).not.toHaveBeenCalled();
  });
});

// =============================================================================
// deleteData
// =============================================================================
describe('deleteData', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('skips config when keepConfig=true', async () => {
    const db = createMockDb(false);
    const svc = new PrivacyService(db as any);
    const result = await svc.deleteData({
      categories: ['config'],
      keepConfig: true,
    });
    expect(result.deletedCategories).not.toContain('config');
  });

  it('reports success when all categories deleted', async () => {
    const db = createMockDb(false);
    const svc = new PrivacyService(db as any);
    const result = await svc.deleteData({ categories: ['temp', 'prompts'] });
    expect(result.success).toBe(true);
    expect(result.deletedCategories).toContain('temp');
    expect(result.deletedCategories).toContain('prompts');
  });

  it('sets requiresRestart for critical categories', async () => {
    const db = createMockDb(true);
    const svc = new PrivacyService(db as any);
    const result = await svc.deleteData({ categories: ['conversations'] });
    expect(result.requiresRestart).toBe(true);
  });
});

// =============================================================================
// exportConfig — strips secrets
// =============================================================================
describe('exportConfig', () => {
  it('removes API keys from exported config', async () => {
    const fsp = await import('fs/promises');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fsp.readFile).mockResolvedValue(JSON.stringify({
      model: 'gpt-5',
      openaiApiKey: 'sk-secret',
      anthropicApiKey: 'sk-ant-secret',
      elevenLabsApiKey: 'elkey',
      deepgramApiKey: 'dkey',
    }));
    vi.mocked(fsp.writeFile).mockResolvedValue();

    const svc = new PrivacyService(createMockDb() as any);
    await (svc as any).exportConfig('/fake/export');

    const writeCall = vi.mocked(fsp.writeFile).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.model).toBe('gpt-5');
    expect(written.openaiApiKey).toBeUndefined();
    expect(written.anthropicApiKey).toBeUndefined();
    expect(written.elevenLabsApiKey).toBeUndefined();
    expect(written.deepgramApiKey).toBeUndefined();
  });
});

// =============================================================================
// getDataSummary
// =============================================================================
describe('getDataSummary', () => {
  it('returns summary with all 12 categories', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const svc = new PrivacyService(createMockDb(false) as any);
    const summary = await svc.getDataSummary();
    expect(summary.categories).toHaveLength(12);
    expect(summary.totalSizeBytes).toBe(0);
    expect(summary.dataCollectionStart).toBeNull();
    expect(summary.lastActivity).toBeNull();
  });
});
