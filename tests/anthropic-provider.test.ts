import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));
vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

import { AnthropicProvider } from '../src/main/services/providers/anthropic-provider';

function createProvider(): AnthropicProvider {
  return new AnthropicProvider();
}

// =============================================================================
// Basic state
// =============================================================================
describe('AnthropicProvider basics', () => {
  it('has correct name', () => {
    expect(createProvider().name).toBe('anthropic');
  });

  it('supports function-calling, vision, streaming, computer-use, prompt-caching', () => {
    const p = createProvider();
    expect(p.supportedFeatures.has('function-calling')).toBe(true);
    expect(p.supportedFeatures.has('vision')).toBe(true);
    expect(p.supportedFeatures.has('streaming')).toBe(true);
    expect(p.supportedFeatures.has('computer-use')).toBe(true);
    expect(p.supportedFeatures.has('prompt-caching')).toBe(true);
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
// extractSystem
// =============================================================================
describe('extractSystem', () => {
  let p: AnthropicProvider;
  const extractSystem = (msgs: any[]) => (p as any).extractSystem(msgs);

  beforeEach(() => { p = createProvider(); });

  it('extracts system messages', () => {
    const result = extractSystem([
      { role: 'system', content: 'You are an assistant' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(result.systemContent).toBe('You are an assistant');
    expect(result.conversationMessages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('combines multiple system messages', () => {
    const result = extractSystem([
      { role: 'system', content: 'Part 1' },
      { role: 'system', content: 'Part 2' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(result.systemContent).toBe('Part 1\n\nPart 2');
  });

  it('treats developer role as system', () => {
    const result = extractSystem([
      { role: 'developer', content: 'Instructions' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(result.systemContent).toBe('Instructions');
  });

  it('preserves user and assistant messages in order', () => {
    const result = extractSystem([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ]);
    expect(result.conversationMessages).toHaveLength(3);
    expect(result.conversationMessages[0].role).toBe('user');
    expect(result.conversationMessages[1].role).toBe('assistant');
    expect(result.conversationMessages[2].role).toBe('user');
  });

  it('handles empty messages array', () => {
    const result = extractSystem([]);
    expect(result.systemContent).toBe('');
    expect(result.conversationMessages).toEqual([]);
  });

  it('stringifies non-string system content', () => {
    const result = extractSystem([
      { role: 'system', content: { key: 'value' } },
    ]);
    expect(result.systemContent).toBe('{"key":"value"}');
  });
});

// =============================================================================
// buildSystemParam
// =============================================================================
describe('buildSystemParam', () => {
  let p: AnthropicProvider;
  const buildSystemParam = (s: string) => (p as any).buildSystemParam(s);

  beforeEach(() => { p = createProvider(); });

  it('returns string for short content', () => {
    const result = buildSystemParam('Short prompt');
    expect(result).toBe('Short prompt');
  });

  it('returns array with cache_control for long content (>3500 chars)', () => {
    const longContent = 'x'.repeat(4000);
    const result = buildSystemParam(longContent);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].type).toBe('text');
    expect(result[0].text).toBe(longContent);
    expect(result[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('boundary: exactly 3500 chars is short', () => {
    const result = buildSystemParam('x'.repeat(3500));
    expect(typeof result).toBe('string');
  });

  it('boundary: 3501 chars triggers caching', () => {
    const result = buildSystemParam('x'.repeat(3501));
    expect(Array.isArray(result)).toBe(true);
  });
});

// =============================================================================
// convertImage
// =============================================================================
describe('convertImage', () => {
  let p: AnthropicProvider;
  const convertImage = (data: string, mediaType?: string) =>
    (p as any).convertImage(data, mediaType);

  beforeEach(() => { p = createProvider(); });

  it('converts raw base64 data', () => {
    const result = convertImage('abc123');
    expect(result.type).toBe('image');
    expect(result.source.type).toBe('base64');
    expect(result.source.data).toBe('abc123');
    expect(result.source.media_type).toBe('image/png'); // default
  });

  it('extracts data from data URL', () => {
    const result = convertImage('data:image/jpeg;base64,/9j/4AAQ');
    expect(result.source.data).toBe('/9j/4AAQ');
    expect(result.source.media_type).toBe('image/png'); // mediaType param not provided
  });

  it('uses provided media type', () => {
    const result = convertImage('abc', 'image/jpeg');
    expect(result.source.media_type).toBe('image/jpeg');
  });

  it('falls back to image/png for invalid media type', () => {
    const result = convertImage('abc', 'image/bmp');
    expect(result.source.media_type).toBe('image/png');
  });

  it('accepts image/gif', () => {
    const result = convertImage('abc', 'image/gif');
    expect(result.source.media_type).toBe('image/gif');
  });

  it('accepts image/webp', () => {
    const result = convertImage('abc', 'image/webp');
    expect(result.source.media_type).toBe('image/webp');
  });

  it('handles data: prefix without base64 marker', () => {
    const result = convertImage('data:image/png,rawdata');
    expect(result.source.data).toBe('rawdata');
  });
});

// =============================================================================
// trackCost
// =============================================================================
describe('Anthropic trackCost', () => {
  let p: AnthropicProvider;

  beforeEach(() => { p = createProvider(); });

  it('tracks cost for claude-sonnet-4', () => {
    (p as any).trackCost('claude-sonnet-4-20250514', 1000, 500);
    const log = p.getCostLog();
    expect(log).toHaveLength(1);
    // claude-sonnet-4: input=0.003/1K, output=0.015/1K → 1*0.003 + 0.5*0.015 = 0.0105
    expect(log[0].estimatedCostUSD).toBeCloseTo(0.0105);
  });

  it('tracks cost for claude-opus-4', () => {
    (p as any).trackCost('claude-opus-4-20250514', 2000, 1000);
    const log = p.getCostLog();
    // claude-opus-4: input=0.015/1K, output=0.075/1K → 2*0.015 + 1*0.075 = 0.105
    expect(log[0].estimatedCostUSD).toBeCloseTo(0.105);
  });

  it('tracks cost for claude-haiku-3.5', () => {
    (p as any).trackCost('claude-haiku-3.5-20250514', 5000, 2000);
    const log = p.getCostLog();
    // haiku: input=0.0008/1K, output=0.004/1K → 5*0.0008 + 2*0.004 = 0.012
    expect(log[0].estimatedCostUSD).toBeCloseTo(0.012);
  });

  it('falls back to claude-sonnet-4 pricing for unknown model', () => {
    (p as any).trackCost('claude-unknown', 1000, 1000);
    const log = p.getCostLog();
    expect(log[0].estimatedCostUSD).toBeCloseTo(0.018);
  });
});

// =============================================================================
// getCostLog / resetCostLog
// =============================================================================
describe('Anthropic cost log', () => {
  it('getCostLog returns copy', () => {
    const p = createProvider();
    (p as any).trackCost('claude-sonnet-4', 100, 100);
    expect(p.getCostLog()).not.toBe(p.getCostLog());
  });

  it('resetCostLog clears entries', () => {
    const p = createProvider();
    (p as any).trackCost('claude-sonnet-4', 100, 100);
    p.resetCostLog();
    expect(p.getCostLog()).toHaveLength(0);
  });
});
