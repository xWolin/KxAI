import { exec } from 'child_process';
import * as os from 'os';
import { powerMonitor } from 'electron';
import { ScreenCaptureService } from './screen-capture';

/**
 * ScreenMonitorService — Tiered smart screen monitoring.
 *
 * Three tiers minimize API costs while keeping the agent aware:
 *
 * T0: Window title tracking (free, every 2s)
 *     - Detects app switches, new windows, tab changes
 *     - Uses Win32 GetForegroundWindow / AppleScript / xdotool
 *
 * T1: OCR text extraction (free, every 10-15s when T0 detects change)
 *     - Windows native OCR (UWP OcrEngine) on screenshot
 *     - Extracts visible text without API calls
 *     - Builds a "screen context" string for AI
 *
 * T2: Smart vision (API call, only when T1 detects significant content change)
 *     - Full screenshot + AI vision analysis
 *     - Triggered only when screen content meaningfully changed
 *     - Produces insights, suggestions, proactive notifications
 *
 * The result is that ~95% of monitoring is free (T0+T1), and expensive
 * vision calls happen only when something important changes.
 */

export interface WindowInfo {
  title: string;
  processName: string;
  timestamp: number;
}

export interface ScreenContext {
  /** Active window title */
  windowTitle: string;
  /** Active process name */
  processName: string;
  /** OCR-extracted text from screen (T1) */
  ocrText: string;
  /** Timestamp of last OCR */
  ocrTimestamp: number;
  /** Whether content significantly changed since last check */
  contentChanged: boolean;
  /** Summary of recent window switches */
  recentWindows: string[];
}

export interface MonitorEvent {
  type: 'window-change' | 'content-change' | 'insight-ready';
  data: any;
}

export class ScreenMonitorService {
  private platform: NodeJS.Platform;
  private screenCapture: ScreenCaptureService | null = null;

  // T0 state
  private t0Interval: NodeJS.Timeout | null = null;
  private currentWindow: WindowInfo = { title: '', processName: '', timestamp: 0 };
  private recentWindows: string[] = [];
  private windowChangeCount = 0;

  // T1 state
  private t1Interval: NodeJS.Timeout | null = null;
  private lastOcrText = '';
  private lastOcrTimestamp = 0;
  private ocrChangeThreshold = 0.1; // 10% text difference = significant change

  // T2 state — periodic vision check even without OCR changes
  private t2Interval: NodeJS.Timeout | null = null;
  private lastVisionTimestamp = 0;

  // Callbacks
  private onWindowChange: ((info: WindowInfo) => void) | null = null;
  private onContentChange: ((ctx: ScreenContext) => void) | null = null;
  private onVisionNeeded: ((ctx: ScreenContext, screenshots: Array<{ base64: string; label: string }>) => void) | null =
    null;
  private onIdleStart: (() => void) | null = null;
  private onIdleEnd: (() => void) | null = null;

  // Config
  private t0IntervalMs = 2000; // Check window title every 2s
  private t1IntervalMs = 12000; // OCR every 12s
  private t2IntervalMs = 3 * 60 * 1000; // Periodic vision check every 3 min
  private t1PendingCheck = false; // Flag: T0 detected change, T1 should run

  // Activity tracking
  private isUserActive = true;
  private lastActivityTime = Date.now();
  private idleThresholdMs = 5 * 60 * 1000; // 5 minutes = idle

  constructor() {
    this.platform = os.platform();
  }

  setScreenCapture(sc: ScreenCaptureService): void {
    this.screenCapture = sc;
  }

