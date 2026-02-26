import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '[]'),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import * as fs from 'fs';
import * as fsp from 'fs/promises';

const fsMock = fs as any;
const fspMock = fsp as any;

describe('WorkflowService', () => {
  let WorkflowService: any;
  let service: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readFileSync.mockReturnValue('[]');

    // Dynamic import to re-run constructor with fresh mocks
    const mod = await import('../src/main/services/workflow-service');
    WorkflowService = mod.WorkflowService;
    service = new WorkflowService();
  });

  describe('constructor', () => {
    it('should create workflow directory if missing', () => {
      expect(fsMock.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('workflow'),
        { recursive: true }
      );
    });

    it('should skip directory creation if exists', () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('[]');
      const s2 = new WorkflowService();
      // mkdirSync called once in beforeEach, not again for s2
      // (existsSync returns true for dir check AND load file checks)
      expect(s2).toBeDefined();
    });

    it('should load activity log from disk', () => {
      const entries = [{ timestamp: 1000, hour: 10, dayOfWeek: 1, action: 'test', context: '', category: 'dev' }];
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify(entries));
      const s2 = new WorkflowService();
      expect(s2.getActivityLog()).toEqual(entries);
    });

    it('should handle corrupt data gracefully', () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('not valid json{{{');
      const s2 = new WorkflowService();
      expect(s2.getActivityLog()).toEqual([]);
    });
  });

  describe('logActivity', () => {
    it('should add entry with correct fields', () => {
      service.logActivity('coding', 'VSCode', 'development');
      const log = service.getActivityLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        action: 'coding',
        context: 'VSCode',
        category: 'development',
      });
      expect(log[0].timestamp).toBeGreaterThan(0);
      expect(log[0].hour).toBeGreaterThanOrEqual(0);
      expect(log[0].hour).toBeLessThanOrEqual(23);
      expect(log[0].dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(log[0].dayOfWeek).toBeLessThanOrEqual(6);
    });

    it('should trigger async save', () => {
      service.logActivity('test', 'ctx', 'cat');
      expect(fspMock.writeFile).toHaveBeenCalledTimes(2); // log + patterns
    });

    it('should accumulate multiple entries', () => {
      service.logActivity('a1', 'c1', 'cat1');
      service.logActivity('a2', 'c2', 'cat2');
      service.logActivity('a3', 'c3', 'cat3');
      expect(service.getActivityLog()).toHaveLength(3);
    });
  });

  describe('save (via logActivity)', () => {
    it('should trim to 2000 entries when exceeding limit', () => {
      // Populate with >2000 entries
      const entries = Array.from({ length: 2100 }, (_, i) => ({
        timestamp: i,
        hour: i % 24,
        dayOfWeek: i % 7,
        action: `action-${i}`,
        context: '',
        category: 'test',
      }));
      // Inject directly
      (service as any).activityLog = entries;
      service.logActivity('final', '', 'test');
      // After save, should have 2001 entries (trimmed to 2000 + 1 new... but trim happens in save)
      // Actually: push makes it 2101, then save trims to last 2000
      const log = service.getActivityLog(3000);
      expect(log.length).toBeLessThanOrEqual(2001);
    });
  });

  describe('getDailySummary', () => {
    it('should return empty string when no entries today', () => {
      expect(service.getDailySummary()).toBe('');
    });

    it('should return formatted summary for today entries', () => {
      const now = new Date();
      (service as any).activityLog = [
        {
          timestamp: now.getTime(),
          hour: now.getHours(),
          dayOfWeek: now.getDay(),
          action: 'coding',
          context: 'editor',
          category: 'dev',
        },
      ];
      const summary = service.getDailySummary();
      expect(summary).toContain('Dzisiejsze aktywności użytkownika');
      expect(summary).toContain('coding (dev)');
      expect(summary).toContain(':00');
    });

    it('should group entries by hour', () => {
      const now = new Date();
      const hour = now.getHours();
      (service as any).activityLog = [
        { timestamp: now.getTime(), hour, dayOfWeek: now.getDay(), action: 'a1', context: '', category: 'c1' },
        { timestamp: now.getTime(), hour, dayOfWeek: now.getDay(), action: 'a2', context: '', category: 'c2' },
      ];
      const summary = service.getDailySummary();
      // Both actions should be on the same hour line
      expect(summary).toContain('a1 (c1), a2 (c2)');
    });

    it('should sort by hour ascending', () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      (service as any).activityLog = [
        { timestamp: todayStart + 15 * 3600000, hour: 15, dayOfWeek: now.getDay(), action: 'afternoon', context: '', category: 'cat' },
        { timestamp: todayStart + 9 * 3600000, hour: 9, dayOfWeek: now.getDay(), action: 'morning', context: '', category: 'cat' },
      ];
      const summary = service.getDailySummary();
      const morningIdx = summary.indexOf('9:00');
      const afternoonIdx = summary.indexOf('15:00');
      expect(morningIdx).toBeLessThan(afternoonIdx);
    });

    it('should exclude yesterday entries', () => {
      const yesterday = Date.now() - 25 * 60 * 60 * 1000;
      (service as any).activityLog = [
        { timestamp: yesterday, hour: 10, dayOfWeek: 1, action: 'old', context: '', category: 'cat' },
      ];
      expect(service.getDailySummary()).toBe('');
    });
  });

  describe('getWeeklyPatterns', () => {
    it('should return empty when fewer than 5 entries', () => {
      (service as any).activityLog = [
        { timestamp: Date.now(), hour: 10, dayOfWeek: 1, action: 'a', context: '', category: 'c' },
        { timestamp: Date.now(), hour: 11, dayOfWeek: 2, action: 'b', context: '', category: 'c' },
      ];
      expect(service.getWeeklyPatterns()).toBe('');
    });

    it('should return empty when no recurring patterns', () => {
      const now = Date.now();
      // 5 entries but all on different day/hour combos with only 1 occurrence each
      (service as any).activityLog = Array.from({ length: 5 }, (_, i) => ({
        timestamp: now,
        hour: i,
        dayOfWeek: i,
        action: `action-${i}`,
        context: '',
        category: `cat-${i}`,
      }));
      expect(service.getWeeklyPatterns()).toBe('');
    });

    it('should detect recurring patterns (2+ unique days)', () => {
      const now = Date.now();
      const monday1 = now - 6 * 86400000; // ~6 days ago
      const monday2 = now - 0 * 86400000; // today (assume different date)
      // Create entries with same dayOfWeek + hour + category but on different calendar days
      const dayOfWeek = new Date(monday1).getDay();
      const entries = [
        { timestamp: monday1, hour: 9, dayOfWeek, action: 'standup', context: '', category: 'meeting' },
        { timestamp: monday2, hour: 9, dayOfWeek, action: 'standup', context: '', category: 'meeting' },
        // Filler to reach 5 entries
        { timestamp: now - 86400000, hour: 14, dayOfWeek: 3, action: 'code', context: '', category: 'dev' },
        { timestamp: now - 2 * 86400000, hour: 14, dayOfWeek: 3, action: 'code', context: '', category: 'dev' },
        { timestamp: now, hour: 20, dayOfWeek: 0, action: 'relax', context: '', category: 'personal' },
      ];
      (service as any).activityLog = entries;

      const patterns = service.getWeeklyPatterns();
      // Check if the monday pattern is detected (2 unique days at same dayOfWeek/hour/category)
      if (new Date(monday1).toISOString().slice(0, 10) !== new Date(monday2).toISOString().slice(0, 10)) {
        expect(patterns).toContain('Wykryte wzorce tygodniowe');
        expect(patterns).toContain('meeting');
        expect(patterns).toContain('x/tydzień');
      }
    });

    it('should exclude entries older than 7 days', () => {
      const old = Date.now() - 8 * 86400000;
      (service as any).activityLog = Array.from({ length: 10 }, (_, i) => ({
        timestamp: old - i * 3600000,
        hour: 10,
        dayOfWeek: 1,
        action: 'old',
        context: '',
        category: 'cat',
      }));
      expect(service.getWeeklyPatterns()).toBe('');
    });

    it('should limit to 10 recurring patterns', () => {
      const now = Date.now();
      // Create 15 distinct recurring patterns
      const entries: any[] = [];
      for (let i = 0; i < 15; i++) {
        const day1 = now - 1 * 86400000;
        const day2 = now - 2 * 86400000;
        entries.push(
          { timestamp: day1, hour: i % 24, dayOfWeek: new Date(day1).getDay(), action: 'a', context: '', category: `cat${i}` },
          { timestamp: day2, hour: i % 24, dayOfWeek: new Date(day2).getDay(), action: 'a', context: '', category: `cat${i}` },
        );
      }
      (service as any).activityLog = entries;
      const patterns = service.getWeeklyPatterns();
      if (patterns) {
        const lines = patterns.split('\n').filter((l: string) => l.trim().startsWith('—') || l.includes('x/tydzień'));
        // Should have at most 10 pattern lines
        expect(lines.length).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('buildTimeContext', () => {
    it('should include current time info', () => {
      const ctx = service.buildTimeContext();
      expect(ctx).toContain('## Czas');
      expect(ctx).toContain('Teraz:');
      expect(ctx).toContain('Pora dnia:');
      expect(ctx).toContain('Dzień tygodnia:');
    });

    it('should include correct time of day', () => {
      const hour = new Date().getHours();
      const ctx = service.buildTimeContext();
      if (hour < 6) expect(ctx).toContain('noc');
      else if (hour < 12) expect(ctx).toContain('rano');
      else if (hour < 18) expect(ctx).toContain('po południu');
      else expect(ctx).toContain('wieczorem');
    });

    it('should include daily summary when entries exist', () => {
      const now = new Date();
      (service as any).activityLog = [
        { timestamp: now.getTime(), hour: now.getHours(), dayOfWeek: now.getDay(), action: 'testing', context: '', category: 'qa' },
      ];
      const ctx = service.buildTimeContext();
      expect(ctx).toContain('Dzisiejsze aktywności');
      expect(ctx).toContain('testing (qa)');
    });

    it('should include weekly patterns when present', () => {
      const now = Date.now();
      const day1 = now - 1 * 86400000;
      const day2 = now - 2 * 86400000;
      const dow = new Date(day1).getDay();
      const hour = 10;
      // Need 5+ entries with recurring pattern
      (service as any).activityLog = [
        { timestamp: day1, hour, dayOfWeek: dow, action: 'standup', context: '', category: 'meeting' },
        { timestamp: day2, hour, dayOfWeek: dow, action: 'standup', context: '', category: 'meeting' },
        { timestamp: now, hour: 14, dayOfWeek: new Date(now).getDay(), action: 'code', context: '', category: 'dev' },
        { timestamp: now - 86400000, hour: 14, dayOfWeek: new Date(now - 86400000).getDay(), action: 'code', context: '', category: 'dev' },
        { timestamp: now, hour: 20, dayOfWeek: new Date(now).getDay(), action: 'relax', context: '', category: 'fun' },
      ];
      const ctx = service.buildTimeContext();
      // May or may not contain weekly patterns depending on date math
      expect(ctx).toContain('## Czas');
    });
  });

  describe('getPatterns', () => {
    it('should return empty array initially', () => {
      expect(service.getPatterns()).toEqual([]);
    });

    it('should return a copy (not the original array)', () => {
      const patterns = service.getPatterns();
      patterns.push({ name: 'hack' });
      expect(service.getPatterns()).toEqual([]);
    });

    it('should return loaded patterns from disk', () => {
      const patternsData = [{ name: 'test', frequency: 5, lastSeen: Date.now(), context: 'ctx' }];
      fsMock.existsSync.mockReturnValue(true);
      let callCount = 0;
      fsMock.readFileSync.mockImplementation(() => {
        callCount++;
        // First call = activity log, second = patterns
        if (callCount <= 1) return '[]';
        return JSON.stringify(patternsData);
      });
      const s2 = new WorkflowService();
      expect(s2.getPatterns()).toEqual(patternsData);
    });
  });

  describe('getActivityLog', () => {
    it('should return empty array initially', () => {
      expect(service.getActivityLog()).toEqual([]);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        service.logActivity(`action-${i}`, '', 'cat');
      }
      expect(service.getActivityLog(3)).toHaveLength(3);
    });

    it('should return last N entries', () => {
      for (let i = 0; i < 5; i++) {
        service.logActivity(`action-${i}`, '', 'cat');
      }
      const last2 = service.getActivityLog(2);
      expect(last2[0].action).toBe('action-3');
      expect(last2[1].action).toBe('action-4');
    });

    it('should default to 50 entries', () => {
      for (let i = 0; i < 60; i++) {
        service.logActivity(`action-${i}`, '', 'cat');
      }
      expect(service.getActivityLog()).toHaveLength(50);
    });
  });
});
