import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from './logger';

// Re-export from shared types (canonical source)
export type { ActivityEntry, ActivityStats, WorkflowPattern } from '../../shared/types/workflow';
import type { ActivityEntry, ActivityStats, WorkflowPattern } from '../../shared/types/workflow';

import type { DatabaseService } from './database-service';

const log = createLogger('WorkflowService');

// ─── Process name → category mapping ───
const PROCESS_CATEGORY_MAP: Record<string, string> = {
  // Coding
  code: 'coding',
  'code.exe': 'coding',
  'code - insiders': 'coding',
  'visual studio': 'coding',
  devenv: 'coding',
  'devenv.exe': 'coding',
  webstorm: 'coding',
  intellij: 'coding',
  pycharm: 'coding',
  rider: 'coding',
  sublime_text: 'coding',
  notepad: 'coding',
  'notepad++': 'coding',
  vim: 'coding',
  nvim: 'coding',
  cursor: 'coding',
  'cursor.exe': 'coding',
  zed: 'coding',
  // Terminal
  'windows terminal': 'terminal',
  'windowsterminal.exe': 'terminal',
  cmd: 'terminal',
  'cmd.exe': 'terminal',
  powershell: 'terminal',
  'powershell.exe': 'terminal',
  'pwsh.exe': 'terminal',
  terminal: 'terminal',
  iterm2: 'terminal',
  hyper: 'terminal',
  warp: 'terminal',
  alacritty: 'terminal',
  kitty: 'terminal',
  // Communication
  teams: 'communication',
  'teams.exe': 'communication',
  slack: 'communication',
  discord: 'communication',
  'discord.exe': 'communication',
  zoom: 'communication',
  'zoom.exe': 'communication',
  skype: 'communication',
  thunderbird: 'communication',
  outlook: 'communication',
  'outlook.exe': 'communication',
  telegram: 'communication',
  // Browsing
  chrome: 'browsing',
  'chrome.exe': 'browsing',
  firefox: 'browsing',
  'firefox.exe': 'browsing',
  edge: 'browsing',
  'msedge.exe': 'browsing',
  brave: 'browsing',
  'brave.exe': 'browsing',
  opera: 'browsing',
  safari: 'browsing',
  vivaldi: 'browsing',
  arc: 'browsing',
  // Documents
  word: 'documents',
  'winword.exe': 'documents',
  excel: 'documents',
  'excel.exe': 'documents',
  powerpoint: 'documents',
  'powerpnt.exe': 'documents',
  onenote: 'documents',
  libreoffice: 'documents',
  'soffice.exe': 'documents',
  notion: 'documents',
  obsidian: 'documents',
  'obsidian.exe': 'documents',
  typora: 'documents',
  // Design
  figma: 'design',
  'figma.exe': 'design',
  photoshop: 'design',
  illustrator: 'design',
  gimp: 'design',
  inkscape: 'design',
  canva: 'design',
  // Media
  spotify: 'media',
  'spotify.exe': 'media',
  vlc: 'media',
  'vlc.exe': 'media',
  // File management
  explorer: 'files',
  'explorer.exe': 'files',
  finder: 'files',
};

