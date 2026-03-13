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

    it('should retry auto-start if it fails and cancel on stop', async () => {
      vi.useFakeTimers();
      deps.config.get.mockImplementation((key) => {
        if (key === 'telegramAutoStart') return true;
        return null;
      });
      
      // Force start() to fail initially
      vi.spyOn(service, 'start').mockResolvedValueOnce({ success: false, error: 'Network error' });
      
      await service.initialize();
      
      // Timer should be set
      expect((service as any).retryTimer).not.toBeNull();
      
      // Cancel by stopping
      await service.stop();
      expect((service as any).retryTimer).toBeNull();
      
      vi.useRealTimers();
    });

    it('should cancel retry timer on shutdown', async () => {
      vi.useFakeTimers();
      deps.config.get.mockImplementation((key) => {
        if (key === 'telegramAutoStart') return true;
        return null;
      });
      
      vi.spyOn(service, 'start').mockResolvedValueOnce({ success: false, error: 'Network error' });
      
      await service.initialize();
      expect((service as any).retryTimer).not.toBeNull();
      
      service.shutdown();
      expect((service as any).retryTimer).toBeNull();
      
      vi.useRealTimers();
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
      vi.useFakeTimers();
      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      mockReq.destroy = vi.fn();
      (https.request as any).mockReturnValue(mockReq);

      const promise = (service as any).apiCall('token', 'getMe');
      
      // Advance timers to trigger the timeout
      vi.advanceTimersByTime(16000);
      
      await expect(promise).rejects.toThrow('Telegram API timeout');
      vi.useRealTimers();
    });

    it('should handle invalid JSON from API', async () => {
      vi.useRealTimers();
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

    it('should retry sendMessage without Markdown if it fails', async () => {
      vi.useRealTimers();
      let attempt = 0;
      (https.request as any).mockImplementation((url: string, options: any, callback: any) => {
        const mockReq = new EventEmitter() as any;
        mockReq.write = vi.fn();
        mockReq.end = vi.fn();
        
        setImmediate(() => {
          const mockRes = new EventEmitter() as any;
          if (callback) callback(mockRes);
          
          if (attempt === 0) {
            attempt++;
            mockRes.emit('data', JSON.stringify({ ok: false, description: 'Markdown error' }));
          } else {
            mockRes.emit('data', JSON.stringify({ ok: true, result: {} }));
          }
          mockRes.emit('end');
        });
        return mockReq;
      });

      const success = await service.sendMessage(123, 'test');
      expect(success).toBe(true);
      expect(attempt).toBe(1);
    });
  });

  describe('setToken', () => {
    it('should validate token format', async () => {
      const result = await service.setToken('invalid');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid bot token format');
    });

    it('should save token and username on success', async () => {
      mockTelegramApi([{ ok: true, result: { username: 'my_bot' } }]);
      const result = await service.setToken('123456:ABC-DEF1234ghIkl-zyx57W2v1u123456789');
      expect(result.success).toBe(true);
      expect(result.botUsername).toBe('my_bot');
      expect(deps.security.setApiKey).toHaveBeenCalledWith('telegram-bot-token', expect.any(String));
    });

    it('should auto-enable autoStart on first successful token setup', async () => {
      mockTelegramApi([{ ok: true, result: { username: 'my_bot' } }]);
      const result = await service.setToken('123456:ABC-DEF1234ghIkl-zyx57W2v1u123456789');
      expect(result.success).toBe(true);
      expect(deps.config.set).toHaveBeenCalledWith('telegramAutoStart', true);
      expect(service.getStatus().autoStart).toBe(true);
    });

    it('should not change autoStart if it is already enabled', async () => {
      (service as any).autoStart = true;
      mockTelegramApi([{ ok: true, result: { username: 'my_bot' } }]);
      await service.setToken('123456:ABC-DEF1234ghIkl-zyx57W2v1u123456789');
      const autoStartCalls = (deps.config.set as any).mock.calls.filter(
        (c: [string, unknown]) => c[0] === 'telegramAutoStart',
      );
      expect(autoStartCalls).toHaveLength(0);
    });
  });

  describe('retry timer cleanup', () => {
    it('should cancel pending retry timer when stop() is called', async () => {
      vi.useFakeTimers();
      (service as any).autoStart = true;
      vi.spyOn(service, 'start').mockResolvedValue({ success: false, error: 'Network error' });

      await (service as any).autoStartWithRetry();

      expect((service as any).retryTimer).not.toBeNull();

      await service.stop();
      expect((service as any).retryTimer).toBeNull();

      vi.useRealTimers();
    });

    it('should cancel pending retry timer when shutdown() is called', async () => {
      vi.useFakeTimers();
      (service as any).autoStart = true;
      vi.spyOn(service, 'start').mockResolvedValue({ success: false, error: 'Network error' });

      await (service as any).autoStartWithRetry();

      expect((service as any).retryTimer).not.toBeNull();

      service.shutdown();
      expect((service as any).retryTimer).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('concurrent processing', () => {
    it('should skip message if chat is already processing', async () => {
      (service as any).processingChats.add(123);
      mockTelegramApi([{ ok: true, result: {} }]); // "wait" message

      await (service as any).handleMessage('token', {
        chat: { id: 123 },
        text: 'hello',
        from: { first_name: 'User' }
      });

      expect(deps.agentLoop.processWithTools).not.toHaveBeenCalled();
    });
  });
});
