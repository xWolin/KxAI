import { describe, it, expect, vi } from 'vitest';

// We only need minimal mocks since detectContentType is a static method
vi.mock('electron', () => ({
  clipboard: {
    readText: vi.fn(() => ''),
    writeText: vi.fn(),
    readImage: vi.fn(() => ({ isEmpty: () => true, toDataURL: () => '' })),
  },
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    default: actual,
    randomUUID: vi.fn(() => 'test-uuid'),
    createHash: actual.createHash,
  };
});

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { ClipboardService } from '../src/main/services/clipboard-service';

// =============================================================================
// detectContentType (static method — zero dependencies)
// =============================================================================
describe('ClipboardService.detectContentType', () => {
  const detect = ClipboardService.detectContentType;

  // ── URLs ──
  describe('URLs', () => {
    it.each([
      'https://google.com',
      'http://example.com/path?q=1',
      'https://sub.domain.com/deep/path',
      'http://localhost:3000',
    ])('detects URL: %s', (input) => {
      expect(detect(input)).toBe('url');
    });
  });

  // ── Email ──
  describe('emails', () => {
    it.each([
      'user@example.com',
      'first.last@company.org',
      'test+tag@gmail.com',
    ])('detects email: %s', (input) => {
      expect(detect(input)).toBe('email');
    });
  });

  // ── Colors ──
  describe('colors', () => {
    it.each([
      '#fff',
      '#FF0000',
      '#aabbcc',
      '#aabbccdd',
    ])('detects hex color: %s', (input) => {
      expect(detect(input)).toBe('color');
    });

    it.each([
      'rgb(255, 0, 0)',
      'rgba(0, 128, 255, 0.5)',
    ])('detects rgb color: %s', (input) => {
      expect(detect(input)).toBe('color');
    });
  });

  // ── Phone numbers ──
  describe('phone numbers', () => {
    it.each([
      '+48 123 456 789',
      '(555) 123-4567',
      '+1-800-555-0199',
    ])('detects phone: %s', (input) => {
      expect(detect(input)).toBe('phone');
    });
  });

  // ── File paths ──
  describe('paths', () => {
    it.each([
      'C:\\Users\\test\\file.txt',
      'D:\\Program Files\\app',
    ])('detects Windows path: %s', (input) => {
      expect(detect(input)).toBe('path');
    });

    it.each([
      '/home/user/file.txt',
      '/usr/local/bin/node',
    ])('detects Unix path: %s', (input) => {
      expect(detect(input)).toBe('path');
    });
  });

  // ── JSON ──
  describe('JSON', () => {
    it.each([
      '{"key": "value"}',
      '[1, 2, 3]',
      '{"nested": {"a": 1}}',
    ])('detects JSON: %s', (input) => {
      expect(detect(input)).toBe('json');
    });

    it('invalid JSON starting with { → falls through to other checks', () => {
      // starts with { but isn't valid JSON
      const result = detect('{not really json at all}');
      expect(result).not.toBe('json');
    });
  });

  // ── HTML ──
  describe('HTML', () => {
    it.each([
      '<div class="test">Hello</div>',
      '<html><body></body></html>',
      '<p>Paragraph</p>',
      '<!DOCTYPE html>',
      '<table><tr><td>Cell</td></tr></table>',
    ])('detects HTML: %s', (input) => {
      expect(detect(input)).toBe('html');
    });
  });

  // ── Markdown ──
  describe('Markdown', () => {
    it.each([
      '# Heading',
      '## Second level',
      '- List item',
      '* Another list',
      '1. Numbered',
      '```code block```',
      '> Blockquote',
      '| Col1 | Col2 |',
    ])('detects Markdown: %s', (input) => {
      expect(detect(input)).toBe('markdown');
    });
  });

  // ── Numbers ──
  describe('numbers', () => {
    it.each([
      '42',
      '3.14',
      '-7',
      '1,000,000',
      '1e10',
      '2.5E-3',
    ])('detects number: %s', (input) => {
      expect(detect(input)).toBe('number');
    });
  });

  // ── Code ──
  describe('code', () => {
    it.each([
      'const x = 5;\nfunction test() { return x; }',
      'import React from "react";\nexport default function App() {}',
      'def main():\n    return None;\nimport sys',
      'class Foo {\n  constructor() {}\n}',
    ])('detects code: %s', (input) => {
      expect(detect(input)).toBe('code');
    });
  });

  // ── Plain text fallback ──
  describe('text fallback', () => {
    it.each([
      'Just a regular sentence.',
      'Hello world',
      'Zażółć gęślą jaźń',
    ])('detects text: %s', (input) => {
      expect(detect(input)).toBe('text');
    });
  });

  // ── Edge cases ──
  describe('edge cases', () => {
    it('empty string → unknown', () => {
      expect(detect('')).toBe('unknown');
    });

    it('whitespace only → unknown', () => {
      expect(detect('   \n\t  ')).toBe('unknown');
    });

    it('handles leading/trailing whitespace', () => {
      expect(detect('  https://google.com  ')).toBe('url');
    });
  });
});
