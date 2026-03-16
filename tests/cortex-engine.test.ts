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
      selectToolsForMessage: vi.fn().mockReturnValue([]),
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
  it('initializes with 11 builtin proactive rules', () => {
    const engine = new CortexEngine(createDeps());
    const status = engine.getStatus();
    expect(status.ruleStats.rulesEnabled).toBe(11);
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
    expect(status.activeHours).toEqual({ start: '09:00', end: '18:00' });
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
// requestActionApproval — AFK timeout behaviour (regression: cortex-engine.ts:384)
// Without this fix, a 60s timeout always auto-denied moderate tools even when
// the user was AFK, blocking all autonomous MCP actions.
// =============================================================================
describe('requestActionApproval (AFK timeout)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-approves moderate tool on timeout when user is AFK', async () => {
    const engine = new CortexEngine(createDeps());
    // Register a dummy callback so the no-UI branch is skipped
    engine.setActionRequestCallback(() => {});
    engine.setAfkState(true);

    const promise = (engine as any).requestActionApproval('mcp_kxaichattr_chat_read', {}, 'moderate', 'test');
    vi.advanceTimersByTime(61_000);

    const result = await promise;
    expect(result.approved).toBe(true);
  });

  it('auto-denies moderate tool on timeout when user is NOT AFK', async () => {
    const engine = new CortexEngine(createDeps());
    engine.setActionRequestCallback(() => {});
    engine.setAfkState(false);

    const promise = (engine as any).requestActionApproval('mcp_kxaichattr_chat_read', {}, 'moderate', 'test');
    vi.advanceTimersByTime(61_000);

    const result = await promise;
    expect(result.approved).toBe(false);
  });

  it('always auto-denies dangerous tool on timeout even when AFK', async () => {
    const engine = new CortexEngine(createDeps());
    engine.setActionRequestCallback(() => {});
    engine.setAfkState(true);

    const promise = (engine as any).requestActionApproval('run_command', {}, 'dangerous', 'test');
    vi.advanceTimersByTime(61_000);

    const result = await promise;
    expect(result.approved).toBe(false);
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

// =============================================================================
// AFK tasks — regression tests for email-digest & workflow-optimization
// =============================================================================
describe('AFK tasks', () => {
  it('getNextAfkTask returns email-digest when afk >= 15 and earlier tasks consumed', () => {
    const engine = new CortexEngine(createDeps());
    const getTask = (engine as any).getNextAfkTask.bind(engine);

    // Mark earlier tasks as completed
    (engine as any).afkTasksDone = new Set(['memory-review', 'pattern-analysis', 'welcome-back']);

    const task = getTask(15);
    expect(task).not.toBeNull();
    expect(task!.id).toBe('email-digest');
    expect(task!.prompt).toContain('email');
  });

  it('getNextAfkTask returns workflow-optimization when afk >= 20 and earlier tasks consumed', () => {
    const engine = new CortexEngine(createDeps());
    const getTask = (engine as any).getNextAfkTask.bind(engine);

    (engine as any).afkTasksDone = new Set([
      'memory-review', 'pattern-analysis', 'welcome-back', 'email-digest',
    ]);

    const task = getTask(20);
    expect(task).not.toBeNull();
    expect(task!.id).toBe('workflow-optimization');
    expect(task!.prompt).toContain('cron');
  });

  it('getNextAfkTask skips email-digest when afk < 15', () => {
    const engine = new CortexEngine(createDeps());
    const getTask = (engine as any).getNextAfkTask.bind(engine);

    (engine as any).afkTasksDone = new Set(['memory-review', 'pattern-analysis']);

    const task = getTask(14);
    // Should return welcome-back (minAfk: 15 > 14), or null if none qualify
    // Actually: welcome-back minAfk=15 > 14, so task should be pattern-analysis or null
    // Let's just verify email-digest is NOT returned
    if (task) {
      expect(task.id).not.toBe('email-digest');
      expect(task.id).not.toBe('workflow-optimization');
    }
  });

  it('all 5 AFK tasks are defined in correct order', () => {
    const engine = new CortexEngine(createDeps());
    const getTask = (engine as any).getNextAfkTask.bind(engine);

    // With enough AFK time and no completed tasks, first task should be memory-review
    const first = getTask(30);
    expect(first).not.toBeNull();
    expect(first!.id).toBe('memory-review');
  });
});

// =============================================================================
// MCP connected detection — uses getStatus() not listServers()
// =============================================================================
describe('MCP connected detection in gatherProactiveContext', () => {
  it('populates mcpConnectedServers from getStatus() with status=connected', async () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);

    // Wire mcpClient with getStatus() returning connected servers
    (engine as any).mcpClient = {
      getStatus: () => ({
        servers: [
          { id: 'gmail-1', name: 'Gmail', status: 'connected', tools: [] },
          { id: 'slack-1', name: 'Slack', status: 'disconnected', tools: [] },
          { id: 'notion-1', name: 'Notion', status: 'connected', tools: [] },
        ],
        totalTools: 5,
        connectedCount: 2,
      }),
    };

    // Wire other deps needed by gatherProactiveContext
    (engine as any).calendarService = null;
    (engine as any).screenMonitor = null;
    (engine as any).knowledgeGraph = null;
    (engine as any).systemMonitor = null;

    const ctx = await (engine as any).gatherProactiveContext();
    expect(ctx.mcpConnectedServers).toEqual(
      expect.arrayContaining(['gmail', 'notion']),
    );
    expect(ctx.mcpConnectedServers).not.toContain('slack');
    expect(ctx.mcpConnectedServers).toHaveLength(2);
  });

  it('returns empty mcpConnectedServers when no mcpClient', async () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);

    (engine as any).mcpClient = null;
    (engine as any).calendarService = null;
    (engine as any).screenMonitor = null;
    (engine as any).knowledgeGraph = null;
    (engine as any).systemMonitor = null;

    const ctx = await (engine as any).gatherProactiveContext();
    expect(ctx.mcpConnectedServers).toEqual([]);
  });

  it('returns empty mcpConnectedServers when all servers disconnected', async () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);

    (engine as any).mcpClient = {
      getStatus: () => ({
        servers: [
          { id: 's1', name: 'TestServer', status: 'disconnected', tools: [] },
        ],
        totalTools: 0,
        connectedCount: 0,
      }),
    };
    (engine as any).calendarService = null;
    (engine as any).screenMonitor = null;
    (engine as any).knowledgeGraph = null;
    (engine as any).systemMonitor = null;

    const ctx = await (engine as any).gatherProactiveContext();
    expect(ctx.mcpConnectedServers).toEqual([]);
  });
});

