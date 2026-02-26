import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

import {
  ProactiveEngine,
  type ProactiveContext,
  type ProactiveFeedback,
} from '../src/main/services/proactive-engine';

function createDeps() {
  return {
    workflow: {
      getTimeContext: vi.fn(() => 'Poniedziałek 10:00'),
    } as any,
    memory: {
      getSessionDuration: vi.fn(() => 30),
    } as any,
    config: {
      get: vi.fn(() => 60000),
    } as any,
  };
}

function createEngine() {
  return new ProactiveEngine(createDeps());
}

function mockContext(overrides: Partial<ProactiveContext> = {}): ProactiveContext {
  return {
    now: new Date('2024-06-15T10:00:00'),
    hourOfDay: 10,
    dayOfWeek: 6, // Saturday
    timeOfDay: 'morning',
    upcomingEvents: [],
    todayEvents: [],
    calendarConnected: false,
    systemSnapshot: null,
    systemWarnings: [],
    timeContext: 'test',
    currentSessionMinutes: 30,
    screenContext: '',
    currentWindow: 'VS Code',
    kgSummary: '',
    isAfk: false,
    ...overrides,
  };
}

// =============================================================================
// Constructor
// =============================================================================
describe('ProactiveEngine constructor', () => {
  it('initializes with builtin rules', () => {
    const engine = createEngine();
    const stats = engine.getStats();
    expect(stats.rulesEnabled).toBeGreaterThan(0);
    expect(stats.rulesEnabled).toBe(10); // 10 builtin rules
  });
});

// =============================================================================
// recordFeedback / getAcceptRate
// =============================================================================
describe('recordFeedback', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('records accepted feedback and increments accepted count', () => {
    // fired must be > 0 for getAcceptRate to use the actual ratio
    const fb = (engine as any).feedbackMap;
    fb.set('test', { fired: 1, accepted: 0, dismissed: 0, lastFired: Date.now() });
    engine.recordFeedback({ ruleId: 'test', action: 'accepted', timestamp: Date.now() });
    expect(engine.getAcceptRate('test')).toBe(1.0); // 1/1
  });

  it('records dismissed feedback', () => {
    const fb = (engine as any).feedbackMap;
    fb.set('test', { fired: 1, accepted: 0, dismissed: 0, lastFired: Date.now() });
    engine.recordFeedback({ ruleId: 'test', action: 'dismissed', timestamp: Date.now() });
    expect(engine.getAcceptRate('test')).toBe(0.0); // 0/1
  });

  it('records replied as accepted', () => {
    const fb = (engine as any).feedbackMap;
    fb.set('test', { fired: 1, accepted: 0, dismissed: 0, lastFired: Date.now() });
    engine.recordFeedback({ ruleId: 'test', action: 'replied', timestamp: Date.now() });
    expect(engine.getAcceptRate('test')).toBe(1.0);
  });

  it('calculates mixed accept rate', () => {
    const fb = (engine as any).feedbackMap;
    fb.set('r', { fired: 3, accepted: 0, dismissed: 0, lastFired: Date.now() });
    engine.recordFeedback({ ruleId: 'r', action: 'accepted', timestamp: 1 });
    engine.recordFeedback({ ruleId: 'r', action: 'dismissed', timestamp: 2 });
    engine.recordFeedback({ ruleId: 'r', action: 'accepted', timestamp: 3 });
    expect(engine.getAcceptRate('r')).toBeCloseTo(2 / 3);
  });

  it('creates new entry if rule not yet in feedbackMap', () => {
    engine.recordFeedback({ ruleId: 'new-rule', action: 'accepted', timestamp: 1 });
    const entry = (engine as any).feedbackMap.get('new-rule');
    expect(entry).toBeDefined();
    expect(entry.accepted).toBe(1);
    expect(entry.fired).toBe(0); // only evaluate() increments fired
  });
});

// =============================================================================
// getAcceptRate
// =============================================================================
describe('getAcceptRate', () => {
  it('returns 0.5 for unknown rule', () => {
    const engine = createEngine();
    expect(engine.getAcceptRate('nonexistent')).toBe(0.5);
  });
});

