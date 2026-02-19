import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';

export interface CronJob {
  id: string;
  name: string;
  /** Cron expression (5-field: min hour dom month dow) or interval keyword */
  schedule: string;
  /** What the agent should do */
  action: string;
  /** Whether the agent created this itself vs user-created */
  autoCreated: boolean;
  enabled: boolean;
  /** Category: routine, workflow, reminder, cleanup, health-check */
  category: 'routine' | 'workflow' | 'reminder' | 'cleanup' | 'health-check' | 'custom';
  createdAt: number;
  lastRun?: number;
  lastResult?: string;
  runCount: number;
}

export interface CronExecution {
  jobId: string;
  timestamp: number;
  result: string;
  success: boolean;
}

export class CronService {
  private jobsPath: string;
  private historyPath: string;
  private jobs: CronJob[] = [];
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private onExecute?: (job: CronJob) => Promise<string>;

  constructor() {
    const userDataPath = app.getPath('userData');
    const cronDir = path.join(userDataPath, 'workspace', 'cron');
    if (!fs.existsSync(cronDir)) {
      fs.mkdirSync(cronDir, { recursive: true });
    }
    this.jobsPath = path.join(cronDir, 'jobs.json');
    this.historyPath = path.join(cronDir, 'history.json');
    this.loadJobs();
  }

  setExecutor(executor: (job: CronJob) => Promise<string>): void {
    this.onExecute = executor;
  }

  private loadJobs(): void {
    try {
      if (fs.existsSync(this.jobsPath)) {
        this.jobs = JSON.parse(fs.readFileSync(this.jobsPath, 'utf8'));
      }
    } catch {
      this.jobs = [];
    }
  }

  private saveJobs(): void {
    // Atomic write: write to temp file then rename
    const tmpPath = this.jobsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.jobs, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.jobsPath);
  }

  private saveExecution(exec: CronExecution): void {
    let history: CronExecution[] = [];
    try {
      if (fs.existsSync(this.historyPath)) {
        history = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      }
    } catch { /* ignore */ }
    history.push(exec);
    // Keep last 500 executions
    if (history.length > 500) history = history.slice(-500);
    // Atomic write
    const tmpPath = this.historyPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(history, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.historyPath);
  }

  // ─── CRUD ───

  addJob(job: Omit<CronJob, 'id' | 'createdAt' | 'runCount'>): CronJob {
    const newJob: CronJob = {
      ...job,
      id: uuidv4(),
      createdAt: Date.now(),
      runCount: 0,
    };
    this.jobs.push(newJob);
    this.saveJobs();
    if (newJob.enabled) this.scheduleJob(newJob);
    return newJob;
  }

  updateJob(id: string, updates: Partial<CronJob>): CronJob | null {
    const idx = this.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    this.jobs[idx] = { ...this.jobs[idx], ...updates };
    this.saveJobs();
    // Reschedule
    this.unscheduleJob(id);
    if (this.jobs[idx].enabled) this.scheduleJob(this.jobs[idx]);
    return this.jobs[idx];
  }

  removeJob(id: string): boolean {
    this.unscheduleJob(id);
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.saveJobs();
    return this.jobs.length < before;
  }

  getJobs(): CronJob[] {
    return [...this.jobs];
  }

  getJob(id: string): CronJob | null {
    return this.jobs.find((j) => j.id === id) || null;
  }

  getHistory(jobId?: string): CronExecution[] {
    try {
      if (fs.existsSync(this.historyPath)) {
        const history: CronExecution[] = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
        return jobId ? history.filter((h) => h.jobId === jobId) : history;
      }
    } catch { /* ignore */ }
    return [];
  }

  // ─── Scheduling ───

  startAll(): void {
    for (const job of this.jobs) {
      if (job.enabled) this.scheduleJob(job);
    }
  }

  stopAll(): void {
    for (const [id] of this.timers) {
      this.unscheduleJob(id);
    }
  }

  private scheduleJob(job: CronJob): void {
    this.unscheduleJob(job.id);
    const intervalMs = this.parseScheduleToMs(job.schedule);
    if (intervalMs <= 0) return;

    // Calculate initial delay to align with schedule
    const now = new Date();
    let initialDelay = intervalMs;

    // For minute-based schedules, align to next minute boundary
    if (intervalMs >= 60000) {
      const msIntoMinute = now.getSeconds() * 1000 + now.getMilliseconds();
      initialDelay = intervalMs - (msIntoMinute % intervalMs);
    }

    const timer = setTimeout(() => {
      this.executeJob(job);
      // Set up recurring interval
      const recurring = setInterval(() => this.executeJob(job), intervalMs);
      this.timers.set(job.id, recurring);
    }, initialDelay);

    this.timers.set(job.id, timer);
  }

  private unscheduleJob(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  private async executeJob(job: CronJob): Promise<void> {
    if (!this.onExecute) return;

    try {
      const result = await this.onExecute(job);
      job.lastRun = Date.now();
      job.lastResult = result.slice(0, 500);
      job.runCount++;
      this.saveJobs();
      this.saveExecution({
        jobId: job.id,
        timestamp: Date.now(),
        result: result.slice(0, 1000),
        success: true,
      });
    } catch (error: any) {
      job.lastRun = Date.now();
      job.lastResult = `Error: ${error.message}`;
      this.saveJobs();
      this.saveExecution({
        jobId: job.id,
        timestamp: Date.now(),
        result: `Error: ${error.message}`,
        success: false,
      });
    }
  }

  /**
   * Parse schedule string to interval in milliseconds.
   * Supports: "30s", "5m", "1h", "30m", or simple cron-like "every X minutes"
   */
  private parseScheduleToMs(schedule: string): number {
    // Simple duration: "30s", "5m", "1h", "2h30m"
    const durationMatch = schedule.match(/^(\d+)(s|m|h)$/i);
    if (durationMatch) {
      const val = parseInt(durationMatch[1]);
      switch (durationMatch[2].toLowerCase()) {
        case 's': return val * 1000;
        case 'm': return val * 60 * 1000;
        case 'h': return val * 60 * 60 * 1000;
      }
    }

    // "every X minutes/hours"
    const everyMatch = schedule.match(/^every\s+(\d+)\s*(min|minute|minutes|hour|hours|h|m|s|sec|seconds?)$/i);
    if (everyMatch) {
      const val = parseInt(everyMatch[1]);
      const unit = everyMatch[2].toLowerCase();
      if (unit.startsWith('min') || unit === 'm') return val * 60 * 1000;
      if (unit.startsWith('hour') || unit === 'h') return val * 60 * 60 * 1000;
      if (unit.startsWith('sec') || unit === 's') return val * 1000;
    }

    // Simple cron expression (5-field) — parse to approximate interval
    const cronParts = schedule.split(/\s+/);
    if (cronParts.length === 5) {
      return this.parseCronToMs(cronParts);
    }

    // Default: 30 minutes
    console.warn(`CronService: Nie udało się sparsować schedule "${schedule}", używam fallback: 30 minut`);
    return 30 * 60 * 1000;
  }

  private parseCronToMs(parts: string[]): number {
    const [min, hour] = parts;

    // "*/N * * * *" = every N minutes
    if (min.startsWith('*/')) {
      return parseInt(min.slice(2)) * 60 * 1000;
    }

    // "0 */N * * *" = every N hours
    if (min === '0' && hour.startsWith('*/')) {
      return parseInt(hour.slice(2)) * 60 * 60 * 1000;
    }

    // Specific time = once per day (24h interval)
    return 24 * 60 * 60 * 1000;
  }
}
