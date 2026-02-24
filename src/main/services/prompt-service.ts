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
import * as fsp from 'fs/promises';
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
  async load(filename: string): Promise<string> {
    // Check user override first
    const userPath = path.join(this.userDir, filename);
    const userContent = await this.readWithCache(userPath);
    if (userContent !== null) {
      return userContent;
    }

    // Fall back to bundled
    const bundledPath = path.join(this.bundledDir, filename);
    const bundledContent = await this.readWithCache(bundledPath);
    return bundledContent ?? '';
  }

  /**
   * Load a prompt with variable substitution.
   * Variables use {name} syntax.
   * 
   * Example: load('HEARTBEAT.md', { maxSteps: '20', task: 'check email' })
   */
  async render(filename: string, vars?: Record<string, string>): Promise<string> {
    let content = await this.load(filename);
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
  async exists(filename: string): Promise<boolean> {
    try {
      await fsp.access(path.join(this.userDir, filename));
      return true;
    } catch {
      try {
        await fsp.access(path.join(this.bundledDir, filename));
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * List all available prompt files (merged user + bundled).
   */
  async list(): Promise<string[]> {
    const files = new Set<string>();
    try {
      for (const f of await fsp.readdir(this.bundledDir)) {
        if (f.endsWith('.md')) files.add(f);
      }
    } catch { /* bundled dir may not exist in some setups */ }
    try {
      for (const f of await fsp.readdir(this.userDir)) {
        if (f.endsWith('.md')) files.add(f);
      }
    } catch { /* user dir may be empty */ }
    return Array.from(files).sort();
  }

  /**
   * Copy a bundled prompt to user dir for customization.
   * Returns the user-side file path.
   */
  async copyToUser(filename: string): Promise<string | null> {
    const bundledPath = path.join(this.bundledDir, filename);
    const userPath = path.join(this.userDir, filename);

    try {
      await fsp.access(userPath);
      return userPath; // Already exists
    } catch { /* does not exist, proceed to copy */ }

    try {
      const content = await fsp.readFile(bundledPath, 'utf-8');
      await fsp.writeFile(userPath, content, 'utf-8');
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

  private async readWithCache(filePath: string): Promise<string | null> {
    try {
      await fsp.access(filePath);
    } catch {
      return null;
    }

    try {
      const stat = await fsp.stat(filePath);
      const mtime = stat.mtimeMs;

      // Check cache
      if (this.cacheEnabled) {
        const cached = this.cache.get(filePath);
        if (cached && cached.mtime === mtime) {
          return cached.content;
        }
      }

      // Read and cache
      const content = await fsp.readFile(filePath, 'utf-8');
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
