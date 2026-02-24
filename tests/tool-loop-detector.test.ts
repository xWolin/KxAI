import { describe, it, expect, beforeEach } from 'vitest';
import { ToolLoopDetector } from '../src/main/services/tool-loop-detector';
import type { LoopCheckResult } from '../src/main/services/tool-loop-detector';

describe('ToolLoopDetector', () => {
  let detector: ToolLoopDetector;

  beforeEach(() => {
    detector = new ToolLoopDetector();
  });

  // ─── Basic operation ───

  describe('basic operation', () => {
    it('returns ok for first call', () => {
      const result = detector.recordAndCheck('read_file', { path: '/a' }, 'content');
      expect(result.status).toBe('ok');
      expect(result.shouldContinue).toBe(true);
      expect(result.iteration).toBe(1);
    });

    it('increments iteration counter', () => {
      detector.recordAndCheck('tool_a', {}, 'out1');
      detector.recordAndCheck('tool_b', {}, 'out2');
      const result = detector.recordAndCheck('tool_c', {}, 'out3');
      expect(result.iteration).toBe(3);
    });

    it('returns ok for varied tool calls', () => {
      for (let i = 0; i < 15; i++) {
        const result = detector.recordAndCheck(`tool_${i}`, { i }, `output_${i}`);
        expect(result.status).toBe('ok');
        expect(result.shouldContinue).toBe(true);
      }
    });

    it('reset() clears all state', () => {
      for (let i = 0; i < 5; i++) {
        detector.recordAndCheck('tool', { x: 1 }, 'same_output');
      }
      detector.reset();
      const result = detector.recordAndCheck('tool', { x: 1 }, 'same_output');
      expect(result.status).toBe('ok');
      expect(result.iteration).toBe(1);
    });
  });

  // ─── Hash repeat detection ───

  describe('hash repeat detection', () => {
    it('detects same output 3x in a row (default threshold)', () => {
      detector.recordAndCheck('search', { q: 'test' }, 'same result');
      detector.recordAndCheck('search', { q: 'test2' }, 'same result');
      const result = detector.recordAndCheck('search', { q: 'test3' }, 'same result');
      expect(result.status).toBe('loop-detected');
      expect(result.shouldContinue).toBe(false);
      expect(result.reason).toContain('output');
      expect(result.nudgeMessage).toContain('LOOP DETECTED');
    });

    it('does not trigger on 2 same outputs (below threshold)', () => {
      detector.recordAndCheck('search', {}, 'same');
      const result = detector.recordAndCheck('search', {}, 'same');
      expect(result.status).toBe('ok');
    });

    it('does not trigger when outputs differ', () => {
      detector.recordAndCheck('search', {}, 'output_1');
      detector.recordAndCheck('search', {}, 'output_2');
      const result = detector.recordAndCheck('search', {}, 'output_3');
      expect(result.status).toBe('ok');
    });

    it('respects custom hashRepeatThreshold', () => {
      const d = new ToolLoopDetector({ hashRepeatThreshold: 5 });
      for (let i = 0; i < 4; i++) {
        const r = d.recordAndCheck('tool', { i }, 'same');
        expect(r.status).toBe('ok');
      }
      const final = d.recordAndCheck('tool', { i: 4 }, 'same');
      expect(final.status).toBe('loop-detected');
    });

    it('resets repeat count when output changes', () => {
      detector.recordAndCheck('tool', {}, 'aaa');
      detector.recordAndCheck('tool', {}, 'aaa');
      // break the streak with different output
      detector.recordAndCheck('tool', {}, 'bbb');
      // 2 new same outputs — below threshold of 3
      detector.recordAndCheck('other', {}, 'ccc');
      const result = detector.recordAndCheck('other', {}, 'ccc');
      expect(result.status).toBe('ok');
    });
  });

  // ─── Ping-pong detection ───

  describe('ping-pong detection', () => {
    it('detects A→B→A→B→A→B pattern (3 cycles default)', () => {
      let result: LoopCheckResult;
      // 3 full cycles = 6 calls
      result = detector.recordAndCheck('read_file', {}, 'r1');
      result = detector.recordAndCheck('write_file', {}, 'w1');
      result = detector.recordAndCheck('read_file', {}, 'r2');
      result = detector.recordAndCheck('write_file', {}, 'w2');
      result = detector.recordAndCheck('read_file', {}, 'r3');
      result = detector.recordAndCheck('write_file', {}, 'w3');
      expect(result.status).toBe('loop-detected');
      expect(result.reason).toContain('Ping-pong');
      expect(result.reason).toContain('read_file');
      expect(result.reason).toContain('write_file');
      expect(result.nudgeMessage).toContain('PING-PONG');
    });

    it('does not trigger for A→B→A→B (only 2 cycles)', () => {
      detector.recordAndCheck('toolA', {}, '1');
      detector.recordAndCheck('toolB', {}, '2');
      detector.recordAndCheck('toolA', {}, '3');
      const result = detector.recordAndCheck('toolB', {}, '4');
      expect(result.status).toBe('ok');
    });

    it('does not trigger when same tool repeats (A→A is not ping-pong)', () => {
      for (let i = 0; i < 6; i++) {
        const result = detector.recordAndCheck('same_tool', { i }, `output_${i}`);
        // Should not be ping-pong (might be same-tool-repeat though)
        if (result.status === 'loop-detected') {
          expect(result.reason).not.toContain('Ping-pong');
        }
      }
    });

    it('does not trigger for A→B→C→A→B→C (3 distinct tools)', () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        detector.recordAndCheck('toolA', {}, `a${cycle}`);
        detector.recordAndCheck('toolB', {}, `b${cycle}`);
        detector.recordAndCheck('toolC', {}, `c${cycle}`);
      }
      // 9 calls, but no A→B ping-pong
      const stats = detector.getStats();
      expect(stats.iteration).toBe(9);
      // The last result should be ok (or warning at 9 < 20)
    });

    it('respects custom pingPongThreshold', () => {
      const d = new ToolLoopDetector({ pingPongThreshold: 2 });
      d.recordAndCheck('A', {}, '1');
      d.recordAndCheck('B', {}, '2');
      d.recordAndCheck('A', {}, '3');
      const result = d.recordAndCheck('B', {}, '4');
      expect(result.status).toBe('loop-detected');
      expect(result.reason).toContain('Ping-pong');
    });
  });

  // ─── Same tool repeat detection ───

  describe('same tool repeat detection', () => {
    it('detects same tool + same params 5x in a row (default)', () => {
      let result: LoopCheckResult;
      for (let i = 0; i < 5; i++) {
        result = detector.recordAndCheck('search_web', { query: 'weather' }, `result_${i}`);
      }
      expect(result!.status).toBe('loop-detected');
      expect(result!.reason).toContain('search_web');
      expect(result!.reason).toContain('5x');
      expect(result!.nudgeMessage).toContain('SAME TOOL REPEAT');
    });

    it('does not trigger when params differ', () => {
      for (let i = 0; i < 5; i++) {
        const result = detector.recordAndCheck('search_web', { query: `query_${i}` }, `result_${i}`);
        expect(result.status).toBe('ok');
      }
    });

    it('does not trigger at 4 repeats (below threshold)', () => {
      for (let i = 0; i < 4; i++) {
        const result = detector.recordAndCheck('api_call', { url: '/same' }, `r${i}`);
        expect(result.status).toBe('ok');
      }
    });

    it('respects custom sameToolRepeatMax', () => {
      const d = new ToolLoopDetector({ sameToolRepeatMax: 3 });
      d.recordAndCheck('tool', { x: 1 }, 'a');
      d.recordAndCheck('tool', { x: 1 }, 'b');
      const result = d.recordAndCheck('tool', { x: 1 }, 'c');
      expect(result.status).toBe('loop-detected');
    });

    it('resets count when different tool is called', () => {
      detector.recordAndCheck('tool', { x: 1 }, 'a');
      detector.recordAndCheck('tool', { x: 1 }, 'b');
      detector.recordAndCheck('tool', { x: 1 }, 'c');
      detector.recordAndCheck('tool', { x: 1 }, 'd');
      // Break the streak
      detector.recordAndCheck('other_tool', {}, 'x');
      // Restart — only 1 now
      const result = detector.recordAndCheck('tool', { x: 1 }, 'e');
      expect(result.status).toBe('ok');
    });
  });

  // ─── Warning threshold ───

  describe('warning threshold', () => {
    it('issues warning at iteration 20 (default)', () => {
      let warningResult: LoopCheckResult | null = null;
      for (let i = 1; i <= 20; i++) {
        const result = detector.recordAndCheck(`tool_${i}`, { i }, `output_${i}`);
        if (result.status === 'warning') {
          warningResult = result;
        }
      }
      expect(warningResult).not.toBeNull();
      expect(warningResult!.status).toBe('warning');
      expect(warningResult!.shouldContinue).toBe(true);
      expect(warningResult!.nudgeMessage).toContain('UWAGA');
      expect(warningResult!.nudgeMessage).toContain('20');
    });

    it('warning is issued only once', () => {
      let warningCount = 0;
      for (let i = 1; i <= 30; i++) {
        const result = detector.recordAndCheck(`tool_${i}`, { i }, `output_${i}`);
        if (result.status === 'warning') warningCount++;
      }
      expect(warningCount).toBe(1);
    });

    it('respects custom warningIterations', () => {
      const d = new ToolLoopDetector({ warningIterations: 5 });
      let warningAt = -1;
      for (let i = 1; i <= 10; i++) {
        const result = d.recordAndCheck(`tool_${i}`, { i }, `output_${i}`);
        if (result.status === 'warning') warningAt = i;
      }
      expect(warningAt).toBe(5);
    });
  });

  // ─── Critical limit ───

  describe('critical limit', () => {
    it('stops at iteration 50 (default)', () => {
      let result: LoopCheckResult;
      for (let i = 1; i <= 50; i++) {
        result = detector.recordAndCheck(`tool_${i}`, { i }, `output_${i}`);
      }
      expect(result!.status).toBe('critical');
      expect(result!.shouldContinue).toBe(false);
      expect(result!.nudgeMessage).toContain('LIMIT KRYTYCZNY');
      expect(result!.nudgeMessage).toContain('50');
    });

    it('respects custom criticalIterations', () => {
      const d = new ToolLoopDetector({ criticalIterations: 10, warningIterations: 5 });
      let result: LoopCheckResult;
      for (let i = 1; i <= 10; i++) {
        result = d.recordAndCheck(`tool_${i}`, { i }, `output_${i}`);
      }
      expect(result!.status).toBe('critical');
      expect(result!.shouldContinue).toBe(false);
    });
  });

  // ─── Detection priority ───

  describe('detection priority', () => {
    it('hash repeat takes priority over same-tool-repeat', () => {
      // Call same tool with same params AND same output — hash repeat triggers at 3, before same-tool at 5
      detector.recordAndCheck('tool', { x: 1 }, 'SAME');
      detector.recordAndCheck('tool', { x: 1 }, 'SAME');
      const result = detector.recordAndCheck('tool', { x: 1 }, 'SAME');
      expect(result.status).toBe('loop-detected');
      expect(result.reason).toContain('output');
    });

    it('loop detection takes priority over critical limit', () => {
      const d = new ToolLoopDetector({ criticalIterations: 3, hashRepeatThreshold: 3 });
      d.recordAndCheck('t', {}, 'same');
      d.recordAndCheck('t', {}, 'same');
      const result = d.recordAndCheck('t', {}, 'same');
      // Hash repeat triggers first (checked before critical)
      expect(result.status).toBe('loop-detected');
      expect(result.reason).toContain('output');
    });
  });

  // ─── getStats() ───

  describe('getStats()', () => {
    it('returns correct iteration count and unique tools', () => {
      detector.recordAndCheck('toolA', {}, 'a');
      detector.recordAndCheck('toolB', {}, 'b');
      detector.recordAndCheck('toolA', {}, 'c');

      const stats = detector.getStats();
      expect(stats.iteration).toBe(3);
      expect(stats.uniqueTools).toBe(2);
      expect(stats.history).toHaveLength(3);
    });

    it('returns copy of history (not reference)', () => {
      detector.recordAndCheck('tool', {}, 'out');
      const stats = detector.getStats();
      stats.history.push({} as any);
      expect(detector.getStats().history).toHaveLength(1);
    });

    it('empty after reset', () => {
      detector.recordAndCheck('tool', {}, 'out');
      detector.reset();
      const stats = detector.getStats();
      expect(stats.iteration).toBe(0);
      expect(stats.uniqueTools).toBe(0);
      expect(stats.history).toHaveLength(0);
    });
  });

  // ─── Hashing edge cases ───

  describe('hashing', () => {
    it('handles null/undefined params gracefully', () => {
      const result = detector.recordAndCheck('tool', null, undefined);
      expect(result.status).toBe('ok');
    });

    it('handles empty object params', () => {
      const result = detector.recordAndCheck('tool', {}, {});
      expect(result.status).toBe('ok');
    });

    it('handles complex nested objects', () => {
      const params = { nested: { deep: { value: [1, 2, 3] } } };
      const result = detector.recordAndCheck('tool', params, { result: 'ok' });
      expect(result.status).toBe('ok');
    });

    it('treats objects with same keys in different order as same hash', () => {
      const d = new ToolLoopDetector({ sameToolRepeatMax: 2 });
      d.recordAndCheck('tool', { a: 1, b: 2 }, 'out');
      const result = d.recordAndCheck('tool', { b: 2, a: 1 }, 'out');
      // Should detect as same params (sorted keys)
      expect(result.status).toBe('loop-detected');
    });

    it('handles circular reference gracefully (falls back to unknown)', () => {
      const obj: any = { a: 1 };
      obj.self = obj;
      // Should not throw
      const result = detector.recordAndCheck('tool', obj, 'output');
      expect(result.status).toBe('ok');
    });
  });

  // ─── Nudge messages ───

  describe('nudge messages', () => {
    it('hash repeat nudge contains action guidance', () => {
      detector.recordAndCheck('t', {}, 'same');
      detector.recordAndCheck('t', {}, 'same');
      const result = detector.recordAndCheck('t', {}, 'same');
      expect(result.nudgeMessage).toContain('zmienić podejście');
    });

    it('ping-pong nudge mentions strategy change', () => {
      const d = new ToolLoopDetector({ pingPongThreshold: 2 });
      d.recordAndCheck('A', {}, '1');
      d.recordAndCheck('B', {}, '2');
      d.recordAndCheck('A', {}, '3');
      const result = d.recordAndCheck('B', {}, '4');
      expect(result.nudgeMessage).toContain('strategię');
    });

    it('same-tool nudge mentions changing approach', () => {
      let result: LoopCheckResult;
      for (let i = 0; i < 5; i++) {
        result = detector.recordAndCheck('tool', { x: 1 }, `out${i}`);
      }
      expect(result!.nudgeMessage).toContain('podejście');
    });

    it('critical nudge says to respond to user', () => {
      const d = new ToolLoopDetector({ criticalIterations: 3, warningIterations: 2 });
      d.recordAndCheck('a', {}, '1');
      d.recordAndCheck('b', {}, '2');
      const result = d.recordAndCheck('c', {}, '3');
      expect(result.nudgeMessage).toContain('odpowiedzieć użytkownikowi');
    });

    it('ok status has no nudge message', () => {
      const result = detector.recordAndCheck('tool', {}, 'output');
      expect(result.nudgeMessage).toBeUndefined();
    });
  });

  // ─── Real-world scenarios ───

  describe('real-world scenarios', () => {
    it('agent searching but getting same results', () => {
      // Agent keeps searching but gets the same empty results
      detector.recordAndCheck('search_web', { q: 'obscure topic' }, { results: [] });
      detector.recordAndCheck('search_web', { q: 'obscure topic v2' }, { results: [] });
      const result = detector.recordAndCheck('search_web', { q: 'obscure topic v3' }, { results: [] });
      expect(result.status).toBe('loop-detected');
      expect(result.reason).toContain('output');
    });

    it('agent reading and writing same file back and forth', () => {
      const d = new ToolLoopDetector({ pingPongThreshold: 2 });
      d.recordAndCheck('read_file', { path: '/app.ts' }, 'content v1');
      d.recordAndCheck('write_file', { path: '/app.ts' }, 'ok');
      d.recordAndCheck('read_file', { path: '/app.ts' }, 'content v2');
      const result = d.recordAndCheck('write_file', { path: '/app.ts' }, 'ok');
      expect(result.status).toBe('loop-detected');
      expect(result.reason).toContain('Ping-pong');
    });

    it('agent polling API waiting for status change', () => {
      let result: LoopCheckResult;
      for (let i = 0; i < 5; i++) {
        result = detector.recordAndCheck('call_api', { url: '/status' }, { status: 'pending' });
      }
      expect(result!.status).toBe('loop-detected');
    });

    it('productive agent with varied tools passes all checks', () => {
      const tools = ['read_file', 'search', 'write_file', 'run_command', 'list_dir'];
      for (let i = 0; i < 15; i++) {
        const tool = tools[i % tools.length];
        const result = detector.recordAndCheck(tool, { step: i }, `unique_output_${i}`);
        expect(result.shouldContinue).toBe(true);
      }
    });
  });
});
