import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetryHandler, createAIRetryHandler, createWebRetryHandler } from '../src/main/services/retry-handler';

// Suppress log output
vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

// Helper to access private methods
function priv<T>(instance: any, name: string): (...args: any[]) => T {
  return instance[name].bind(instance);
}

// =============================================================================
// Constructor / defaults
// =============================================================================
describe('RetryHandler constructor', () => {
  it('uses defaults when no config', () => {
    const handler = new RetryHandler();
    const config = (handler as any).config;
    expect(config.maxRetries).toBe(3);
    expect(config.baseDelayMs).toBe(1000);
    expect(config.maxDelayMs).toBe(30000);
    expect(config.backoffMultiplier).toBe(2);
    expect(config.jitterFactor).toBe(0.25);
    expect(config.circuitBreakerThreshold).toBe(5);
    expect(config.circuitBreakerResetMs).toBe(60000);
  });

  it('merges partial config', () => {
    const handler = new RetryHandler({ maxRetries: 5, baseDelayMs: 500 });
    const config = (handler as any).config;
    expect(config.maxRetries).toBe(5);
    expect(config.baseDelayMs).toBe(500);
    expect(config.maxDelayMs).toBe(30000); // default preserved
  });
});

// =============================================================================
// isRetryable
// =============================================================================
describe('isRetryable', () => {
  let handler: RetryHandler;
  let isRetryable: (error: any, config: any) => boolean;

  beforeEach(() => {
    handler = new RetryHandler();
    isRetryable = priv(handler, 'isRetryable');
  });

  it.each([
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
    'socket hang up', 'network',
  ])('retries on error code/message: %s', (pattern) => {
    expect(isRetryable({ message: pattern }, (handler as any).config)).toBe(true);
  });

  it.each(['429', '500', '502', '503', '504'])(
    'retries on HTTP status %s',
    (status) => {
      expect(isRetryable({ status: Number(status) }, (handler as any).config)).toBe(true);
    },
  );

  it.each(['Rate limit', 'rate_limit_exceeded', 'overloaded', 'server_error'])(
    'retries on message: %s',
    (msg) => {
      expect(isRetryable({ message: msg }, (handler as any).config)).toBe(true);
    },
  );

  it('retries on Retry-After header', () => {
    expect(
      isRetryable({ message: 'custom', headers: { 'retry-after': '5' } }, (handler as any).config),
    ).toBe(true);
  });

  it('retries on response Retry-After header', () => {
    expect(
      isRetryable(
        { message: 'custom', response: { headers: { 'retry-after': '10' } } },
        (handler as any).config,
      ),
    ).toBe(true);
  });

  it('does not retry on unknown error', () => {
    expect(isRetryable({ message: 'syntax error' }, (handler as any).config)).toBe(false);
  });

  it('retries on custom retryableErrors', () => {
    const config = { ...(handler as any).config, retryableErrors: ['custom_error'] };
    expect(isRetryable({ message: 'custom_error happened' }, config)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isRetryable({ message: 'RATE LIMIT exceeded' }, (handler as any).config)).toBe(true);
  });
});

// =============================================================================
// calculateDelay
// =============================================================================
describe('calculateDelay', () => {
  let handler: RetryHandler;
  let calcDelay: (attempt: number, config: any, error?: any) => number;

  beforeEach(() => {
    handler = new RetryHandler({ jitterFactor: 0 }); // no jitter for determinism
    calcDelay = priv(handler, 'calculateDelay');
  });

  it('calculates exponential backoff', () => {
    const config = (handler as any).config;
    expect(calcDelay(0, config)).toBe(1000);         // 1000 * 2^0
    expect(calcDelay(1, config)).toBe(2000);         // 1000 * 2^1
    expect(calcDelay(2, config)).toBe(4000);         // 1000 * 2^2
    expect(calcDelay(3, config)).toBe(8000);         // 1000 * 2^3
  });

  it('caps delay at maxDelayMs', () => {
    const config = { ...(handler as any).config, maxDelayMs: 5000 };
    expect(calcDelay(10, config)).toBe(5000);
  });

  it('uses Retry-After header when present', () => {
    const config = (handler as any).config;
    const error = { headers: { 'retry-after': '3' } };
    expect(calcDelay(0, config, error)).toBe(3000);
  });

  it('caps Retry-After at maxDelayMs', () => {
    const config = { ...(handler as any).config, maxDelayMs: 5000 };
    const error = { headers: { 'retry-after': '100' } };
    expect(calcDelay(0, config, error)).toBe(5000);
  });

  it('adds jitter within range', () => {
    const withJitter = new RetryHandler({ jitterFactor: 0.5 });
    const calc = priv<number>(withJitter, 'calculateDelay');
    const config = (withJitter as any).config;

    const delays = new Set<number>();
    for (let i = 0; i < 20; i++) delays.add(calc(0, config));
    // Should have some variation
    expect(delays.size).toBeGreaterThan(1);
    // All within valid range
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(config.maxDelayMs);
    }
  });
});

