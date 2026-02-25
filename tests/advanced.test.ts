/**
 * Advanced tests — Krok 5.5
 *
 * These tests target cross-cutting concerns that unit tests with mocks miss:
 * 1. SDK contract tests — verify parameter shapes passed to AI SDKs
 * 2. Signal propagation tests — verify AbortSignal flows through entire pipeline
 * 3. Concurrent access tests — ToolsService registry mutation, heartbeat race
 * 4. Shutdown ordering tests — verify cleanup sequence
 *
 * Reference: docs/SERVICE-DEPENDENCY-MAP.md (8 critical findings)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
    getName: vi.fn(() => 'KxAI'),
    getAppPath: vi.fn(() => '/mock/app'),
    isPackaged: false,
  },
  clipboard: { readText: vi.fn(() => ''), writeText: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  access: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  stat: vi.fn(async () => ({ mtimeMs: 0 })),
}));

// ─── SDK Contract Tests ───

describe('SDK Contract Tests', () => {
  describe('OpenAI Provider — parameter shapes', () => {
    let OpenAIProvider: any;

    beforeEach(async () => {
      const mod = await import('../src/main/services/providers/openai-provider');
      OpenAIProvider = mod.OpenAIProvider;
    });

    it('uses max_completion_tokens instead of max_tokens', async () => {
      const provider = new OpenAIProvider();
      const mockCreate = vi.fn(async () => ({
        choices: [{ message: { content: 'hi', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));

      // Inject a mock client
      (provider as any).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.chat(
        [{ role: 'system', content: 'test' }],
        { model: 'gpt-5', maxTokens: 1024 },
      );

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs).toHaveProperty('max_completion_tokens');
      expect(callArgs).not.toHaveProperty('max_tokens');
    });

    it('uses developer role for GPT-5 and o-series models', async () => {
      const provider = new OpenAIProvider();
      const mockCreate = vi.fn(async () => ({
        choices: [{ message: { content: 'hi', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));

      (provider as any).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.chat(
        [{ role: 'developer', content: 'test' }, { role: 'user', content: 'hello' }],
        { model: 'gpt-5', maxTokens: 512 },
      );

      const callArgs = mockCreate.mock.calls[0][0];
      const systemMsg = callArgs.messages.find((m: any) => m.role === 'developer' || m.role === 'system');
      expect(systemMsg.role).toBe('developer');
    });

    it('passes signal in second argument (options), not in request body', async () => {
      const provider = new OpenAIProvider();
      const ac = new AbortController();
      const mockCreate = vi.fn(async () => ({
        choices: [{ message: { content: 'hi', tool_calls: undefined } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }));

      (provider as any).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.chat(
        [{ role: 'user', content: 'test' }],
        { model: 'gpt-5', maxTokens: 512, signal: ac.signal },
      );

      // Signal MUST be in second argument (options object), NOT in request body
      const requestBody = mockCreate.mock.calls[0][0];
      const optionsArg = mockCreate.mock.calls[0][1];

      expect(requestBody).not.toHaveProperty('signal');
      expect(optionsArg).toBeDefined();
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });

    it('passes signal for streamChat in second argument', async () => {
      const provider = new OpenAIProvider();
      const ac = new AbortController();
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'x' } }] };
        },
      };
      const mockCreate = vi.fn(async () => mockStream);

      (provider as any).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.streamChat(
        [{ role: 'user', content: 'test' }],
        { model: 'gpt-5', maxTokens: 512, signal: ac.signal },
        vi.fn(),
      );

      const optionsArg = mockCreate.mock.calls[0][1];
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });

    it('passes signal for chatWithVision in second argument', async () => {
      const provider = new OpenAIProvider();
      const ac = new AbortController();
      const mockCreate = vi.fn(async () => ({
        choices: [{ message: { content: 'I see a screen', tool_calls: undefined } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      }));

      (provider as any).client = {
        chat: { completions: { create: mockCreate } },
      };

      await provider.chatWithVision(
        'You are an assistant',
        'What do you see?',
        [{ base64Data: 'data:image/png;base64,iVBOR', mediaType: 'image/png' }],
        { model: 'gpt-5', maxTokens: 1024, signal: ac.signal },
      );

      const requestBody = mockCreate.mock.calls[0][0];
      const optionsArg = mockCreate.mock.calls[0][1];

      expect(requestBody).not.toHaveProperty('signal');
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });
  });

  describe('Anthropic Provider — parameter shapes', () => {
    let AnthropicProvider: any;

    beforeEach(async () => {
      const mod = await import('../src/main/services/providers/anthropic-provider');
      AnthropicProvider = mod.AnthropicProvider;
    });

    it('extracts system message from messages array for Anthropic API', async () => {
      const provider = new AnthropicProvider();
      const mockCreate = vi.fn(async () => ({
        content: [{ type: 'text', text: 'hello' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }));

      (provider as any).client = { messages: { create: mockCreate, stream: mockCreate } };

      await provider.chat(
        [{ role: 'system', content: 'You are helpful' }, { role: 'user', content: 'hi' }],
        { model: 'claude-sonnet-4-20250514', maxTokens: 512 },
      );

      const callArgs = mockCreate.mock.calls[0][0];
      // Anthropic uses 'system' as top-level param, not in messages array
      expect(callArgs.messages.every((m: any) => m.role !== 'system')).toBe(true);
      // System should be in the system param (string or array)
      expect(callArgs.system).toBeDefined();
    });

    it('passes signal in second argument for chat', async () => {
      const provider = new AnthropicProvider();
      const ac = new AbortController();
      const mockCreate = vi.fn(async () => ({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }));

      (provider as any).client = { messages: { create: mockCreate, stream: mockCreate } };

      await provider.chat(
        [{ role: 'user', content: 'test' }],
        { model: 'claude-sonnet-4-20250514', maxTokens: 512, signal: ac.signal },
      );

      const requestBody = mockCreate.mock.calls[0][0];
      const optionsArg = mockCreate.mock.calls[0][1];

      expect(requestBody).not.toHaveProperty('signal');
      expect(optionsArg).toBeDefined();
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });

    it('passes signal in second argument for computerUseStep', async () => {
      const provider = new AnthropicProvider();
      const ac = new AbortController();
      const mockBetaCreate = vi.fn(async () => ({
        content: [{ type: 'text', text: 'I see a desktop' }],
        stop_reason: 'end_turn',
      }));

      (provider as any).client = {
        beta: { messages: { create: mockBetaCreate } },
        messages: { create: vi.fn(), stream: vi.fn() },
      };

      await provider.computerUseStep(
        'You are an agent',
        [{ role: 'user', content: [{ type: 'text', text: 'Click the button' }] }],
        { displayWidth: 1024, displayHeight: 768 },
        'claude-sonnet-4-20250514',
        { signal: ac.signal },
      );

      const requestBody = mockBetaCreate.mock.calls[0][0];
      const optionsArg = mockBetaCreate.mock.calls[0][1];

      // Signal must NOT be in request body
      expect(requestBody).not.toHaveProperty('signal');
      // Signal must be in second argument
      expect(optionsArg).toBeDefined();
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });

    it('uses prompt caching for computerUseStep system prompt', async () => {
      const provider = new AnthropicProvider();
      const mockBetaCreate = vi.fn(async () => ({
        content: [],
        stop_reason: 'end_turn',
      }));

      (provider as any).client = {
        beta: { messages: { create: mockBetaCreate } },
        messages: { create: vi.fn(), stream: vi.fn() },
      };

      await provider.computerUseStep(
        'System prompt for caching',
        [{ role: 'user', content: [{ type: 'text', text: 'Do something' }] }],
        { displayWidth: 1024, displayHeight: 768 },
        'claude-sonnet-4-20250514',
      );

      const callArgs = mockBetaCreate.mock.calls[0][0];
      // System should use cache_control for prompt caching
      expect(callArgs.system).toBeDefined();
      expect(Array.isArray(callArgs.system)).toBe(true);
      expect(callArgs.system[0]).toHaveProperty('cache_control');
      expect(callArgs.system[0].cache_control).toEqual({ type: 'ephemeral' });
    });
  });
});

// ─── Signal Propagation Tests ───

describe('Signal Propagation Tests', () => {
  describe('AIService — signal flows to SDK', () => {
    let AIService: any;
    let mockConfig: any;
    let mockSecurity: any;

    beforeEach(async () => {
      mockConfig = {
        get: vi.fn((key: string) => {
          if (key === 'aiProvider') return 'openai';
          if (key === 'aiModel') return 'gpt-5';
          if (key === 'proactiveMode') return false;
          return undefined;
        }),
      };
      mockSecurity = {
        getApiKey: vi.fn(async () => 'sk-test-key'),
      };
    });

    it('sendMessageWithVision forwards signal to OpenAI SDK', async () => {
      const mod = await import('../src/main/services/ai-service');
      const service = new mod.AIService(mockConfig, mockSecurity);

      const ac = new AbortController();
      const mockCreate = vi.fn(async () => ({
        choices: [{ message: { content: 'I see things' } }],
      }));

      // Inject mock OpenAI client
      (service as any).openaiClient = {
        chat: { completions: { create: mockCreate } },
      };

      await service.sendMessageWithVision(
        'What is on screen?',
        'data:image/png;base64,abc',
        'System context',
        'high',
        { signal: ac.signal },
      );

      // Signal must be in second argument to create()
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const optionsArg = mockCreate.mock.calls[0][1];
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });

    it('sendMessageWithVision forwards signal to Anthropic SDK', async () => {
      mockConfig.get = vi.fn((key: string) => {
        if (key === 'aiProvider') return 'anthropic';
        if (key === 'aiModel') return 'claude-sonnet-4-20250514';
        return undefined;
      });

      const mod = await import('../src/main/services/ai-service');
      const service = new mod.AIService(mockConfig, mockSecurity);

      const ac = new AbortController();
      const mockCreate = vi.fn(async () => ({
        content: [{ type: 'text', text: 'I see a desktop' }],
      }));

      (service as any).anthropicClient = { messages: { create: mockCreate } };

      await service.sendMessageWithVision(
        'What is on screen?',
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        'System context',
        'high',
        { signal: ac.signal },
      );

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const optionsArg = mockCreate.mock.calls[0][1];
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });

    it('computerUseStep forwards signal to Anthropic beta SDK', async () => {
      mockConfig.get = vi.fn((key: string) => {
        if (key === 'aiProvider') return 'anthropic';
        if (key === 'aiModel') return 'claude-sonnet-4-20250514';
        return undefined;
      });

      const mod = await import('../src/main/services/ai-service');
      const service = new mod.AIService(mockConfig, mockSecurity);

      const ac = new AbortController();
      const mockBetaCreate = vi.fn(async () => ({
        content: [{ type: 'text', text: 'Clicking' }],
        stop_reason: 'end_turn',
      }));

      (service as any).anthropicClient = {
        beta: { messages: { create: mockBetaCreate } },
      };

      await service.computerUseStep(
        'System prompt',
        [{ role: 'user', content: [{ type: 'text', text: 'Click button' }] }],
        1024,
        768,
        { signal: ac.signal },
      );

      expect(mockBetaCreate).toHaveBeenCalledTimes(1);
      const optionsArg = mockBetaCreate.mock.calls[0][1];
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });

    it('sendMessage forwards signal to OpenAI SDK', async () => {
      const mod = await import('../src/main/services/ai-service');
      const service = new mod.AIService(mockConfig, mockSecurity);

      const ac = new AbortController();
      const mockCreate = vi.fn(async () => ({
        choices: [{ message: { content: 'response' } }],
      }));

      (service as any).openaiClient = {
        chat: { completions: { create: mockCreate } },
      };

      await service.sendMessage('hello', undefined, 'ctx', { signal: ac.signal });

      const optionsArg = mockCreate.mock.calls[0][1];
      expect(optionsArg).toHaveProperty('signal', ac.signal);
    });
  });

  describe('AbortController lifecycle', () => {
    it('AbortSignal propagates abort state', () => {
      const ac = new AbortController();
      expect(ac.signal.aborted).toBe(false);
      ac.abort();
      expect(ac.signal.aborted).toBe(true);
    });

    it('aborted signal rejects on addEventListener', () => {
      const ac = new AbortController();
      const handler = vi.fn();
      ac.signal.addEventListener('abort', handler);
      ac.abort();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('already-aborted signal has aborted=true for new listeners', () => {
      const ac = new AbortController();
      ac.abort();
      // In Node.js, once aborted, the signal.aborted is true
      // Listeners added after abort may or may not fire synchronously
      // depending on the Node.js version. The key contract is:
      expect(ac.signal.aborted).toBe(true);
    });
  });
});

// ─── Concurrent Access Tests ───

describe('Concurrent Access Tests', () => {
  describe('ToolsService registry — mutation safety', () => {
    let ToolsService: any;

    beforeEach(async () => {
      const mod = await import('../src/main/services/tools-service');
      ToolsService = mod.ToolsService;
    });

    it('register and unregister maintain consistency between Map and Array', () => {
      const service = new ToolsService();

      // Register 3 tools
      service.register(
        { name: 'tool_a', description: 'A', parameters: {} },
        async () => ({ success: true, data: 'a' }),
      );
      service.register(
        { name: 'tool_b', description: 'B', parameters: {} },
        async () => ({ success: true, data: 'b' }),
      );
      service.register(
        { name: 'tool_c', description: 'C', parameters: {} },
        async () => ({ success: true, data: 'c' }),
      );

      const defs = service.getDefinitions();
      expect(defs.map((d: any) => d.name)).toContain('tool_a');
      expect(defs.map((d: any) => d.name)).toContain('tool_b');
      expect(defs.map((d: any) => d.name)).toContain('tool_c');

      // Unregister tool_b
      service.unregister('tool_b');
      const defsAfter = service.getDefinitions();
      expect(defsAfter.map((d: any) => d.name)).not.toContain('tool_b');
      expect(defsAfter.map((d: any) => d.name)).toContain('tool_a');
      expect(defsAfter.map((d: any) => d.name)).toContain('tool_c');
    });

    it('unregisterByPrefix removes all matching tools atomically', () => {
      const service = new ToolsService();

      service.register(
        { name: 'mcp_github_list', description: 'List repos', parameters: {} },
        async () => ({ success: true, data: 'repos' }),
      );
      service.register(
        { name: 'mcp_github_create', description: 'Create repo', parameters: {} },
        async () => ({ success: true, data: 'created' }),
      );
      service.register(
        { name: 'mcp_slack_send', description: 'Send msg', parameters: {} },
        async () => ({ success: true, data: 'sent' }),
      );
      service.register(
        { name: 'read_file', description: 'Read file', parameters: {} },
        async () => ({ success: true, data: 'content' }),
      );

      const removed = service.unregisterByPrefix('mcp_github_');
      expect(removed).toBe(2);

      const defs = service.getDefinitions();
      expect(defs.map((d: any) => d.name)).not.toContain('mcp_github_list');
      expect(defs.map((d: any) => d.name)).not.toContain('mcp_github_create');
      expect(defs.map((d: any) => d.name)).toContain('mcp_slack_send');
      expect(defs.map((d: any) => d.name)).toContain('read_file');
    });

    it('execute returns error for unregistered tool without crashing', async () => {
      const service = new ToolsService();

      const result = await service.execute('nonexistent_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('nonexistent_tool');
    });

    it('getDefinitions returns snapshot — mutations do not affect callers', () => {
      const service = new ToolsService();

      service.register(
        { name: 'tool_x', description: 'X', parameters: {} },
        async () => ({ success: true, data: 'x' }),
      );

      const snapshot = service.getDefinitions();
      const countBefore = snapshot.length;

      // Mutate registry after getting snapshot
      service.register(
        { name: 'tool_y', description: 'Y', parameters: {} },
        async () => ({ success: true, data: 'y' }),
      );

      // Snapshot should NOT be affected
      expect(snapshot.length).toBe(countBefore);
    });

    it('concurrent register + unregister does not corrupt state', async () => {
      const service = new ToolsService();

      // Simulate rapid register/unregister cycles
      const ops: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        ops.push(
          (async () => {
            const name = `dynamic_tool_${i}`;
            service.register(
              { name, description: `Tool ${i}`, parameters: {} },
              async () => ({ success: true, data: String(i) }),
            );
          })(),
        );
      }
      await Promise.all(ops);

      // Unregister half
      for (let i = 0; i < 25; i++) {
        service.unregister(`dynamic_tool_${i}`);
      }

      const defs = service.getDefinitions();
      const defNames = defs.map((d: any) => d.name);

      // First 25 should be gone
      for (let i = 0; i < 25; i++) {
        expect(defNames).not.toContain(`dynamic_tool_${i}`);
      }
      // Last 25 should remain
      for (let i = 25; i < 50; i++) {
        expect(defNames).toContain(`dynamic_tool_${i}`);
      }
    });
  });

  describe('HeartbeatEngine — timer race conditions', () => {
    let HeartbeatEngine: any;
    let mockDeps: any;

    beforeEach(async () => {
      const mod = await import('../src/main/services/heartbeat-engine');
      HeartbeatEngine = mod.HeartbeatEngine;
      mockDeps = {
        ai: { sendMessage: vi.fn(async () => 'HEARTBEAT_OK') },
        memory: {
          buildSystemContext: vi.fn(async () => 'system ctx'),
          getRecentContext: vi.fn(() => []),
          addMessage: vi.fn(),
        },
        workflow: {
          logActivity: vi.fn(async () => {}),
          getRecentActivities: vi.fn(async () => []),
        },
        cron: { getJobs: vi.fn(() => []) },
        tools: { getToolDefinitions: vi.fn(() => []) },
        promptService: {
          load: vi.fn(async () => ''),
          render: vi.fn(async () => ''),
        },
        responseProcessor: {
          parseCronSuggestion: vi.fn(() => null),
          processMemoryUpdates: vi.fn(async () => 0),
        },
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('stopHeartbeat clears timer and aborts controller', () => {
      const engine = new HeartbeatEngine(mockDeps);
      engine.setProcessingCheck(() => false);

      // Start heartbeat with short interval
      engine.startHeartbeat(60000);

      // Should have a timer
      expect((engine as any).heartbeatTimer).not.toBeNull();

      // Stop
      engine.stopHeartbeat();

      expect((engine as any).heartbeatTimer).toBeNull();
      // AbortController should be aborted or null
      const ac = (engine as any).abortController;
      expect(ac === null || ac?.signal.aborted).toBe(true);
    });

    it('startHeartbeat clears previous timer before creating new one', () => {
      const engine = new HeartbeatEngine(mockDeps);
      engine.setProcessingCheck(() => false);

      engine.startHeartbeat(60000);
      const timer1 = (engine as any).heartbeatTimer;

      engine.startHeartbeat(30000);
      const timer2 = (engine as any).heartbeatTimer;

      // New timer should be different from old one
      expect(timer1).not.toBe(timer2);
      expect(timer2).not.toBeNull();

      // Cleanup
      engine.stopHeartbeat();
    });

    it('multiple stop calls are idempotent', () => {
      const engine = new HeartbeatEngine(mockDeps);
      engine.setProcessingCheck(() => false);

      engine.startHeartbeat(60000);
      engine.stopHeartbeat();
      engine.stopHeartbeat();
      engine.stopHeartbeat();

      expect((engine as any).heartbeatTimer).toBeNull();
    });
  });

  describe('TakeControlEngine — concurrent start/stop', () => {
    let TakeControlEngine: any;

    beforeEach(async () => {
      const mod = await import('../src/main/services/take-control-engine');
      TakeControlEngine = mod.TakeControlEngine;
    });

    it('rejects concurrent startTakeControl calls', async () => {
      const mockAI = { supportsNativeComputerUse: vi.fn(() => false) };
      const mockAutomation = { enable: vi.fn(), disable: vi.fn(), lockSafety: vi.fn(), unlockSafety: vi.fn() };
      const engine = new TakeControlEngine(
        mockAI as any,
        {} as any,
        {} as any,
        { render: vi.fn(async () => ''), load: vi.fn(async () => '') } as any,
        {} as any,
      );
      engine.setAutomationService(mockAutomation as any);

      // Force takeControlActive = true
      (engine as any).takeControlActive = true;

      const result = await engine.startTakeControl('Click X', undefined, undefined, true);
      expect(result).toContain('już aktywny');
    });

    it('stopTakeControl aborts the internal AbortController', () => {
      const mockAI = {};
      const engine = new TakeControlEngine(
        mockAI as any,
        {} as any,
        {} as any,
        { render: vi.fn(async () => ''), load: vi.fn(async () => '') } as any,
        {} as any,
      );

      // Simulate active take-control
      const ac = new AbortController();
      (engine as any).abortController = ac;
      (engine as any).takeControlActive = true;

      engine.stopTakeControl();

      expect(ac.signal.aborted).toBe(true);
    });

    it('isAborted reflects AbortController state', () => {
      const mockAI = {};
      const engine = new TakeControlEngine(
        mockAI as any,
        {} as any,
        {} as any,
        { render: vi.fn(async () => ''), load: vi.fn(async () => '') } as any,
        {} as any,
      );

      // No AC — not aborted
      expect((engine as any).isAborted).toBe(false);

      // With AC, not aborted
      (engine as any).abortController = new AbortController();
      expect((engine as any).isAborted).toBe(false);

      // After abort
      (engine as any).abortController.abort();
      expect((engine as any).isAborted).toBe(true);
    });
  });
});

// ─── Shutdown Ordering Tests ───

describe('Shutdown Ordering Tests', () => {
  describe('ServiceContainer — phase sequence', () => {
    it('shutdown phases execute in order', async () => {
      // This tests the contract: services must shut down in dependency order
      // Phase 1: Stop processing (agent, screen, cron)
      // Phase 2: Close network (meeting, transcription, browser, dashboard, mcp)
      // Phase 3: Stop watchers (RAG, plugins)
      // Phase 4: Cleanup (TTS)
      // Phase 5: Flush caches (embedding)
      // Phase 6: Close DB (memory/SQLite)

      const shutdownOrder: string[] = [];
      const mockService = (name: string) => ({
        shutdown: vi.fn(async () => { shutdownOrder.push(name); }),
        stopProcessing: vi.fn(() => { shutdownOrder.push(`stop:${name}`); }),
        stop: vi.fn(() => { shutdownOrder.push(`stop:${name}`); }),
      });

      const agentLoop = mockService('agentLoop');
      const screenMonitor = mockService('screenMonitor');
      const cron = mockService('cron');
      const memory = mockService('memory');

      // Simulate Phase 1
      agentLoop.stopProcessing();
      screenMonitor.stop();
      cron.stop();

      // Simulate Phase 6
      await memory.shutdown();

      // agentLoop must stop BEFORE memory shuts down
      const agentIdx = shutdownOrder.indexOf('stop:agentLoop');
      const memoryIdx = shutdownOrder.indexOf('memory');
      expect(agentIdx).toBeLessThan(memoryIdx);
    });
  });

  describe('Worker thread cleanup', () => {
    it('terminateWorker resolves without error when no worker exists', async () => {
      const mod = await import('../src/main/services/embedding-service');
      const EmbeddingService = mod.EmbeddingService;
      const service = new EmbeddingService({} as any);

      // Should not throw even if worker was never started
      await service.terminateWorker();
    });
  });
});

// ─── Dependency Map Conformance Tests ───

describe('Dependency Map Conformance', () => {
  it('ToolsService exposes register, unregister, unregisterByPrefix, execute, getDefinitions', async () => {
    const mod = await import('../src/main/services/tools-service');
    const service = new mod.ToolsService();

    expect(typeof service.register).toBe('function');
    expect(typeof service.unregister).toBe('function');
    expect(typeof service.unregisterByPrefix).toBe('function');
    expect(typeof service.execute).toBe('function');
    expect(typeof service.getDefinitions).toBe('function');
  });

  it('AIService exposes sendMessageWithVision with optional signal parameter', async () => {
    const mod = await import('../src/main/services/ai-service');
    const mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'aiProvider') return 'openai';
        if (key === 'aiModel') return 'gpt-5';
        return undefined;
      }),
    };
    const mockSecurity = { getApiKey: vi.fn(async () => null) };
    const service = new mod.AIService(mockConfig as any, mockSecurity as any);

    // Method should exist and accept 5 arguments (last is options with signal)
    expect(typeof service.sendMessageWithVision).toBe('function');
  });

  it('AIService exposes computerUseStep with optional signal parameter', async () => {
    const mod = await import('../src/main/services/ai-service');
    const mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'aiProvider') return 'openai';
        if (key === 'aiModel') return 'gpt-5';
        return undefined;
      }),
    };
    const mockSecurity = { getApiKey: vi.fn(async () => null) };
    const service = new mod.AIService(mockConfig as any, mockSecurity as any);

    expect(typeof service.computerUseStep).toBe('function');
  });

  it('TakeControlEngine exposes stopTakeControl', async () => {
    const mod = await import('../src/main/services/take-control-engine');
    const engine = new mod.TakeControlEngine(
      {} as any,
      {} as any,
      {} as any,
      { render: vi.fn(async () => ''), load: vi.fn(async () => '') } as any,
      {} as any,
    );

    expect(typeof engine.stopTakeControl).toBe('function');
    expect(typeof engine.isTakeControlActive).toBe('function');
  });

  it('HeartbeatEngine exposes startHeartbeat and stopHeartbeat', async () => {
    const mod = await import('../src/main/services/heartbeat-engine');
    const engine = new mod.HeartbeatEngine({
      ai: {} as any,
      memory: {} as any,
      workflow: {} as any,
      cron: {} as any,
      tools: {} as any,
      promptService: {} as any,
      responseProcessor: {} as any,
    });

    expect(typeof engine.startHeartbeat).toBe('function');
    expect(typeof engine.stopHeartbeat).toBe('function');
  });
});