/** Categorize a process by its name (case-insensitive lookup) */
function categorizeProcess(processName: string): string {
  if (!processName) return 'general';
  const lower = processName.toLowerCase().replace(/\.exe$/, '');
  // Direct match first
  if (PROCESS_CATEGORY_MAP[lower]) return PROCESS_CATEGORY_MAP[lower];
  if (PROCESS_CATEGORY_MAP[processName.toLowerCase()]) return PROCESS_CATEGORY_MAP[processName.toLowerCase()];
  // Partial match
  for (const [key, cat] of Object.entries(PROCESS_CATEGORY_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return cat;
  }
  return 'general';
}

export class WorkflowService {
  private activityLog: ActivityEntry[] = [];
  private patterns: WorkflowPattern[] = [];
  private logPath: string;
  private patternsPath: string;
  private db: DatabaseService | null = null;
  private dbReady = false;

  // For duration tracking on window changes
  private lastWindowEntry: { processName: string; windowTitle: string; timestamp: number } | null = null;

  constructor() {
    const userDataPath = app.getPath('userData');
    const workflowDir = path.join(userDataPath, 'workspace', 'workflow');
    this.logPath = path.join(workflowDir, 'activity-log.json');
    this.patternsPath = path.join(workflowDir, 'patterns.json');
    // Fire-and-forget async initialization (dir creation + data loading)
    this.initAsync(workflowDir).catch(() => {});
  }

  /**
   * Set the DatabaseService dependency (called after DI wiring).
   * Triggers migration of legacy JSON data to SQLite.
   */
  setDatabase(database: DatabaseService): void {
    this.db = database;
    this.dbReady = true;
    // Migrate legacy JSON data if needed
    this.migrateLegacyData().catch((err) => log.warn('Legacy activity migration skipped:', err));
  }

  private async initAsync(workflowDir: string): Promise<void> {
    try {
      await fsp.access(workflowDir);
    } catch {
      await fsp.mkdir(workflowDir, { recursive: true });
    }
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      try {
        await fsp.access(this.logPath);
        this.activityLog = JSON.parse(await fsp.readFile(this.logPath, 'utf8'));
      } catch {
        /* file doesn't exist or corrupt */
      }
      try {
        await fsp.access(this.patternsPath);
        this.patterns = JSON.parse(await fsp.readFile(this.patternsPath, 'utf8'));
      } catch {
        /* file doesn't exist or corrupt */
      }
    } catch {
      /* ignore corrupt data */
    }
  }

  /**
   * Migrate legacy activity-log.json into SQLite (one-time).
   */
  private async migrateLegacyData(): Promise<void> {
    if (!this.db) return;
    const migratedPath = this.logPath + '.migrated';
    try {
      await fsp.access(this.logPath);
      // Check it hasn't already been migrated
      try {
        await fsp.access(migratedPath);
        return; // Already migrated
      } catch {
        /* not migrated yet */
      }
      if (this.activityLog.length > 0) {
        log.info(`Migrating ${this.activityLog.length} legacy activity entries to SQLite...`);
        this.db.insertActivitiesBatch(this.activityLog);
        await fsp.rename(this.logPath, migratedPath);
        log.info('Legacy activity migration complete');
      }
    } catch {
      /* no legacy file — nothing to migrate */
    }
  }

  private save(): void {
    // If DB is ready, patterns go to patterns.json (patterns still file-based)
    // Activity log goes to SQLite — no more JSON save for activities
    fsp.writeFile(this.patternsPath, JSON.stringify(this.patterns, null, 2), 'utf8').catch(() => {});
  }

  /**
   * Log a user activity — now persists to SQLite.
   */
  logActivity(action: string, context: string, category: string): void {
    const now = new Date();
    const entry: ActivityEntry = {
      timestamp: now.getTime(),
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
      action,
      context,
      category,
    };

    if (this.dbReady && this.db) {
      this.db.insertActivity(entry);
    } else {
      // Fallback: in-memory (before DB init)
      this.activityLog.push(entry);
      if (this.activityLog.length > 2000) {
        this.activityLog = this.activityLog.slice(-2000);
      }
    }
  }

  /**
   * Log a window change event from ScreenMonitor T0.
   * Calculates duration for the previous window and auto-categorizes by process.
   */
  logWindowChange(info: { title: string; processName: string; timestamp?: number }): void {
    const now = Date.now();
    const ts = info.timestamp ?? now;
    const category = categorizeProcess(info.processName);
    const action = `window:${info.processName || 'unknown'}`;

    // If same window as last — skip (deduplicate rapid T0 ticks)
    if (
      this.lastWindowEntry &&
      this.lastWindowEntry.processName === info.processName &&
      this.lastWindowEntry.windowTitle === info.title
    ) {
      return;
    }

    const entry: ActivityEntry = {
      timestamp: ts,
      hour: new Date(ts).getHours(),
      dayOfWeek: new Date(ts).getDay(),
      action,
      context: info.title,
      category,
      processName: info.processName,
      windowTitle: info.title,
    };

    if (this.dbReady && this.db) {
      this.db.insertActivity(entry);
    } else {
      this.activityLog.push(entry);
    }

    this.lastWindowEntry = { processName: info.processName, windowTitle: info.title, timestamp: ts };
  }

  /**
   * Get activity summary for the AI to understand user's daily patterns.
   * Uses SQLite when available, falls back to in-memory.
   */
  getDailySummary(): string {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let today: ActivityEntry[];
    if (this.dbReady && this.db) {
      today = this.db.getActivities(todayStart, 500);
    } else {
      today = this.activityLog.filter((a) => a.timestamp >= todayStart);
    }

    if (today.length === 0) return '';

    const byHour: Record<number, string[]> = {};
    for (const a of today) {
      if (!byHour[a.hour]) byHour[a.hour] = [];
      const label = a.processName ? `${a.processName} (${a.category})` : `${a.action} (${a.category})`;
      byHour[a.hour].push(label);
    }

    const lines = Object.entries(byHour)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([hour, actions]) => {
        // Deduplicate within same hour
        const unique = [...new Set(actions)];
        return `  ${hour}:00 — ${unique.slice(0, 8).join(', ')}`;
      });

    return `## Dzisiejsze aktywności użytkownika\n${lines.join('\n')}`;
  }

  /**
   * Get weekly pattern summary for AI context.
   */
  getWeeklyPatterns(): string {
    const days = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    let recent: ActivityEntry[];
    if (this.dbReady && this.db) {
      recent = this.db.getActivities(weekAgo, 5000);
    } else {
      recent = this.activityLog.filter((a) => a.timestamp >= weekAgo);
    }

    if (recent.length < 5) return '';

    // Analyze patterns per day of week and hour — count UNIQUE DAYS, not entries
    const dayHourDays: Record<string, Set<string>> = {};
    for (const a of recent) {
      const key = `${a.dayOfWeek}-${a.hour}-${a.category}`;
      if (!dayHourDays[key]) dayHourDays[key] = new Set();
      // Use date string to count unique calendar days
      const dateStr = new Date(a.timestamp).toISOString().slice(0, 10);
      dayHourDays[key].add(dateStr);
    }

    // Find recurring patterns (seen on 2+ unique days at same day/hour)
    const recurring = Object.entries(dayHourDays)
      .filter(([, days_set]) => days_set.size >= 2)
      .sort(([, a], [, b]) => b.size - a.size)
      .slice(0, 10)
      .map(([key, days_set]) => {
        const [dow, hour, cat] = key.split('-');
        return `  ${days[parseInt(dow)]} ~${hour}:00 — ${cat} (${days_set.size}x/tydzień)`;
      });

    if (recurring.length === 0) return '';
    return `## Wykryte wzorce tygodniowe\n${recurring.join('\n')}`;
  }

  /**
   * Get aggregated activity statistics for the last N hours.
   */
  getActivityStats(hours: number): ActivityStats {
    const sinceMs = Date.now() - hours * 60 * 60 * 1000;
    if (this.dbReady && this.db) {
      return this.db.getActivityStats(sinceMs);
    }
    // Fallback: compute from in-memory
    const recent = this.activityLog.filter((a) => a.timestamp >= sinceMs);
    const appMap = new Map<string, { totalMs: number; switches: number }>();
    const catMap = new Map<string, number>();
    for (const a of recent) {
      const proc = a.processName || a.action || 'unknown';
      const existing = appMap.get(proc) || { totalMs: 0, switches: 0 };
      existing.switches++;
      existing.totalMs += a.durationMs ?? 0;
      appMap.set(proc, existing);
      catMap.set(a.category, (catMap.get(a.category) ?? 0) + (a.durationMs ?? 0));
    }
    return {
      topApps: [...appMap.entries()]
        .map(([processName, v]) => ({ processName, totalMs: v.totalMs, switches: v.switches }))
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 10),
      topCategories: [...catMap.entries()]
        .map(([category, totalMs]) => ({ category, totalMs }))
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 10),
      totalSwitches: recent.length,
      totalTrackedMs: recent.reduce((sum, a) => sum + (a.durationMs ?? 0), 0),
      since: sinceMs,
    };
  }

  /**
   * Build time-aware context for the AI system prompt.
   */
  buildTimeContext(): string {
    const now = new Date();
    const days = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
    const timeOfDay =
      now.getHours() < 6 ? 'noc' : now.getHours() < 12 ? 'rano' : now.getHours() < 18 ? 'po południu' : 'wieczorem';

    let ctx = `## Czas\n`;
    ctx += `- Teraz: ${now.toLocaleDateString('pl-PL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}\n`;
    ctx += `- Pora dnia: ${timeOfDay}\n`;
    ctx += `- Dzień tygodnia: ${days[now.getDay()]}\n\n`;

    const daily = this.getDailySummary();
    if (daily) ctx += daily + '\n\n';

    const weekly = this.getWeeklyPatterns();
    if (weekly) ctx += weekly + '\n';

    return ctx;
  }

  /**
   * Add a new pattern (called from CortexEngine after AI identifies one).
   */
  addPattern(pattern: WorkflowPattern): void {
    // Deduplicate by description
    const existing = this.patterns.findIndex((p) => p.description === pattern.description);
    if (existing >= 0) {
      this.patterns[existing] = { ...this.patterns[existing], ...pattern, lastSeen: Date.now() };
    } else {
      this.patterns.push(pattern);
    }
    this.save();
    log.info(`Pattern ${existing >= 0 ? 'updated' : 'added'}: ${pattern.description}`);
  }

  getPatterns(): WorkflowPattern[] {
    return [...this.patterns];
  }

  getActivityLog(limit: number = 50): ActivityEntry[] {
    if (this.dbReady && this.db) {
      const sinceMs = Date.now() - 24 * 60 * 60 * 1000; // Last 24h
      return this.db.getActivities(sinceMs, limit);
    }
    return this.activityLog.slice(-limit);
  }
}
