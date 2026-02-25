/**
 * Smart Clipboard Pipeline types — shared between main and renderer.
 *
 * @module clipboard
 * @phase 6.1
 */

/** Detected content type of clipboard entry */
export type ClipboardContentType =
  | 'text'
  | 'url'
  | 'email'
  | 'code'
  | 'json'
  | 'path'
  | 'color'
  | 'phone'
  | 'address'
  | 'number'
  | 'markdown'
  | 'html'
  | 'unknown';

/** Single clipboard history entry */
export interface ClipboardEntry {
  /** Unique identifier */
  id: string;
  /** Raw text content */
  content: string;
  /** Auto-detected content type */
  contentType: ClipboardContentType;
  /** Content preview (truncated for display) */
  preview: string;
  /** Byte length of content */
  byteLength: number;
  /** Character count */
  charCount: number;
  /** ISO timestamp when copied */
  copiedAt: string;
  /** Source application (if detectable) */
  sourceApp?: string;
  /** Whether this entry has been pinned by user */
  pinned: boolean;
  /** AI-generated enrichment (summary, explanation, formatted version) */
  enrichment?: string;
  /** Hash for deduplication */
  contentHash: string;
}

/** Options for searching clipboard history */
export interface ClipboardSearchOptions {
  /** Search query (full-text search) */
  query?: string;
  /** Filter by content type */
  contentType?: ClipboardContentType;
  /** Max results to return */
  limit?: number;
  /** Only return pinned entries */
  pinnedOnly?: boolean;
  /** Date range start (ISO) */
  since?: string;
  /** Date range end (ISO) */
  until?: string;
}

/** Clipboard pipeline configuration */
export interface ClipboardConfig {
  /** Whether clipboard monitoring is enabled (opt-in) */
  enabled: boolean;
  /** Max history entries to keep */
  maxHistory: number;
  /** Auto-delete entries older than N days (0 = never) */
  retentionDays: number;
  /** Whether to run AI enrichment on copied content */
  aiEnrichment: boolean;
  /** Minimum content length to track (skip very short copies) */
  minLength: number;
  /** Content types to auto-enrich */
  enrichTypes: ClipboardContentType[];
}

/** Clipboard pipeline status */
export interface ClipboardStatus {
  /** Whether monitoring is currently active */
  monitoring: boolean;
  /** Total entries in history */
  totalEntries: number;
  /** Pinned entries count */
  pinnedEntries: number;
  /** Monitoring started at (ISO) */
  startedAt?: string;
}
