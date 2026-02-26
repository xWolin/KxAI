/**
 * Tests for TakeControlEngine — desktop automation control system.
 * Covers: detectTakeControlIntent, parseToolCall, setPendingTask,
 * consumePendingTakeControl, isTakeControlActive, startTakeControl guards,
 * stopTakeControl, executeComputerUseAction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@main/services/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock all deps
vi.mock('@main/services/ai-service', () => ({ AIService: vi.fn() }));
vi.mock('@main/services/tools-service', () => ({ ToolsService: vi.fn() }));
vi.mock('@main/services/automation-service', () => ({ AutomationService: vi.fn() }));
vi.mock('@main/services/screen-capture', () => ({ ScreenCaptureService: vi.fn() }));
vi.mock('@main/services/memory', () => ({ MemoryService: vi.fn() }));
vi.mock('@main/services/prompt-service', () => ({ PromptService: vi.fn() }));
vi.mock('@main/services/intent-detector', () => ({ IntentDetector: vi.fn() }));

import { TakeControlEngine } from '@main/services/take-control-engine';

// ─── Helpers ───

function makeEngine(opts?: { withAutomation?: boolean; withScreenCapture?: boolean }) {
  const ai = {
    sendMessage: vi.fn().mockResolvedValue(''),
    sendMessageWithVision: vi.fn().mockResolvedValue(''),
    computerUseStep: vi.fn().mockResolvedValue([]),
    supportsNativeComputerUse: vi.fn().mockReturnValue(false),
    pruneComputerUseImages: vi.fn(),
    buildComputerUseToolResult: vi.fn().mockReturnValue({ type: 'tool_result' }),
    getProviderName: vi.fn().mockReturnValue('openai'),
  } as any;

  const tools = {
    execute: vi.fn().mockResolvedValue({ success: true, data: 'OK' }),
  } as any;

  const memory = {
    buildSystemContext: vi.fn().mockResolvedValue('# System'),
  } as any;

  const promptService = {
    render: vi.fn().mockResolvedValue('Take control prompt'),
  } as any;

  const intentDetector = {} as any;

  const automation = {
    enable: vi.fn(),
    disable: vi.fn(),
    lockSafety: vi.fn(),
    unlockSafety: vi.fn(),
    mouseMove: vi.fn().mockResolvedValue(undefined),
    mouseClick: vi.fn().mockResolvedValue(undefined),
    keyboardType: vi.fn().mockResolvedValue(undefined),
    keyboardPress: vi.fn().mockResolvedValue(undefined),
    keyboardShortcut: vi.fn().mockResolvedValue(undefined),
  } as any;

  const screenCapture = {
    captureForComputerUse: vi.fn().mockResolvedValue({
      base64: 'base64data',
      dataUrl: 'data:image/png;base64,base64data',
      width: 1024,
      height: 768,
      nativeWidth: 2048,
      nativeHeight: 1536,
      scaleX: 2,
      scaleY: 2,
    }),
  } as any;

  const engine = new TakeControlEngine(ai, tools, memory, promptService, intentDetector);

  if (opts?.withAutomation !== false) {
    engine.setAutomationService(automation);
  }
  if (opts?.withScreenCapture !== false) {
    engine.setScreenCaptureService(screenCapture);
  }

  return { engine, ai, tools, memory, promptService, automation, screenCapture };
}

// ─── Tests ───

describe('TakeControlEngine', () => {
  // ─── detectTakeControlIntent ───

  describe('detectTakeControlIntent', () => {
    it('returns null when no automation service', () => {
      const { engine } = makeEngine({ withAutomation: false });
      expect(engine.detectTakeControlIntent('przejmij kontrolę')).toBeNull();
    });

    it('detects "przejmij kontrolę"', () => {
      const { engine } = makeEngine();
      const result = engine.detectTakeControlIntent('Przejmij kontrolę nad komputerem');
      expect(result).toBe('Przejmij kontrolę nad komputerem');
    });

    it('detects "przejmij sterowanie"', () => {
      const { engine } = makeEngine();
      expect(engine.detectTakeControlIntent('przejmij sterowanie')).toBeTruthy();
    });

    it('detects "take control"', () => {
      const { engine } = makeEngine();
      expect(engine.detectTakeControlIntent('take control of the screen')).toBeTruthy();
    });

    it('detects "przejmij pulpit"', () => {
      const { engine } = makeEngine();
      expect(engine.detectTakeControlIntent('przejmij pulpit')).toBeTruthy();
    });

    it('detects "zrób to za mnie na komputerze"', () => {
      const { engine } = makeEngine();
      expect(engine.detectTakeControlIntent('zrób to za mnie na komputerze')).toBeTruthy();
    });

    it('detects "steruj komputerem"', () => {
      const { engine } = makeEngine();
      expect(engine.detectTakeControlIntent('steruj komputerem')).toBeTruthy();
    });

    it('detects "działaj na pulpicie"', () => {
      const { engine } = makeEngine();
      expect(engine.detectTakeControlIntent('działaj na pulpicie')).toBeTruthy();
    });

    it('excludes web/browser intents', () => {
      const { engine } = makeEngine();
      expect(engine.detectTakeControlIntent('wyszukaj w google informacje')).toBeNull();
      expect(engine.detectTakeControlIntent('otwórz stronę github.com')).toBeNull();
      expect(engine.detectTakeControlIntent('pokaż stronę w przeglądarce')).toBeNull();
      expect(engine.detectTakeControlIntent('przeglądaj internet')).toBeNull();
      expect(engine.detectTakeControlIntent('sprawdź online cenę')).toBeNull();
    });

    it('returns null for unrelated messages', () => {
      const { engine } = makeEngine();
      expect(engine.detectTakeControlIntent('Co słychać?')).toBeNull();
      expect(engine.detectTakeControlIntent('napisz kod w pythonie')).toBeNull();
    });

    it('truncates result to 500 chars', () => {
      const { engine } = makeEngine();
      const longMsg = 'przejmij kontrolę ' + 'x'.repeat(600);
      const result = engine.detectTakeControlIntent(longMsg);
      expect(result!.length).toBe(500);
    });
  });

  // ─── setPendingTask / consumePendingTakeControl ───

  describe('setPendingTask / consumePendingTakeControl', () => {
    it('set/get/clear cycle', () => {
      const { engine } = makeEngine();
      engine.setPendingTask('Do something');
      expect(engine.consumePendingTakeControl()).toBe('Do something');
      expect(engine.consumePendingTakeControl()).toBeNull(); // cleared
    });

    it('setPendingTask(null) clears', () => {
      const { engine } = makeEngine();
      engine.setPendingTask('task');
      engine.setPendingTask(null);
      expect(engine.consumePendingTakeControl()).toBeNull();
    });
  });

  // ─── isTakeControlActive ───

  describe('isTakeControlActive', () => {
    it('default is false', () => {
      const { engine } = makeEngine();
      expect(engine.isTakeControlActive()).toBe(false);
    });
  });

  // ─── stopTakeControl ───

  describe('stopTakeControl', () => {
    it('does not throw when no active abort controller', () => {
      const { engine } = makeEngine();
      expect(() => engine.stopTakeControl()).not.toThrow();
    });
  });

  // ─── startTakeControl guard clauses ───

  describe('startTakeControl guards', () => {
    it('returns error when no automation service', async () => {
      const { engine } = makeEngine({ withAutomation: false });
      const result = await engine.startTakeControl('task', undefined, undefined, true);
      expect(result).toContain('automation nie jest dostępna');
    });

    it('returns error when already active', async () => {
      const { engine } = makeEngine();
      (engine as any).takeControlActive = true;
      const result = await engine.startTakeControl('task', undefined, undefined, true);
      expect(result).toContain('już aktywny');
    });

    it('returns error when not confirmed', async () => {
      const { engine } = makeEngine();
      const result = await engine.startTakeControl('task', undefined, undefined, false);
      expect(result).toContain('potwierdzenie');
    });

    it('returns error when no screen capture', async () => {
      const { engine } = makeEngine({ withScreenCapture: false });
      const result = await engine.startTakeControl('task', undefined, undefined, true);
      expect(result).toContain('Screen capture nie jest dostępny');
    });
  });

  // ─── parseToolCall ───

  describe('parseToolCall (private)', () => {
    const parse = (response: string) => {
      const { engine } = makeEngine();
      return (engine as any).parseToolCall(response);
    };

    it('parses valid tool block', () => {
      const response = 'Some text\n```tool\n{"tool": "click", "params": {"x": 100, "y": 200}}\n```\nMore text';
      const result = parse(response);
      expect(result).toEqual({ tool: 'click', params: { x: 100, y: 200 } });
    });

    it('returns null when no tool block', () => {
      expect(parse('Just regular text')).toBeNull();
    });

    it('returns null on invalid JSON', () => {
      expect(parse('```tool\n{invalid json}\n```')).toBeNull();
    });

    it('returns null when parsed object has no tool field', () => {
      expect(parse('```tool\n{"action": "click"}\n```')).toBeNull();
    });

    it('defaults params to {} when missing', () => {
      const result = parse('```tool\n{"tool": "screenshot"}\n```');
      expect(result).toEqual({ tool: 'screenshot', params: {} });
    });
  });

  // ─── startTakeControl vision fallback flow ───

  describe('startTakeControl — vision fallback', () => {
    it('calls vision path when not native computer use', async () => {
      const { engine, ai, automation, screenCapture } = makeEngine();
      ai.supportsNativeComputerUse.mockReturnValue(false);
      // AI immediately responds with TASK_COMPLETE
      ai.sendMessageWithVision.mockResolvedValue('TASK_COMPLETE');

      const onStatus = vi.fn();
      const onChunk = vi.fn();
      const result = await engine.startTakeControl('click button', onStatus, onChunk, true);

      expect(automation.enable).toHaveBeenCalled();
      expect(automation.unlockSafety).toHaveBeenCalled();
      expect(result).toContain('Zadanie ukończone');
      // cleanup
      expect(automation.lockSafety).toHaveBeenCalled();
      expect(automation.disable).toHaveBeenCalled();
      expect(engine.isTakeControlActive()).toBe(false);
    });

    it('executes tool calls from vision response', async () => {
      const { engine, ai, tools, screenCapture } = makeEngine();
      ai.supportsNativeComputerUse.mockReturnValue(false);

      let callCount = 0;
      ai.sendMessageWithVision.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return '```tool\n{"tool": "click", "params": {"x": 50, "y": 60}}\n```';
        }
        return 'TASK_COMPLETE';
      });

      const result = await engine.startTakeControl('click', undefined, undefined, true);
      // Tool was executed (with scaled coordinates: 50*2=100, 60*2=120)
      expect(tools.execute).toHaveBeenCalledWith('click', { x: 100, y: 120 });
      expect(result).toContain('Zadanie ukończone');
    });

    it('stops after maxTextRetries without tool blocks', async () => {
      const { engine, ai } = makeEngine();
      ai.supportsNativeComputerUse.mockReturnValue(false);
      ai.sendMessageWithVision.mockResolvedValue('Just text, no tool block');

      const onChunk = vi.fn();
      const result = await engine.startTakeControl('do something', undefined, onChunk, true);
      expect(result).toContain('nie generuje bloków tool');
    });
  });

  // ─── startTakeControl Anthropic path ───

  describe('startTakeControl — Anthropic native', () => {
    it('calls Anthropic path when supportsNativeComputerUse', async () => {
      const { engine, ai, screenCapture } = makeEngine();
      ai.supportsNativeComputerUse.mockReturnValue(true);
      ai.computerUseStep.mockResolvedValue([{ type: 'done' }]);

      const result = await engine.startTakeControl('task', undefined, undefined, true);
      expect(ai.computerUseStep).toHaveBeenCalled();
      expect(result).toContain('Zadanie ukończone');
    });

    it('handles empty steps response', async () => {
      const { engine, ai } = makeEngine();
      ai.supportsNativeComputerUse.mockReturnValue(true);
      ai.computerUseStep.mockResolvedValue([]);

      const onChunk = vi.fn();
      const result = await engine.startTakeControl('task', undefined, onChunk, true);
      expect(onChunk).toHaveBeenCalledWith(expect.stringContaining('No actions'));
    });

    it('handles API error gracefully', async () => {
      const { engine, ai } = makeEngine();
      ai.supportsNativeComputerUse.mockReturnValue(true);
      ai.computerUseStep.mockRejectedValue(new Error('Rate limit exceeded'));

      const onChunk = vi.fn();
      const result = await engine.startTakeControl('task', undefined, onChunk, true);
      expect(result).toContain('Rate limit exceeded');
    });

    it('handles screenshot failure during initial capture', async () => {
      const { engine, ai, screenCapture } = makeEngine();
      ai.supportsNativeComputerUse.mockReturnValue(true);
      screenCapture.captureForComputerUse.mockResolvedValue(null);

      const result = await engine.startTakeControl('task', undefined, undefined, true);
      expect(result).toContain('Nie udało się przechwycić ekranu');
    });
  });

  // ─── executeComputerUseAction ───

  describe('executeComputerUseAction (private)', () => {
    const capture = {
      width: 1024, height: 768,
      nativeWidth: 2048, nativeHeight: 1536,
      scaleX: 2, scaleY: 2,
      base64: 'b64', dataUrl: 'data:...',
    };

    it('throws when no automation', async () => {
      const { engine } = makeEngine({ withAutomation: false });
      await expect(
        (engine as any).executeComputerUseAction({ action: 'left_click', coordinate: [100, 100] }, capture),
      ).rejects.toThrow('Automation not available');
    });

    it('handles screenshot action (noop)', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction({ action: 'screenshot' }, capture);
      // No automation calls for screenshot
      expect(automation.mouseMove).not.toHaveBeenCalled();
      expect(automation.mouseClick).not.toHaveBeenCalled();
    });

    it('mouse_move scales coordinates', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction(
        { action: 'mouse_move', coordinate: [100, 200] }, capture,
      );
      expect(automation.mouseMove).toHaveBeenCalledWith(200, 400); // 100*2, 200*2
    });

    it('mouse_move throws without coordinate', async () => {
      const { engine } = makeEngine();
      await expect(
        (engine as any).executeComputerUseAction({ action: 'mouse_move' }, capture),
      ).rejects.toThrow('requires coordinate');
    });

    it('left_click with coordinate', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction(
        { action: 'left_click', coordinate: [50, 50] }, capture,
      );
      expect(automation.mouseClick).toHaveBeenCalledWith(100, 100, 'left');
    });

    it('right_click uses right button', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction(
        { action: 'right_click', coordinate: [10, 10] }, capture,
      );
      expect(automation.mouseClick).toHaveBeenCalledWith(20, 20, 'right');
    });

    it('middle_click uses middle button', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction(
        { action: 'middle_click', coordinate: [10, 10] }, capture,
      );
      expect(automation.mouseClick).toHaveBeenCalledWith(20, 20, 'middle');
    });

    it('double_click calls mouseClick twice', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction(
        { action: 'double_click', coordinate: [25, 25] }, capture,
      );
      expect(automation.mouseClick).toHaveBeenCalledTimes(2);
      expect(automation.mouseClick).toHaveBeenCalledWith(50, 50, 'left');
    });

    it('click without coordinate', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction({ action: 'left_click' }, capture);
      expect(automation.mouseClick).toHaveBeenCalledWith(undefined, undefined, 'left');
    });

    it('type action calls keyboardType', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction({ action: 'type', text: 'hello' }, capture);
      expect(automation.keyboardType).toHaveBeenCalledWith('hello');
    });

    it('type without text throws', async () => {
      const { engine } = makeEngine();
      await expect(
        (engine as any).executeComputerUseAction({ action: 'type' }, capture),
      ).rejects.toThrow('requires text');
    });

    it('key action with combo calls keyboardShortcut', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction({ action: 'key', text: 'ctrl+c' }, capture);
      expect(automation.keyboardShortcut).toHaveBeenCalledWith(['ctrl', 'c']);
    });

    it('key action with single key calls keyboardPress', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction({ action: 'key', text: 'enter' }, capture);
      expect(automation.keyboardPress).toHaveBeenCalledWith('enter');
    });

    it('key without text throws', async () => {
      const { engine } = makeEngine();
      await expect(
        (engine as any).executeComputerUseAction({ action: 'key' }, capture),
      ).rejects.toThrow('requires text');
    });

    it('scroll action calls keyboardPress multiple times', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction(
        { action: 'scroll', scroll_direction: 'down', scroll_amount: 3 }, capture,
      );
      expect(automation.keyboardPress).toHaveBeenCalledTimes(3);
      expect(automation.keyboardPress).toHaveBeenCalledWith('down');
    });

    it('scroll with coordinate moves mouse first', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction(
        { action: 'scroll', scroll_direction: 'up', scroll_amount: 1, coordinate: [100, 100] }, capture,
      );
      expect(automation.mouseMove).toHaveBeenCalledWith(200, 200);
      expect(automation.keyboardPress).toHaveBeenCalledWith('up');
    });

    it('scroll caps at 10 iterations', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction(
        { action: 'scroll', scroll_direction: 'down', scroll_amount: 20 }, capture,
      );
      expect(automation.keyboardPress).toHaveBeenCalledTimes(10);
    });

    it('cursor_position is noop', async () => {
      const { engine, automation } = makeEngine();
      await (engine as any).executeComputerUseAction({ action: 'cursor_position' }, capture);
      expect(automation.mouseMove).not.toHaveBeenCalled();
    });

    it('wait action delays (capped at 10s)', async () => {
      const { engine } = makeEngine();
      const start = Date.now();
      await (engine as any).executeComputerUseAction({ action: 'wait', duration: 0.1 }, capture);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(90); // ~100ms
    });
  });
});
