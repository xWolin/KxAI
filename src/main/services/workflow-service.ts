import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

// Re-export from shared types (canonical source)
export type { ActivityEntry, WorkflowPattern } from '../../shared/types/workflow';
import type { ActivityEntry, WorkflowPattern } from '../../shared/types/workflow';

export class WorkflowService {
  private activityLog: ActivityEntry[] = [];
  private patterns: WorkflowPattern[] = [];
  private logPath: string;
  private patternsPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    const workflowDir = path.join(userDataPath, 'workspace', 'workflow');
    if (!fs.existsSync(workflowDir)) {
      fs.mkdirSync(workflowDir, { recursive: true });
    }
    this.logPath = path.join(workflowDir, 'activity-log.json');
    this.patternsPath = path.join(workflowDir, 'patterns.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.logPath)) {
        this.activityLog = JSON.parse(fs.readFileSync(this.logPath, 'utf8'));
      }
      if (fs.existsSync(this.patternsPath)) {
        this.patterns = JSON.parse(fs.readFileSync(this.patternsPath, 'utf8'));
      }
    } catch { /* ignore corrupt data */ }
  }

  private save(): void {
    // Keep last 2000 entries
    if (this.activityLog.length > 2000) {
      this.activityLog = this.activityLog.slice(-2000);
    }
    // Fire-and-forget async writes — activity logging should not block event loop
    fsp.writeFile(this.logPath, JSON.stringify(this.activityLog, null, 2), 'utf8').catch(() => {});
    fsp.writeFile(this.patternsPath, JSON.stringify(this.patterns, null, 2), 'utf8').catch(() => {});
  }

  /**
   * Log a user activity (called from screen analysis, chat interactions, etc.)
   */
  logActivity(action: string, context: string, category: string): void {
    const now = new Date();
    this.activityLog.push({
      timestamp: now.getTime(),
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
      action,
      context,
      category,
    });
    this.save();
  }

  /**
   * Get activity summary for the AI to understand user's daily patterns.
   */
  getDailySummary(): string {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const today = this.activityLog.filter((a) => a.timestamp >= todayStart);

    if (today.length === 0) return '';

    const byHour: Record<number, string[]> = {};
    for (const a of today) {
      if (!byHour[a.hour]) byHour[a.hour] = [];
      byHour[a.hour].push(`${a.action} (${a.category})`);
    }

    const lines = Object.entries(byHour)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([hour, actions]) => `  ${hour}:00 — ${actions.join(', ')}`);

    return `## Dzisiejsze aktywności użytkownika\n${lines.join('\n')}`;
  }

  /**
   * Get weekly pattern summary for AI context.
   */
  getWeeklyPatterns(): string {
    const days = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recent = this.activityLog.filter((a) => a.timestamp >= weekAgo);

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
   * Build time-aware context for the AI system prompt.
   */
  buildTimeContext(): string {
    const now = new Date();
    const days = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
    const timeOfDay = now.getHours() < 6 ? 'noc' :
      now.getHours() < 12 ? 'rano' :
      now.getHours() < 18 ? 'po południu' : 'wieczorem';

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

  getPatterns(): WorkflowPattern[] {
    return [...this.patterns];
  }

  getActivityLog(limit: number = 50): ActivityEntry[] {
    return this.activityLog.slice(-limit);
  }
}