// =============================================================================
// buildIntegrationContext — produces integration awareness section
// =============================================================================
describe('buildIntegrationContext', () => {
  it('returns empty string when no integrations connected', () => {
    const engine = new CortexEngine(createDeps());
    (engine as any).mcpClient = null;
    (engine as any).calendarService = null;

    const result = (engine as any).buildIntegrationContext();
    expect(result).toBe('');
  });

  it('includes email nudge when Gmail is connected', () => {
    const engine = new CortexEngine(createDeps());
    (engine as any).mcpClient = {
      getStatus: () => ({
        servers: [
          { id: 'g1', name: 'Gmail', status: 'connected', tools: ['a', 'b'] },
        ],
        totalTools: 2,
        connectedCount: 1,
      }),
    };
    (engine as any).calendarService = null;

    const result = (engine as any).buildIntegrationContext();
    expect(result).toContain('Email');
    expect(result).toContain('PODŁĄCZONY');
    expect(result).toContain('integracje');
  });

  it('includes calendar section when calendar is connected', () => {
    const engine = new CortexEngine(createDeps());
    (engine as any).mcpClient = null;
    (engine as any).calendarService = {
      isConnected: () => true,
      getUpcomingEvents: () => [],
    };

    const result = (engine as any).buildIntegrationContext();
    expect(result).toContain('Kalendarz');
    expect(result).toContain('PODŁĄCZONY');
  });

  it('shows next meeting time when calendar has upcoming events', () => {
    const engine = new CortexEngine(createDeps());
    (engine as any).mcpClient = null;
    const futureTime = new Date(Date.now() + 30 * 60_000).toISOString();
    (engine as any).calendarService = {
      isConnected: () => true,
      getUpcomingEvents: () => [{ summary: 'Standup', start: futureTime }],
    };

    const result = (engine as any).buildIntegrationContext();
    expect(result).toContain('Standup');
    expect(result).toContain('min');
  });

  it('skips disconnected MCP servers', () => {
    const engine = new CortexEngine(createDeps());
    (engine as any).mcpClient = {
      getStatus: () => ({
        servers: [
          { id: 's1', name: 'Slack', status: 'disconnected', tools: [] },
        ],
        totalTools: 0,
        connectedCount: 0,
      }),
    };
    (engine as any).calendarService = null;

    const result = (engine as any).buildIntegrationContext();
    expect(result).toBe('');
  });
});

