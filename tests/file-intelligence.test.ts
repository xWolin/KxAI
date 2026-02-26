import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('fs/promises', () => ({
  default: { stat: vi.fn(), readFile: vi.fn(), readdir: vi.fn() },
  stat: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => false), createReadStream: vi.fn() },
  existsSync: vi.fn(() => false),
  createReadStream: vi.fn(),
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import * as fsp from 'fs/promises';
import { FileIntelligenceService } from '../src/main/services/file-intelligence';

const mockStat = vi.mocked(fsp.stat);

// =============================================================================
// detectFormat
// =============================================================================
describe('detectFormat', () => {
  let svc: FileIntelligenceService;

  beforeEach(() => {
    svc = new FileIntelligenceService();
  });

  it.each([
    ['.pdf', 'pdf'],
    ['.PDF', 'pdf'],
  ])('detects %s as %s', (ext, fmt) => {
    expect(svc.detectFormat(ext)).toBe(fmt);
  });

  it.each([
    ['.docx', 'docx'],
    ['.doc', 'docx'],
    ['.DOCX', 'docx'],
  ])('detects %s as %s', (ext, fmt) => {
    expect(svc.detectFormat(ext)).toBe(fmt);
  });

  it.each([
    ['.xlsx', 'xlsx'],
    ['.xls', 'xlsx'],
  ])('detects %s as %s', (ext, fmt) => {
    expect(svc.detectFormat(ext)).toBe(fmt);
  });

  it.each([
    ['.csv', 'csv'],
    ['.tsv', 'csv'],
  ])('detects %s as %s', (ext, fmt) => {
    expect(svc.detectFormat(ext)).toBe(fmt);
  });

  it('detects epub', () => {
    expect(svc.detectFormat('.epub')).toBe('epub');
  });

  it.each(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'])(
    'detects %s as image',
    (ext) => {
      expect(svc.detectFormat(ext)).toBe('image');
    },
  );

  it.each(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma'])(
    'detects %s as audio',
    (ext) => {
      expect(svc.detectFormat(ext)).toBe('audio');
    },
  );

  it.each(['.mp4', '.mkv', '.avi', '.webm', '.mov'])(
    'detects %s as video',
    (ext) => {
      expect(svc.detectFormat(ext)).toBe('video');
    },
  );

  it.each(['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.rb', '.php', '.cs', '.cpp', '.c', '.h', '.sh', '.sql'])(
    'detects %s as code',
    (ext) => {
      expect(svc.detectFormat(ext)).toBe('code');
    },
  );

  it.each(['.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.log', '.ini', '.cfg'])(
    'detects %s as text',
    (ext) => {
      expect(svc.detectFormat(ext)).toBe('text');
    },
  );

  it('returns unknown for unrecognized extension', () => {
    expect(svc.detectFormat('.xyz')).toBe('unknown');
    expect(svc.detectFormat('.abc')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(svc.detectFormat('.PDF')).toBe('pdf');
    expect(svc.detectFormat('.Xlsx')).toBe('xlsx');
    expect(svc.detectFormat('.MP3')).toBe('audio');
    expect(svc.detectFormat('.TS')).toBe('code');
    expect(svc.detectFormat('.JSON')).toBe('text');
  });
});

// =============================================================================
// getFileInfo
// =============================================================================
describe('getFileInfo', () => {
  let svc: FileIntelligenceService;

  beforeEach(() => {
    svc = new FileIntelligenceService();
    vi.clearAllMocks();
  });

  it('returns correct metadata for a text file', async () => {
    mockStat.mockResolvedValueOnce({
      size: 1024,
      birthtime: new Date('2024-01-15T10:00:00Z'),
      mtime: new Date('2024-06-01T14:30:00Z'),
      isDirectory: () => false,
    });

    const info = await svc.getFileInfo('/path/to/file.txt');
    expect(info.path).toBe('/path/to/file.txt');
    expect(info.name).toBe('file.txt');
    expect(info.extension).toBe('.txt');
    expect(info.size).toBe(1024);
    expect(info.sizeFormatted).toBe('1.0 KB');
    expect(info.mimeType).toBe('text/plain');
    expect(info.createdAt).toContain('2024-01-15');
    expect(info.modifiedAt).toContain('2024-06-01');
    expect(info.isDirectory).toBe(false);
    expect(info.format).toBe('text');
  });

  it('returns correct metadata for a PDF', async () => {
    mockStat.mockResolvedValueOnce({
      size: 5_242_880,
      birthtime: new Date('2024-03-01'),
      mtime: new Date('2024-03-01'),
      isDirectory: () => false,
    });

    const info = await svc.getFileInfo('/docs/report.pdf');
    expect(info.name).toBe('report.pdf');
    expect(info.extension).toBe('.pdf');
    expect(info.mimeType).toBe('application/pdf');
    expect(info.format).toBe('pdf');
    expect(info.sizeFormatted).toBe('5.0 MB');
  });

  it('returns correct metadata for a directory', async () => {
    mockStat.mockResolvedValueOnce({
      size: 0,
      birthtime: new Date('2024-01-01'),
      mtime: new Date('2024-01-01'),
      isDirectory: () => true,
    });

    const info = await svc.getFileInfo('/path/to/dir');
    expect(info.isDirectory).toBe(true);
  });

  it('falls back to application/octet-stream for unknown extension', async () => {
    mockStat.mockResolvedValueOnce({
      size: 100,
      birthtime: new Date('2024-01-01'),
      mtime: new Date('2024-01-01'),
      isDirectory: () => false,
    });

    const info = await svc.getFileInfo('/file.xyz');
    expect(info.mimeType).toBe('application/octet-stream');
  });

  it('formats various sizes correctly', async () => {
    const sizes = [
      [0, '0 B'],
      [512, '512.0 B'],
      [1024, '1.0 KB'],
      [1_048_576, '1.0 MB'],
      [1_073_741_824, '1.0 GB'],
    ] as [number, string][];

    for (const [bytes, expected] of sizes) {
      mockStat.mockResolvedValueOnce({
        size: bytes,
        birthtime: new Date(),
        mtime: new Date(),
        isDirectory: () => false,
      });
      const info = await svc.getFileInfo(`/file${bytes}.txt`);
      expect(info.sizeFormatted).toBe(expected);
    }
  });
});

// =============================================================================
// MIME types coverage
// =============================================================================
describe('MIME types', () => {
  let svc: FileIntelligenceService;

  beforeEach(() => {
    svc = new FileIntelligenceService();
  });

  it.each([
    ['.pdf', 'application/pdf'],
    ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['.json', 'application/json'],
    ['.html', 'text/html'],
    ['.ts', 'text/typescript'],
    ['.py', 'text/x-python'],
    ['.png', 'image/png'],
    ['.mp3', 'audio/mpeg'],
    ['.mp4', 'video/mp4'],
  ])('maps %s to %s', async (ext, mime) => {
    mockStat.mockResolvedValueOnce({
      size: 100,
      birthtime: new Date(),
      mtime: new Date(),
      isDirectory: () => false,
    });

    const info = await svc.getFileInfo(`/test${ext}`);
    expect(info.mimeType).toBe(mime);
  });
});
