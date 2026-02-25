/**
 * RetryHandler — inteligentne ponawianie operacji z circuit breaker.
 *
 * Features:
 * 1. Exponential backoff z jitter
 * 2. Circuit breaker — po N consecutive failures przestaje próbować na M sekund
 * 3. Retry-after header support
 * 4. Configurable retry predicates (które errory retry'ować)
 * 5. Fallback handlers
 * 6. Per-operation statistics
 */

interface RetryConfig {
  maxRetries: number; // Default: 3
  baseDelayMs: number; // Default: 1000
  maxDelayMs: number; // Default: 30000
  backoffMultiplier: number; // Default: 2
  jitterFactor: number; // Default: 0.25 (25% randomness)
  retryableErrors: string[]; // Error messages/codes worth retrying
  circuitBreakerThreshold: number; // Default: 5 consecutive failures
  circuitBreakerResetMs: number; // Default: 60000 (1 min)
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

interface OperationStats {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  lastError: string | null;
  avgDurationMs: number;
}

const DEFAULT_RETRYABLE_PATTERNS = [
  // Network errors
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'socket hang up',
  'network',
  // HTTP status codes
  '429', // Rate limited
  '500', // Internal server error
  '502', // Bad gateway
  '503', // Service unavailable
  '504', // Gateway timeout
  // OpenAI specific
  'Rate limit',
  'rate_limit_exceeded',
  'overloaded',
  'capacity',
  'server_error',
  // Anthropic specific
  'overloaded_error',
  'api_error',
];

export class RetryHandler {
  private config: RetryConfig;
  private circuits: Map<string, CircuitBreakerState> = new Map();
  private stats: Map<string, OperationStats> = new Map();

  constructor(config?: Partial<RetryConfig>) {
    this.config = {
      maxRetries: config?.maxRetries ?? 3,
      baseDelayMs: config?.baseDelayMs ?? 1000,
      maxDelayMs: config?.maxDelayMs ?? 30000,
      backoffMultiplier: config?.backoffMultiplier ?? 2,
      jitterFactor: config?.jitterFactor ?? 0.25,
      retryableErrors: config?.retryableErrors ?? [],
      circuitBreakerThreshold: config?.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: config?.circuitBreakerResetMs ?? 60000,
    };
  }

  /**
   * Execute an operation with automatic retry and circuit breaking.
   *
   * @param operationName - Unique name for tracking (e.g., 'openai-chat', 'web-search')
   * @param fn - The async function to execute
   * @param overrides - Optional per-call config overrides
   */
  async execute<T>(operationName: string, fn: () => Promise<T>, overrides?: Partial<RetryConfig>): Promise<T> {
    const config = { ...this.config, ...overrides };

    // Check circuit breaker
    const circuit = this.getCircuit(operationName);
    if (circuit.state === 'open') {
      const elapsed = Date.now() - circuit.lastFailure;
      if (elapsed < config.circuitBreakerResetMs) {
        throw new Error(
          `Circuit breaker otwarty dla "${operationName}" — zbyt wiele błędów. Spróbuj za ${Math.ceil((config.circuitBreakerResetMs - elapsed) / 1000)}s.`,
        );
      }
      // Try half-open
      circuit.state = 'half-open';
    }

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await fn();

        // Success — reset circuit breaker
        circuit.failures = 0;
        circuit.state = 'closed';

        // Update stats
        this.recordSuccess(operationName, Date.now() - startTime);

        return result;
      } catch (error: any) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryable(error, config)) {
          // Non-retryable error — fail immediately
          this.recordFailure(operationName, error);
          circuit.failures++;
          circuit.lastFailure = Date.now();
          if (circuit.failures >= config.circuitBreakerThreshold) {
            circuit.state = 'open';
          }
          throw error;
        }

        // Update retry stats
        this.recordRetry(operationName);

        if (attempt < config.maxRetries) {
          // Calculate delay with exponential backoff + jitter
          const delay = this.calculateDelay(attempt, config, error);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.recordFailure(operationName, lastError!);
    circuit.failures++;
    circuit.lastFailure = Date.now();
    if (circuit.failures >= config.circuitBreakerThreshold) {
      circuit.state = 'open';
    }

    throw lastError;
  }