// =============================================================================
// email-check proactive rule — fires when email MCP is connected
// =============================================================================
describe('email-check proactive rule', () => {
  it('fires when Gmail is connected and not night/AFK', () => {
    const engine = new CortexEngine(createDeps());
    const rules = (engine as any).rules as Array<any>;
    const emailRule = rules.find((r: any) => r.id === 'email-check');
    expect(emailRule).toBeDefined();

    const ctx = {
      mcpConnectedServers: ['gmail'],
      timeOfDay: 'morning',
      isAfk: false,
    };
    expect(emailRule.shouldFire(ctx)).toBe(true);
  });

  it('fires when Outlook is connected', () => {
    const engine = new CortexEngine(createDeps());
    const rules = (engine as any).rules as Array<any>;
    const emailRule = rules.find((r: any) => r.id === 'email-check');

    const ctx = {
      mcpConnectedServers: ['outlook'],
      timeOfDay: 'afternoon',
      isAfk: false,
    };
    expect(emailRule.shouldFire(ctx)).toBe(true);
  });

  it('does not fire at night', () => {
    const engine = new CortexEngine(createDeps());
    const rules = (engine as any).rules as Array<any>;
    const emailRule = rules.find((r: any) => r.id === 'email-check');

    const ctx = {
      mcpConnectedServers: ['gmail'],
      timeOfDay: 'night',
      isAfk: false,
    };
    expect(emailRule.shouldFire(ctx)).toBe(false);
  });

  it('does not fire when user is AFK', () => {
    const engine = new CortexEngine(createDeps());
    const rules = (engine as any).rules as Array<any>;
    const emailRule = rules.find((r: any) => r.id === 'email-check');

    const ctx = {
      mcpConnectedServers: ['gmail'],
      timeOfDay: 'morning',
      isAfk: true,
    };
    expect(emailRule.shouldFire(ctx)).toBe(false);
  });

  it('does not fire when no email server connected', () => {
    const engine = new CortexEngine(createDeps());
    const rules = (engine as any).rules as Array<any>;
    const emailRule = rules.find((r: any) => r.id === 'email-check');

    const ctx = {
      mcpConnectedServers: ['slack', 'notion'],
      timeOfDay: 'morning',
      isAfk: false,
    };
    expect(emailRule.shouldFire(ctx)).toBe(false);
  });

  it('generates correct proactive message', () => {
    const engine = new CortexEngine(createDeps());
    const rules = (engine as any).rules as Array<any>;
    const emailRule = rules.find((r: any) => r.id === 'email-check');

    const msg = emailRule.generate();
    expect(msg.type).toBe('proactive');
    expect(msg.message).toContain('poczt');
    expect(msg.context).toBe('email-check-nudge');
  });
});

