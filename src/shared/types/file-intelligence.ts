/**
 * File Intelligence types — file analysis, extraction, search.
 * Phase 6.6 — agent "rozumie" pliki na komputerze.
 */

export type SupportedFileFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'text'
  | 'code'
  | 'image'
  | 'audio'
  | 'video'
  | 'epub'
  | 'unknown';

export interface FileMetadata {
  path: string;
  name: string;
  extension: string;
  size: number;
  sizeFormatted: string;
  mimeType: string;
  createdAt: string;
  modifiedAt: string;
  isDirectory: boolean;
  format: SupportedFileFormat;
}

export interface FileExtractionResult {
  text: string;
  metadata: FileMetadata;
  truncated: boolean;
  pageCount?: number;
  sheets?: Array<{ name: string; rows: number; cols: number }>;
  wordCount: number;
  charCount: number;
}

export interface FileSearchMatch {
  path: string;
  name: string;
  line?: number;
  content?: string;
  size: number;
  modified: string;
}

export interface FileSearchResult {
  matches: FileSearchMatch[];
  totalMatches: number;
  truncated: boolean;
  searchedFiles: number;
  searchedDirs: number;
}

export interface FolderAnalysis {
  path: string;
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  totalSizeFormatted: string;
  filesByType: Record<string, number>;
  largestFiles: Array<{ path: string; size: number; sizeFormatted: string }>;
  recentlyModified: Array<{ path: string; modified: string }>;
  structure: string;
}