  /**
   * Start tiered monitoring.
   */
  start(
    onWindowChange?: (info: WindowInfo) => void,
    onContentChange?: (ctx: ScreenContext) => void,
    onVisionNeeded?: (ctx: ScreenContext, screenshots: Array<{ base64: string; label: string }>) => void,
    onIdleStart?: () => void,
    onIdleEnd?: () => void,
  ): void {
    this.onWindowChange = onWindowChange || null;
    this.onContentChange = onContentChange || null;
    this.onVisionNeeded = onVisionNeeded || null;
    this.onIdleStart = onIdleStart || null;
    this.onIdleEnd = onIdleEnd || null;

    // Stop any existing intervals first
    this.stop();

    // T0: Window title tracking
    this.t0Interval = setInterval(() => this.t0Check(), this.t0IntervalMs);
    this.t0Check(); // Initial check

    // T1: OCR on interval — always runs, not just on window change
    this.t1Interval = setInterval(() => this.t1Check(), this.t1IntervalMs);

    // T2: Periodic vision check — guarantees agent speaks up at least every few minutes
    this.t2Interval = setInterval(() => this.periodicVisionCheck(), this.t2IntervalMs);

    // Initial vision check after 30s to give user first impression
    setTimeout(() => this.periodicVisionCheck(), 30_000);

    console.log('[ScreenMonitor] Started — T0: 2s, T1: 12s, T2 periodic: 3min');
  }

  stop(): void {
    if (this.t0Interval) {
      clearInterval(this.t0Interval);
      this.t0Interval = null;
    }
    if (this.t1Interval) {
      clearInterval(this.t1Interval);
      this.t1Interval = null;
    }
    if (this.t2Interval) {
      clearInterval(this.t2Interval);
      this.t2Interval = null;
    }
    console.log('[ScreenMonitor] Stopped');
  }

  isRunning(): boolean {
    return this.t0Interval !== null;
  }

  /**
   * Get current screen context (for AI system prompt injection).
   */
  getScreenContext(): ScreenContext {
    return {
      windowTitle: this.currentWindow.title,
      processName: this.currentWindow.processName,
      ocrText: this.lastOcrText,
      ocrTimestamp: this.lastOcrTimestamp,
      contentChanged: this.t1PendingCheck,
      recentWindows: [...this.recentWindows],
    };
  }

  /**
   * Build a compact context string for AI system prompt.
   */
  buildMonitorContext(): string {
    const ctx = this.getScreenContext();
    const parts: string[] = [];

    // Filter out KxAI's own window — the agent shouldn't comment on itself
    const isOwnWindow = (title: string) => /kxai/i.test(title);

    if (ctx.windowTitle && !isOwnWindow(ctx.windowTitle)) {
      parts.push(`Aktywne okno: ${ctx.windowTitle}`);
    }
    if (ctx.processName && !isOwnWindow(ctx.processName)) {
      parts.push(`Proces: ${ctx.processName}`);
    }
    if (ctx.recentWindows.length > 1) {
      const unique = [...new Set(ctx.recentWindows)].filter((w) => !isOwnWindow(w)).slice(0, 5);
      if (unique.length > 0) parts.push(`Ostatnie okna: ${unique.join(' → ')}`);
    }
    if (ctx.ocrText) {
      // Limit OCR text to ~500 chars for context
      const trimmed = ctx.ocrText.slice(0, 500);
      parts.push(`Widoczny tekst na ekranie:\n${trimmed}`);
    }

    return parts.length > 0 ? `\n## 👁️ Screen Monitor\n${parts.join('\n')}\n` : '';
  }

  // ─── T0: Window Title Tracking (FREE) ───

  private async t0Check(): Promise<void> {
    try {
      const info = await this.getActiveWindowInfo();

      // Detect change
      if (info.title !== this.currentWindow.title || info.processName !== this.currentWindow.processName) {
        const _oldTitle = this.currentWindow.title;
        this.currentWindow = info;

        // Track recent windows (keep last 10)
        if (info.title && info.title !== 'Unknown') {
          this.recentWindows.push(info.title);
          if (this.recentWindows.length > 10) this.recentWindows.shift();
        }

        this.windowChangeCount++;
        this.t1PendingCheck = true; // Flag T1 to run
        this.lastActivityTime = Date.now();
        this.isUserActive = true;

        this.onWindowChange?.(info);
      }

      // Idle detection — use Electron powerMonitor for accurate system-wide idle time
      // (counts seconds since last mouse/keyboard input, not just window changes)
      try {
        const systemIdleSeconds = powerMonitor.getSystemIdleTime();
        const wasActive = this.isUserActive;
        this.isUserActive = systemIdleSeconds < this.idleThresholdMs / 1000;
        if (this.isUserActive) {
          this.lastActivityTime = Date.now();
        }
        // Emit idle/active transitions for AFK mode
        if (wasActive && !this.isUserActive) {
          this.onIdleStart?.();
        } else if (!wasActive && this.isUserActive) {
          this.onIdleEnd?.();
        }
      } catch {
        // Fallback: use window change detection if powerMonitor unavailable
        const timeSinceActivity = Date.now() - this.lastActivityTime;
        if (timeSinceActivity > this.idleThresholdMs && this.isUserActive) {
          this.isUserActive = false;
          this.onIdleStart?.();
        }
      }
    } catch (_error) {
      // T0 errors are non-critical
    }
  }

