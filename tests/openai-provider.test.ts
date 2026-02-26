import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('openai', () => ({ default: vi.fn() }));
vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

import { OpenAIProvider } from '../src/main/services/providers/openai-provider';

function createProvider(): OpenAIProvider {
  return new OpenAIProvider();
}

// =============================================================================
// Basic state
// =============================================================================
describe('OpenAIProvider basics', () => {
  it('has correct name', () => {
    expect(createProvider().name).toBe('openai');
  });

  it('supports function-calling, vision, streaming, structured-output', () => {
    const p = createProvider();
    expect(p.supportedFeatures.has('function-calling')).toBe(true);
    expect(p.supportedFeatures.has('vision')).toBe(true);
    expect(p.supportedFeatures.has('streaming')).toBe(true);
    expect(p.supportedFeatures.has('structured-output')).toBe(true);
  });

  it('isReady returns false without init', () => {
    expect(createProvider().isReady()).toBe(false);
  });

  it('reset nullifies client', () => {
    const p = createProvider();
    (p as any).client = {};
    p.reset();
    expect(p.isReady()).toBe(false);
  });
});

// =============================================================================
// getSystemRole
// =============================================================================
describe('getSystemRole', () => {
  let p: OpenAIProvider;
  const getSystemRole = (model: string) => (p as any).getSystemRole(model);

  beforeEach(() => { p = createProvider(); });

  it('returns developer for gpt-5', () => {
    expect(getSystemRole('gpt-5')).toBe('developer');
  });

  it('returns developer for gpt-5-turbo', () => {
    expect(getSystemRole('gpt-5-turbo')).toBe('developer');
  });

  it('returns developer for o3', () => {
    expect(getSystemRole('o3')).toBe('developer');
  });

  it('returns developer for o4-mini', () => {
    expect(getSystemRole('o4-mini')).toBe('developer');
  });

  it('returns system for gpt-4.1', () => {
    expect(getSystemRole('gpt-4.1')).toBe('system');
  });

  it('returns system for gpt-4.1-mini', () => {
    expect(getSystemRole('gpt-4.1-mini')).toBe('system');
  });

  it('returns system for unknown model', () => {
    expect(getSystemRole('some-model')).toBe('system');
  });
});

// =============================================================================
// tokenParam
// =============================================================================
describe('tokenParam', () => {
  it('returns max_completion_tokens', () => {
    const p = createProvider();
    const result = (p as any).tokenParam(4096);
    expect(result).toEqual({ max_completion_tokens: 4096 });
  });

  it('returns correct value for small limits', () => {
    const p = createProvider();
    expect((p as any).tokenParam(100)).toEqual({ max_completion_tokens: 100 });
  });
});

// =============================================================================
// trackCost
// =============================================================================
describe('trackCost', () => {
  let p: OpenAIProvider;

  beforeEach(() => { p = createProvider(); });

  it('tracks cost for gpt-5 model', () => {
    (p as any).trackCost('gpt-5', 1000, 500);
    const log = p.getCostLog();
    expect(log).toHaveLength(1);
    expect(log[0].model).toBe('gpt-5');
    expect(log[0].promptTokens).toBe(1000);
    expect(log[0].completionTokens).toBe(500);
    // gpt-5: input=0.01/1K, output=0.03/1K → 1000*0.01/1000 + 500*0.03/1000 = 0.01 + 0.015 = 0.025
    expect(log[0].estimatedCostUSD).toBeCloseTo(0.025);
  });

  it('tracks cost for gpt-4.1-mini', () => {
    (p as any).trackCost('gpt-4.1-mini', 2000, 1000);
    const log = p.getCostLog();
    // model.startsWith('gpt-4.1') matches first → gpt-4.1 pricing: input=0.002, output=0.008
    // 2*0.002 + 1*0.008 = 0.012
    expect(log[0].estimatedCostUSD).toBeCloseTo(0.012);
  });

  it('falls back to gpt-5 pricing for unknown model', () => {
    (p as any).trackCost('unknown-model', 1000, 1000);
    const log = p.getCostLog();
    // gpt-5 pricing: 1000*0.01/1000 + 1000*0.03/1000 = 0.01 + 0.03 = 0.04
    expect(log[0].estimatedCostUSD).toBeCloseTo(0.04);
  });

  it('accumulates multiple entries', () => {
    (p as any).trackCost('gpt-5', 100, 100);
    (p as any).trackCost('gpt-5', 200, 200);
    expect(p.getCostLog()).toHaveLength(2);
  });
});

// =============================================================================
// getCostLog / resetCostLog
// =============================================================================
describe('cost log management', () => {
  it('getCostLog returns a copy', () => {
    const p = createProvider();
    (p as any).trackCost('gpt-5', 100, 100);
    const log1 = p.getCostLog();
    const log2 = p.getCostLog();
    expect(log1).not.toBe(log2); // different references
    expect(log1).toEqual(log2);
  });

  it('resetCostLog clears all entries', () => {
    const p = createProvider();
    (p as any).trackCost('gpt-5', 100, 100);
    p.resetCostLog();
    expect(p.getCostLog()).toHaveLength(0);
  });
});
