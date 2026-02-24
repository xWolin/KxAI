/**
 * Tagged logger — structured logging z identyfikacją serwisu.
 * Zamiennik bezpośredniego użycia console.log/warn/error.
 *
 * Użycie:
 *   const log = createLogger('BrowserService');
 *   log.info('Connected to CDP');
 *   log.warn('Retrying...', { attempt: 3 });
 *   log.error('Connection failed', err);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Global log level — can be adjusted at runtime */
let globalLogLevel: LogLevel = 'info';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLogLevel;
}

/**
 * Create a tagged logger for a specific service/module.
 *
 * @param tag - Service/module name (e.g. 'BrowserService', 'AgentLoop')
 * @returns Logger instance with tagged output
 */
export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;

  const shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[globalLogLevel];
  };

  return {
    debug(message: string, ...args: unknown[]) {
      if (shouldLog('debug')) {
        console.debug(prefix, message, ...args);
      }
    },
    info(message: string, ...args: unknown[]) {
      if (shouldLog('info')) {
        console.log(prefix, message, ...args);
      }
    },
    warn(message: string, ...args: unknown[]) {
      if (shouldLog('warn')) {
        console.warn(prefix, message, ...args);
      }
    },
    error(message: string, ...args: unknown[]) {
      if (shouldLog('error')) {
        console.error(prefix, message, ...args);
      }
    },
  };
}
