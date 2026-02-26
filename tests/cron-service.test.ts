import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
const mockUserDataPath = '/mock/userData';
let mockFiles: Record<string, string> = {};

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mockUserDataPath),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((p: string) => p in mockFiles),
    readFileSync: vi.fn((p: string) => {
      if (p in mockFiles) return mockFiles[p];
      throw new Error(`ENOENT: ${p}`);
    }),
    writeFileSync: vi.fn((p: string, data: string) => { mockFiles[p] = data; }),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn((p: string) => p in mockFiles),
  readFileSync: vi.fn((p: string) => {
    if (p in mockFiles) return mockFiles[p];
    throw new Error(`ENOENT: ${p}`);
  }),
  writeFileSync: vi.fn((p: string, data: string) => { mockFiles[p] = data; }),
  mkdirSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn(async (p: string, data: string) => { mockFiles[p] = data; }),
    readFile: vi.fn(async (p: string) => {
      if (p in mockFiles) return mockFiles[p];
      throw new Error(`ENOENT: ${p}`);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      if (from in mockFiles) {
        mockFiles[to] = mockFiles[from];
        delete mockFiles[from];
      }
    }),
  },
  writeFile: vi.fn(async (p: string, data: string) => { mockFiles[p] = data; }),
  readFile: vi.fn(async (p: string) => {
    if (p in mockFiles) return mockFiles[p];
    throw new Error(`ENOENT: ${p}`);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    if (from in mockFiles) {
      mockFiles[to] = mockFiles[from];
      delete mockFiles[from];
    }
  }),
}));

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `test-uuid-${++uuidCounter}`),
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import * as path from 'path';
import { CronService } from '../src/main/services/cron-service';
import type { CronJob } from '../src/shared/types/cron';

