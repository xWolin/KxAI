import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ───
vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { CortexEngine } from '../src/main/services/cortex-engine';
import { CORTEX_TIER_PRESETS } from '../src/shared/types/cortex';

// ─── Helpers ───

function createDeps() {
  return {
    ai: {
      sendMessage: vi.fn().mockResolvedValue('CORTEX_OK'),
    } as any,
    memory: {
      get: vi.fn().mockResolvedValue(''),
      getSessionDuration: vi.fn().mockReturnValue(0),
    } as any,
    workflow: {
      buildTimeContext: vi.fn().mockReturnValue('Poniedziałek 10:00'),
      getWeeklyPatterns: vi.fn().mockReturnValue(''),
      getDailySummary: vi.fn().mockReturnValue(''),
      getActivityLog: vi.fn().mockReturnValue([]),
      getActivityStats: vi.fn().mockReturnValue({ totalEvents: 0, categories: {} }),
      logWindowChange: vi.fn(),
      logActivity: vi.fn(),
      addPattern: vi.fn(),
    } as any,
    cron: {
      getJobs: vi.fn().mockReturnValue([]),
      getSummary: vi.fn().mockReturnValue(''),
    } as any,
    tools: {
      execute: vi.fn().mockResolvedValue({ success: true, data: 'done' }),
      getTools: vi.fn().mockReturnValue([]),
    } as any,
    promptService: {
      load: vi.fn().mockResolvedValue('Test prompt'),
    } as any,
    responseProcessor: {
      postProcess: vi.fn().mockResolvedValue({ memoryUpdatesApplied: 0, autoApprovedCron: 0 }),
    } as any,
    config: {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'cortexIntensity') return 'balanced';
        return undefined;
      }),
      on: vi.fn(),
    } as any,
    securityGuard: {
      assessRisk: vi.fn().mockReturnValue({ requiresApproval: false }),
      approveModerateToolForSession: vi.fn(),
    } as any,
  };
}

// =============================================================================
// Constructor
// =============================================================================
describe('CortexEngine constructor', () => {
  it('initializes with 10 builtin proactive rules', () => {
    const engine = new CortexEngine(createDeps());
    const status = engine.getStatus();
    expect(status.ruleStats.rulesEnabled).toBe(10);
  });

  it('starts in disabled state', () => {
    const engine = new CortexEngine(createDeps());
    expect(engine.isEnabled()).toBe(false);
  });

  it('starts with no pending actions', () => {
    const engine = new CortexEngine(createDeps());
    expect(engine.getPendingActions()).toHaveLength(0);
  });
});

// =============================================================================
// start / stop / isEnabled
// =============================================================================
describe('start / stop / isEnabled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets enabled=true after start()', () => {
    const engine = new CortexEngine(createDeps());
    engine.start();
    expect(engine.isEnabled()).toBe(true);
    engine.stop();
  });

  it('sets enabled=false after stop()', () => {
    const engine = new CortexEngine(createDeps());
    engine.start();
    engine.stop();
    expect(engine.isEnabled()).toBe(false);
  });

  it('calling start() twice stops previous timers before restarting', () => {
    const engine = new CortexEngine(createDeps());
    engine.start();
    engine.start(); // Should not throw
    expect(engine.isEnabled()).toBe(true);
    engine.stop();
  });

  it('stop() sets enabled=false and clears timers', () => {
    const engine = new CortexEngine(createDeps());
    engine.start();
    expect(engine.isEnabled()).toBe(true);
    expect((engine as any).thinkTimer).not.toBeNull();

    engine.stop();

    expect(engine.isEnabled()).toBe(false);
    expect((engine as any).thinkTimer).toBeNull();
    expect((engine as any).ruleCheckTimer).toBeNull();
  });

  it('reads cortexIntensity from config on start()', () => {
    const deps = createDeps();
    deps.config.get.mockImplementation((key: string) => {
      if (key === 'cortexIntensity') return 'eco';
      return undefined;
    });
    const engine = new CortexEngine(deps);
    engine.start();

    const status = engine.getStatus();
    expect(status.intensity).toBe('eco');
    engine.stop();
  });

  it('reads active hours from config on start()', () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);
    engine.start();

    // start() reads cortexActiveHoursStart and cortexActiveHoursEnd from config
    expect(deps.config.get).toHaveBeenCalledWith('cortexActiveHoursStart');
    expect(deps.config.get).toHaveBeenCalledWith('cortexActiveHoursEnd');
    engine.stop();
  });
});

