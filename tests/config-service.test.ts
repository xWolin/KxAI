/**
 * Unit tests for ConfigService v2.
 *
 * Tests cover:
 * - Zod schema validation (defaults, invalid data, partial recovery)
 * - Typed get/set with TypeScript inference
 * - setBatch for atomic multi-key updates
 * - onChange reactive subscriptions
 * - Debounced save (single write for multiple set() calls)
 * - Atomic write (temp file + rename)
 * - Config migration system
 * - forceSave and shutdown
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// ─── Mock electron app ───
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// ─── Mock fs ───
let mockFileContent: string | null = null;
let mockFileExists = false;

vi.mock('fs', () => ({
  existsSync: vi.fn(() => mockFileExists),
  readFileSync: vi.fn(() => mockFileContent ?? ''),
}));

let lastWrittenPath = '';
let lastWrittenContent = '';
let lastRenamedFrom = '';
let lastRenamedTo = '';
let writeShouldFail = false;

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async (_path: string, content: string) => {
    if (writeShouldFail) throw new Error('disk full');
    lastWrittenPath = _path;
    lastWrittenContent = content;
  }),
  rename: vi.fn(async (from: string, to: string) => {
    lastRenamedFrom = from;
    lastRenamedTo = to;
  }),
}));

// ─── Mock logger ───
vi.mock('../src/main/services/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ConfigService } from '../src/main/services/config';
import { KxAIConfigSchema, CURRENT_CONFIG_VERSION } from '../src/shared/schemas/config-schema';

// ─── Helpers ───

function createService(fileContent?: string): ConfigService {
  if (fileContent !== undefined) {
    mockFileExists = true;
    mockFileContent = fileContent;
  } else {
    mockFileExists = false;
    mockFileContent = null;
  }
  return new ConfigService();
}

// ─── Tests ───

describe('ConfigService v2', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFileExists = false;
    mockFileContent = null;
    lastWrittenPath = '';
    lastWrittenContent = '';
    lastRenamedFrom = '';
    lastRenamedTo = '';
    writeShouldFail = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ────────────── Schema defaults ──────────────

  describe('schema defaults', () => {
    it('uses default values when no config file exists', () => {
      const svc = createService();
      expect(svc.get('aiProvider')).toBe('openai');
      expect(svc.get('aiModel')).toBe('gpt-5');
      expect(svc.get('proactiveMode')).toBe(false);
      expect(svc.get('proactiveIntervalMs')).toBe(60000);
      expect(svc.get('theme')).toBe('dark');
      expect(svc.get('onboarded')).toBe(false);
      expect(svc.get('agentName')).toBe('KxAI');
      expect(svc.get('agentEmoji')).toBe('🤖');
      expect(svc.get('screenWatchEnabled')).toBe(false);
      expect(svc.get('userLanguage')).toBe('pl');
      expect(svc.get('useNativeFunctionCalling')).toBe(true);
    });

    it('sets _version to CURRENT_CONFIG_VERSION', () => {
      const svc = createService();
      expect(svc.get('_version')).toBe(CURRENT_CONFIG_VERSION);
    });

    it('preserves optional fields as undefined when not set', () => {
      const svc = createService();
      expect(svc.get('userName')).toBeUndefined();
      expect(svc.get('widgetPosition')).toBeUndefined();
      expect(svc.get('indexedFolders')).toBeUndefined();
      expect(svc.get('mcpServers')).toBeUndefined();
      expect(svc.get('meetingCoach')).toBeUndefined();
    });
  });

  // ────────────── Loading from file ──────────────

  describe('loading from file', () => {
    it('loads valid JSON and merges with defaults', () => {
      const svc = createService(
        JSON.stringify({
          aiProvider: 'anthropic',
          aiModel: 'claude-4-opus',
          userName: 'Jan',
        }),
      );
      expect(svc.get('aiProvider')).toBe('anthropic');
      expect(svc.get('aiModel')).toBe('claude-4-opus');
      expect(svc.get('userName')).toBe('Jan');
      // Defaults still applied for unset fields
      expect(svc.get('proactiveMode')).toBe(false);
      expect(svc.get('agentName')).toBe('KxAI');
    });

    it('handles corrupted JSON gracefully (uses defaults)', () => {
      const svc = createService('{broken json!!!');
      expect(svc.get('aiProvider')).toBe('openai');
      expect(svc.get('aiModel')).toBe('gpt-5');
    });

    it('handles empty file gracefully', () => {
      mockFileExists = true;
      mockFileContent = '';
      // readFileSync returns '', JSON.parse('') throws
      const svc = new ConfigService();
      expect(svc.get('aiProvider')).toBe('openai');
    });

    it('preserves unknown keys via passthrough', () => {
      const svc = createService(
        JSON.stringify({
          customField: 'hello',
          nested: { a: 1 },
        }),
      );
      const all = svc.getAll();
      expect((all as any).customField).toBe('hello');
      expect((all as any).nested).toEqual({ a: 1 });
    });
  });

  // ────────────── Typed get/set ──────────────

  describe('typed get/set', () => {
    it('set() updates value and get() returns it', () => {
      const svc = createService();
      svc.set('aiModel', 'gpt-5-turbo');
      expect(svc.get('aiModel')).toBe('gpt-5-turbo');
    });

    it('set() skips save when value unchanged (shallow equality)', () => {
      const svc = createService();
      const listener = vi.fn();
      svc.onChange('aiModel', listener);

      svc.set('aiModel', 'gpt-5'); // Same as default
      expect(listener).not.toHaveBeenCalled();
    });

    it('getAll() returns a shallow copy', () => {
      const svc = createService();
      const a = svc.getAll();
      const b = svc.getAll();
      expect(a).toEqual(b);
      expect(a).not.toBe(b); // Different reference
    });
  });

  // ────────────── setBatch ──────────────

  describe('setBatch', () => {
    it('updates multiple keys atomically', () => {
      const svc = createService();
      svc.setBatch({
        aiProvider: 'anthropic',
        aiModel: 'claude-4-opus',
        agentName: 'Jarvis',
      });
      expect(svc.get('aiProvider')).toBe('anthropic');
      expect(svc.get('aiModel')).toBe('claude-4-opus');
      expect(svc.get('agentName')).toBe('Jarvis');
    });

    it('fires a single change notification for all keys', () => {
      const svc = createService();
      const listener = vi.fn();
      svc.onAnyChange(listener);

      svc.setBatch({
        aiProvider: 'anthropic',
        aiModel: 'claude-4-opus',
        agentName: 'Jarvis',
      });

      expect(listener).toHaveBeenCalledTimes(1);
      const changes = listener.mock.calls[0][0];
      expect(changes.aiProvider).toBe('anthropic');
      expect(changes.aiModel).toBe('claude-4-opus');
      expect(changes.agentName).toBe('Jarvis');
    });

    it('skips notification when no values actually changed', () => {
      const svc = createService();
      const listener = vi.fn();
      svc.onAnyChange(listener);

      // Set same as defaults
      svc.setBatch({ aiProvider: 'openai', aiModel: 'gpt-5' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ────────────── onChange subscriptions ──────────────

  describe('onChange', () => {
    it('notifies key-specific listeners', () => {
      const svc = createService();
      const listener = vi.fn();
      svc.onChange('aiProvider', listener);

      svc.set('aiProvider', 'anthropic');
      expect(listener).toHaveBeenCalledWith('anthropic', 'openai');
    });

    it('does not notify for other keys', () => {
      const svc = createService();
      const listener = vi.fn();
      svc.onChange('aiProvider', listener);

      svc.set('aiModel', 'gpt-5-turbo');
      expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribe works', () => {
      const svc = createService();
      const listener = vi.fn();
      const unsub = svc.onChange('aiProvider', listener);

      unsub();
      svc.set('aiProvider', 'anthropic');
      expect(listener).not.toHaveBeenCalled();
    });

    it('onAnyChange receives all changes', () => {
      const svc = createService();
      const listener = vi.fn();
      svc.onAnyChange(listener);

      svc.set('agentEmoji', '🚀');
      expect(listener).toHaveBeenCalledWith({ agentEmoji: '🚀' });
    });

    it('onAnyChange unsubscribe works', () => {
      const svc = createService();
      const listener = vi.fn();
      const unsub = svc.onAnyChange(listener);

      unsub();
      svc.set('agentEmoji', '🚀');
      expect(listener).not.toHaveBeenCalled();
    });

    it('emits EventEmitter "change" event', () => {
      const svc = createService();
      const listener = vi.fn();
      svc.on('change', listener);

      svc.set('theme', 'light');
      expect(listener).toHaveBeenCalledWith({ theme: 'light' });
    });

    it('listener errors do not crash the service', () => {
      const svc = createService();
      svc.onChange('aiProvider', () => {
        throw new Error('boom');
      });
      expect(() => svc.set('aiProvider', 'anthropic')).not.toThrow();
      expect(svc.get('aiProvider')).toBe('anthropic');
    });
  });

  // ────────────── Debounced save ──────────────

  describe('debounced save', () => {
    it('does not save immediately on set()', () => {
      const svc = createService();
      svc.set('agentName', 'Test');
      // Before timer fires, nothing written
      expect(lastWrittenContent).toBe('');
    });

    it('saves after debounce delay', async () => {
      const svc = createService();
      svc.set('agentName', 'Test');

      vi.advanceTimersByTime(250); // 200ms delay + margin
      await vi.runAllTimersAsync();

      expect(lastWrittenContent).toContain('"agentName": "Test"');
    });

    it('coalesces multiple set() calls into one write', async () => {
      const fsp = await import('fs/promises');
      const writeSpy = fsp.writeFile as Mock;
      writeSpy.mockClear();

      const svc = createService();
      svc.set('aiProvider', 'anthropic');
      svc.set('aiModel', 'claude-4-opus');
      svc.set('agentName', 'Jarvis');

      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      // Only one write should happen
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const written = JSON.parse(lastWrittenContent);
      expect(written.aiProvider).toBe('anthropic');
      expect(written.aiModel).toBe('claude-4-opus');
      expect(written.agentName).toBe('Jarvis');
    });
  });

  // ────────────── Atomic write ──────────────

  describe('atomic write', () => {
    it('writes to .tmp then renames', async () => {
      const svc = createService();
      svc.set('agentName', 'Atom');

      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      expect(lastWrittenPath).toContain('.tmp');
      expect(lastRenamedFrom).toContain('.tmp');
      expect(lastRenamedTo).not.toContain('.tmp');
      expect(lastRenamedTo).toContain('kxai-config.json');
    });

    it('handles write failure gracefully', async () => {
      writeShouldFail = true;
      const svc = createService();
      svc.set('agentName', 'Fail');

      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      // Service should not crash, value should still be in memory
      expect(svc.get('agentName')).toBe('Fail');
    });
  });

  // ────────────── forceSave ──────────────

  describe('forceSave', () => {
    it('saves immediately without waiting for debounce', async () => {
      const svc = createService();
      svc.set('agentName', 'Force');
      await svc.forceSave();

      expect(lastWrittenContent).toContain('"agentName": "Force"');
    });

    it('cancels pending debounced save', async () => {
      const fsp = await import('fs/promises');
      const writeSpy = fsp.writeFile as Mock;
      writeSpy.mockClear();

      const svc = createService();
      svc.set('agentName', 'Force');
      await svc.forceSave();

      // Advance timers — no additional write should happen
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(writeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────── Migration ──────────────

  describe('config migration', () => {
    it('migrates v0 config (no _version) to current version', () => {
      const svc = createService(
        JSON.stringify({
          aiProvider: 'anthropic',
          // no _version field
        }),
      );
      expect(svc.get('_version')).toBe(CURRENT_CONFIG_VERSION);
      expect(svc.get('aiProvider')).toBe('anthropic');
    });

    it('does not migrate config already at current version', () => {
      const svc = createService(
        JSON.stringify({
          _version: CURRENT_CONFIG_VERSION,
          aiProvider: 'anthropic',
        }),
      );
      expect(svc.get('_version')).toBe(CURRENT_CONFIG_VERSION);
      expect(svc.get('aiProvider')).toBe('anthropic');
    });
  });

  // ────────────── Onboarding ──────────────

  describe('onboarding', () => {
    it('isOnboarded() returns false by default', () => {
      const svc = createService();
      expect(svc.isOnboarded()).toBe(false);
    });

    it('completeOnboarding sets all fields and saves immediately', async () => {
      const svc = createService();
      await svc.completeOnboarding({
        userName: 'Jan',
        userRole: 'developer',
        userDescription: 'Full-stack developer',
        agentName: 'Jarvis',
        agentEmoji: '🤖',
        aiProvider: 'anthropic',
        aiModel: 'claude-4-opus',
      });

      expect(svc.isOnboarded()).toBe(true);
      expect(svc.get('userName')).toBe('Jan');
      expect(svc.get('aiProvider')).toBe('anthropic');
      // Should have written to disk immediately (forceSave)
      expect(lastWrittenContent).toContain('"onboarded": true');
    });
  });

  // ────────────── Shutdown ──────────────

  describe('shutdown', () => {
    it('flushes pending save and clears listeners', async () => {
      const svc = createService();
      const listener = vi.fn();
      svc.onChange('aiModel', listener);

      svc.set('aiModel', 'test-model');
      await svc.shutdown();

      // Save should have been flushed
      expect(lastWrittenContent).toContain('"aiModel": "test-model"');

      // Listeners should be cleared — no notification
      svc.set('aiModel', 'another');
      expect(listener).toHaveBeenCalledTimes(1); // Only the first call
    });
  });

  // ────────────── Zod schema ──────────────

  describe('KxAIConfigSchema', () => {
    it('parses empty object with all defaults', () => {
      const result = KxAIConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.aiProvider).toBe('openai');
        expect(result.data.aiModel).toBe('gpt-5');
        expect(result.data._version).toBe(1);
      }
    });

    it('rejects invalid aiProvider value', () => {
      const result = KxAIConfigSchema.safeParse({ aiProvider: 'google' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid theme value', () => {
      const result = KxAIConfigSchema.safeParse({ theme: 'blue' });
      expect(result.success).toBe(false);
    });

    it('accepts valid MCP server config', () => {
      const result = KxAIConfigSchema.safeParse({
        mcpServers: [
          {
            id: 'test',
            name: 'Test Server',
            transport: 'stdio',
            command: 'node',
            args: ['server.js'],
            autoConnect: true,
            enabled: true,
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts meetingCoach as opaque record', () => {
      const result = KxAIConfigSchema.safeParse({
        meetingCoach: { enabled: true, language: 'pl', coachStyle: 'concise' },
      });
      expect(result.success).toBe(true);
    });

    it('allows passthrough of unknown keys', () => {
      const result = KxAIConfigSchema.safeParse({ futureField: 42 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).futureField).toBe(42);
      }
    });
  });
});