  private async getActiveWindowInfo(): Promise<WindowInfo> {
    try {
      if (this.platform === 'win32') {
        return await this.getActiveWindowWin32();
      } else if (this.platform === 'darwin') {
        return await this.getActiveWindowMac();
      } else {
        return await this.getActiveWindowLinux();
      }
    } catch {
      return { title: 'Unknown', processName: 'Unknown', timestamp: Date.now() };
    }
  }

  private getActiveWindowWin32(): Promise<WindowInfo> {
    return new Promise((resolve) => {
      // Use -EncodedCommand to avoid all quoting/escaping issues with cmd→powershell
      const script = `
Add-Type -Name WinAPI -Namespace KxAI -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);' -ErrorAction SilentlyContinue
$hwnd = [KxAI.WinAPI]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[KxAI.WinAPI]::GetWindowText($hwnd, $sb, 512) | Out-Null
$title = $sb.ToString()
$pid2 = [uint32]0
[KxAI.WinAPI]::GetWindowThreadProcessId($hwnd, [ref]$pid2) | Out-Null
$proc = if ($pid2 -gt 0) { (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName } else { "Unknown" }
Write-Output "$title<SEP>$proc"
`.trim();
      // Encode as UTF-16LE Base64 for -EncodedCommand
      const encoded = Buffer.from(script, 'utf16le').toString('base64');

      exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { timeout: 5000 }, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ title: 'Unknown', processName: 'Unknown', timestamp: Date.now() });
          return;
        }
        const parts = stdout.trim().split('<SEP>');
        resolve({
          title: parts[0] || 'Unknown',
          processName: parts[1] || 'Unknown',
          timestamp: Date.now(),
        });
      });
    });
  }

  private getActiveWindowMac(): Promise<WindowInfo> {
    return new Promise((resolve) => {
      exec(
        `osascript -e 'tell application "System Events" to get {name, name of first process whose frontmost is true} of first window of (first process whose frontmost is true)'`,
        { timeout: 3000 },
        (error, stdout) => {
          if (error) {
            resolve({ title: 'Unknown', processName: 'Unknown', timestamp: Date.now() });
            return;
          }
          const parts = stdout.trim().split(', ');
          resolve({
            title: parts[0] || 'Unknown',
            processName: parts[1] || 'Unknown',
            timestamp: Date.now(),
          });
        },
      );
    });
  }

  private getActiveWindowLinux(): Promise<WindowInfo> {
    return new Promise((resolve) => {
      exec('xdotool getactivewindow getwindowname', { timeout: 3000 }, (error, stdout) => {
        resolve({
          title: error ? 'Unknown' : stdout.trim(),
          processName: 'Unknown',
          timestamp: Date.now(),
        });
      });
    });
  }

  // ─── T1: OCR Text Extraction (FREE) ───

  private async t1Check(): Promise<void> {
    // Skip if user is idle (save resources)
    if (!this.isUserActive) return;

    try {
      // Capture all screens for OCR (multi-monitor support)
      if (!this.screenCapture) return;
      const allScreens = await this.screenCapture.captureAllScreens();
      if (allScreens.length === 0) return;

      // Combine OCR text from all screens
      const ocrTexts: string[] = [];
      for (const screen of allScreens) {
        const text = await this.extractText(screen.base64);
        if (text && text.length > 10) {
          ocrTexts.push(allScreens.length > 1 ? `[${screen.displayLabel}] ${text}` : text);
        }
      }
      const combinedOcr = ocrTexts.join('\n---\n');

      // Calculate text difference
      const diffRatio = this.textDiffRatio(this.lastOcrText, combinedOcr);
      const significantChange = diffRatio > this.ocrChangeThreshold;

      this.lastOcrText = combinedOcr;
      this.lastOcrTimestamp = Date.now();
      this.t1PendingCheck = false;

      if (significantChange && combinedOcr.length > 20) {
        const ctx = this.getScreenContext();
        ctx.contentChanged = true;

        this.onContentChange?.(ctx);

        // T2: Trigger vision if we have a callback and content changed meaningfully
        // Send ALL screens for multi-monitor awareness
        if (this.onVisionNeeded && allScreens.length > 0) {
          this.lastVisionTimestamp = Date.now();
          const screenshots = allScreens.map((s) => ({
            base64: s.base64.replace(/^data:image\/\w+;base64,/, ''),
            label: s.displayLabel,
          }));
          this.onVisionNeeded(ctx, screenshots);
        }
      }
    } catch (error) {
      // T1 errors are non-critical
      console.error('[ScreenMonitor] T1 OCR error:', error);
    }
  }

  /**
   * Periodic forced vision check — runs every T2 interval (3 min).
   * Guarantees the agent sees the screen regularly even without OCR changes.
   * This ensures the agent can proactively comment, suggest, or just observe.
   */
  private async periodicVisionCheck(): Promise<void> {
    if (!this.isUserActive) return;
    if (!this.screenCapture || !this.onVisionNeeded) return;

    // Skip if T1 already triggered T2 recently (within last 90s)
    if (Date.now() - this.lastVisionTimestamp < 90_000) return;

    try {
      // Capture all screens for multi-monitor awareness
      const allScreens = await this.screenCapture.captureAllScreens();
      if (allScreens.length === 0) {
        console.log('[ScreenMonitor] Periodic T2 — no capture returned');
        return;
      }
      console.log(`[ScreenMonitor] Periodic T2 — ${allScreens.length} screen(s) captured`);

      // Also grab OCR text from all screens if we have none yet
      if (!this.lastOcrText) {
        const ocrTexts: string[] = [];
        for (const screen of allScreens) {
          const text = await this.extractText(screen.base64);
          if (text && text.length > 10) {
            ocrTexts.push(allScreens.length > 1 ? `[${screen.displayLabel}] ${text}` : text);
          }
        }
        this.lastOcrText = ocrTexts.join('\n---\n');
        this.lastOcrTimestamp = Date.now();
      }

      this.lastVisionTimestamp = Date.now();
      const ctx = this.getScreenContext();
      ctx.contentChanged = true; // Force — periodic check

      console.log(
        `[ScreenMonitor] Periodic T2 vision check — window: ${ctx.windowTitle}, ${allScreens.length} screen(s)`,
      );

      // Send ALL screens for multi-monitor vision
      const screenshots = allScreens.map((s) => ({
        base64: s.base64.replace(/^data:image\/\w+;base64,/, ''),
        label: s.displayLabel,
      }));
      this.onVisionNeeded(ctx, screenshots);
    } catch (error) {
      console.error('[ScreenMonitor] Periodic vision error:', error);
    }
  }

  /**
   * Extract text from screenshot using platform-native OCR.
   * Windows: PowerShell + UWP OcrEngine (free, built-in since Windows 10)
   * macOS: Vision framework
   * Linux: tesseract fallback
   */
  private async extractText(dataUrl: string): Promise<string> {
    if (this.platform === 'win32') {
      return this.ocrWindows(dataUrl);
    } else if (this.platform === 'darwin') {
      return this.ocrMac(dataUrl);
    } else {
      return this.ocrLinux(dataUrl);
    }
  }

  private ocrWindows(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      // Use Windows UWP OcrEngine — built into Windows 10+
      // We save the screenshot as a temp file, then OCR it
      const tmpPath = require('path').join(require('os').tmpdir(), 'kxai_ocr_tmp.png');
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');

      require('fs').writeFileSync(tmpPath, buffer);

      const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime]

