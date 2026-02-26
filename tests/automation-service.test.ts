/**
 * Tests for AutomationService — desktop automation service.
 * Covers: button validation, edge cases, safety lock, coordinate validation,
 * middle mouse button support, stdin pipe for osascript.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process
const mockExec = vi.fn();
const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  exec: (...args: any[]) => mockExec(...args),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

// Mock os
vi.mock('os', () => ({
  platform: vi.fn(() => 'darwin'),
  tmpdir: vi.fn(() => '/tmp'),
}));

// Mock fs
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

// Mock electron
vi.mock('electron', () => ({
  systemPreferences: {
    isTrustedAccessibilityClient: vi.fn(() => true),
  },
  screen: {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 200 })),
  },
}));

import * as os from 'os';
const osMock = os as any;

import { AutomationService } from '@main/services/automation-service';

// ─── Helper to create a mock child process for spawn ───
function createMockChildProcess(exitCode = 0, stdout = '', stderr = '') {
  const child = new EventEmitter() as any;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  // Emit data and close asynchronously
  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  }, 5);

  return child;
}

describe('AutomationService', () => {
  let service: AutomationService;

  beforeEach(() => {
    osMock.platform.mockReturnValue('darwin');
    service = new AutomationService();
    service.enable();
    service.unlockSafety();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Safety & Enable ───

  describe('safety lock', () => {
    it('blocks actions when disabled', async () => {
      service.disable();
      const result = await service.mouseMove(100, 200);
      expect(result.success).toBe(false);
      expect(result.error).toContain('wyłączona');
    });

    it('blocks actions when safety locked', async () => {
      service.lockSafety();
      const result = await service.mouseMove(100, 200);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Safety lock');
    });

    it('enable/disable/lock/unlock toggles state', () => {
      expect(service.isEnabled()).toBe(true);
      service.disable();
      expect(service.isEnabled()).toBe(false);
      expect(service.isSafetyLocked()).toBe(true);
      service.enable();
      service.unlockSafety();
      expect(service.isSafetyLocked()).toBe(false);
    });
  });

  // ─── Coordinate Validation ───

  describe('coordinate validation', () => {
    it('rejects NaN coordinates', async () => {
      const result = await service.mouseMove(NaN, 100);
      expect(result.success).toBe(false);
      expect(result.error).toContain('skończonymi');
    });

    it('rejects Infinity coordinates', async () => {
      const result = await service.mouseMove(Infinity, 100);
      expect(result.success).toBe(false);
      expect(result.error).toContain('skończonymi');
    });

    it('rejects negative coordinates', async () => {
      const result = await service.mouseMove(-1, 100);
      expect(result.success).toBe(false);
      expect(result.error).toContain('poza zakresem');
    });

    it('rejects coordinates exceeding MAX_COORD', async () => {
      const result = await service.mouseMove(100, 40000);
      expect(result.success).toBe(false);
      expect(result.error).toContain('poza zakresem');
    });
  });

  // ─── Mouse Button Validation ───

  describe('mouseClick button validation', () => {
    it('rejects invalid button value', async () => {
      const result = await service.mouseClick(100, 200, 'invalid' as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Nieznany przycisk');
      expect(result.error).toContain('invalid');
    });

    it('accepts left button', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'OK'));
      const result = await service.mouseClick(100, 200, 'left');
      expect(result.success).toBe(true);
    });

    it('accepts right button', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'OK'));
      const result = await service.mouseClick(100, 200, 'right');
      expect(result.success).toBe(true);
    });

    it('accepts middle button', async () => {
      mockSpawn.mockReturnValue(createMockChildProcess(0, 'OK'));
      const result = await service.mouseClick(100, 200, 'middle');
      expect(result.success).toBe(true);
    });
  });

  // ─── macOS: middle mouse button generates correct CGEvent types ───

  describe('macOS middle mouse button', () => {
    it('uses kCGEventOtherMouseDown/Up for middle button', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.mouseClick(100, 200, 'middle');

      // Verify stdin received JXA with correct CGEvent types
      const writtenScript = child.stdin.write.mock.calls[0]?.[0] as string;
      expect(writtenScript).toContain('kCGEventOtherMouseDown');
      expect(writtenScript).toContain('kCGEventOtherMouseUp');
      expect(writtenScript).toContain('kCGMouseButtonCenter');
    });

    it('uses kCGEventLeftMouseDown for left button', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.mouseClick(100, 200, 'left');

      const writtenScript = child.stdin.write.mock.calls[0]?.[0] as string;
      expect(writtenScript).toContain('kCGEventLeftMouseDown');
      expect(writtenScript).toContain('kCGMouseButtonLeft');
    });

    it('uses kCGEventRightMouseDown for right button', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.mouseClick(100, 200, 'right');

      const writtenScript = child.stdin.write.mock.calls[0]?.[0] as string;
      expect(writtenScript).toContain('kCGEventRightMouseDown');
      expect(writtenScript).toContain('kCGMouseButtonRight');
    });
  });

  // ─── macOS: osascript stdin pipe security ───

  describe('osascript stdin pipe', () => {
    it('mouseMove uses spawn + stdin instead of exec -e', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.mouseMove(100, 200);

      // Should call spawn('osascript', ['-l', 'JavaScript']) not exec
      expect(mockSpawn).toHaveBeenCalledWith('osascript', ['-l', 'JavaScript'], expect.any(Object));
      // Should NOT use exec for the osascript call
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('mouseClick uses spawn + stdin instead of exec -e', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.mouseClick(100, 200, 'left');

      expect(mockSpawn).toHaveBeenCalledWith('osascript', ['-l', 'JavaScript'], expect.any(Object));
      expect(child.stdin.write).toHaveBeenCalled();
      expect(child.stdin.end).toHaveBeenCalled();
    });

    it('passes JXA script via stdin, not shell -e flag', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.mouseMove(500, 300);

      const writtenScript = child.stdin.write.mock.calls[0]?.[0] as string;
      expect(writtenScript).toContain('CGWarpMouseCursorPosition');
      expect(writtenScript).toContain('500');
      expect(writtenScript).toContain('300');
    });

    it('handles osascript failure gracefully', async () => {
      const child = createMockChildProcess(1, '', 'permission denied');
      mockSpawn.mockReturnValue(child);

      const result = await service.mouseMove(100, 200);
      expect(result.success).toBe(false);
      expect(result.error).toContain('permission denied');
    });

    it('handles spawn error gracefully', async () => {
      const child = new EventEmitter() as any;
      child.stdin = { write: vi.fn(), end: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(child);

      const promise = service.mouseMove(100, 200);
      setTimeout(() => child.emit('error', new Error('ENOENT')), 5);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });
  });

  // ─── macOS: keyboardShortcut uses stdin ───

  describe('keyboardShortcut on macOS', () => {
    it('uses AppleScript via stdin', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.keyboardShortcut(['cmd', 'a']);

      expect(mockSpawn).toHaveBeenCalledWith('osascript', ['-l', 'AppleScript'], expect.any(Object));
      const writtenScript = child.stdin.write.mock.calls[0]?.[0] as string;
      expect(writtenScript).toContain('System Events');
      expect(writtenScript).toContain('keystroke');
      expect(writtenScript).toContain('command down');
    });
  });

  // ─── macOS: keyboardPress uses stdin ───

  describe('keyboardPress on macOS', () => {
    it('uses AppleScript via stdin', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.keyboardPress('enter');

      expect(mockSpawn).toHaveBeenCalledWith('osascript', ['-l', 'AppleScript'], expect.any(Object));
      const writtenScript = child.stdin.write.mock.calls[0]?.[0] as string;
      expect(writtenScript).toContain('key code 36'); // enter = keycode 36
    });
  });

  // ─── getMousePosition ───

  describe('getMousePosition on macOS', () => {
    it('uses Electron screen API', async () => {
      const pos = await service.getMousePosition();
      expect(pos).toEqual({ x: 100, y: 200 });
    });
  });

  // ─── Action Log ───

  describe('action log', () => {
    it('records actions', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.mouseMove(100, 200);
      const log = service.getActionLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].type).toBe('mouse_move');
    });

    it('returns a copy of action log', async () => {
      const child = createMockChildProcess(0, 'OK');
      mockSpawn.mockReturnValue(child);

      await service.mouseMove(100, 200);
      const log1 = service.getActionLog();
      const log2 = service.getActionLog();
      expect(log1).not.toBe(log2);
      expect(log1).toEqual(log2);
    });
  });

  // ─── Windows platform ───

  describe('Windows platform', () => {
    beforeEach(() => {
      osMock.platform.mockReturnValue('win32');
      service = new AutomationService();
      service.enable();
      service.unlockSafety();
    });

    it('mouseMove uses PowerShell', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: any, cb: Function) => cb(null, 'OK', ''));

      const result = await service.mouseMove(100, 200);
      expect(result.success).toBe(true);
      expect(mockExec).toHaveBeenCalled();
      const cmd = mockExec.mock.calls[0][0] as string;
      expect(cmd).toContain('powershell');
      expect(cmd).toContain('System.Windows.Forms');
    });

    it('mouseClick middle button uses 0x0020 flag', async () => {
      mockExec.mockImplementation((_cmd: string, _opts: any, cb: Function) => cb(null, 'OK', ''));

      const result = await service.mouseClick(100, 200, 'middle');
      expect(result.success).toBe(true);
      const cmd = mockExec.mock.calls[0][0] as string;
      expect(cmd).toContain('0x0020'); // middle mouse down flag
    });
  });

  // ─── Linux platform ───

  describe('Linux platform', () => {
    beforeEach(() => {
      osMock.platform.mockReturnValue('linux');
      service = new AutomationService();
      service.enable();
      service.unlockSafety();
    });

    it('mouseClick middle button uses xdotool button 2', async () => {
      mockExec.mockImplementation((cmd: string, _opts: any, cb: Function) => cb(null, 'OK', ''));

      const result = await service.mouseClick(100, 200, 'middle');
      expect(result.success).toBe(true);
      const cmd = mockExec.mock.calls[0][0] as string;
      expect(cmd).toContain('xdotool click 2');
    });
  });
});