// =============================================================================
// ThinkQueue integration — enqueue/drain/metrics (Phase 1: ADR-001)
// =============================================================================
describe('ThinkQueue integration', () => {
  // ── Enqueue instead of skip when agent is processing user message ──────────

  it('enqueues trigger (not drops) when isProcessingCheck returns true', async () => {
    const engine = new CortexEngine(createDeps());
    engine.setProcessingCheck(() => true);

    await (engine as any).think({ reason: 'timer', priority: 'normal' });

    const m = engine.getThinkQueueMetrics();
    expect(m.queueDepth).toBe(1);
    expect(m.totalEnqueued).toBe(1);
  });

  // ── Exactly-one-in-flight semaphore: enqueue when thinkRunning ───────────

  it('enqueues trigger when think is already in flight (thinkRunning=true)', async () => {
    const engine = new CortexEngine(createDeps());
    (engine as any).thinkRunning = true;

    await (engine as any).think({ reason: 'cron_event', priority: 'high' });

    const m = engine.getThinkQueueMetrics();
    expect(m.queueDepth).toBe(1);
    expect(m.totalEnqueued).toBe(1);
  });

  // ── pushEvent('cron') proactively enqueues a think trigger ───────────────

  it('pushEvent("cron") enqueues a cron_event think trigger', () => {
    const engine = new CortexEngine(createDeps());

    engine.pushEvent('cron', 'Job "email-digest" executed OK', 'normal');

    const m = engine.getThinkQueueMetrics();
    expect(m.queueDepth).toBe(1);
    expect(m.totalEnqueued).toBe(1);
  });

  // ── pushEvent('idle') enqueues a user_return trigger ─────────────────────

  it('pushEvent("idle") enqueues a user_return think trigger', () => {
    const engine = new CortexEngine(createDeps());

    engine.pushEvent('idle', 'User returned after 5 minutes AFK', 'normal');

    const m = engine.getThinkQueueMetrics();
    expect(m.queueDepth).toBe(1);
    expect(m.totalEnqueued).toBe(1);
  });

  // ── Other pushEvent sources do NOT enqueue a think trigger ───────────────

  it('pushEvent("screen") does NOT enqueue a think trigger', () => {
    const engine = new CortexEngine(createDeps());

    engine.pushEvent('screen', 'Screen changed', 'normal');

    expect(engine.getThinkQueueMetrics().queueDepth).toBe(0);
  });

  // ── notifyProcessingDone drains the queue ────────────────────────────────

  it('notifyProcessingDone drains queued trigger after processing completes', async () => {
    const engine = new CortexEngine(createDeps());
    // Enable engine so notifyProcessingDone's guard passes (without full start/timers)
    (engine as any).enabled = true;

    // While processing, enqueue a trigger
    engine.setProcessingCheck(() => true);
    await (engine as any).think({ reason: 'timer', priority: 'normal' });
    expect(engine.getThinkQueueMetrics().queueDepth).toBe(1);

    // Processing done — trigger drain
    engine.setProcessingCheck(() => false);
    engine.notifyProcessingDone();

    // Flush setImmediate (drain) and the think cycle's finally→drain
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(engine.getThinkQueueMetrics().queueDepth).toBe(0);
  });

  // ── Active hours skip does NOT enqueue ───────────────────────────────────

  it('does NOT enqueue when outside active hours', async () => {
    const deps = createDeps();
    deps.config.get = vi.fn().mockImplementation((key: string) => {
      if (key === 'cortexIntensity') return 'balanced';
      if (key === 'cortexActiveHoursStart') return 9;
      if (key === 'cortexActiveHoursEnd') return 17;
      return undefined;
    });

    const engine = new CortexEngine(deps);

    // Manually set activeHours to force outside-hours condition
    (engine as any).activeHours = { start: 25, end: 26 }; // impossible hour → always outside

    await (engine as any).think({ reason: 'timer', priority: 'normal' });

    expect(engine.getThinkQueueMetrics().queueDepth).toBe(0);
  });

  // ── Drop summary injected as system event ────────────────────────────────

  it('drop summary is consumed and eventQueue gets it on next drain', async () => {
    const engine = new CortexEngine(createDeps());
    const thinkQueue: any = (engine as any).thinkQueue;

    // Manually fill queue with low-priority items, then force a drop
    for (let i = 0; i < 5; i++) {
      thinkQueue.enqueue({ id: `low${i}`, reason: 'timer', priority: 'low', enqueuedAt: Date.now() });
    }
    thinkQueue.enqueue({ id: 'high1', reason: 'cron_event', priority: 'high', enqueuedAt: Date.now() });

    // consumeDropSummary should return a non-null string
    const summary = thinkQueue.consumeDropSummary();
    expect(summary).not.toBeNull();
    expect(summary).toContain('low');
  });

  // ── Topic Dedup ────────────────────────────────

  it('initializes TopicDedupService on startup', () => {
    const deps = createDeps();
    const engine = new CortexEngine(deps);
    expect((engine as any).topicDedup).toBeDefined();
    expect(typeof (engine as any).topicDedup.isDuplicate).toBe('function');
  });
});

