/**
 * Lazy shiki highlighter for syntax highlighting in code blocks.
 * Loads asynchronously on import — falls back to plain text if not ready.
 */
import { createHighlighter, type Highlighter } from 'shiki';

let instance: Highlighter | null = null;
let loading: Promise<void> | null = null;

const THEME = 'tokyo-night';

const LANGS = [
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'python',
  'css',
  'scss',
  'html',
  'json',
  'bash',
  'shellscript',
  'markdown',
  'sql',
  'yaml',
  'xml',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'php',
  'ruby',
  'swift',
  'kotlin',
  'dockerfile',
  'toml',
  'diff',
  'powershell',
  'lua',
  'ini',
];

/** Initialize the highlighter (idempotent, returns same promise). */
export function initHighlighter(): Promise<void> {
  if (!loading) {
    loading = createHighlighter({ themes: [THEME], langs: LANGS })
      .then((hl) => {
        instance = hl;
      })
      .catch((err) => {
        console.warn('[Highlighter] Init failed:', err);
        loading = null;
      });
  }
  return loading;
}

/** Get the highlighter instance (null if not yet loaded). */
export function getHighlighter(): Highlighter | null {
  return instance;
}

/** Highlight code, returns HTML string or null if not ready/unsupported lang. */
export function highlightCode(code: string, lang: string): string | null {
  if (!instance) return null;
  try {
    return instance.codeToHtml(code, { lang, theme: THEME });
  } catch {
    return null;
  }
}

// Start loading immediately on import
initHighlighter();
