/**
 * Shared constants — default values, limits, and configuration constants.
 */

/** Max tool loop iterations before agent stops */
export const MAX_TOOL_ITERATIONS = 15;

/** Max sub-agents running simultaneously */
export const MAX_CONCURRENT_SUBAGENTS = 3;

/** Default heartbeat interval (5 minutes) */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/** Default proactive mode interval (30 seconds) */
export const DEFAULT_PROACTIVE_INTERVAL_MS = 30_000;

/** Max file size for RAG indexing (500MB) */
export const MAX_RAG_FILE_SIZE = 500 * 1024 * 1024;

/** Max total files for RAG indexing */
export const MAX_RAG_TOTAL_FILES = 10_000;

/** Max text size to load into memory at once (10MB) */
export const MAX_TEXT_READ_SIZE = 10 * 1024 * 1024;

/** Conversation history retention: auto-archive after N days */
export const SESSION_ARCHIVE_DAYS = 30;

/** Default AI model */
export const DEFAULT_AI_MODEL = 'gpt-5';

/** Default AI provider */
export const DEFAULT_AI_PROVIDER = 'openai' as const;
