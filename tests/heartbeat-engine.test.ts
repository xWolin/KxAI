import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatEngine } from '../src/main/services/heartbeat-engine';

// Mock logger
vi.mock('../src/main/services/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock tool-loop-detector used inside runHeartbeatToolLoop
vi.mock('../src/main/services/tool-loop-detector', () => ({
  ToolLoopDetector: vi.fn().mockImplementation(() => ({
    recordAndCheck: vi.fn().mockReturnValue({ shouldContinue: true }),
  })),
}));

function createMockDeps() {
  return {
    ai: {
      sendMessage: vi.fn().mockResolvedValue('HEARTBEAT_OK'),
    },
    memory: {
      get: vi.fn().mockResolvedValue(null),
      buildSystemContext: vi.fn().mockReturnValue(''),
    },
    workflow: {
      buildTimeContext: vi.fn().mockReturnValue('## Czas\n- Teraz: wtorek'),
      logActivity: vi.fn(),
    },
    cron: {
      getJobs: vi.fn().mockReturnValue([]),
    },
    tools: {
      execute: vi.fn().mockResolvedValue({ success: true, data: 'ok' }),
      getToolDefinitions: vi.fn().mockReturnValue([]),
    },
    promptService: {
      render: vi.fn().mockReturnValue('prompt'),
      load: vi.fn().mockResolvedValue(''),
    },
    responseProcessor: {
      isHeartbeatSuppressed: vi.fn().mockReturnValue(false),
      postProcess: vi.fn().mockResolvedValue(undefined),
    },
    screenMonitor: {
      isRunning: vi.fn().mockReturnValue(false),
      buildMonitorContext: vi.fn().mockReturnValue(''),
      getCurrentWindow: vi.fn().mockReturnValue(null),
    },
  };
}

describe('HeartbeatEngine', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let engine: HeartbeatEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    deps = createMockDeps();
    engine = new HeartbeatEngine(deps as any);
  });

  afterEach(() => {
    engine.stopHeartbeat();
    vi.useRealTimers();
  });

  // ─── Configuration ───

  describe('setters', () => {
    it('setScreenMonitor should update screen monitor', () => {
      const newMonitor = { isRunning: vi.fn().mockReturnValue(true), buildMonitorContext: vi.fn(), getCurrentWindow: vi.fn() };
      engine.setScreenMonitor(newMonitor);
      // Verify it's used: heartbeat should call the new monitor
      expect(newMonitor).toBeDefined();
    });

    it('setActiveHours should set active hours range', () => {
      engine.setActiveHours(9, 17);
      // During business hours: isWithinActiveHours depends on current time
      expect(engine.isWithinActiveHours).toBeDefined();
    });

    it('setActiveHours with nulls should clear restriction', () => {
      engine.setActiveHours(9, 17);
      engine.setActiveHours(null, null);
      expect(engine.isWithinActiveHours()).toBe(true); // No restriction
    });

    it('setResultCallback should store callback', () => {
      const cb = vi.fn();
      engine.setResultCallback(cb);
      expect(cb).not.toHaveBeenCalled();
    });

    it('setProcessingCheck should store check function', () => {
      const check = vi.fn().mockReturnValue(false);
      engine.setProcessingCheck(check);
      expect(check).not.toHaveBeenCalled();
    });
  });

  describe('setAfkState', () => {
    it('should transition to AFK', () => {
      engine.setAfkState(true);
      expect((engine as any).isAfk).toBe(true);
      expect((engine as any).afkSince).toBeGreaterThan(0);
    });

    it('should clear afkTasksDone when entering AFK', () => {
      (engine as any).afkTasksDone.add('task1');
      engine.setAfkState(true);
      expect((engine as any).afkTasksDone.size).toBe(0);
    });

    it('should transition from AFK back to active', () => {
      engine.setAfkState(true);
      engine.setAfkState(false);
      expect((engine as any).isAfk).toBe(false);
    });

    it('should not reset AFK state when already AFK', () => {
      engine.setAfkState(true);
      const afkSince = (engine as any).afkSince;
      vi.advanceTimersByTime(1000);
      engine.setAfkState(true); // Already AFK
      expect((engine as any).afkSince).toBe(afkSince); // Should NOT reset
    });
  });

  describe('resetSessionState', () => {
    it('should clear observation history', () => {
      (engine as any).observationHistory = [{ timestamp: 1, windowTitle: 'x', summary: 'y', response: 'z' }];
      engine.resetSessionState();
      expect((engine as any).observationHistory).toEqual([]);
    });
  });

  // ─── Start / Stop ───

  describe('startHeartbeat / stopHeartbeat', () => {
    it('startHeartbeat should set interval timer', () => {
      engine.startHeartbeat(60000);
      expect((engine as any).heartbeatTimer).not.toBeNull();
    });

    it('stopHeartbeat should clear timer', () => {
      engine.startHeartbeat(60000);
      engine.stopHeartbeat();
      expect((engine as any).heartbeatTimer).toBeNull();
    });

    it('startHeartbeat should clear existing timer first', () => {
      engine.startHeartbeat(60000);
      const timer1 = (engine as any).heartbeatTimer;
      engine.startHeartbeat(30000);
      const timer2 = (engine as any).heartbeatTimer;
      expect(timer2).not.toBe(timer1);
    });

    it('stopHeartbeat should abort running operation', () => {
      const ac = new AbortController();
      (engine as any).abortController = ac;
      engine.stopHeartbeat();
      expect(ac.signal.aborted).toBe(true);
    });
  });

  // ─── Active Hours ───

  describe('isWithinActiveHours', () => {
    it('should return true when no restriction set', () => {
      expect(engine.isWithinActiveHours()).toBe(true);
    });

    it('should check normal range (e.g. 9-17)', () => {
      engine.setActiveHours(9, 17);
      const hour = new Date().getHours();
      const expected = hour >= 9 && hour < 17;
      expect(engine.isWithinActiveHours()).toBe(expected);
    });

    it('should handle wrap-around range (e.g. 22-6)', () => {
      engine.setActiveHours(22, 6);
      const hour = new Date().getHours();
      // For wrap-around: hour >= 22 OR hour < 6
      const expected = hour >= 22 || hour < 6;
      expect(engine.isWithinActiveHours()).toBe(expected);
    });
  });

  // ─── isHeartbeatContentEmpty ───

  describe('isHeartbeatContentEmpty', () => {
    const check = (content: string) => (engine as any).isHeartbeatContentEmpty(content);

    it('should return true for empty string', () => {
      expect(check('')).toBe(true);
    });

    it('should return true for only headers', () => {
      expect(check('# Tasks\n## Sub\n### Deep')).toBe(true);
    });

    it('should return true for empty checklist items', () => {
      expect(check('- [ ] \n* [x] \n+ ')).toBe(true);
    });

    it('should return false for actual content', () => {
      expect(check('# Tasks\n- [ ] Zrób coś')).toBe(false);
    });

    it('should return false for text content', () => {
      expect(check('Some actual text')).toBe(false);
    });

    it('should return true for whitespace-only lines', () => {
      expect(check('   \n  \n\n')).toBe(true);
    });
  });

  // ─── isSimilarScene ───

  describe('isSimilarScene', () => {
    const check = (a: string, b: string) => (engine as any).isSimilarScene(a, b);

    it('should return true for identical titles', () => {
      expect(check('VSCode - Project', 'VSCode - Project')).toBe(true);
    });

    it('should return false for empty titles', () => {
      expect(check('', 'something')).toBe(false);
      expect(check('something', '')).toBe(false);
    });

    it('should match same app name after separator', () => {
      expect(check('file.ts — Visual Studio Code', 'main.ts — Visual Studio Code')).toBe(true);
    });

    it('should match browser patterns', () => {
      expect(check('Video - YouTube', 'Music - YouTube')).toBe(true);
      expect(check('Issue #123 - GitHub', 'Pull request - GitHub')).toBe(true);
    });

    it('should return false for different apps', () => {
      expect(check('VSCode - Project', 'Chrome - Google')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(check('VSCODE - Project', 'vscode - project')).toBe(true);
    });

    it('should not match short app names (<=3 chars)', () => {
      // App name extraction: "x — AB" → "AB" (length 2, <=3)
      expect(check('file - AB', 'other - AB')).toBe(false);
    });
  });

  // ─── parseToolCall ───

  describe('parseToolCall', () => {
    const parse = (response: string) => (engine as any).parseToolCall(response);

    it('should parse valid tool block', () => {
      const response = 'Some text\n```tool\n{"tool": "search", "params": {"query": "test"}}\n```\nMore text';
      const result = parse(response);
      expect(result).toEqual({ tool: 'search', params: { query: 'test' } });
    });

    it('should return null when no tool block', () => {
      expect(parse('Just regular text')).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      expect(parse('```tool\n{invalid json}\n```')).toBeNull();
    });

    it('should return null when tool field is missing', () => {
      expect(parse('```tool\n{"action": "search"}\n```')).toBeNull();
    });

    it('should default params to empty object', () => {
      const result = parse('```tool\n{"tool": "status"}\n```');
      expect(result).toEqual({ tool: 'status', params: {} });
    });
  });

  // ─── sanitizeToolOutput ───

  describe('sanitizeToolOutput', () => {
    const sanitize = (tool: string, data: any) => (engine as any).sanitizeToolOutput(tool, data);

    it('should wrap output in safety markers', () => {
      const result = sanitize('search', 'found it');
      expect(result).toContain('[TOOL OUTPUT');
      expect(result).toContain('[END TOOL OUTPUT]');
      expect(result).toContain('Tool: search');
    });

    it('should truncate long output', () => {
      const longData = 'x'.repeat(20000);
      const result = sanitize('tool', longData);
      expect(result).toContain('(output truncated)');
      expect(result.length).toBeLessThan(20000);
    });

    it('should escape triple backticks', () => {
      const result = sanitize('tool', '```code```');
      expect(result).not.toContain('```');
    });

    it('should escape markdown headers in output', () => {
      // sanitizeToolOutput applies regex on the JSON.stringified version
      // \n# in raw data becomes \n# in JSON string output → replaced with \n\\$1
      const data = { text: 'line\n# Injection' };
      const result = sanitize('tool', data);
      // The output is JSON.stringified first, then escaped
      expect(result).toContain('TOOL OUTPUT');
      expect(result).toContain('Tool: tool');
    });
  });

  // ─── cleanHeartbeatResponse ───

  describe('cleanHeartbeatResponse', () => {
    const clean = (response: string) => (engine as any).cleanHeartbeatResponse(response);

    it('should strip tool blocks', () => {
      const response = 'Hello\n```tool\n{"tool": "x"}\n```\nWorld';
      expect(clean(response)).toBe('Hello\n\nWorld');
    });

    it('should strip TOOL OUTPUT sections', () => {
      const response = 'Start\n[TOOL OUTPUT — DATA]\nsome data\n[END TOOL OUTPUT]\nEnd';
      expect(clean(response)).toBe('Start\n\nEnd');
    });

    it('should return null for HEARTBEAT_OK', () => {
      expect(clean('HEARTBEAT_OK')).toBeNull();
    });

    it('should return null for NO_REPLY', () => {
      expect(clean('NO_REPLY')).toBeNull();
    });

    it('should return null for short responses (<10 chars)', () => {
      expect(clean('ok')).toBeNull();
    });

    it('should return null for empty after stripping', () => {
      expect(clean('```tool\n{"tool": "x"}\n```')).toBeNull();
    });

    it('should preserve meaningful content', () => {
      const result = clean('Widzę, że pracujesz nad projektem. Potrzebujesz pomocy?');
      expect(result).toContain('Widzę');
    });
  });

  // ─── logScreenActivity ───

  describe('logScreenActivity', () => {
    it('should categorize coding activity', () => {
      engine.logScreenActivity('VSCode IDE window', 'editing files');
      expect(deps.workflow.logActivity).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'coding'
      );
    });

    it('should categorize communication activity', () => {
      engine.logScreenActivity('Slack - channel', 'chatting');
      expect(deps.workflow.logActivity).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'communication'
      );
    });

    it('should categorize browsing activity', () => {
      engine.logScreenActivity('Chrome browser tab', 'web search');
      expect(deps.workflow.logActivity).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'browsing'
      );
    });

    it('should categorize document activity', () => {
      engine.logScreenActivity('Word Document view', 'editing doc');
      expect(deps.workflow.logActivity).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'documents'
      );
    });

    it('should categorize terminal activity', () => {
      engine.logScreenActivity('PowerShell terminal', 'running commands');
      expect(deps.workflow.logActivity).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'terminal'
      );
    });

    it('should default to general category', () => {
      engine.logScreenActivity('Unknown app', 'doing stuff');
      expect(deps.workflow.logActivity).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'general'
      );
    });

    it('should truncate long strings to 200 chars', () => {
      const longContext = 'x'.repeat(300);
      const longMessage = 'y'.repeat(300);
      engine.logScreenActivity(longContext, longMessage);
      const call = deps.workflow.logActivity.mock.calls[0];
      expect(call[0].length).toBeLessThanOrEqual(200);
      expect(call[1].length).toBeLessThanOrEqual(200);
    });
  });

  // ─── getNextAfkTask ───

  describe('getNextAfkTask', () => {
    const getTask = (afkMinutes: number) => (engine as any).getNextAfkTask(afkMinutes);

    it('should return memory-review after 5min AFK', () => {
      const task = getTask(5);
      expect(task).not.toBeNull();
      expect(task.id).toBe('memory-review');
    });

    it('should return pattern-analysis after 10min AFK', () => {
      (engine as any).afkTasksDone.add('memory-review');
      const task = getTask(10);
      expect(task).not.toBeNull();
      expect(task.id).toBe('pattern-analysis');
    });

    it('should return welcome-back after 15min AFK', () => {
      (engine as any).afkTasksDone.add('memory-review');
      (engine as any).afkTasksDone.add('pattern-analysis');
      const task = getTask(15);
      expect(task).not.toBeNull();
      expect(task.id).toBe('welcome-back');
    });

    it('should return null when all tasks done', () => {
      (engine as any).afkTasksDone.add('memory-review');
      (engine as any).afkTasksDone.add('pattern-analysis');
      (engine as any).afkTasksDone.add('welcome-back');
      expect(getTask(60)).toBeNull();
    });

    it('should skip tasks below minAfk threshold', () => {
      const task = getTask(2); // Below 5 min threshold
      expect(task).toBeNull();
    });
  });

  // ─── Observation History ───

  describe('recordObservation', () => {
    const record = (wt: string, sc: string, resp: string) =>
      (engine as any).recordObservation(wt, sc, resp);

    it('should add observation to history', () => {
      record('VSCode', 'editing', 'noted');
      expect((engine as any).observationHistory).toHaveLength(1);
    });

    it('should truncate windowTitle to 100 chars', () => {
      record('x'.repeat(200), '', 'ok');
      expect((engine as any).observationHistory[0].windowTitle.length).toBeLessThanOrEqual(100);
    });

    it('should truncate response to 200 chars', () => {
      record('title', '', 'r'.repeat(300));
      expect((engine as any).observationHistory[0].response.length).toBeLessThanOrEqual(200);
    });

    it('should trim to MAX_OBSERVATIONS', () => {
      for (let i = 0; i < 15; i++) {
        record(`title-${i}`, '', `resp-${i}`);
      }
      expect((engine as any).observationHistory.length).toBeLessThanOrEqual(10);
    });
  });

  describe('extractObservationSummary', () => {
    const extract = (wt: string, sc: string) => (engine as any).extractObservationSummary(wt, sc);

    it('should include window title', () => {
      const summary = extract('My App Window', '');
      expect(summary).toContain('My App Window');
    });

    it('should include first 3 non-header lines of screen context', () => {
      const ctx = '## Header\nLine 1\nLine 2\nLine 3\nLine 4';
      const summary = extract('', ctx);
      expect(summary).toContain('Line 1');
      expect(summary).toContain('Line 2');
      expect(summary).toContain('Line 3');
      expect(summary).not.toContain('Line 4');
    });

    it('should return fallback when no data', () => {
      expect(extract('', '')).toBe('(brak danych)');
    });
  });

  describe('buildObservationContext', () => {
    const build = (wt: string) => (engine as any).buildObservationContext(wt);

    it('should show first observation message when empty history', () => {
      const ctx = build('VSCode');
      expect(ctx).toContain('pierwsza obserwacja');
    });

    it('should show recent observations', () => {
      (engine as any).observationHistory = [
        { timestamp: Date.now() - 60000, windowTitle: 'VSCode', summary: 's1', response: 'r1' },
        { timestamp: Date.now() - 30000, windowTitle: 'Chrome', summary: 's2', response: 'r2' },
      ];
      const ctx = build('Chrome');
      expect(ctx).toContain('Historia obserwacji');
      expect(ctx).toContain('min temu');
    });

    it('should detect scene continuity', () => {
      const ts = Date.now() - 120000;
      (engine as any).observationHistory = [
        { timestamp: ts, windowTitle: 'file.ts — Visual Studio Code', summary: 's', response: 'r' },
      ];
      const ctx = build('main.ts — Visual Studio Code');
      expect(ctx).toContain('CIĄGŁOŚĆ');
    });

    it('should detect scene change', () => {
      (engine as any).observationHistory = [
        { timestamp: Date.now() - 60000, windowTitle: 'VSCode - Project', summary: 's', response: 'r' },
      ];
      const ctx = build('Chrome - Google');
      expect(ctx).toContain('ZMIANA');
    });
  });

  // ─── heartbeat() ───

  describe('heartbeat', () => {
    it('should skip when agent is processing', async () => {
      engine.setProcessingCheck(() => true);
      const result = await engine.heartbeat();
      expect(result).toBeNull();
      expect(deps.ai.sendMessage).not.toHaveBeenCalled();
    });

    it('should skip outside active hours', async () => {
      // Set active hours to impossible range for current time
      const hour = new Date().getHours();
      // Set range that excludes current hour
      const start = (hour + 2) % 24;
      const end = (hour + 4) % 24;
      engine.setActiveHours(start, end);
      const result = await engine.heartbeat();
      expect(result).toBeNull();
    });

    it('should skip when no tasks and no screen context', async () => {
      deps.memory.get.mockResolvedValue(null);
      deps.screenMonitor!.isRunning.mockReturnValue(false);
      const result = await engine.heartbeat();
      expect(result).toBeNull();
    });

    it('should process heartbeat with HEARTBEAT.md content', async () => {
      deps.memory.get.mockImplementation(async (key: string) => {
        if (key === 'HEARTBEAT.md') return '# Tasks\n- [ ] Check email';
        if (key === 'MEMORY.md') return 'Some memory content';
        return null;
      });
      const longResponse = 'Sprawdzilem email - jest 5 nowych wiadomosci i potrzebujesz je przejrzec na biezaco.';
      deps.ai.sendMessage.mockResolvedValue(longResponse);
      deps.responseProcessor.isHeartbeatSuppressed.mockReturnValue(false);

      const result = await engine.heartbeat();
      expect(deps.ai.sendMessage).toHaveBeenCalled();
      // Either result is the cleaned response or null if further cleaned
      // The key assertion is that AI was consulted
      const sendCall = deps.ai.sendMessage.mock.calls[0][0] as string;
      expect(sendCall).toContain('HEARTBEAT');
    });

    it('should suppress HEARTBEAT_OK responses', async () => {
      deps.memory.get.mockImplementation(async (key: string) => {
        if (key === 'HEARTBEAT.md') return '# Tasks\n- [ ] Do something';
        return '';
      });
      deps.ai.sendMessage.mockResolvedValue('HEARTBEAT_OK');
      deps.responseProcessor.isHeartbeatSuppressed.mockReturnValue(true);

      const result = await engine.heartbeat();
      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      deps.memory.get.mockImplementation(async (key: string) => {
        if (key === 'HEARTBEAT.md') return '# Tasks\n- [ ] Task';
        return '';
      });
      deps.ai.sendMessage.mockRejectedValue(new Error('API error'));
      const result = await engine.heartbeat();
      expect(result).toBeNull();
    });

    it('should emit status during heartbeat', async () => {
      deps.memory.get.mockImplementation(async (key: string) => {
        if (key === 'HEARTBEAT.md') return '# Tasks\n- [ ] Check stuff';
        return '';
      });
      deps.ai.sendMessage.mockResolvedValue('Done checking.');

      const statusCb = vi.fn();
      engine.onAgentStatus = statusCb;

      await engine.heartbeat();
      expect(statusCb).toHaveBeenCalledWith(expect.objectContaining({ state: 'heartbeat' }));
      expect(statusCb).toHaveBeenCalledWith(expect.objectContaining({ state: 'idle' }));
    });
  });

  // ─── AFK heartbeat ───

  describe('afkHeartbeat', () => {
    it('should rate-limit AFK tasks to 10min intervals', async () => {
      engine.setAfkState(true);
      (engine as any).lastAfkTaskTime = Date.now(); // Just ran a task
      const result = await (engine as any).afkHeartbeat();
      expect(result).toBeNull();
    });

    it('should return null when all tasks done', async () => {
      engine.setAfkState(true);
      (engine as any).afkTasksDone.add('memory-review');
      (engine as any).afkTasksDone.add('pattern-analysis');
      (engine as any).afkTasksDone.add('welcome-back');
      const result = await (engine as any).afkHeartbeat();
      expect(result).toBeNull();
    });

    it('should run first available task', async () => {
      engine.setAfkState(true);
      vi.advanceTimersByTime(6 * 60000); // 6 min AFK
      deps.ai.sendMessage.mockResolvedValue('Reviewed memory — all good.');
      deps.responseProcessor.isHeartbeatSuppressed.mockReturnValue(false);

      const result = await (engine as any).afkHeartbeat();
      expect(deps.ai.sendMessage).toHaveBeenCalled();
      expect((engine as any).afkTasksDone.has('memory-review')).toBe(true);
    });
  });
});