  /**
   * Execute with fallback — if all retries fail, run fallback function.
   */
  async executeWithFallback<T>(
    operationName: string,
    fn: () => Promise<T>,
    fallback: (error: Error) => T | Promise<T>,
    overrides?: Partial<RetryConfig>,
  ): Promise<T> {
    try {
      return await this.execute(operationName, fn, overrides);
    } catch (error: any) {
      console.warn(`[RetryHandler] ${operationName} failed after retries, using fallback:`, error.message);
      return fallback(error);
    }
  }

  /**
   * Check if an error is retryable.
   */
  private isRetryable(error: any, config: RetryConfig): boolean {
    const message = (error.message || '').toLowerCase();
    const code = (error.code || '').toLowerCase();
    const status = error.status || error.statusCode || 0;

    const patterns = [...DEFAULT_RETRYABLE_PATTERNS, ...config.retryableErrors];

    for (const pattern of patterns) {
      const lower = pattern.toLowerCase();
      if (message.includes(lower) || code.includes(lower) || String(status) === pattern) {
        return true;
      }
    }

    // Check for Retry-After header (OpenAI/Anthropic rate limiting)
    if (error.headers?.['retry-after'] || error.response?.headers?.['retry-after']) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter.
   */
  private calculateDelay(attempt: number, config: RetryConfig, error?: any): number {
    // Check for Retry-After header
    const retryAfter = error?.headers?.['retry-after'] || error?.response?.headers?.['retry-after'];
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) {
        return Math.min(seconds * 1000, config.maxDelayMs);
      }
    }

    // Exponential backoff: baseDelay * multiplier^attempt
    const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);

    // Add jitter to prevent thundering herd
    const jitter = exponentialDelay * config.jitterFactor * (Math.random() * 2 - 1);
    const delay = Math.min(exponentialDelay + jitter, config.maxDelayMs);

    return Math.max(0, Math.round(delay));
  }

  // ─── Circuit Breaker ───

  private getCircuit(name: string): CircuitBreakerState {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, { failures: 0, lastFailure: 0, state: 'closed' });
    }
    return this.circuits.get(name)!;
  }

  getCircuitState(name: string): CircuitBreakerState['state'] {
    return this.getCircuit(name).state;
  }

  resetCircuit(name: string): void {
    this.circuits.set(name, { failures: 0, lastFailure: 0, state: 'closed' });
  }

  // ─── Statistics ───

  private getStats(name: string): OperationStats {
    if (!this.stats.has(name)) {
      this.stats.set(name, {
        totalCalls: 0,
        successCount: 0,
        failureCount: 0,
        retryCount: 0,
        lastError: null,
        avgDurationMs: 0,
      });
    }
    return this.stats.get(name)!;
  }

  private recordSuccess(name: string, durationMs: number): void {
    const stats = this.getStats(name);
    stats.totalCalls++;
    stats.successCount++;
    // Running average
    stats.avgDurationMs = stats.avgDurationMs === 0 ? durationMs : stats.avgDurationMs * 0.8 + durationMs * 0.2;
  }

  private recordFailure(name: string, error: Error): void {
    const stats = this.getStats(name);
    stats.totalCalls++;
    stats.failureCount++;
    stats.lastError = error.message;
  }

  private recordRetry(name: string): void {
    const stats = this.getStats(name);
    stats.retryCount++;
  }

  getAllStats(): Record<string, OperationStats> {
    const result: Record<string, OperationStats> = {};
    for (const [name, stats] of this.stats) {
      result[name] = { ...stats };
    }
    return result;
  }

  getOperationStats(name: string): OperationStats {
    return { ...this.getStats(name) };
  }

  // ─── Utility ───

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Pre-configured RetryHandler instances for common operations.
 */
export function createAIRetryHandler(): RetryHandler {
  return new RetryHandler({
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    circuitBreakerThreshold: 5,
    circuitBreakerResetMs: 120000, // 2 min cooldown for AI APIs
  });
}

export function createWebRetryHandler(): RetryHandler {
  return new RetryHandler({
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    circuitBreakerThreshold: 10,
    circuitBreakerResetMs: 30000,
  });
}
