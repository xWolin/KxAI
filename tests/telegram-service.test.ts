import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import https from 'node:https';
import { TelegramService } from '../src/main/services/telegram-service';
import { EventEmitter } from 'node:events';

// ─── Mocks ───

vi.mock('node:https');

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

function createMockDeps() {
  return {
    security: {
      getApiKey: vi.fn().mockResolvedValue('mock-token'),
      hasApiKey: vi.fn().mockResolvedValue(true),
      setApiKey: vi.fn().mockResolvedValue(undefined),
    },
    config: {
      get: vi.fn((key: string) => {
        const defaults: Record<string, any> = {
          telegramAutoStart: false,
          telegramAllowedChatIds: [],
          telegramAllowedUsernames: [],
          telegramDenyByDefault: true,
        };
        return defaults[key];
      }),
      set: vi.fn(),
    },
    agentLoop: {
      processWithTools: vi.fn().mockResolvedValue('Agent response'),
    },
  };
}

describe('TelegramService', () => {
  let service: TelegramService;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    service = new TelegramService();
    service.setDependencies(deps as any);
  });

  afterEach(() => {
    service.shutdown();
  });

  function mockTelegramApi(responses: Array<{ ok: boolean, result?: any }>) {
    let callIndex = 0;
    (https.request as any).mockImplementation((url: string, options: any, callback: any) => {
      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      
      const response = responses[callIndex++] || { ok: true, result: {} };
      
      setImmediate(() => {
        const mockRes = new EventEmitter() as any;
        if (callback) callback(mockRes);
        else mockReq.emit('response', mockRes);
        
        mockRes.emit('data', JSON.stringify(response));
        mockRes.emit('end');
      });

      return mockReq;
    });
  }

  describe('initialize', () => {
    it('should load config correctly', async () => {
      deps.config.get.mockImplementation((key) => {
        if (key === 'telegramAllowedChatIds') return [123];
        if (key === 'telegramDenyByDefault') return false;
        return null;
      });

      await service.initialize();
      const status = service.getStatus();
      expect(status.allowedChatIds).toContain(123);
      expect(status.denyByDefault).toBe(false);
    });

    it('should auto-start if configured', async () => {
      deps.config.get.mockImplementation((key) => {
        if (key === 'telegramAutoStart') return true;
        return null;
      });
      
      mockTelegramApi([{ ok: true, result: { id: 1, username: 'bot' } }]);

      const startSpy = vi.spyOn(service, 'start');
      await service.initialize();
      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe('authorization', () => {
    it('should allow message from allowed chat ID', async () => {
      (service as any).allowedChatIds = [123];
      
      mockTelegramApi([
        { ok: true, result: {} }, // typing
        { ok: true, result: {} }  // sendMessage
      ]);

      await (service as any).handleMessage('token', {
        chat: { id: 123 },
        text: 'hello',
        from: { first_name: 'User' }
      });

      expect(deps.agentLoop.processWithTools).toHaveBeenCalled();
    });

    it('should reject message from unauthorized chat if denyByDefault is true', async () => {
      (service as any).allowedChatIds = [123];
      (service as any).denyByDefault = true;
      
      mockTelegramApi([{ ok: true, result: {} }]); // rejection message

      await (service as any).handleMessage('token', {
        chat: { id: 456 },
        text: 'hello',
        from: { first_name: 'Hacker' }
      });

      expect(deps.agentLoop.processWithTools).not.toHaveBeenCalled();
    });
  });

  describe('stability & error handling', () => {
    it('should handle API timeout', async () => {
      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      mockReq.destroy = vi.fn();
      (https.request as any).mockReturnValue(mockReq);

      const promise = (service as any).apiCall('token', 'getMe');
      mockReq.emit('timeout');
      await expect(promise).rejects.toThrow('Telegram API timeout');
    });

    it('should handle invalid JSON from API', async () => {
      (https.request as any).mockImplementation((url: string, options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.write = vi.fn();
        mockReq.end = vi.fn();
        
        setImmediate(() => {
          const mockRes = new EventEmitter() as any;
          if (callback) callback(mockRes);
          mockRes.emit('data', 'invalid-json');
          mockRes.emit('end');
        });
        return mockReq;
      });

      const promise = (service as any).apiCall('token', 'getMe');
      await expect(promise).rejects.toThrow('Invalid JSON response');
    });
  });
});