// =============================================================================
// setIntensity
// =============================================================================
describe('setIntensity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('changes intensity on stopped engine', () => {
    const engine = new CortexEngine(createDeps());
    // Engine not running — setIntensity just updates internal state without restarting
    engine.setIntensity('eco');
    expect((engine as any).intensity).toBe('eco');
    expect((engine as any).tierConfig).toBe(CORTEX_TIER_PRESETS.eco);
  });

  it('no-op when setting same intensity', () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);
    engine.start();

    const startCallCount = deps.config.on.mock.calls.length;
    engine.setIntensity('balanced'); // balanced is already the default
    expect(deps.config.on.mock.calls.length).toBe(startCallCount); // no restart

    engine.stop();
  });

  it('restarts when running with new intensity', () => {
    const engine = new CortexEngine(createDeps());
    engine.start();
    engine.setIntensity('eco');

    // Engine should still be enabled after intensity change
    expect(engine.isEnabled()).toBe(true);
    engine.stop();
  });

  it('does not restart when engine is stopped', () => {
    const engine = new CortexEngine(createDeps());
    engine.setIntensity('eco'); // engine not running
    expect(engine.isEnabled()).toBe(false);
  });
});

// =============================================================================
// setAfkState
// =============================================================================
describe('setAfkState', () => {
  it('fires onAfkChanged(true) when user goes AFK', () => {
    const engine = new CortexEngine(createDeps());
    const cb = vi.fn();
    engine.setAfkCallback(cb);

    engine.setAfkState(true);
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('fires onAfkChanged(false) when user returns from AFK', () => {
    const engine = new CortexEngine(createDeps());
    const cb = vi.fn();
    engine.setAfkCallback(cb);

    engine.setAfkState(true);
    engine.setAfkState(false);

    expect(cb).toHaveBeenCalledWith(false);
  });

  it('no-op when setting same AFK state', () => {
    const engine = new CortexEngine(createDeps());
    const cb = vi.fn();
    engine.setAfkCallback(cb);

    engine.setAfkState(false); // already false
    expect(cb).not.toHaveBeenCalled();
  });

  it('queues welcome-back event when returning from AFK', () => {
    const engine = new CortexEngine(createDeps());
    engine.setAfkState(true);

    const eventsBefore = engine.getStatus().pendingEvents;
    engine.setAfkState(false);

    expect(engine.getStatus().pendingEvents).toBe(eventsBefore + 1);
  });

  it('reflects AFK state in getStatus()', () => {
    const engine = new CortexEngine(createDeps());
    expect(engine.getStatus().isAfk).toBe(false);

    engine.setAfkState(true);
    expect(engine.getStatus().isAfk).toBe(true);

    engine.setAfkState(false);
    expect(engine.getStatus().isAfk).toBe(false);
  });
});

// =============================================================================
// pushEvent
// =============================================================================
describe('pushEvent', () => {
  it('adds event to queue', () => {
    const engine = new CortexEngine(createDeps());
    engine.pushEvent('test-source', 'Test event');

    expect(engine.getStatus().pendingEvents).toBe(1);
  });

  it('caps queue at MAX_EVENTS (20)', () => {
    const engine = new CortexEngine(createDeps());

    for (let i = 0; i < 25; i++) {
      engine.pushEvent('test', `Event ${i}`, 'normal');
    }

    expect(engine.getStatus().pendingEvents).toBe(20);
  });

  it('drops lowest priority when queue is full', () => {
    const engine = new CortexEngine(createDeps());

    // Fill with low priority events
    for (let i = 0; i < 20; i++) {
      engine.pushEvent('test', `Low ${i}`, 'low');
    }

    // Add a critical event — should replace a low one
    engine.pushEvent('test', 'Critical event', 'critical');

    // Queue stays at 20
    expect(engine.getStatus().pendingEvents).toBe(20);
  });
});

// =============================================================================
// recordFeedback / getAcceptRate
// =============================================================================
describe('recordFeedback / getAcceptRate', () => {
  let engine: CortexEngine;

  beforeEach(() => {
    engine = new CortexEngine(createDeps());
  });

  it('returns 0.5 when no feedback data exists', () => {
    expect(engine.getAcceptRate('unknown-rule')).toBe(0.5);
  });

  it('returns 0.5 when fired=0', () => {
    (engine as any).feedbackMap.set('test', { fired: 0, accepted: 0, dismissed: 0, lastFired: null });
    expect(engine.getAcceptRate('test')).toBe(0.5);
  });

  it('records accepted feedback → accept rate 1.0', () => {
    (engine as any).feedbackMap.set('test', { fired: 1, accepted: 0, dismissed: 0, lastFired: Date.now() });
    engine.recordFeedback({ ruleId: 'test', action: 'accepted', timestamp: Date.now() });
    expect(engine.getAcceptRate('test')).toBe(1.0);
  });

  it('records dismissed feedback → accept rate 0.0', () => {
    (engine as any).feedbackMap.set('test', { fired: 1, accepted: 0, dismissed: 0, lastFired: Date.now() });
    engine.recordFeedback({ ruleId: 'test', action: 'dismissed', timestamp: Date.now() });
    expect(engine.getAcceptRate('test')).toBe(0.0);
  });

  it('counts replied as accepted', () => {
    (engine as any).feedbackMap.set('test', { fired: 1, accepted: 0, dismissed: 0, lastFired: Date.now() });
    engine.recordFeedback({ ruleId: 'test', action: 'replied', timestamp: Date.now() });
    expect(engine.getAcceptRate('test')).toBe(1.0);
  });

  it('calculates mixed accept rate', () => {
    (engine as any).feedbackMap.set('test', { fired: 4, accepted: 3, dismissed: 1, lastFired: Date.now() });
    engine.recordFeedback({ ruleId: 'test', action: 'dismissed', timestamp: Date.now() });
    // After: accepted=3, dismissed=2 → 3/5 = 0.6
    expect(engine.getAcceptRate('test')).toBeCloseTo(0.6);
  });

  it('returns 0.5 for new rule with accepted but fired=0', () => {
    // recordFeedback creates entry with fired=0; getAcceptRate returns 0.5 when fired=0
    engine.recordFeedback({ ruleId: 'new-rule', action: 'accepted', timestamp: Date.now() });
    expect(engine.getAcceptRate('new-rule')).toBe(0.5);
  });
});

// =============================================================================
// getStatus
// =============================================================================
describe('getStatus', () => {
  it('returns correct structure on fresh engine', () => {
    const engine = new CortexEngine(createDeps());
    const status = engine.getStatus();

    expect(status).toMatchObject({
      enabled: false,
      intensity: 'balanced',
      screenMode: 'active',
      activeHours: null,
      isAfk: false,
      lastThinkAt: 0,
      lastReflectionAt: 0,
      totalThinkCycles: 0,
      totalReflections: 0,
      pendingEvents: 0,
    });
  });

  it('returns ruleStats with all required fields', () => {
    const engine = new CortexEngine(createDeps());
    const { ruleStats } = engine.getStatus();

    expect(ruleStats).toHaveProperty('totalFired');
    expect(ruleStats).toHaveProperty('totalAccepted');
    expect(ruleStats).toHaveProperty('totalDismissed');
    expect(ruleStats).toHaveProperty('rulesEnabled');
    expect(ruleStats).toHaveProperty('ruleDetails');
    expect(Array.isArray(ruleStats.ruleDetails)).toBe(true);
  });

  it('reflects enabled state correctly', () => {
    vi.useFakeTimers();
    const engine = new CortexEngine(createDeps());
    engine.start();
    expect(engine.getStatus().enabled).toBe(true);
    engine.stop();
    expect(engine.getStatus().enabled).toBe(false);
    vi.useRealTimers();
  });

  it('formats activeHours from config', () => {
    const deps = createDeps();
    deps.config.get.mockImplementation((key: string) => {
      if (key === 'cortexIntensity') return 'balanced';
      if (key === 'cortexActiveHoursStart') return '09:00';
      if (key === 'cortexActiveHoursEnd') return '18:00';
      return undefined;
    });

    vi.useFakeTimers();
    const engine = new CortexEngine(deps);
    engine.start();

    const status = engine.getStatus();
    expect(status.activeHours).toEqual({ start: '9:00', end: '18:00' });
    engine.stop();
    vi.useRealTimers();
  });
});

// =============================================================================
// handleActionResponse
// =============================================================================
describe('handleActionResponse', () => {
  it('resolves pending action with approval result', () => {
    const engine = new CortexEngine(createDeps());
    const resolve = vi.fn();
    const requestId = 'req_test_123';

    (engine as any).pendingActions.set(requestId, {
      request: { requestId, toolName: 'shell_exec', params: {}, risk: 'dangerous', reason: 'test', timestamp: Date.now() },
      resolve,
    });

    engine.handleActionResponse({ requestId, approved: true });

    expect(resolve).toHaveBeenCalledWith({ requestId, approved: true });
    expect(engine.getPendingActions()).toHaveLength(0);
  });

  it('no-op when requestId does not exist', () => {
    const engine = new CortexEngine(createDeps());
    // Should not throw
    expect(() => engine.handleActionResponse({ requestId: 'ghost', approved: false })).not.toThrow();
  });

  it('calls approveModerateToolForSession when approved with moderate risk', () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);
    const resolve = vi.fn();
    const requestId = 'req_moderate';

    (engine as any).pendingActions.set(requestId, {
      request: { requestId, toolName: 'file_write', params: {}, risk: 'moderate', reason: 'test', timestamp: Date.now() },
      resolve,
    });

    engine.handleActionResponse({ requestId, approved: true });

    expect(deps.securityGuard.approveModerateToolForSession).toHaveBeenCalledWith('file_write');
  });

  it('does not call approveModerateToolForSession when denied', () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);
    const resolve = vi.fn();
    const requestId = 'req_denied';

    (engine as any).pendingActions.set(requestId, {
      request: { requestId, toolName: 'file_write', params: {}, risk: 'moderate', reason: 'test', timestamp: Date.now() },
      resolve,
    });

    engine.handleActionResponse({ requestId, approved: false });

    expect(deps.securityGuard.approveModerateToolForSession).not.toHaveBeenCalled();
  });

  it('removes pending action from map after response', () => {
    const engine = new CortexEngine(createDeps());
    const resolve = vi.fn();
    const requestId = 'req_cleanup';

    (engine as any).pendingActions.set(requestId, {
      request: { requestId, toolName: 'test', params: {}, risk: 'moderate', reason: 'test', timestamp: Date.now() },
      resolve,
    });

    expect(engine.getPendingActions()).toHaveLength(1);
    engine.handleActionResponse({ requestId, approved: true });
    expect(engine.getPendingActions()).toHaveLength(0);
  });
});

