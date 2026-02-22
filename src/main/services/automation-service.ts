import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const MAX_COORD = 32767; // Safe maximum screen coordinate

/**
 * AutomationService — Desktop automation via platform-specific commands.
 * Windows: PowerShell + System.Windows.Forms + Win32 API
 * macOS: AppleScript (osascript)
 * Linux: xdotool
 *
 * Unika natywnych modułów (nut.js) — działa out-of-the-box bez electron-rebuild.
 */
export class AutomationService {
  private platform: NodeJS.Platform;
  private enabled = false;
  private safetyLock = true; // Requires explicit unlock before automation
  private actionLog: AutomationAction[] = [];

  constructor() {
    this.platform = os.platform();
  }

  /**
   * Enable automation (must be called explicitly).
   */
  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.safetyLock = true;
  }

  /**
   * Unlock safety — allows actual automation actions.
   * Call after user confirms they want the agent to take control.
   */
  unlockSafety(): void {
    this.safetyLock = false;
  }

  lockSafety(): void {
    this.safetyLock = true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isSafetyLocked(): boolean {
    return this.safetyLock;
  }

  getActionLog(): AutomationAction[] {
    return [...this.actionLog];
  }

  // ─── Mouse ───

  /**
   * Validate that coordinates are safe integers within screen bounds.
   */
  private validateCoords(x: number, y: number): { valid: boolean; error?: string } {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { valid: false, error: `Współrzędne muszą być liczbami skończonymi (x=${x}, y=${y})` };
    }
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx < 0 || ry < 0 || rx > MAX_COORD || ry > MAX_COORD) {
      return { valid: false, error: `Współrzędne poza zakresem 0-${MAX_COORD} (x=${rx}, y=${ry})` };
    }
    return { valid: true };
  }

  async mouseMove(x: number, y: number): Promise<AutomationResult> {
    const check = this.validateCoords(x, y);
    if (!check.valid) return { success: false, error: check.error! };
    const sx = Math.round(x);
    const sy = Math.round(y);

    return this.executeAction('mouse_move', { x: sx, y: sy }, async () => {
      if (this.platform === 'win32') {
        return this.runPowerShell(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${sx}, ${sy})`
        );
      } else if (this.platform === 'darwin') {
        // macOS: use Python + Quartz CoreGraphics for real HID mouse move
        // Requires: pyobjc-framework-Quartz + Accessibility permission
        const pyScript = `import Quartz; Quartz.CGEventPost(Quartz.kCGHIDEventTap, Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (${sx}, ${sy}), Quartz.kCGMouseButtonLeft))`;
        return this.runCommand(`python3 -c "${pyScript.replace(/"/g, '\\"')}"`);
      } else {
        return this.runCommand(`xdotool mousemove ${sx} ${sy}`);
      }
    });
  }

  async mouseClick(x?: number, y?: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<AutomationResult> {
    if (x !== undefined && y !== undefined) {
      const check = this.validateCoords(x, y);
      if (!check.valid) return { success: false, error: check.error! };
    }
    const sx = x !== undefined ? Math.round(x) : undefined;
    const sy = y !== undefined ? Math.round(y) : undefined;

    return this.executeAction('mouse_click', { x: sx, y: sy, button }, async () => {
      if (this.platform === 'win32') {
        const moveCmd = sx !== undefined && sy !== undefined
          ? `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${sx}, ${sy}); Start-Sleep -Milliseconds 50; `
          : '';

        const downFlag = button === 'right' ? '0x0008' : button === 'middle' ? '0x0020' : '0x0002';
        const upFlag = button === 'right' ? '0x0010' : button === 'middle' ? '0x0040' : '0x0004';

        return this.runPowerShell(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `${moveCmd}` +
          `$signature = @"
[DllImport("user32.dll")]
public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
"@; ` +
          `$mouse = Add-Type -MemberDefinition $signature -Name "Win32Mouse" -Namespace "Win32" -PassThru; ` +
          `$mouse::mouse_event(${downFlag}, 0, 0, 0, 0); ` +
          `Start-Sleep -Milliseconds 50; ` +
          `$mouse::mouse_event(${upFlag}, 0, 0, 0, 0)`
        );
      } else if (this.platform === 'darwin') {
        // macOS: use cliclick for coordinate-based clicking (brew install cliclick)
        if (sx !== undefined && sy !== undefined) {
          const btn = button === 'right' ? 'rc' : button === 'middle' ? 'mc' : 'c';
          return this.runCommand(`cliclick ${btn}:${sx},${sy}`);
        } else {
          // Click at current position
          const btn = button === 'right' ? 'rc' : button === 'middle' ? 'mc' : 'c';
          return this.runCommand(`cliclick ${btn}:.`);
        }
      } else {
        const moveCmd = sx !== undefined && sy !== undefined ? `xdotool mousemove ${sx} ${sy} && ` : '';
        const btn = button === 'right' ? '3' : button === 'middle' ? '2' : '1';
        return this.runCommand(`${moveCmd}xdotool click ${btn}`);
      }
    });
  }

  // ─── Keyboard ───

  async keyboardType(text: string): Promise<AutomationResult> {
    return this.executeAction('keyboard_type', { text: text.slice(0, 50) + '...' }, async () => {
      if (this.platform === 'win32') {
        // Use PowerShell -EncodedCommand to avoid injection — encode the script as UTF-16LE Base64
        const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(text, 'utf8').toString('base64')}')))`;
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
        return new Promise<AutomationResult>((resolve) => {
          exec(
            `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
            { timeout: 10000 },
            (error, stdout) => {
              if (error) resolve({ success: false, error: error.message });
              else resolve({ success: true, data: stdout.trim() || 'OK' });
            }
          );
        });
      } else if (this.platform === 'darwin') {
        // Write text to temp file and use osascript to read from file to avoid injection
        const tmpFile = path.join(os.tmpdir(), `kxai-type-${Date.now()}.txt`);
        fs.writeFileSync(tmpFile, text, 'utf8');
        const result = await this.runCommand(
          `osascript -e 'set theText to (read POSIX file "${tmpFile}" as «class utf8»)' -e 'tell application "System Events" to keystroke theText'`
        );
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        return result;
      } else {
        // Write text to temp file and pipe to xdotool to avoid injection
        const tmpFile = path.join(os.tmpdir(), `kxai-type-${Date.now()}.txt`);
        fs.writeFileSync(tmpFile, text, 'utf8');
        const result = await this.runCommand(`xdotool type --delay 20 --clearmodifiers -- "$(cat '${tmpFile}')"`);
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        return result;
      }
    });
  }

  async keyboardShortcut(keys: string[]): Promise<AutomationResult> {
    return this.executeAction('keyboard_shortcut', { keys }, async () => {
      if (this.platform === 'win32') {
        // Convert to SendKeys format: ['ctrl', 'a'] → '^a'
        const sendKeysStr = this.toSendKeysFormat(keys);
        return this.runPowerShell(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('${sendKeysStr}')`
        );
      } else if (this.platform === 'darwin') {
        const modifiers: string[] = [];
        const keyParts: string[] = [];
        for (const k of keys) {
          if (k === 'cmd' || k === 'command') modifiers.push('command down');
          else if (k === 'alt' || k === 'option') modifiers.push('option down');
          else if (k === 'ctrl' || k === 'control') modifiers.push('control down');
          else if (k === 'shift') modifiers.push('shift down');
          else keyParts.push(k);
        }
        const using = modifiers.length > 0 ? ` using {${modifiers.join(', ')}}` : '';
        const key = keyParts[0] || '';
        return this.runCommand(
          `osascript -e 'tell application "System Events" to keystroke "${key}"${using}'`
        );
      } else {
        const xdotoolKeys = keys.map((k) => {
          const map: Record<string, string> = {
            ctrl: 'ctrl', alt: 'alt', shift: 'shift', enter: 'Return',
            tab: 'Tab', escape: 'Escape', space: 'space', backspace: 'BackSpace',
            delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
          };
          return map[k.toLowerCase()] || k;
        });
        return this.runCommand(`xdotool key ${xdotoolKeys.join('+')}`);
      }
    });
  }

  async keyboardPress(key: string): Promise<AutomationResult> {
    return this.executeAction('keyboard_press', { key }, async () => {
      if (this.platform === 'win32') {
        const sendKey = this.specialKeyToSendKeys(key);
        return this.runPowerShell(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `[System.Windows.Forms.SendKeys]::SendWait('${sendKey}')`
        );
      } else if (this.platform === 'darwin') {
        const keyCode = this.keyToMacKeyCode(key);
        return this.runCommand(
          `osascript -e 'tell application "System Events" to key code ${keyCode}'`
        );
      } else {
        const xKey = this.keyToXdotool(key);
        return this.runCommand(`xdotool key ${xKey}`);
      }
    });
  }

  // ─── Window Info ───

  async getActiveWindowTitle(): Promise<string> {
    try {
      if (this.platform === 'win32') {
        const result = await this.runPowerShellRaw(
          `Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Window {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@; $hwnd = [Win32Window]::GetForegroundWindow(); $sb = New-Object System.Text.StringBuilder 256; [Win32Window]::GetWindowText($hwnd, $sb, 256); $sb.ToString()`
        );
        return result.trim();
      } else if (this.platform === 'darwin') {
        const result = await this.runCommandRaw(
          `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`
        );
        return result.trim();
      } else {
        const result = await this.runCommandRaw(`xdotool getactivewindow getwindowname`);
        return result.trim();
      }
    } catch {
      return 'Unknown';
    }
  }

  async getMousePosition(): Promise<{ x: number; y: number }> {
    try {
      if (this.platform === 'win32') {
        const result = await this.runPowerShellRaw(
          `Add-Type -AssemblyName System.Windows.Forms; ` +
          `$p = [System.Windows.Forms.Cursor]::Position; "$($p.X),$($p.Y)"`
        );
        const [x, y] = result.trim().split(',').map(Number);
        return { x: x || 0, y: y || 0 };
      } else if (this.platform === 'darwin') {
        // macOS: get mouse position via Python + Quartz CoreGraphics
        try {
          const result = await this.runCommandRaw(
            `python3 -c "import Quartz; e = Quartz.CGEventCreate(None); p = Quartz.CGEventGetLocation(e); print(f'{int(p.x)},{int(p.y)}')"`
          );
          const [x, y] = result.trim().split(',').map(Number);
          return { x: x || 0, y: y || 0 };
        } catch {
          return { x: 0, y: 0 };
        }
      } else {
        const result = await this.runCommandRaw(`xdotool getmouselocation`);
        const match = result.match(/x:(\d+) y:(\d+)/);
        return match ? { x: parseInt(match[1]), y: parseInt(match[2]) } : { x: 0, y: 0 };
      }
    } catch {
      return { x: 0, y: 0 };
    }
  }

  // ─── Execution Helpers ───

  private async executeAction(
    type: string,
    params: any,
    action: () => Promise<AutomationResult>
  ): Promise<AutomationResult> {
    if (!this.enabled) {
      return { success: false, error: 'Automation wyłączona. Włącz ją w ustawieniach.' };
    }
    if (this.safetyLock) {
      return { success: false, error: 'Safety lock aktywny. Użytkownik musi odblokować sterowanie.' };
    }

    this.actionLog.push({
      type,
      params,
      timestamp: Date.now(),
    });

    // Keep log manageable
    if (this.actionLog.length > 500) {
      this.actionLog = this.actionLog.slice(-500);
    }

    return action();
  }

  private runPowerShell(script: string): Promise<AutomationResult> {
    return new Promise((resolve) => {
      exec(
        `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
        { timeout: 10000 },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: error.message });
          } else {
            resolve({ success: true, data: stdout.trim() || 'OK' });
          }
        }
      );
    });
  }

  private runPowerShellRaw(script: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(
        `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
        { timeout: 10000 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });
  }

  private runCommand(cmd: string): Promise<AutomationResult> {
    return new Promise((resolve) => {
      exec(cmd, { timeout: 10000 }, (error, stdout) => {
        if (error) resolve({ success: false, error: error.message });
        else resolve({ success: true, data: stdout.trim() || 'OK' });
      });
    });
  }

  private runCommandRaw(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 10000 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }

  // ─── Key Mapping ───

  private toSendKeysFormat(keys: string[]): string {
    let result = '';
    const modifiers: string[] = [];
    let mainKey = '';

    for (const k of keys) {
      const lower = k.toLowerCase();
      if (lower === 'ctrl' || lower === 'control') modifiers.push('^');
      else if (lower === 'alt') modifiers.push('%');
      else if (lower === 'shift') modifiers.push('+');
      else mainKey = this.specialKeyToSendKeys(lower);
    }

    result = modifiers.join('') + mainKey;
    return result;
  }

  private specialKeyToSendKeys(key: string): string {
    const map: Record<string, string> = {
      enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', escape: '{ESC}', esc: '{ESC}',
      backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}',
      up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
      home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
      f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}',
      f6: '{F6}', f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}',
      f11: '{F11}', f12: '{F12}', space: ' ', insert: '{INSERT}',
    };
    return map[key.toLowerCase()] || key;
  }

  private keyToMacKeyCode(key: string): number {
    const map: Record<string, number> = {
      enter: 36, return: 36, tab: 48, escape: 53, space: 49,
      delete: 51, backspace: 51, up: 126, down: 125, left: 123, right: 124,
    };
    return map[key.toLowerCase()] || 0;
  }

  private keyToXdotool(key: string): string {
    const map: Record<string, string> = {
      enter: 'Return', tab: 'Tab', escape: 'Escape', space: 'space',
      backspace: 'BackSpace', delete: 'Delete', up: 'Up', down: 'Down',
      left: 'Left', right: 'Right', home: 'Home', end: 'End',
    };
    return map[key.toLowerCase()] || key;
  }
}

export interface AutomationResult {
  success: boolean;
  data?: string;
  error?: string;
}

export interface AutomationAction {
  type: string;
  params: any;
  timestamp: number;
}