function Await($WinRTTask) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
  if (!$asTask) { $asTask = [System.WindowsRuntimeSystemExtensions].GetMethod('AsTask', [Type[]]@([Windows.Foundation.IAsyncOperation\`1].MakeGenericType([Object]))) }
  $netTask = $asTask.MakeGenericMethod($WinRTTask.GetType().GetGenericArguments()).Invoke($null, @($WinRTTask))
  $netTask.Wait()
  return $netTask.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${tmpPath.replace(/\\/g, '\\\\')}'))
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read))
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream))
$bitmap = Await ($decoder.GetSoftwareBitmapAsync())
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = Await ($engine.RecognizeAsync($bitmap))
Write-Output $result.Text
$stream.Dispose()
`.trim();

      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
        { timeout: 15000, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          // Clean up tmp file
          try {
            require('fs').unlinkSync(tmpPath);
          } catch {
            /* cleanup */
          }
          if (error) {
            // Fallback: return empty — T1 just won't produce text
            resolve('');
            return;
          }
          resolve(stdout.trim().slice(0, 3000)); // Limit output
        },
      );
    });
  }

  private ocrMac(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const tmpPath = require('path').join(require('os').tmpdir(), 'kxai_ocr_tmp.png');
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      require('fs').writeFileSync(tmpPath, Buffer.from(base64, 'base64'));

      // macOS Vision framework via Swift
      const script = `
import Vision
import AppKit
let url = URL(fileURLWithPath: "${tmpPath}")
guard let img = NSImage(contentsOf: url), let cgImg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let req = VNRecognizeTextRequest()
req.recognitionLevel = .fast
try VNImageRequestHandler(cgImage: cgImg).perform([req])
let text = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\\n")
print(text)
`;
      const tmpSwift = require('path').join(require('os').tmpdir(), 'kxai_ocr.swift');
      require('fs').writeFileSync(tmpSwift, script);

      exec(`swift ${tmpSwift}`, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        try {
          require('fs').unlinkSync(tmpPath);
          require('fs').unlinkSync(tmpSwift);
        } catch {
          /* cleanup */
        }
        resolve(error ? '' : stdout.trim().slice(0, 3000));
      });
    });
  }

  private ocrLinux(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const tmpPath = require('path').join(require('os').tmpdir(), 'kxai_ocr_tmp.png');
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      require('fs').writeFileSync(tmpPath, Buffer.from(base64, 'base64'));

      exec(`tesseract ${tmpPath} stdout 2>/dev/null`, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        try {
          require('fs').unlinkSync(tmpPath);
        } catch {
          /* cleanup */
        }
        resolve(error ? '' : stdout.trim().slice(0, 3000));
      });
    });
  }

  // ─── Text Diff ───

  /**
   * Quick text similarity ratio using character bigrams.
   * Returns 0 (identical) to 1 (completely different).
   */
  private textDiffRatio(a: string, b: string): number {
    if (!a && !b) return 0;
    if (!a || !b) return 1;

    // Normalize: lowercase, collapse whitespace
    const na = a.toLowerCase().replace(/\s+/g, ' ').trim();
    const nb = b.toLowerCase().replace(/\s+/g, ' ').trim();

    if (na === nb) return 0;

    // Bigram similarity (Dice coefficient)
    const bigramsA = new Set<string>();
    const bigramsB = new Set<string>();
    for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
    for (let i = 0; i < nb.length - 1; i++) bigramsB.add(nb.slice(i, i + 2));

    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }

    const similarity = (2 * intersection) / (bigramsA.size + bigramsB.size);
    return 1 - similarity; // 0 = same, 1 = different
  }

  // ─── Public getters ───

  getCurrentWindow(): WindowInfo {
    return { ...this.currentWindow };
  }

  getRecentWindows(): string[] {
    return [...this.recentWindows];
  }

  isIdle(): boolean {
    return !this.isUserActive;
  }

  /**
   * Get system idle time in seconds (time since last mouse/keyboard input).
   */
  getIdleSeconds(): number {
    try {
      return powerMonitor.getSystemIdleTime();
    } catch {
      return this.isUserActive ? 0 : Math.floor((Date.now() - this.lastActivityTime) / 1000);
    }
  }

  /**
   * Force a T1 check (useful when user requests "co widzisz na ekranie?")
   */
  async forceOcrCheck(): Promise<string> {
    await this.t1Check();
    return this.lastOcrText;
  }
}