// =============================================================================
// getPendingActions
// =============================================================================
describe('getPendingActions', () => {
  it('returns empty array by default', () => {
    const engine = new CortexEngine(createDeps());
    expect(engine.getPendingActions()).toEqual([]);
  });

  it('returns all pending action requests', () => {
    const engine = new CortexEngine(createDeps());
    const req1 = { requestId: 'r1', toolName: 'shell', params: {}, risk: 'dangerous' as const, reason: 't', timestamp: 1 };
    const req2 = { requestId: 'r2', toolName: 'file', params: {}, risk: 'moderate' as const, reason: 't', timestamp: 2 };

    (engine as any).pendingActions.set('r1', { request: req1, resolve: vi.fn() });
    (engine as any).pendingActions.set('r2', { request: req2, resolve: vi.fn() });

    const pending = engine.getPendingActions();
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.requestId)).toContain('r1');
    expect(pending.map((p) => p.requestId)).toContain('r2');
  });
});

// =============================================================================
// markEventNotified / isEventNotified
// =============================================================================
describe('markEventNotified / isEventNotified', () => {
  it('returns false for unknown event UID', () => {
    const engine = new CortexEngine(createDeps());
    expect(engine.isEventNotified('meeting-123')).toBe(false);
  });

  it('returns true after marking event', () => {
    const engine = new CortexEngine(createDeps());
    engine.markEventNotified('meeting-123');
    expect(engine.isEventNotified('meeting-123')).toBe(true);
  });

  it('notifiedEventUids is cleared on start()', () => {
    vi.useFakeTimers();
    const engine = new CortexEngine(createDeps());
    engine.markEventNotified('old-meeting');

    engine.start();
    expect(engine.isEventNotified('old-meeting')).toBe(false);
    engine.stop();
    vi.useRealTimers();
  });
});

// =============================================================================
// requestActionApproval — auto-deny/approve when no UI callback
// =============================================================================
describe('requestActionApproval (no UI callback)', () => {
  it('auto-denies dangerous actions when no callback registered', async () => {
    const engine = new CortexEngine(createDeps());

    const result = await (engine as any).requestActionApproval('shell_exec', {}, 'dangerous', 'test');
    expect(result.approved).toBe(false);
  });

  it('auto-approves moderate actions when no callback registered', async () => {
    const engine = new CortexEngine(createDeps());

    const result = await (engine as any).requestActionApproval('file_read', {}, 'moderate', 'test');
    expect(result.approved).toBe(true);
  });
});

// =============================================================================
// triggerReflection — skips when isProcessingCheck returns true
// =============================================================================
describe('triggerReflection', () => {
  it('skips reflection when agent is processing user message', async () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);
    engine.setProcessingCheck(() => true);

    await engine.triggerReflection('manual');
    // ai.sendMessage should NOT be called since reflection is skipped
    expect(deps.ai.sendMessage).not.toHaveBeenCalled();
  });
});
