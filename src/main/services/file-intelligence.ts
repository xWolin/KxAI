/**
 * FileIntelligenceService — inteligentna analiza i ekstrakcja tekstu z plików.
 *
 * Obsługiwane formaty:
 * - PDF  → pdf-parse (ekstrakcja tekstu z layoutem)
 * - DOCX → mammoth (cross-platform, czysta konwersja)
 * - XLSX/XLS → SheetJS (arkusze → CSV-like tekst)
 * - EPUB → PowerShell (Windows) / unzip (Linux/macOS)
 * - Tekst/Kod → fs.readFile z detekcją encodingu
 * - Obrazy → metadane (analiza via AI vision osobno)
 * - Audio → metadane (transkrypcja via Deepgram osobno)
 *
 * Phase 6.6 — File Intelligence
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { createLogger } from './logger';
import type {
  SupportedFileFormat,
  FileMetadata,
  FileExtractionResult,
  FileSearchMatch,
  FileSearchResult,
  FolderAnalysis,
} from '../../shared/types/file-intelligence';

// Re-export types for convenience
export type {
  SupportedFileFormat,
  FileMetadata,
  FileExtractionResult,
  FileSearchMatch,
  FileSearchResult,
  FolderAnalysis,
} from '../../shared/types/file-intelligence';

const log = createLogger('FileIntelligence');

// ─── Limits ───
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_TEXT_OUTPUT = 100_000; // 100K znaków
const MAX_SEARCH_RESULTS = 50;
const MAX_FOLDER_DEPTH = 10;
const MAX_FOLDER_FILES = 10_000;

// ─── MIME types ───
const MIME_TYPES: Record<string, string> = {
  // Documents
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.epub': 'application/epub+zip',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  // Text
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'application/toml',
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.log': 'text/plain',
  '.rst': 'text/x-rst',
  // Code
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.py': 'text/x-python',
  '.java': 'text/x-java',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.rb': 'text/x-ruby',
  '.php': 'text/x-php',
  '.cs': 'text/x-csharp',
  '.cpp': 'text/x-c++',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.sql': 'text/x-sql',
  '.r': 'text/x-r',
  '.R': 'text/x-r',
  '.lua': 'text/x-lua',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  // Video
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

// ─── Extension sets ───
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.mdx',
  '.markdown',
  '.rst',
  '.text',
  '.json',
  '.jsonc',
  '.json5',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.tsv',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.log',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.svg',
]);

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyx',
  '.java',
  '.kt',
  '.scala',
  '.cpp',
  '.c',
  '.h',
  '.hpp',
  '.cc',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  '.lua',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.r',
  '.R',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']);

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma']);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.webm', '.mov', '.wmv', '.flv']);

// Skip these directories when walking
const SKIP_DIRS = new Set([
  'node_modules',
  '__pycache__',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.tmp',
  'tmp',
  '.vscode',
  '.idea',
]);

export class FileIntelligenceService {
  // ─── Public API ───

  /**
   * Detect file format from extension.
   */
  detectFormat(ext: string): SupportedFileFormat {
    const lower = ext.toLowerCase();
    if (lower === '.pdf') return 'pdf';
    if (lower === '.docx' || lower === '.doc') return 'docx';
    if (lower === '.xlsx' || lower === '.xls') return 'xlsx';
    if (lower === '.csv' || lower === '.tsv') return 'csv';
    if (lower === '.epub') return 'epub';
    if (IMAGE_EXTENSIONS.has(lower)) return 'image';
    if (AUDIO_EXTENSIONS.has(lower)) return 'audio';
    if (VIDEO_EXTENSIONS.has(lower)) return 'video';
    if (CODE_EXTENSIONS.has(lower)) return 'code';
    if (TEXT_EXTENSIONS.has(lower)) return 'text';
    return 'unknown';
  }

  /**
   * Get file metadata without reading content.
   */
  async getFileInfo(filePath: string): Promise<FileMetadata> {
    const stats = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    return {
      path: filePath,
      name: path.basename(filePath),
      extension: ext,
      size: stats.size,
      sizeFormatted: formatSize(stats.size),
      mimeType: MIME_TYPES[ext] || 'application/octet-stream',
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
      isDirectory: stats.isDirectory(),
      format: this.detectFormat(ext),
    };
  }

  /**
   * Extract text content from any supported file type.
   * Dispatches to the correct parser based on file extension.
   */
  async extractText(filePath: string): Promise<FileExtractionResult> {
    const metadata = await this.getFileInfo(filePath);

    if (metadata.isDirectory) {
      throw new Error('Nie można wyekstrahować tekstu z katalogu — użyj analyze_folder');
    }

    if (metadata.size > MAX_FILE_SIZE) {
      throw new Error(`Plik zbyt duży (${metadata.sizeFormatted}). Maksymalny rozmiar: ${formatSize(MAX_FILE_SIZE)}`);
    }

    let text: string;
    let pageCount: number | undefined;
    let sheets: Array<{ name: string; rows: number; cols: number }> | undefined;

    try {
      switch (metadata.format) {
        case 'pdf':
          ({ text, pageCount } = await this.extractPDF(filePath));
          break;
        case 'docx':
          text = await this.extractDOCX(filePath);
          break;
        case 'xlsx':
          ({ text, sheets } = await this.extractXLSX(filePath));
          break;
        case 'csv':
        case 'text':
        case 'code':
          text = await this.readTextFile(filePath);
          break;
        case 'epub':
          text = await this.extractEPUB(filePath);
          break;
        case 'image':
          text = `[Plik graficzny: ${metadata.name} (${metadata.sizeFormatted}). Użyj screenshot_analyze lub AI vision do analizy zawartości obrazu.]`;
          break;
        case 'audio':
          text = `[Plik audio: ${metadata.name} (${metadata.sizeFormatted}). Użyj transkrypcji (Deepgram/Whisper) do przetworzenia.]`;
          break;
        case 'video':
          text = `[Plik wideo: ${metadata.name} (${metadata.sizeFormatted}). Bezpośrednia ekstrakcja tekstu z wideo nie jest obsługiwana.]`;
          break;
        default:
          // Spróbuj odczytać jako tekst
          try {
            text = await this.readTextFile(filePath);
          } catch {
            text = `[Nieobsługiwany format pliku: ${metadata.extension}]`;
          }
      }
    } catch (err: any) {
      log.error(`Błąd ekstrakcji tekstu z ${filePath}:`, err);
      throw new Error(`Nie udało się wyekstrahować tekstu z ${metadata.name}: ${err.message}`, { cause: err });
    }

    const truncated = text.length > MAX_TEXT_OUTPUT;
    if (truncated) {
      text = text.slice(0, MAX_TEXT_OUTPUT) + '\n\n[...treść ucięta — plik zbyt duży dla jednorazowego odczytu]';
    }

    return {
      text,
      metadata,
      truncated,
      pageCount,
      sheets,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
    };
  }

  /**
   * Search for files by name pattern and/or content.
   */
  async searchFiles(
    directory: string,
    options: {
      namePattern?: string; // glob: *.pdf, report*, *.docx
      contentPattern?: string; // tekst lub regex do szukania w treści
      extensions?: string[]; // filtr rozszerzeń: ['.pdf', '.docx']
      maxResults?: number;
      maxDepth?: number;
      caseSensitive?: boolean;
    } = {},
  ): Promise<FileSearchResult> {
    const maxResults = Math.min(options.maxResults || MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS);
    const maxDepth = Math.min(options.maxDepth || MAX_FOLDER_DEPTH, MAX_FOLDER_DEPTH);
    const matches: FileSearchMatch[] = [];
    let searchedFiles = 0;
    let searchedDirs = 0;
    let stopped = false;

    const nameRegex = options.namePattern
      ? new RegExp(globToRegex(options.namePattern), options.caseSensitive ? '' : 'i')
      : null;

    const contentRegex = options.contentPattern
      ? new RegExp(escapeRegex(options.contentPattern), options.caseSensitive ? '' : 'i')
      : null;

    const extensions = options.extensions
      ? new Set(options.extensions.map((e) => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`)))
      : null;

    await this.walkDirectory(
      directory,
      async (filePath, stats, depth) => {
        if (stopped || matches.length >= maxResults) {
          stopped = true;
          return false;
        }
        if (depth > maxDepth) return false;

        if (stats.isDirectory()) {
          searchedDirs++;
          return true;
        }

        searchedFiles++;
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();

        // Filtr rozszerzeń
        if (extensions && !extensions.has(ext)) return true;

        // Filtr nazwy
        if (nameRegex && !nameRegex.test(fileName)) return true;

        // Szukanie w treści
        if (contentRegex) {
          const format = this.detectFormat(ext);
          if (format !== 'text' && format !== 'code' && format !== 'csv') return true;
          if (stats.size > 5 * 1024 * 1024) return true; // pomijaj pliki >5MB

          try {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (contentRegex.test(lines[i])) {
                matches.push({
                  path: filePath,
                  name: fileName,
                  line: i + 1,
                  content: lines[i].trim().slice(0, 200),
                  size: stats.size,
                  modified: stats.mtime.toISOString(),
                });
                if (matches.length >= maxResults) {
                  stopped = true;
                  return false;
                }
                break; // jedno trafienie per plik
              }
            }
          } catch {
            /* pomijaj nieczytelne pliki */
          }
          return true;
        }

        // Trafienie po samej nazwie
        matches.push({
          path: filePath,
          name: fileName,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        });
        return true;
      },
      0,
    );

    return {
      matches,
      totalMatches: matches.length,
      truncated: matches.length >= maxResults,
      searchedFiles,
      searchedDirs,
    };
  }

  /**
   * Analyze a folder — file type distribution, largest files, structure.
   */
  async analyzeFolder(directory: string, maxDepth = 5): Promise<FolderAnalysis> {
    const filesByType: Record<string, number> = {};
    const allFiles: Array<{ path: string; size: number; modified: Date }> = [];
    let totalSize = 0;
    let totalFiles = 0;
    let totalDirectories = 0;

    await this.walkDirectory(
      directory,
      async (filePath, stats, depth) => {
        if (totalFiles + totalDirectories > MAX_FOLDER_FILES) return false;
        if (depth > maxDepth) return false;

        if (stats.isDirectory()) {
          totalDirectories++;
          return true;
        }

        totalFiles++;
        totalSize += stats.size;
        const ext = path.extname(filePath).toLowerCase() || '(bez rozszerzenia)';
        filesByType[ext] = (filesByType[ext] || 0) + 1;
        allFiles.push({ path: filePath, size: stats.size, modified: stats.mtime });
        return true;
      },
      0,
    );

    const largestFiles = [...allFiles]
      .sort((a, b) => b.size - a.size)
      .slice(0, 10)
      .map((f) => ({ path: f.path, size: f.size, sizeFormatted: formatSize(f.size) }));

    const recentlyModified = [...allFiles]
      .sort((a, b) => b.modified.getTime() - a.modified.getTime())
      .slice(0, 10)
      .map((f) => ({ path: f.path, modified: f.modified.toISOString() }));

    const structure = await this.buildTreeStructure(directory, Math.min(maxDepth, 3));

    return {
      path: directory,
      totalFiles,
      totalDirectories,
      totalSize,
      totalSizeFormatted: formatSize(totalSize),
      filesByType,
      largestFiles,
      recentlyModified,
      structure,
    };
  }

  // ─── Private: File extractors ───

  /**
   * PDF → text via pdf-parse (preserves layout).
   */
  private async extractPDF(filePath: string): Promise<{ text: string; pageCount: number }> {
    const { PDFParse } = await import('pdf-parse');
    const dataBuffer = await fs.readFile(filePath);
    const pdf = new PDFParse({ data: new Uint8Array(dataBuffer) });
    const result = await pdf.getText();
    await pdf.destroy();
    // Szacuj liczbę stron z form feed characters (\f) wstawianych przez pdf-parse
    const pageCount = (result.text.match(/\f/g) || []).length + 1;
    return { text: result.text, pageCount };
  }

  /**
   * DOCX → text via mammoth (cross-platform, czysta konwersja).
   * Zastępuje PowerShell-only approach z RAG service.
   */
  private async extractDOCX(filePath: string): Promise<string> {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    if (result.messages.length > 0) {
      log.warn(`mammoth warnings for ${path.basename(filePath)}:`, result.messages.slice(0, 3));
    }
    return result.value;
  }

  /**
   * XLSX/XLS → text via ExcelJS (każdy arkusz jako CSV).
   */
  private async extractXLSX(
    filePath: string,
  ): Promise<{ text: string; sheets: Array<{ name: string; rows: number; cols: number }> }> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets: Array<{ name: string; rows: number; cols: number }> = [];
    const textParts: string[] = [];

    for (const worksheet of workbook.worksheets) {
      const rows = worksheet.rowCount;
      const cols = worksheet.columnCount;

      sheets.push({
        name: worksheet.name,
        rows,
        cols,
      });

      // Convert worksheet to CSV-like text
      const csvLines: string[] = [];
      worksheet.eachRow((row) => {
        const values = row.values as any[];
        // row.values is 1-indexed (index 0 is undefined), slice it
        const cells = values.slice(1).map((v) => (v != null ? String(v) : ''));
        csvLines.push(cells.join(','));
      });

      textParts.push(`=== Arkusz: ${worksheet.name} (${rows} wierszy × ${cols} kolumn) ===\n${csvLines.join('\n')}`);
    }

    return { text: textParts.join('\n\n'), sheets };
  }

  /**
   * EPUB → text extraction.
   * Windows: PowerShell z System.IO.Compression
   * macOS/Linux: unzip + strip HTML tags
   */
  private async extractEPUB(filePath: string): Promise<string> {
    try {
      if (process.platform === 'win32') {
        return await this.extractEPUBWindows(filePath);
      }
      return await this.extractEPUBUnix(filePath);
    } catch (err) {
      log.warn('EPUB extraction failed:', err);
      return '[Nie udało się wyekstrahować tekstu z pliku EPUB]';
    }
  }

  private async extractEPUBWindows(filePath: string): Promise<string> {
    const { execSync } = await import('child_process');
    const escapedPath = filePath.replace(/'/g, "''");
    const script = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedPath}')
      $text = ''
      foreach ($entry in $zip.Entries) {
        if ($entry.FullName -match '\\.(xhtml|html|htm)$') {
          $reader = New-Object System.IO.StreamReader($entry.Open())
          $content = $reader.ReadToEnd()
          $reader.Close()
          $text += ($content -replace '<[^>]+>', ' ' -replace '\\s+', ' ') + " "
        }
      }
      $zip.Dispose()
      $text
    `;
    const result = execSync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60000,
    });
    return result.trim();
  }

  private async extractEPUBUnix(filePath: string): Promise<string> {
    const { execSync } = await import('child_process');
    const os = await import('os');
    const tempDir = path.join(os.tmpdir(), `kxai-epub-${Date.now()}`);
    try {
      execSync(`unzip -o "${filePath}" -d "${tempDir}"`, { timeout: 60000 });

      let text = '';
      const htmlFiles = await this.findFilesWithExtensions(tempDir, ['.xhtml', '.html', '.htm']);
      for (const htmlFile of htmlFiles.slice(0, 100)) {
        try {
          const content = await fs.readFile(htmlFile, 'utf8');
          text += content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') + ' ';
        } catch {
          /* skip */
        }
      }
      return text.trim();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Read text file with UTF-8 encoding.
   */
  private async readTextFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }

  // ─── Private: Directory walking ───

  private async walkDirectory(
    dir: string,
    callback: (filePath: string, stats: fsSync.Stats, depth: number) => Promise<boolean>,
    depth: number,
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Pomijaj ukryte katalogi i typowe excludes
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        try {
          const stats = await fs.stat(fullPath);
          const shouldContinue = await callback(fullPath, stats, depth);
          if (!shouldContinue) return;

          if (stats.isDirectory()) {
            await this.walkDirectory(fullPath, callback, depth + 1);
          }
        } catch {
          /* pomijaj niedostępne pliki */
        }
      }
    } catch {
      /* pomijaj niedostępne katalogi */
    }
  }

  /**
   * Build a tree-like structure string (like `tree` command).
   */
  private async buildTreeStructure(dir: string, maxDepth: number, prefix = '', depth = 0): Promise<string> {
    if (depth > maxDepth) return prefix + '...\n';

    let result = '';
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const filtered = entries
        .filter((e) => !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
        .sort((a, b) => {
          // Katalogi najpierw
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 30);

      for (let i = 0; i < filtered.length; i++) {
        const entry = filtered[i];
        const isLast = i === filtered.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';

        if (entry.isDirectory()) {
          result += `${prefix}${connector}${entry.name}/\n`;
          result += await this.buildTreeStructure(
            path.join(dir, entry.name),
            maxDepth,
            prefix + childPrefix,
            depth + 1,
          );
        } else {
          result += `${prefix}${connector}${entry.name}\n`;
        }
      }

      if (entries.length > 30) {
        result += `${prefix}... i ${entries.length - 30} więcej plików\n`;
      }
    } catch {
      /* skip */
    }
    return result;
  }

  /**
   * Find files with specific extensions recursively.
   */
  private async findFilesWithExtensions(dir: string, extensions: string[]): Promise<string[]> {
    const results: string[] = [];
    const exts = new Set(extensions.map((e) => e.toLowerCase()));

    await this.walkDirectory(
      dir,
      async (filePath, stats) => {
        if (!stats.isDirectory() && exts.has(path.extname(filePath).toLowerCase())) {
          results.push(filePath);
        }
        return results.length < 100;
      },
      0,
    );

    return results;
  }
}

// ─── Utility functions ───

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function globToRegex(glob: string): string {
  return (
    '^' +
    glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') +
    '$'
  );
}

function escapeRegex(str: string): string {
  // Jeśli wygląda na regex (zawiera specjalne znaki), nie escapuj
  if (/[.*+?^${}()|[\]\\]/.test(str) && str.length > 2) {
    return str;
  }
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
