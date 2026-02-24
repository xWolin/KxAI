/**
 * Structured error types for KxAI.
 *
 * KxAIError provides error codes, severity levels, and recovery hints
 * across both main process and renderer.
 */

// ─── Error Codes ───

export enum ErrorCode {
  // AI / LLM
  AI_API_ERROR = 'AI_API_ERROR',
  AI_RATE_LIMIT = 'AI_RATE_LIMIT',
  AI_TOKEN_LIMIT = 'AI_TOKEN_LIMIT',
  AI_INVALID_RESPONSE = 'AI_INVALID_RESPONSE',
  AI_STREAM_ERROR = 'AI_STREAM_ERROR',
  AI_MODEL_NOT_FOUND = 'AI_MODEL_NOT_FOUND',

  // Tools
  TOOL_EXECUTION_ERROR = 'TOOL_EXECUTION_ERROR',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  TOOL_TIMEOUT = 'TOOL_TIMEOUT',
  TOOL_LOOP_DETECTED = 'TOOL_LOOP_DETECTED',
  TOOL_VALIDATION_ERROR = 'TOOL_VALIDATION_ERROR',

  // Browser / CDP
  CDP_CONNECTION_ERROR = 'CDP_CONNECTION_ERROR',
  CDP_TARGET_NOT_FOUND = 'CDP_TARGET_NOT_FOUND',
  CDP_COMMAND_ERROR = 'CDP_COMMAND_ERROR',
  CDP_TIMEOUT = 'CDP_TIMEOUT',

  // Config
  CONFIG_LOAD_ERROR = 'CONFIG_LOAD_ERROR',
  CONFIG_SAVE_ERROR = 'CONFIG_SAVE_ERROR',
  CONFIG_VALIDATION_ERROR = 'CONFIG_VALIDATION_ERROR',
  CONFIG_MIGRATION_ERROR = 'CONFIG_MIGRATION_ERROR',

  // Memory / Database
  DB_CONNECTION_ERROR = 'DB_CONNECTION_ERROR',
  DB_QUERY_ERROR = 'DB_QUERY_ERROR',
  DB_MIGRATION_ERROR = 'DB_MIGRATION_ERROR',
  MEMORY_READ_ERROR = 'MEMORY_READ_ERROR',
  MEMORY_WRITE_ERROR = 'MEMORY_WRITE_ERROR',

  // RAG
  RAG_INDEX_ERROR = 'RAG_INDEX_ERROR',
  RAG_SEARCH_ERROR = 'RAG_SEARCH_ERROR',
  RAG_EMBEDDING_ERROR = 'RAG_EMBEDDING_ERROR',

  // Cron
  CRON_SCHEDULE_ERROR = 'CRON_SCHEDULE_ERROR',
  CRON_EXECUTION_ERROR = 'CRON_EXECUTION_ERROR',

  // IPC
  IPC_HANDLER_ERROR = 'IPC_HANDLER_ERROR',
  IPC_INVALID_PARAMS = 'IPC_INVALID_PARAMS',

  // Security
  SECURITY_BLOCKED = 'SECURITY_BLOCKED',
  SECURITY_SSRF = 'SECURITY_SSRF',
  SECURITY_INJECTION = 'SECURITY_INJECTION',
  SECURITY_RATE_LIMIT = 'SECURITY_RATE_LIMIT',

  // File System
  FS_READ_ERROR = 'FS_READ_ERROR',
  FS_WRITE_ERROR = 'FS_WRITE_ERROR',
  FS_NOT_FOUND = 'FS_NOT_FOUND',
  FS_PERMISSION_ERROR = 'FS_PERMISSION_ERROR',

  // Screen / Automation
  SCREEN_CAPTURE_ERROR = 'SCREEN_CAPTURE_ERROR',
  AUTOMATION_ERROR = 'AUTOMATION_ERROR',

  // Meeting
  MEETING_AUDIO_ERROR = 'MEETING_AUDIO_ERROR',
  MEETING_TRANSCRIPTION_ERROR = 'MEETING_TRANSCRIPTION_ERROR',

  // Plugin
  PLUGIN_LOAD_ERROR = 'PLUGIN_LOAD_ERROR',
  PLUGIN_EXECUTION_ERROR = 'PLUGIN_EXECUTION_ERROR',

  // Generic
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  INVALID_STATE = 'INVALID_STATE',
}

// ─── Severity ───

export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info';

// ─── KxAIError ───

export class KxAIError extends Error {
  /** Machine-readable error code */
  public readonly code: ErrorCode;
  /** How severe is this error */
  public readonly severity: ErrorSeverity;
  /** Can the app recover from this error without restart */
  public readonly recoverable: boolean;
  /** Additional structured context */
  public readonly context?: Record<string, unknown>;
  /** Original error that caused this one */
  public readonly originalError?: Error;
  /** ISO timestamp of when the error occurred */
  public readonly timestamp: string;

  constructor(
    message: string,
    code: ErrorCode,
    options: {
      severity?: ErrorSeverity;
      recoverable?: boolean;
      context?: Record<string, unknown>;
      originalError?: Error;
    } = {},
  ) {
    super(message);
    this.name = 'KxAIError';
    this.code = code;
    this.severity = options.severity ?? 'error';
    this.recoverable = options.recoverable ?? true;
    this.context = options.context;
    this.originalError = options.originalError;
    this.timestamp = new Date().toISOString();

    // Preserve original stack trace if available
    if (options.originalError?.stack) {
      this.stack = `${this.stack}\n\nCaused by: ${options.originalError.stack}`;
    }
  }

  /** Serialize for IPC transport or logging */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      recoverable: this.recoverable,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  /** Check if an unknown value is a KxAIError */
  static isKxAIError(value: unknown): value is KxAIError {
    return value instanceof KxAIError;
  }

  /** Wrap any thrown value into a KxAIError */
  static from(
    error: unknown,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    context?: Record<string, unknown>,
  ): KxAIError {
    if (error instanceof KxAIError) return error;

    const originalError = error instanceof Error ? error : new Error(String(error));
    return new KxAIError(originalError.message, code, {
      originalError,
      context,
    });
  }
}