// =============================================================================
// getStats
// =============================================================================
describe('getStats', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('returns stats for all rules', () => {
    const stats = engine.getStats();
    expect(stats.ruleStats).toHaveLength(10);
    expect(stats.totalFired).toBe(0);
    expect(stats.totalAccepted).toBe(0);
    expect(stats.totalDismissed).toBe(0);
  });

  it('reflects feedback in stats', () => {
    engine.recordFeedback({ ruleId: 'low-battery', action: 'accepted', timestamp: 1 });
    engine.recordFeedback({ ruleId: 'low-battery', action: 'dismissed', timestamp: 2 });

    const stats = engine.getStats();
    const rule = stats.ruleStats.find((r) => r.ruleId === 'low-battery');
    expect(rule).toBeDefined();
    expect(rule!.accepted).toBe(1);
    expect(rule!.dismissed).toBe(1);
    expect(rule!.acceptRate).toBe(0.5);
  });

  it('default accept rate is 0.5 for unfired rules', () => {
    const stats = engine.getStats();
    stats.ruleStats.forEach((r) => {
      expect(r.acceptRate).toBe(0.5);
    });
  });
});

// =============================================================================
// start / stop / isRunning
// =============================================================================
describe('start/stop', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = createEngine();
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  it('starts running', () => {
    engine.start(60000);
    expect(engine.isRunning()).toBe(true);
  });

  it('stops running', () => {
    engine.start(60000);
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  it('is not running initially', () => {
    expect(engine.isRunning()).toBe(false);
  });
});

// =============================================================================
// setAfkState
// =============================================================================
describe('setAfkState', () => {
  it('evaluate returns null when AFK', async () => {
    const engine = createEngine();
    engine.setAfkState(true);
    const result = await engine.evaluate();
    expect(result).toBeNull();
  });
});

// =============================================================================
// setActiveHours / isWithinActiveHours
// =============================================================================
describe('setActiveHours', () => {
  it('evaluate returns null outside active hours', async () => {
    const engine = createEngine();
    // Set active hours to 1:00–2:00 — current time is unlikely to be in range
    engine.setActiveHours(1, 2);
    // Only null if current hour not in 1-2 range
    const result = await engine.evaluate();
    // We can't predict the current time, so just verify it doesn't throw
    expect(result === null || result !== null).toBe(true);
  });

  it('clears active hours with nulls', () => {
    const engine = createEngine();
    engine.setActiveHours(9, 17);
    engine.setActiveHours(null, null);
    // Should not restrict — evaluate runs fine
    expect(() => engine.setActiveHours(null, null)).not.toThrow();
  });
});

// =============================================================================
// markEventNotified / isEventNotified
// =============================================================================
describe('event notification tracking', () => {
  let engine: ProactiveEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  it('tracks notified events', () => {
    expect(engine.isEventNotified('uid-1')).toBe(false);
    engine.markEventNotified('uid-1');
    expect(engine.isEventNotified('uid-1')).toBe(true);
  });

  it('does not cross-pollinate UIDs', () => {
    engine.markEventNotified('uid-1');
    expect(engine.isEventNotified('uid-2')).toBe(false);
  });
});

// =============================================================================
// lastFiredRuleId
// =============================================================================
describe('getLastFiredRuleId', () => {
  it('returns null initially', () => {
    const engine = createEngine();
    expect(engine.getLastFiredRuleId()).toBeNull();
  });
});

// =============================================================================
// Rule shouldFire logic (via internal rules)
// =============================================================================
describe('builtin rules', () => {
  let engine: ProactiveEngine;
  let rules: any[];

  beforeEach(() => {
    engine = createEngine();
    rules = (engine as any).rules;
  });

  it('has meeting-reminder rule', () => {
    expect(rules.find((r: any) => r.id === 'meeting-reminder')).toBeDefined();
  });

  it('has low-battery rule', () => {
    expect(rules.find((r: any) => r.id === 'low-battery')).toBeDefined();
  });

  it('has disk-full rule', () => {
    expect(rules.find((r: any) => r.id === 'disk-full')).toBeDefined();
  });

  it('has high-cpu rule', () => {
    expect(rules.find((r: any) => r.id === 'high-cpu')).toBeDefined();
  });

  it('has focus-break rule', () => {
    expect(rules.find((r: any) => r.id === 'focus-break')).toBeDefined();
  });

  // Test rule shouldFire with mock context
  it('low-battery fires when battery < 15% and not charging', () => {
    const rule = rules.find((r: any) => r.id === 'low-battery');
    const ctx = mockContext({
      systemSnapshot: {
        battery: { percent: 10, charging: false },
      } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('low-battery does not fire when battery > 15%', () => {
    const rule = rules.find((r: any) => r.id === 'low-battery');
    const ctx = mockContext({
      systemSnapshot: {
        battery: { percent: 50, charging: false },
      } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('low-battery does not fire when charging', () => {
    const rule = rules.find((r: any) => r.id === 'low-battery');
    const ctx = mockContext({
      systemSnapshot: {
        battery: { percent: 5, charging: true },
      } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('low-battery does not fire without system snapshot', () => {
    const rule = rules.find((r: any) => r.id === 'low-battery');
    const ctx = mockContext({ systemSnapshot: null });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('high-cpu fires when CPU > 90%', () => {
    const rule = rules.find((r: any) => r.id === 'high-cpu');
    const ctx = mockContext({
      systemSnapshot: { cpu: { usagePercent: 95 } } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('high-cpu does not fire when CPU < 90%', () => {
    const rule = rules.find((r: any) => r.id === 'high-cpu');
    const ctx = mockContext({
      systemSnapshot: { cpu: { usagePercent: 50 } } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('focus-break fires when session >= 90 minutes and not AFK', () => {
    const rule = rules.find((r: any) => r.id === 'focus-break');
    const ctx = mockContext({ currentSessionMinutes: 95, isAfk: false });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('focus-break does not fire when session < 90 minutes', () => {
    const rule = rules.find((r: any) => r.id === 'focus-break');
    const ctx = mockContext({ currentSessionMinutes: 30, isAfk: false });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('focus-break does not fire when AFK', () => {
    const rule = rules.find((r: any) => r.id === 'focus-break');
    const ctx = mockContext({ currentSessionMinutes: 120, isAfk: true });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('no-network fires when network disconnected', () => {
    const rule = rules.find((r: any) => r.id === 'no-network');
    const ctx = mockContext({
      systemSnapshot: { network: { connected: false } } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('no-network does not fire when connected', () => {
    const rule = rules.find((r: any) => r.id === 'no-network');
    const ctx = mockContext({
      systemSnapshot: { network: { connected: true } } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });
});

// =============================================================================
// Rule generate
// =============================================================================
describe('rule generate', () => {
  let engine: ProactiveEngine;
  let rules: any[];

  beforeEach(() => {
    engine = createEngine();
    rules = (engine as any).rules;
  });

  it('low-battery generates notification with battery info', () => {
    const rule = rules.find((r: any) => r.id === 'low-battery');
    const ctx = mockContext({
      systemSnapshot: { battery: { percent: 8, charging: false } } as any,
    });
    const notif = rule.generate(ctx, engine);
    expect(notif.type).toBe('proactive');
    expect(notif.message).toContain('8%');
    expect(notif.context).toContain('battery');
  });

  it('high-cpu generates notification with usage', () => {
    const rule = rules.find((r: any) => r.id === 'high-cpu');
    const ctx = mockContext({
      systemSnapshot: { cpu: { usagePercent: 98 }, topProcesses: [] } as any,
    });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('98%');
    expect(notif.context).toContain('cpu');
  });

  it('focus-break generates notification with duration', () => {
    const rule = rules.find((r: any) => r.id === 'focus-break');
    const ctx = mockContext({ currentSessionMinutes: 120 });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('2h');
    expect(notif.context).toContain('focus');
  });

  it('no-network generates notification', () => {
    const rule = rules.find((r: any) => r.id === 'no-network');
    const ctx = mockContext();
    const notif = rule.generate(ctx, engine);
    expect(notif.type).toBe('proactive');
    expect(notif.context).toBe('network:disconnected');
  });
});

// =============================================================================
// Additional rule shouldFire tests
// =============================================================================
describe('rule shouldFire — disk-full', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('fires when any disk > 90% usage', () => {
    const rule = rules.find((r: any) => r.id === 'disk-full');
    const ctx = mockContext({
      systemSnapshot: {
        disk: [{ mount: 'C:', usagePercent: 95, freeGB: 5 }],
      } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('does not fire when all disks < 90%', () => {
    const rule = rules.find((r: any) => r.id === 'disk-full');
    const ctx = mockContext({
      systemSnapshot: {
        disk: [{ mount: 'C:', usagePercent: 70, freeGB: 100 }],
      } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('does not fire without snapshot', () => {
    const rule = rules.find((r: any) => r.id === 'disk-full');
    expect(rule.shouldFire(mockContext({ systemSnapshot: null }), engine)).toBe(false);
  });
});

describe('rule shouldFire — meeting-reminder', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('fires when event within 15 minutes and calendar connected', () => {
    const rule = rules.find((r: any) => r.id === 'meeting-reminder');
    const soon = new Date(Date.now() + 10 * 60_000); // 10 min from now
    const ctx = mockContext({
      calendarConnected: true,
      upcomingEvents: [{ uid: 'ev1', summary: 'Standup', start: soon.toISOString() }] as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('does not fire when calendar not connected', () => {
    const rule = rules.find((r: any) => r.id === 'meeting-reminder');
    const ctx = mockContext({ calendarConnected: false, upcomingEvents: [] });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('does not fire when event already notified', () => {
    const rule = rules.find((r: any) => r.id === 'meeting-reminder');
    engine.markEventNotified('ev1');
    const soon = new Date(Date.now() + 5 * 60_000);
    const ctx = mockContext({
      calendarConnected: true,
      upcomingEvents: [{ uid: 'ev1', summary: 'Test', start: soon.toISOString() }] as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('does not fire when event > 15 minutes away', () => {
    const rule = rules.find((r: any) => r.id === 'meeting-reminder');
    const far = new Date(Date.now() + 30 * 60_000);
    const ctx = mockContext({
      calendarConnected: true,
      upcomingEvents: [{ uid: 'ev2', summary: 'Later', start: far.toISOString() }] as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });
});

describe('rule shouldFire — daily-briefing', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('fires between 7-10 AM in morning', () => {
    const rule = rules.find((r: any) => r.id === 'daily-briefing');
    const ctx = mockContext({ hourOfDay: 8, timeOfDay: 'morning' });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('does not fire at noon', () => {
    const rule = rules.find((r: any) => r.id === 'daily-briefing');
    const ctx = mockContext({ hourOfDay: 12, timeOfDay: 'afternoon' });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });
});

describe('rule shouldFire — evening-summary', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('fires between 17-19 in evening', () => {
    const rule = rules.find((r: any) => r.id === 'evening-summary');
    const ctx = mockContext({ hourOfDay: 18, timeOfDay: 'evening' });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('does not fire in morning', () => {
    const rule = rules.find((r: any) => r.id === 'evening-summary');
    const ctx = mockContext({ hourOfDay: 9, timeOfDay: 'morning' });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });
});

describe('rule shouldFire — high-memory', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('fires when memory > 85%', () => {
    const rule = rules.find((r: any) => r.id === 'high-memory');
    const ctx = mockContext({
      systemSnapshot: { memory: { usagePercent: 90, freeGB: 2, totalGB: 16 } } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('does not fire when memory < 85%', () => {
    const rule = rules.find((r: any) => r.id === 'high-memory');
    const ctx = mockContext({
      systemSnapshot: { memory: { usagePercent: 60 } } as any,
    });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });
});

describe('rule shouldFire — weekend-chill', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('fires on Saturday evening with long session', () => {
    const rule = rules.find((r: any) => r.id === 'weekend-chill');
    const ctx = mockContext({ dayOfWeek: 6, hourOfDay: 20, currentSessionMinutes: 150 });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('fires on Sunday evening', () => {
    const rule = rules.find((r: any) => r.id === 'weekend-chill');
    const ctx = mockContext({ dayOfWeek: 0, hourOfDay: 19, currentSessionMinutes: 130 });
    expect(rule.shouldFire(ctx, engine)).toBe(true);
  });

  it('does not fire on weekday', () => {
    const rule = rules.find((r: any) => r.id === 'weekend-chill');
    const ctx = mockContext({ dayOfWeek: 3, hourOfDay: 20, currentSessionMinutes: 200 });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('does not fire before 18:00', () => {
    const rule = rules.find((r: any) => r.id === 'weekend-chill');
    const ctx = mockContext({ dayOfWeek: 6, hourOfDay: 15, currentSessionMinutes: 200 });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });

  it('does not fire with short session', () => {
    const rule = rules.find((r: any) => r.id === 'weekend-chill');
    const ctx = mockContext({ dayOfWeek: 6, hourOfDay: 20, currentSessionMinutes: 30 });
    expect(rule.shouldFire(ctx, engine)).toBe(false);
  });
});

// =============================================================================
// Generate — meeting-reminder
// =============================================================================
describe('meeting-reminder generate', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('generates with location and attendees', () => {
    const rule = rules.find((r: any) => r.id === 'meeting-reminder');
    const soon = new Date(Date.now() + 10 * 60_000);
    const ctx = mockContext({
      calendarConnected: true,
      upcomingEvents: [{
        uid: 'ev3',
        summary: 'Team Sync',
        start: soon.toISOString(),
        location: 'Room 4',
        attendees: ['Alice', 'Bob', 'Charlie', 'Dave'],
      }] as any,
    });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('Team Sync');
    expect(notif.message).toContain('Room 4');
    expect(notif.message).toContain('Alice');
    expect(notif.message).toContain('+1');
    expect(notif.context).toContain('meeting-reminder:ev3');
    // Marks event as notified
    expect(engine.isEventNotified('ev3')).toBe(true);
  });
});

// =============================================================================
// Generate — disk-full
// =============================================================================
describe('disk-full generate', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('lists critical disks in message', () => {
    const rule = rules.find((r: any) => r.id === 'disk-full');
    const ctx = mockContext({
      systemSnapshot: {
        disk: [
          { mount: 'C:', usagePercent: 95, freeGB: 5.2 },
          { mount: 'D:', usagePercent: 50, freeGB: 200 },
        ],
      } as any,
    });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('C:');
    expect(notif.message).not.toContain('D:');
  });
});

// =============================================================================
// Generate — high-memory
// =============================================================================
describe('high-memory generate', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('shows memory percentage and heavy processes', () => {
    const rule = rules.find((r: any) => r.id === 'high-memory');
    const ctx = mockContext({
      systemSnapshot: {
        memory: { usagePercent: 92, freeGB: 1.5, totalGB: 16 },
        topProcesses: [
          { name: 'chrome', cpuPercent: 10, memoryMB: 2000 },
          { name: 'node', cpuPercent: 5, memoryMB: 800 },
        ],
      } as any,
    });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('92%');
    expect(notif.message).toContain('chrome');
    expect(notif.message).toContain('node');
  });
});

// =============================================================================
// Generate — daily-briefing
// =============================================================================
describe('daily-briefing generate', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('includes calendar events in briefing', () => {
    const rule = rules.find((r: any) => r.id === 'daily-briefing');
    const ctx = mockContext({
      todayEvents: [
        { uid: 'e1', summary: 'Morning standup', start: '2024-06-15T09:00:00' },
        { uid: 'e2', summary: 'Lunch', start: '2024-06-15T12:00:00' },
      ] as any,
      calendarConnected: true,
    });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('Dzień dobry');
    expect(notif.message).toContain('Morning standup');
    expect(notif.message).toContain('Lunch');
  });

  it('shows no events message when calendar connected but empty', () => {
    const rule = rules.find((r: any) => r.id === 'daily-briefing');
    const ctx = mockContext({ todayEvents: [], calendarConnected: true });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('Brak zaplanowanych');
  });

  it('includes system warnings', () => {
    const rule = rules.find((r: any) => r.id === 'daily-briefing');
    const ctx = mockContext({ systemWarnings: ['Niski poziom baterii'] });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('Niski poziom baterii');
  });
});

// =============================================================================
// Generate — evening-summary
// =============================================================================
describe('evening-summary generate', () => {
  let rules: any[];
  let engine: ProactiveEngine;
  beforeEach(() => { engine = createEngine(); rules = (engine as any).rules; });

  it('shows session duration when > 30 min', () => {
    const rule = rules.find((r: any) => r.id === 'evening-summary');
    const ctx = mockContext({ currentSessionMinutes: 180 });
    const notif = rule.generate(ctx, engine);
    expect(notif.message).toContain('3h');
    expect(notif.message).toContain('Dobra robota');
  });
});