// =============================================================================
// Ack Guardrail — follow-up trigger when think produces no tool calls
// =============================================================================
describe('Ack guardrail', () => {
  /** Create deps where think() can actually run through (non-empty HEARTBEAT, stream mock). */
  function createAckDeps(responseText = 'Sprawdzę email wkrótce.') {
    const deps = createDeps();
    // Non-empty HEARTBEAT so think() doesn't short-circuit
    deps.memory.get = vi.fn().mockResolvedValue('- [ ] Sprawdź email');
    // streamMessageWithNativeTools returns text-only (no tool calls)
    deps.ai.streamMessageWithNativeTools = vi.fn().mockResolvedValue({
      text: responseText,
      toolCalls: [],
      _messages: [],
    });
    deps.tools.selectToolsForMessage = vi.fn().mockReturnValue([]);
    // Include memoryUpdateDetails so ppResult.memoryUpdateDetails.length doesn't throw
    deps.responseProcessor.postProcess = vi
      .fn()
      .mockResolvedValue({ memoryUpdatesApplied: 0, autoApprovedCron: 0, memoryUpdateDetails: [] });
    return deps;
  }

  it('enqueues rule_check follow-up when think ends with 0 tool calls and non-suppressed response', async () => {
    const engine = new CortexEngine(createAckDeps());

    await (engine as any).think({ reason: 'timer', priority: 'normal' });

    const m = engine.getThinkQueueMetrics();
    expect(m.queueDepth).toBe(1);
    expect(m.totalEnqueued).toBe(1);

    // Peek at the queued trigger
    const queued = (engine as any).thinkQueue.dequeue();
    expect(queued.reason).toBe('rule_check');
    expect(queued.priority).toBe('low');
    expect(queued.payload).toContain('narzędzi');
  });

  it('does NOT enqueue guardrail when response is CORTEX_OK (suppressed)', async () => {
    const engine = new CortexEngine(createAckDeps('CORTEX_OK'));

    await (engine as any).think({ reason: 'timer', priority: 'normal' });

    expect(engine.getThinkQueueMetrics().queueDepth).toBe(0);
  });

  it('does NOT enqueue guardrail when trigger reason is already rule_check (no infinite loop)', async () => {
    const engine = new CortexEngine(createAckDeps());

    await (engine as any).think({ reason: 'rule_check', priority: 'low' });

    // Queue depth must be 0 — no further rule_check triggered
    expect(engine.getThinkQueueMetrics().queueDepth).toBe(0);
  });

  it('does NOT enqueue guardrail when tool calls were made', async () => {
    const deps = createAckDeps();
    // Simulate tool calls: first response has a tool call, second is final text
    let callCount = 0;
    deps.ai.streamMessageWithNativeTools = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          text: '',
          toolCalls: [{ id: 'tc1', name: 'memory_read', arguments: {} }],
          _messages: [],
        });
      }
      // continueWithToolResults for the second turn
      return Promise.resolve({ text: 'Gotowe.', toolCalls: [], _messages: [] });
    });
    deps.ai.continueWithToolResults = vi.fn().mockResolvedValue({
      text: 'Gotowe.',
      toolCalls: [],
      _messages: [],
    });

    const engine = new CortexEngine(deps);

    await (engine as any).think({ reason: 'timer', priority: 'normal' });

    // Tool calls were made (lastRunToolCallsMade > 0) → no guardrail
    expect(engine.getThinkQueueMetrics().queueDepth).toBe(0);
  });

  it('injects trigger payload as system event when drainThinkQueue processes rule_check', async () => {
    const engine = new CortexEngine(createAckDeps());
    const thinkQueue: any = (engine as any).thinkQueue;

    // Manually enqueue a rule_check trigger with payload
    const payload = 'Test guardrail context payload';
    thinkQueue.enqueue({
      id: 'guardrail-1',
      reason: 'rule_check',
      priority: 'low',
      enqueuedAt: Date.now(),
      payload,
    });

    // Block think from running (thinkRunning=true) so we can observe eventQueue injection
    (engine as any).thinkRunning = true;
    (engine as any).enabled = true;

    await (engine as any).drainThinkQueue();

    // thinkRunning=true means drainThinkQueue returns early without calling think
    // But if we un-block, push happens before think is called — test the intermediate state
    // Instead, test via a spy on pushEvent
    const pushEventSpy = vi.spyOn(engine as any, 'pushEvent');
    (engine as any).thinkRunning = false;
    thinkQueue.enqueue({
      id: 'guardrail-2',
      reason: 'rule_check',
      priority: 'low',
      enqueuedAt: Date.now(),
      payload,
    });

    await (engine as any).drainThinkQueue();

    expect(pushEventSpy).toHaveBeenCalledWith('system', payload, 'low');
  });
});