// =============================================================================
// execute
// =============================================================================
describe('execute', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler({ maxRetries: 2, baseDelayMs: 10, jitterFactor: 0 });
    // Mock sleep to be instant
    (handler as any).sleep = vi.fn(() => Promise.resolve());
  });

  it('returns result on success', async () => {
    const result = await handler.execute('test', async () => 42);
    expect(result).toBe(42);
  });

  it('retries on retryable error then succeeds', async () => {
    let attempt = 0;
    const result = await handler.execute('test', async () => {
      attempt++;
      if (attempt < 2) throw { message: 'ECONNRESET' };
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(attempt).toBe(2);
  });

  it('throws after maxRetries exhausted', async () => {
    await expect(
      handler.execute('test', async () => {
        throw { message: 'ECONNRESET' };
      }),
    ).rejects.toMatchObject({ message: 'ECONNRESET' });
  });

  it('does not retry non-retryable errors', async () => {
    let attempt = 0;
    await expect(
      handler.execute('test', async () => {
        attempt++;
        throw new Error('syntax error');
      }),
    ).rejects.toThrow('syntax error');
    expect(attempt).toBe(1);
  });

  it('tracks retry count in stats', async () => {
    let attempt = 0;
    await handler.execute('counted', async () => {
      attempt++;
      if (attempt < 3) throw { message: 'ECONNRESET' };
      return true;
    });
    const stats = handler.getOperationStats('counted');
    expect(stats.retryCount).toBe(2);
    expect(stats.successCount).toBe(1);
  });
});

// =============================================================================
// executeWithFallback
// =============================================================================
describe('executeWithFallback', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler({ maxRetries: 0, baseDelayMs: 10 });
    (handler as any).sleep = vi.fn(() => Promise.resolve());
  });

  it('returns fallback on failure', async () => {
    const result = await handler.executeWithFallback(
      'test',
      async () => { throw new Error('fail'); },
      () => 'fallback-value',
    );
    expect(result).toBe('fallback-value');
  });

  it('returns primary result when successful', async () => {
    const result = await handler.executeWithFallback(
      'test',
      async () => 'primary',
      () => 'fallback',
    );
    expect(result).toBe('primary');
  });
});

// =============================================================================
// Circuit breaker
// =============================================================================
describe('circuit breaker', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler({
      maxRetries: 0,
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 1000,
    });
    (handler as any).sleep = vi.fn(() => Promise.resolve());
  });

  it('opens circuit after threshold failures', async () => {
    const error = new Error('bad request');
    for (let i = 0; i < 3; i++) {
      await handler.execute('cb-test', async () => { throw error; }).catch(() => {});
    }
    expect(handler.getCircuitState('cb-test')).toBe('open');
  });

  it('rejects immediately when circuit is open', async () => {
    const error = new Error('bad');
    for (let i = 0; i < 3; i++) {
      await handler.execute('cb-test', async () => { throw error; }).catch(() => {});
    }

    await expect(
      handler.execute('cb-test', async () => 'ok'),
    ).rejects.toThrow('Circuit breaker');
  });

  it('resets circuit state', () => {
    handler.resetCircuit('test');
    expect(handler.getCircuitState('test')).toBe('closed');
  });

  it('starts in closed state', () => {
    expect(handler.getCircuitState('new-op')).toBe('closed');
  });
});

// =============================================================================
// Stats
// =============================================================================
describe('stats', () => {
  let handler: RetryHandler;

  beforeEach(() => {
    handler = new RetryHandler({ maxRetries: 0 });
    (handler as any).sleep = vi.fn(() => Promise.resolve());
  });

  it('tracks success stats', async () => {
    await handler.execute('s1', async () => 'ok');
    const stats = handler.getOperationStats('s1');
    expect(stats.totalCalls).toBe(1);
    expect(stats.successCount).toBe(1);
    expect(stats.failureCount).toBe(0);
    expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('tracks failure stats', async () => {
    await handler.execute('f1', async () => { throw new Error('fail'); }).catch(() => {});
    const stats = handler.getOperationStats('f1');
    expect(stats.totalCalls).toBe(1);
    expect(stats.failureCount).toBe(1);
    expect(stats.lastError).toBe('fail');
  });

  it('returns all stats', async () => {
    await handler.execute('a', async () => 1);
    await handler.execute('b', async () => 2);
    const all = handler.getAllStats();
    expect(Object.keys(all)).toContain('a');
    expect(Object.keys(all)).toContain('b');
  });

  it('returns defaults for unknown operation', () => {
    const stats = handler.getOperationStats('unknown');
    expect(stats.totalCalls).toBe(0);
    expect(stats.successCount).toBe(0);
  });
});

// =============================================================================
// Factory functions
// =============================================================================
describe('factory functions', () => {
  it('createAIRetryHandler returns configured handler', () => {
    const handler = createAIRetryHandler();
    expect(handler).toBeInstanceOf(RetryHandler);
    const config = (handler as any).config;
    expect(config.maxRetries).toBe(3);
    expect(config.baseDelayMs).toBe(2000);
    expect(config.maxDelayMs).toBe(60000);
  });

  it('createWebRetryHandler returns configured handler', () => {
    const handler = createWebRetryHandler();
    expect(handler).toBeInstanceOf(RetryHandler);
    const config = (handler as any).config;
    expect(config.maxRetries).toBe(2);
    expect(config.baseDelayMs).toBe(500);
  });
});
