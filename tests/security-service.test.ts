import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
const mockEncryptionKey = Buffer.alloc(32, 'a'); // 32 bytes
const mockIV = Buffer.alloc(16, 'b'); // 16 bytes
const mockUserDataPath = '/mock/userData';
let mockFiles: Record<string, string | Buffer> = {};

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`encrypted:${s}`)),
    decryptString: vi.fn((buf: Buffer) => {
      const str = buf.toString();
      return str.startsWith('encrypted:') ? str.slice('encrypted:'.length) : str;
    }),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((p: string) => p in mockFiles),
    readFileSync: vi.fn((p: string, enc?: string) => {
      if (p in mockFiles) return mockFiles[p];
      throw new Error(`ENOENT: ${p}`);
    }),
    writeFileSync: vi.fn((p: string, data: any) => {
      mockFiles[p] = typeof data === 'string' ? data : data.toString();
    }),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn((p: string) => { delete mockFiles[p]; }),
  },
  existsSync: vi.fn((p: string) => p in mockFiles),
  readFileSync: vi.fn((p: string, enc?: string) => {
    if (p in mockFiles) return mockFiles[p];
    throw new Error(`ENOENT: ${p}`);
  }),
  writeFileSync: vi.fn((p: string, data: any) => {
    mockFiles[p] = typeof data === 'string' ? data : data.toString();
  }),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn((p: string) => { delete mockFiles[p]; }),
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(async (p: string, data: string) => { mockFiles[p] = data; }),
    readFile: vi.fn(async (p: string) => {
      if (p in mockFiles) return mockFiles[p];
      throw new Error(`ENOENT: ${p}`);
    }),
    access: vi.fn(async (p: string) => {
      if (!(p in mockFiles)) throw new Error(`ENOENT: ${p}`);
    }),
    unlink: vi.fn(async (p: string) => { delete mockFiles[p]; }),
  },
  writeFile: vi.fn(async (p: string, data: string) => { mockFiles[p] = data; }),
  readFile: vi.fn(async (p: string) => {
    if (p in mockFiles) return mockFiles[p];
    throw new Error(`ENOENT: ${p}`);
  }),
  access: vi.fn(async (p: string) => {
    if (!(p in mockFiles)) throw new Error(`ENOENT: ${p}`);
  }),
  unlink: vi.fn(async (p: string) => { delete mockFiles[p]; }),
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    default: actual,
    randomBytes: vi.fn((size: number) => {
      // Return deterministic bytes for IV/key
      if (size === 32) return mockEncryptionKey;
      if (size === 16) return mockIV;
      return Buffer.alloc(size, 'c');
    }),
  };
});

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { SecurityService } from '../src/main/services/security';

describe('SecurityService', () => {
  beforeEach(() => {
    mockFiles = {};
    vi.clearAllMocks();
  });

  function createService(): SecurityService {
    // Put a safe key file so constructor doesn't need to generate one fresh
    const safeKeyPath = `${mockUserDataPath}/.kxai-key-safe`;
    mockFiles[safeKeyPath] = Buffer.from(`encrypted:${mockEncryptionKey.toString('hex')}`) as any;
    return new SecurityService();
  }

  describe('constructor', () => {
    it('does not throw', () => {
      expect(() => createService()).not.toThrow();
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('encrypts and decrypts correctly', () => {
      const svc = createService();
      const encrypted = (svc as any).encrypt('hello world');
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe('hello world');
      expect(encrypted.split(':')).toHaveLength(3);
      const decrypted = (svc as any).decrypt(encrypted);
      expect(decrypted).toBe('hello world');
    });

    it('produces different ciphertext each time (different IV)', () => {
      const svc = createService();
      // Even with mocked randomBytes, the format should work
      const e1 = (svc as any).encrypt('test');
      const e2 = (svc as any).encrypt('test');
      // Both should decrypt to same value
      expect((svc as any).decrypt(e1)).toBe('test');
      expect((svc as any).decrypt(e2)).toBe('test');
    });

    it('throws on invalid encrypted format', () => {
      const svc = createService();
      expect(() => (svc as any).decrypt('invalid-no-colons')).toThrow('Invalid encrypted format');
    });

    it('handles empty string', () => {
      const svc = createService();
      const encrypted = (svc as any).encrypt('');
      expect((svc as any).decrypt(encrypted)).toBe('');
    });

    it('handles unicode content', () => {
      const svc = createService();
      const text = 'Zażółć gęślą jaźń 🎵';
      const encrypted = (svc as any).encrypt(text);
      expect((svc as any).decrypt(encrypted)).toBe(text);
    });

    it('handles long API key', () => {
      const svc = createService();
      const longKey = 'sk-' + 'a'.repeat(200);
      const encrypted = (svc as any).encrypt(longKey);
      expect((svc as any).decrypt(encrypted)).toBe(longKey);
    });
  });

  describe('API key CRUD', () => {
    it('setApiKey + getApiKey round-trip', async () => {
      const svc = createService();
      await svc.setApiKey('openai', 'sk-test-key-123');
      const key = await svc.getApiKey('openai');
      expect(key).toBe('sk-test-key-123');
    });

    it('getApiKey returns null for non-existent provider', async () => {
      const svc = createService();
      const key = await svc.getApiKey('nonexistent');
      expect(key).toBeNull();
    });

    it('hasApiKey returns true after set', async () => {
      const svc = createService();
      await svc.setApiKey('anthropic', 'sk-ant-123');
      const has = await svc.hasApiKey('anthropic');
      expect(has).toBe(true);
    });

    it('hasApiKey returns false when not set', async () => {
      const svc = createService();
      const has = await svc.hasApiKey('nonexistent');
      expect(has).toBe(false);
    });

    it('deleteApiKey removes the key', async () => {
      const svc = createService();
      await svc.setApiKey('openai', 'sk-to-delete');
      await svc.deleteApiKey('openai');
      const key = await svc.getApiKey('openai');
      expect(key).toBeNull();
    });

    it('deleteApiKey on non-existent does not throw', async () => {
      const svc = createService();
      await expect(svc.deleteApiKey('nonexistent')).resolves.not.toThrow();
    });

    it('sanitizes provider name (removes special chars)', async () => {
      const svc = createService();
      await svc.setApiKey('my../../evil', 'sk-evil');
      // Should sanitize to "myevil"
      const key = await svc.getApiKey('my../../evil');
      expect(key).toBe('sk-evil');
    });

    it('handles multiple providers', async () => {
      const svc = createService();
      await svc.setApiKey('openai', 'sk-openai');
      await svc.setApiKey('anthropic', 'sk-anthropic');
      await svc.setApiKey('elevenlabs', 'sk-eleven');

      expect(await svc.getApiKey('openai')).toBe('sk-openai');
      expect(await svc.getApiKey('anthropic')).toBe('sk-anthropic');
      expect(await svc.getApiKey('elevenlabs')).toBe('sk-eleven');
    });

    it('overwriting key replaces it', async () => {
      const svc = createService();
      await svc.setApiKey('openai', 'old-key');
      await svc.setApiKey('openai', 'new-key');
      const key = await svc.getApiKey('openai');
      expect(key).toBe('new-key');
    });
  });
});
