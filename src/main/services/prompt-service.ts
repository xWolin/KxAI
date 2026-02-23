/**
 * PromptService — Markdown-based prompt management
 * 
 * Inspired by OpenClaw's pattern:
 * - Prompts live as .md files (bundled defaults + user-customizable overrides)
 * - Each section is a separate file, loaded on demand
 * - Variable substitution via {variableName} placeholders
 * - User can override any prompt by placing a file in workspace/prompts/
 * 
 * File resolution order:
 * 1. userData/workspace/prompts/<file>  (user override)
 * 2. src/main/prompts/<file>            (bundled default)
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export class PromptService {
  private cache = new Map<string, { content: string; mtime: number }>();
  private bundledDir: string;
  private userDir: string;
  private cacheEnabled = true;

  constructor() {
    // Bundled prompts — shipped with the app
    if (app.isPackaged) {
      // In packaged build, extraResources puts prompts/ next to app.asar
      this.bundledDir = path.join(process.resourcesPath, 'prompts');
    } else {
      // Dev mode: resolve from project root → src/main/prompts/
      this.bundledDir = path.join(app.getAppPath(), 'src', 'main', 'prompts');
    }

    // User-customizable prompts — in workspace
    this.userDir = path.join(app.getPath('userData'), 'workspace', 'prompts');
    this.ensureUserDir();
  }

  private ensureUserDir(): void {
    try {
      if (!fs.existsSync(this.userDir)) {
        fs.mkdirSync(this.userDir, { recursive: true });
      }
    } catch (err) {
      console.warn('[PromptService] Failed to create user prompts dir:', err);
    }
  }

  /**
   * Load a prompt file by name (e.g., 'AGENTS.md', 'HEARTBEAT.md').
   * User overrides take priority over bundled defaults.
   * Returns empty string if file doesn't exist.
   */
  load(filename: string): string {
    // Check user override first
    const userPath = path.join(this.userDir, filename);
    const userContent = this.readWithCache(userPath);
    if (userContent !== null) {
      return userContent;
    }

    // Fall back to bundled
    const bundledPath = path.join(this.bundledDir, filename);
    const bundledContent = this.readWithCache(bundledPath);
    return bundledContent ?? '';
  }

  /**
   * Load a prompt with variable substitution.
   * Variables use {name} syntax.
   * 
   * Example: load('HEARTBEAT.md', { maxSteps: '20', task: 'check email' })
   */
  render(filename: string, vars?: Record<string, string>): string {
    let content = this.load(filename);
    if (vars) {
      for (const [key, value] of Object.entries(vars)) {
        content = content.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
    }
    return content;
  }

  /**
   * Check if a prompt file exists (either user or bundled).
   */
  exists(filename: string): boolean {
    return fs.existsSync(path.join(this.userDir, filename))
      || fs.existsSync(path.join(this.bundledDir, filename));
  }

  /**
   * List all available prompt files (merged user + bundled).
   */
  list(): string[] {
    const files = new Set<string>();
    try {
      for (const f of fs.readdirSync(this.bundledDir)) {
        if (f.endsWith('.md')) files.add(f);
      }
    } catch { /* bundled dir may not exist in some setups */ }
    try {
      for (const f of fs.readdirSync(this.userDir)) {
        if (f.endsWith('.md')) files.add(f);
      }
    } catch { /* user dir may be empty */ }
    return Array.from(files).sort();
  }

  /**
   * Copy a bundled prompt to user dir for customization.
   * Returns the user-side file path.
   */
  copyToUser(filename: string): string | null {
    const bundledPath = path.join(this.bundledDir, filename);
    const userPath = path.join(this.userDir, filename);

    if (fs.existsSync(userPath)) {
      return userPath; // Already exists
    }

    try {
      const content = fs.readFileSync(bundledPath, 'utf-8');
      fs.writeFileSync(userPath, content, 'utf-8');
      return userPath;
    } catch (err) {
      console.error(`[PromptService] Failed to copy ${filename} to user dir:`, err);
      return null;
    }
  }

  /**
   * Get the user prompts directory path.
   */
  getUserDir(): string {
    return this.userDir;
  }

  /**
   * Invalidate cache (call after file changes).
   */
  invalidateCache(filename?: string): void {
    if (filename) {
      // Remove specific file from cache
      for (const key of this.cache.keys()) {
        if (key.endsWith(filename)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  // ─── Private ───

  private readWithCache(filePath: string): string | null {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const stat = fs.statSync(filePath);
      const mtime = stat.mtimeMs;

      // Check cache
      if (this.cacheEnabled) {
        const cached = this.cache.get(filePath);
        if (cached && cached.mtime === mtime) {
          return cached.content;
        }
      }

      // Read and cache
      const content = fs.readFileSync(filePath, 'utf-8');
      if (this.cacheEnabled) {
        this.cache.set(filePath, { content, mtime });
      }
      return content;
    } catch (err) {
      console.error(`[PromptService] Failed to read ${filePath}:`, err);
      return null;
    }
  }
}
