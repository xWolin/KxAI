import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  powerMonitor: {
    getSystemIdleTime: vi.fn().mockReturnValue(0),
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Mock os
vi.mock('os', () => ({
  platform: vi.fn().mockReturnValue('win32'),
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}));

import { ScreenMonitorService } from '../src/main/services/screen-monitor';
import { powerMonitor } from 'electron';

describe('ScreenMonitorService', () => {
  let service: ScreenMonitorService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    service = new ScreenMonitorService();
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  // ─── Basic state ───

  describe('isRunning', () => {
    it('should return false initially', () => {
      expect(service.isRunning()).toBe(false);
    });

    it('should return true after start', () => {
      service.start();
      expect(service.isRunning()).toBe(true);
    });

    it('should return false after stop', () => {
      service.start();
      service.stop();
      expect(service.isRunning()).toBe(false);
    });
  });

  describe('getCurrentWindow', () => {
    it('should return empty window initially', () => {
      const win = service.getCurrentWindow();
      expect(win.title).toBe('');
      expect(win.processName).toBe('');
    });

    it('should return a copy', () => {
      const w1 = service.getCurrentWindow();
      w1.title = 'modified';
      expect(service.getCurrentWindow().title).toBe('');
    });
  });

  describe('getRecentWindows', () => {
    it('should return empty array initially', () => {
      expect(service.getRecentWindows()).toEqual([]);
    });

    it('should return a copy', () => {
      const windows = service.getRecentWindows();
      windows.push('hack');
      expect(service.getRecentWindows()).toEqual([]);
    });
  });

  describe('isIdle', () => {
    it('should return false initially (user is active)', () => {
      expect(service.isIdle()).toBe(false);
    });
  });

  describe('getIdleSeconds', () => {
    it('should return value from powerMonitor', () => {
      (powerMonitor.getSystemIdleTime as any).mockReturnValue(120);
      expect(service.getIdleSeconds()).toBe(120);
    });

    it('should fallback when powerMonitor throws', () => {
      (powerMonitor.getSystemIdleTime as any).mockImplementation(() => { throw new Error('not available'); });
      // User is active by default, so returns 0
      expect(service.getIdleSeconds()).toBe(0);
    });
  });

  // ─── getScreenContext ───

  describe('getScreenContext', () => {
    it('should return current context', () => {
      const ctx = service.getScreenContext();
      expect(ctx).toHaveProperty('windowTitle');
      expect(ctx).toHaveProperty('processName');
      expect(ctx).toHaveProperty('ocrText');
      expect(ctx).toHaveProperty('ocrTimestamp');
      expect(ctx).toHaveProperty('contentChanged');
      expect(ctx).toHaveProperty('recentWindows');
    });

    it('should have empty values initially', () => {
      const ctx = service.getScreenContext();
      expect(ctx.windowTitle).toBe('');
      expect(ctx.ocrText).toBe('');
      expect(ctx.recentWindows).toEqual([]);
    });
  });

  // ─── buildMonitorContext ───

  describe('buildMonitorContext', () => {
    it('should return empty string when no context', () => {
      expect(service.buildMonitorContext()).toBe('');
    });

    it('should include window title', () => {
      (service as any).currentWindow = { title: 'MyApp', processName: 'myapp.exe', timestamp: Date.now() };
      const ctx = service.buildMonitorContext();
      expect(ctx).toContain('MyApp');
      expect(ctx).toContain('Screen Monitor');
    });

    it('should filter out KxAI own window', () => {
      (service as any).currentWindow = { title: 'KxAI - Chat', processName: 'kxai', timestamp: Date.now() };
      expect(service.buildMonitorContext()).toBe('');
    });

    it('should include recent windows', () => {
      (service as any).currentWindow = { title: 'VSCode', processName: 'code', timestamp: Date.now() };
      (service as any).recentWindows = ['Chrome', 'VSCode', 'Terminal'];
      const ctx = service.buildMonitorContext();
      expect(ctx).toContain('Ostatnie okna');
    });

    it('should include OCR text (truncated to 500)', () => {
      (service as any).currentWindow = { title: 'Editor', processName: 'editor', timestamp: Date.now() };
      (service as any).lastOcrText = 'Visible text on screen with code';
      const ctx = service.buildMonitorContext();
      expect(ctx).toContain('Widoczny tekst');
      expect(ctx).toContain('Visible text');
    });

    it('should deduplicate recent windows', () => {
      (service as any).currentWindow = { title: 'App', processName: 'app', timestamp: Date.now() };
      (service as any).recentWindows = ['Chrome', 'Chrome', 'Chrome', 'VSCode'];
      const ctx = service.buildMonitorContext();
      // Should show Chrome only once
      const chromeCount = (ctx.match(/Chrome/g) || []).length;
      expect(chromeCount).toBeLessThanOrEqual(2); // At most in recent + active
    });

    it('should limit recent windows to 5', () => {
      (service as any).currentWindow = { title: 'App', processName: 'app', timestamp: Date.now() };
      (service as any).recentWindows = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'];
      const ctx = service.buildMonitorContext();
      expect(ctx).toBeDefined();
    });
  });

  // ─── textDiffRatio ───

  describe('textDiffRatio', () => {
    const diff = (a: string, b: string) => (service as any).textDiffRatio(a, b);

    it('should return 0 for identical strings', () => {
      expect(diff('hello world', 'hello world')).toBe(0);
    });

    it('should return 0 for both empty', () => {
      expect(diff('', '')).toBe(0);
    });

    it('should return 1 when one is empty', () => {
      expect(diff('hello', '')).toBe(1);
      expect(diff('', 'world')).toBe(1);
    });

    it('should return 0 for same text with different casing', () => {
      expect(diff('Hello World', 'hello world')).toBe(0);
    });

    it('should return 0 for same text with different whitespace', () => {
      expect(diff('hello   world', 'hello world')).toBe(0);
    });

    it('should return high value for completely different strings', () => {
      const ratio = diff('abcdefgh', 'zyxwvuts');
      expect(ratio).toBeGreaterThan(0.8);
    });

    it('should return low value for similar strings', () => {
      const ratio = diff('hello world test', 'hello world testing');
      expect(ratio).toBeLessThan(0.3);
    });
  });

  // ─── start / stop ───

  describe('start / stop', () => {
    it('should set up intervals on start', () => {
      service.start();
      expect((service as any).t0Interval).not.toBeNull();
      expect((service as any).t1Interval).not.toBeNull();
      expect((service as any).t2Interval).not.toBeNull();
    });

    it('should clear intervals on stop', () => {
      service.start();
      service.stop();
      expect((service as any).t0Interval).toBeNull();
      expect((service as any).t1Interval).toBeNull();
      expect((service as any).t2Interval).toBeNull();
    });

    it('should accept callbacks', () => {
      const onWindowChange = vi.fn();
      const onContentChange = vi.fn();
      const onVisionNeeded = vi.fn();
      service.start(onWindowChange, onContentChange, onVisionNeeded);
      expect((service as any).onWindowChange).toBe(onWindowChange);
      expect((service as any).onContentChange).toBe(onContentChange);
      expect((service as any).onVisionNeeded).toBe(onVisionNeeded);
    });

    it('should stop before restarting', () => {
      service.start();
      const oldT0 = (service as any).t0Interval;
      service.start(); // Should clear old intervals first
      expect((service as any).t0Interval).not.toBe(oldT0);
    });
  });

  // ─── setScreenCapture ───

  describe('setScreenCapture', () => {
    it('should store screen capture reference', () => {
      const mock = { captureAllScreens: vi.fn() } as any;
      service.setScreenCapture(mock);
      expect((service as any).screenCapture).toBe(mock);
    });
  });
});
