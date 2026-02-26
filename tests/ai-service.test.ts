import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user'),
    getAppPath: vi.fn(() => '/mock/app'),
    isPackaged: false,
  },
}));

vi.mock('openai', () => ({ default: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  readdirSync: vi.fn(() => []),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(() => Promise.resolve('')),
  writeFile: vi.fn(() => Promise.resolve()),
  readdir: vi.fn(() => Promise.resolve([])),
  mkdir: vi.fn(() => Promise.resolve()),
  default: {
    readFile: vi.fn(() => Promise.resolve('')),
    writeFile: vi.fn(() => Promise.resolve()),
    readdir: vi.fn(() => Promise.resolve([])),
    mkdir: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

import { AIService } from '../src/main/services/ai-service';

function createMockConfig() {
  return {
    get: vi.fn((key: string) => {
      const defaults: Record<string, any> = {
        aiProvider: 'openai',
        model: 'gpt-4.1',
        maxTokens: 4096,
        useNativeFunctionCalling: true,
      };
      return defaults[key];
    }),
    set: vi.fn(),
    onChange: vi.fn(),
  };
}

function createMockSecurity() {
  return {
    getApiKey: vi.fn(() => null),
    isReady: vi.fn(() => true),
  };
}

function createService() {
  return new AIService(createMockConfig() as any, createMockSecurity() as any);
}

// =============================================================================
// usesDeveloperRole
// =============================================================================
describe('usesDeveloperRole', () => {
  let svc: AIService;
  const usesDeveloperRole = (model: string) => (svc as any).usesDeveloperRole(model);

  beforeEach(() => { svc = createService(); });

  it('true for gpt-5', () => expect(usesDeveloperRole('gpt-5')).toBe(true));
  it('true for gpt-5-turbo', () => expect(usesDeveloperRole('gpt-5-turbo')).toBe(true));
  it('true for o3', () => expect(usesDeveloperRole('o3')).toBe(true));
  it('true for o4-mini', () => expect(usesDeveloperRole('o4-mini')).toBe(true));
  it('false for gpt-4.1', () => expect(usesDeveloperRole('gpt-4.1')).toBe(false));
  it('false for claude', () => expect(usesDeveloperRole('claude-sonnet-4')).toBe(false));
});

// =============================================================================
// getSystemRole
// =============================================================================
describe('getSystemRole', () => {
  let svc: AIService;
  const getSystemRole = (model: string) => (svc as any).getSystemRole(model);

  beforeEach(() => { svc = createService(); });

  it('developer for gpt-5', () => expect(getSystemRole('gpt-5')).toBe('developer'));
  it('system for gpt-4.1', () => expect(getSystemRole('gpt-4.1')).toBe('system'));
});

// =============================================================================
// openaiTokenParam
// =============================================================================
describe('openaiTokenParam', () => {
  it('returns max_completion_tokens', () => {
    const svc = createService();
    expect((svc as any).openaiTokenParam(2048)).toEqual({ max_completion_tokens: 2048 });
  });
});

// =============================================================================
// getProviderName
// =============================================================================
describe('getProviderName', () => {
  it('returns configured provider', () => {
    const svc = createService();
    expect(svc.getProviderName()).toBe('openai');
  });
});

// =============================================================================
// supportsNativeComputerUse
// =============================================================================
describe('supportsNativeComputerUse', () => {
  it('returns false for openai', () => {
    const svc = createService();
    expect(svc.supportsNativeComputerUse()).toBe(false);
  });

  it('returns true for anthropic', () => {
    const config = createMockConfig();
    config.get.mockImplementation((key: string) => key === 'aiProvider' ? 'anthropic' : 'default');
    const svc = new AIService(config as any, createMockSecurity() as any);
    expect(svc.supportsNativeComputerUse()).toBe(true);
  });
});

// =============================================================================
// buildComputerUseToolResult
// =============================================================================
describe('buildComputerUseToolResult', () => {
  let svc: AIService;

  beforeEach(() => { svc = createService(); });

  it('builds result with screenshot only', () => {
    const result = svc.buildComputerUseToolResult('tool-1', 'base64data');
    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('tool-1');
    expect(result.is_error).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('image');
    expect(result.content[0].source.data).toBe('base64data');
  });

  it('builds result with error + screenshot', () => {
    const result = svc.buildComputerUseToolResult('tool-2', 'img', 'Click failed');
    expect(result.is_error).toBe(true);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('Click failed');
    expect(result.content[1].type).toBe('image');
  });
});

// =============================================================================
// pruneComputerUseImages
// =============================================================================
describe('pruneComputerUseImages', () => {
  let svc: AIService;

  beforeEach(() => { svc = createService(); });

  it('keeps recent images up to limit', () => {
    const messages: any[] = [
      { role: 'user', content: [{ type: 'image', source: { data: '1' } }] },
      { role: 'user', content: [{ type: 'image', source: { data: '2' } }] },
      { role: 'user', content: [{ type: 'image', source: { data: '3' } }] },
    ];
    svc.pruneComputerUseImages(messages, 3);
    // All 3 kept
    expect(messages[0].content[0].type).toBe('image');
    expect(messages[1].content[0].type).toBe('image');
    expect(messages[2].content[0].type).toBe('image');
  });

  it('replaces oldest images when exceeding limit', () => {
    const messages: any[] = [
      { role: 'user', content: [{ type: 'image', source: { data: '1' } }] },
      { role: 'user', content: [{ type: 'image', source: { data: '2' } }] },
      { role: 'user', content: [{ type: 'image', source: { data: '3' } }] },
      { role: 'user', content: [{ type: 'image', source: { data: '4' } }] },
    ];
    svc.pruneComputerUseImages(messages, 2);
    // Last 2 kept, first 2 replaced
    expect(messages[3].content[0].type).toBe('image');
    expect(messages[2].content[0].type).toBe('image');
    expect(messages[0].content[0].type).toBe('text');
    expect(messages[0].content[0].text).toContain('removed');
  });

  it('handles messages without images', () => {
    const messages: any[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    // Should not throw
    svc.pruneComputerUseImages(messages, 3);
    expect(messages).toHaveLength(2);
  });

  it('handles tool_result with nested images', () => {
    const messages: any[] = [
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'image', source: { data: 'old' } }] },
      ]},
      { role: 'user', content: [{ type: 'image', source: { data: 'new' } }] },
    ];
    svc.pruneComputerUseImages(messages, 1);
    // Newest kept (msg index 1), oldest pruned (msg index 0 tool_result)
    expect(messages[1].content[0].type).toBe('image');
    expect(messages[0].content[0].content[0].type).toBe('text');
  });

  it('defaults to keepImages=3', () => {
    const messages: any[] = Array.from({ length: 5 }, (_, i) => ({
      role: 'user',
      content: [{ type: 'image', source: { data: String(i) } }],
    }));
    svc.pruneComputerUseImages(messages);
    const imageCount = messages.filter(m =>
      Array.isArray(m.content) && m.content[0].type === 'image'
    ).length;
    expect(imageCount).toBe(3);
  });
});

// =============================================================================
// getComputerUseToolVersion / getBetaFlag
// =============================================================================
describe('computer use constants', () => {
  it('returns tool version', () => {
    const svc = createService();
    expect((svc as any).getComputerUseToolVersion()).toBe('computer_20250124');
  });

  it('returns beta flag', () => {
    const svc = createService();
    expect((svc as any).getComputerUseBetaFlag()).toBe('computer-use-2025-01-24');
  });
});

// =============================================================================
// Cost tracking
// =============================================================================
describe('cost logs', () => {
  it('getCostLog returns empty when no provider active', () => {
    const svc = createService();
    expect(svc.getCostLog()).toEqual([]);
  });

  it('getAllCostLogs returns empty object when no costs', () => {
    const svc = createService();
    const logs = svc.getAllCostLogs();
    expect(Object.keys(logs).length).toBe(0);
  });
});
