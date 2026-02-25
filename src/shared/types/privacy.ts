/**
 * Privacy & GDPR compliance types.
 *
 * Defines data export/delete/summary structures for GDPR Article 15 (access),
 * Article 17 (erasure), and Article 20 (portability).
 */

/** Categories of user data that KxAI stores */
export type PrivacyDataCategory =
  | 'conversations' // Chat history with AI
  | 'memory' // Agent's memory files (USER.md, MEMORY.md, SOUL.md, HEARTBEAT.md)
  | 'activity' // Workflow activity log + patterns
  | 'meetings' // Meeting transcripts + summaries
  | 'cron' // Cron jobs + execution history
  | 'rag' // Indexed file chunks + embeddings
  | 'audit' // Security audit log
  | 'config' // Application settings (without secrets)
  | 'prompts' // User-customized prompts
  | 'browser' // Browser profile data
  | 'secrets' // Encrypted API keys
  | 'temp'; // Temporary files (TTS audio, OCR screenshots)

/** Summary of stored data for user review */
export interface PrivacyDataSummary {
  /** Total data size in bytes */
  totalSizeBytes: number;
  /** Breakdown by category */
  categories: PrivacyCategorySummary[];
  /** When data collection started (earliest timestamp) */
  dataCollectionStart: string | null;
  /** Last activity timestamp */
  lastActivity: string | null;
}

/** Per-category data summary */
export interface PrivacyCategorySummary {
  category: PrivacyDataCategory;
  /** Human-readable label (PL) */
  label: string;
  /** Number of records/files */
  itemCount: number;
  /** Size in bytes */
  sizeBytes: number;
  /** Human-readable description (PL) */
  description: string;
}

/** Result of data export operation */
export interface PrivacyExportResult {
  success: boolean;
  /** Path to the exported archive (ZIP) */
  exportPath?: string;
  /** Size of the export in bytes */
  sizeBytes?: number;
  /** Categories included in export */
  categories: PrivacyDataCategory[];
  /** Error message if failed */
  error?: string;
}

/** Result of data deletion operation */
export interface PrivacyDeleteResult {
  success: boolean;
  /** Categories that were deleted */
  deletedCategories: PrivacyDataCategory[];
  /** Categories that failed to delete */
  failedCategories: { category: PrivacyDataCategory; error: string }[];
  /** Whether app restart is required */
  requiresRestart: boolean;
}

/** Options for data export */
export interface PrivacyExportOptions {
  /** Which categories to export (default: all) */
  categories?: PrivacyDataCategory[];
  /** Custom export directory (default: user's Documents folder) */
  outputDir?: string;
  /** Include RAG indexed content (can be large) */
  includeRAG?: boolean;
}

/** Options for data deletion */
export interface PrivacyDeleteOptions {
  /** Which categories to delete (default: all) */
  categories?: PrivacyDataCategory[];
  /** Keep application config (model settings, persona) */
  keepConfig?: boolean;
  /** Keep SOUL.md (persona identity) */
  keepPersona?: boolean;
}