describe('CronService', () => {
  beforeEach(() => {
    mockFiles = {};
    uuidCounter = 0;
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createService(): CronService {
    return new CronService();
  }

  // =============================================================================
  // parseScheduleToMs (private)
  // =============================================================================
  describe('parseScheduleToMs', () => {
    let svc: CronService;
    let parseMs: (s: string) => number;

    beforeEach(() => {
      svc = createService();
      parseMs = (svc as any).parseScheduleToMs.bind(svc);
    });

    it.each([
      ['30s', 30_000],
      ['1s', 1_000],
      ['60s', 60_000],
    ])('parses seconds: "%s" → %d ms', (input, expected) => {
      expect(parseMs(input)).toBe(expected);
    });

    it.each([
      ['5m', 300_000],
      ['1m', 60_000],
      ['30m', 1_800_000],
    ])('parses minutes: "%s" → %d ms', (input, expected) => {
      expect(parseMs(input)).toBe(expected);
    });

    it.each([
      ['1h', 3_600_000],
      ['2h', 7_200_000],
      ['24h', 86_400_000],
    ])('parses hours: "%s" → %d ms', (input, expected) => {
      expect(parseMs(input)).toBe(expected);
    });

    it.each([
      ['every 5 minutes', 300_000],
      ['every 1 minute', 60_000],
      ['every 2 hours', 7_200_000],
      ['every 30 seconds', 30_000],
    ])('parses English: "%s" → %d ms', (input, expected) => {
      expect(parseMs(input)).toBe(expected);
    });

    // Cron expressions
    it('parses cron */5 * * * * → 5 minutes', () => {
      expect(parseMs('*/5 * * * *')).toBe(300_000);
    });

    it('parses cron 0 */2 * * * → 2 hours', () => {
      expect(parseMs('0 */2 * * *')).toBe(7_200_000);
    });

    it('parses specific cron time as 24h interval', () => {
      expect(parseMs('30 9 * * *')).toBe(86_400_000);
    });

    it('falls back to 30m for unparseable schedule', () => {
      expect(parseMs('gibberish')).toBe(1_800_000);
    });
  });

  // =============================================================================
  // parseCronToMs (private)
  // =============================================================================
  describe('parseCronToMs', () => {
    let svc: CronService;
    let parseCron: (parts: string[]) => number;

    beforeEach(() => {
      svc = createService();
      parseCron = (svc as any).parseCronToMs.bind(svc);
    });

    it('*/10 * * * * → 10 minutes', () => {
      expect(parseCron(['*/10', '*', '*', '*', '*'])).toBe(600_000);
    });

    it('0 */3 * * * → 3 hours', () => {
      expect(parseCron(['0', '*/3', '*', '*', '*'])).toBe(10_800_000);
    });

    it('fixed time → 24 hours', () => {
      expect(parseCron(['0', '9', '*', '*', '*'])).toBe(86_400_000);
    });
  });

  // =============================================================================
  // CRUD operations
  // =============================================================================
  describe('CRUD', () => {
    it('addJob creates a job with id, createdAt, runCount', () => {
      const svc = createService();
      const job = svc.addJob({
        name: 'Test Job',
        schedule: '5m',
        task: 'Say hello',
        enabled: false,
      });
      expect(job.id).toBe('test-uuid-1');
      expect(job.name).toBe('Test Job');
      expect(job.schedule).toBe('5m');
      expect(job.createdAt).toBeGreaterThan(0);
      expect(job.runCount).toBe(0);
    });

    it('getJobs returns all added jobs', () => {
      const svc = createService();
      svc.addJob({ name: 'J1', schedule: '1m', task: 'Task 1', enabled: false });
      svc.addJob({ name: 'J2', schedule: '2m', task: 'Task 2', enabled: false });
      const jobs = svc.getJobs();
      expect(jobs).toHaveLength(2);
    });

    it('getJob returns specific job', () => {
      const svc = createService();
      const added = svc.addJob({ name: 'Specific', schedule: '1m', task: 'T', enabled: false });
      const found = svc.getJob(added.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Specific');
    });

    it('getJob returns null for unknown id', () => {
      const svc = createService();
      expect(svc.getJob('nonexistent')).toBeNull();
    });

    it('updateJob modifies existing job', () => {
      const svc = createService();
      const job = svc.addJob({ name: 'Original', schedule: '1m', task: 'T', enabled: false });
      const updated = svc.updateJob(job.id, { name: 'Updated' });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated');
      expect(svc.getJob(job.id)!.name).toBe('Updated');
    });

    it('updateJob returns null for unknown id', () => {
      const svc = createService();
      expect(svc.updateJob('nonexistent', { name: 'X' })).toBeNull();
    });

    it('removeJob deletes job', () => {
      const svc = createService();
      const job = svc.addJob({ name: 'ToRemove', schedule: '1m', task: 'T', enabled: false });
      expect(svc.removeJob(job.id)).toBe(true);
      expect(svc.getJob(job.id)).toBeNull();
      expect(svc.getJobs()).toHaveLength(0);
    });

    it('removeJob returns false for unknown id', () => {
      const svc = createService();
      expect(svc.removeJob('nonexistent')).toBe(false);
    });

    it('getJobs returns a copy (not reference)', () => {
      const svc = createService();
      svc.addJob({ name: 'J1', schedule: '1m', task: 'T', enabled: false });
      const jobs1 = svc.getJobs();
      const jobs2 = svc.getJobs();
      expect(jobs1).not.toBe(jobs2);
      expect(jobs1).toEqual(jobs2);
    });
  });

  // =============================================================================
  // Scheduling
  // =============================================================================
  describe('scheduling', () => {
    it('startAll + stopAll does not throw', () => {
      const svc = createService();
      svc.addJob({ name: 'S1', schedule: '5m', task: 'T', enabled: true });
      expect(() => svc.startAll()).not.toThrow();
      expect(() => svc.stopAll()).not.toThrow();
    });

    it('addJob with enabled=true creates timer', () => {
      const svc = createService();
      svc.addJob({ name: 'Enabled', schedule: '10m', task: 'T', enabled: true });
      // Timer should be in the internal map
      expect((svc as any).timers.size).toBe(1);
    });

    it('addJob with enabled=false does not create timer', () => {
      const svc = createService();
      svc.addJob({ name: 'Disabled', schedule: '10m', task: 'T', enabled: false });
      expect((svc as any).timers.size).toBe(0);
    });

    it('removeJob clears timer', () => {
      const svc = createService();
      const job = svc.addJob({ name: 'TimerJob', schedule: '5m', task: 'T', enabled: true });
      expect((svc as any).timers.size).toBe(1);
      svc.removeJob(job.id);
      expect((svc as any).timers.size).toBe(0);
    });

    it('updateJob re-schedules enabled job', () => {
      const svc = createService();
      const job = svc.addJob({ name: 'Reschedule', schedule: '5m', task: 'T', enabled: true });
      svc.updateJob(job.id, { schedule: '10m' });
      // Timer should still exist (rescheduled)
      expect((svc as any).timers.size).toBe(1);
    });
  });

  // =============================================================================
  // setExecutor + executeJob
  // =============================================================================
  describe('executor', () => {
    it('executeJob calls the executor', async () => {
      const svc = createService();
      const executor = vi.fn(async () => 'executed!');
      svc.setExecutor(executor);

      const job = svc.addJob({ name: 'ExecTest', schedule: '5m', task: 'Do work', enabled: false });
      await (svc as any).executeJob(job);

      expect(executor).toHaveBeenCalledWith(job);
    });

    it('executeJob increments runCount', async () => {
      const svc = createService();
      svc.setExecutor(async () => 'ok');

      const job = svc.addJob({ name: 'Counter', schedule: '5m', task: 'Count', enabled: false });
      expect(job.runCount).toBe(0);

      await (svc as any).executeJob(job);
      expect(job.runCount).toBe(1);

      await (svc as any).executeJob(job);
      expect(job.runCount).toBe(2);
    });

    it('executeJob handles executor errors gracefully', async () => {
      const svc = createService();
      svc.setExecutor(async () => { throw new Error('Executor failed'); });

      const job = svc.addJob({ name: 'ErrorJob', schedule: '5m', task: 'Fail', enabled: false });
      await expect((svc as any).executeJob(job)).resolves.not.toThrow();
      expect(job.lastResult).toContain('Error');
    });

    it('oneShot job disables after execution', async () => {
      const svc = createService();
      svc.setExecutor(async () => 'done');

      const job = svc.addJob({
        name: 'OneShot',
        schedule: '5m',
        task: 'Once',
        enabled: true,
        oneShot: true,
      });
      expect(job.enabled).toBe(true);

      await (svc as any).executeJob(job);
      expect(job.enabled).toBe(false);
    });

    it('executeJob without executor is a no-op', async () => {
      const svc = createService();
      const job = svc.addJob({ name: 'NoExec', schedule: '5m', task: 'T', enabled: false });
      await expect((svc as any).executeJob(job)).resolves.not.toThrow();
      expect(job.runCount).toBe(0);
    });
  });

  // =============================================================================
  // History
  // =============================================================================
  describe('history', () => {
    it('getHistory returns empty array when no history', async () => {
      const svc = createService();
      const history = await svc.getHistory();
      expect(history).toEqual([]);
    });

    it('getHistory returns executions after executeJob', async () => {
      const svc = createService();
      svc.setExecutor(async () => 'result');
      const job = svc.addJob({ name: 'HistJob', schedule: '5m', task: 'T', enabled: false });

      await (svc as any).executeJob(job);

      const history = await svc.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].jobId).toBe(job.id);
      expect(history[0].success).toBe(true);
    });

    it('getHistory filters by jobId', async () => {
      const svc = createService();
      svc.setExecutor(async () => 'ok');
      const job1 = svc.addJob({ name: 'H1', schedule: '5m', task: 'T', enabled: false });
      const job2 = svc.addJob({ name: 'H2', schedule: '5m', task: 'T', enabled: false });

      await (svc as any).executeJob(job1);
      await (svc as any).executeJob(job2);
      await (svc as any).executeJob(job1);

      const all = await svc.getHistory();
      expect(all).toHaveLength(3);

      const filtered = await svc.getHistory(job1.id);
      expect(filtered).toHaveLength(2);
      expect(filtered.every((h) => h.jobId === job1.id)).toBe(true);
    });
  });

  // =============================================================================
  // loadJobs from file
  // =============================================================================
  describe('persistence', () => {
    it('loads jobs from file on construction', () => {
      const cronDir = `${mockUserDataPath}/workspace/cron`;
      const jobsPath = path.join(cronDir, 'jobs.json');
      const existingJobs: Partial<CronJob>[] = [
        { id: 'persisted-1', name: 'Persisted', schedule: '5m', task: 'T', enabled: false },
      ];
      mockFiles[jobsPath] = JSON.stringify(existingJobs);
      // Mark all parent paths as existing for existsSync
      mockFiles[cronDir] = '';
      mockFiles[cronDir + '/'] = '';

      const svc = createService();
      const jobs = svc.getJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].name).toBe('Persisted');
    });
  });
});
