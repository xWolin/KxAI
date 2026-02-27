import { execSync, ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import { app } from 'electron';
import { CDPBrowser, CDPPage } from './cdp-client';
import { createLogger } from './logger';

const log = createLogger('BrowserService');

/**
 * BrowserService — Native CDP browser automation (zero Playwright dependency).
 *
 * Launches system Chrome / Edge / Chromium (headful, visible on screen),
 * connects via native Chrome DevTools Protocol, provides accessibility
 * snapshots with numbered refs for AI interaction.
 *
 * Cross-platform: Windows, macOS, Linux.
 *
 * Flow:
 *   1. browser_launch  → spawn Chrome + connect via native CDP
 *   2. browser_snapshot → get text tree with [e1], [e2]... refs
 *   3. browser_click / browser_type → act on ref
 *   4. Repeat 2-3 until task is done
 *   5. browser_close → cleanup
 */

// ─── Types ───

export interface BrowserLaunchOptions {
  headless?: boolean;
  url?: string;
  width?: number;
  height?: number;
}

export interface BrowserResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface SnapshotResult {
  url: string;
  title: string;
  tree: string;
  totalRefs: number;
}

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

// ─── Service ───

/**
 * JavaScript code evaluated inside the browser page to build
 * an accessibility snapshot with numbered refs.
 * Kept as a string to avoid TypeScript DOM type issues (runs in browser, not Node).
 */
const SNAPSHOT_SCRIPT = `(() => {
  document.querySelectorAll('[data-kxref]').forEach(el => el.removeAttribute('data-kxref'));
  let refId = 0;

  function isVisible(el) {
    if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') {
      const st = getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'sticky') return false;
    }
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0;
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (['a','button','input','select','textarea'].includes(tag)) return true;
    const role = el.getAttribute('role');
    if (role && ['button','link','tab','menuitem','checkbox','radio','switch',
      'option','combobox','textbox','searchbox','slider','treeitem','gridcell'].includes(role)) return true;
    if (el.onclick || el.getAttribute('onclick')) return true;
    if (el.contentEditable === 'true') return true;
    return false;
  }

  function getLabel(el) {
    const tag = el.tagName.toLowerCase();
    const ariaLabel = el.getAttribute('aria-label');
    const placeholder = el.getAttribute('placeholder');
    const text = el.innerText ? el.innerText.trim() : '';
    const value = el.value;
    const alt = el.getAttribute('alt');
    const title = el.getAttribute('title');
    const name = el.getAttribute('name');
    const role = el.getAttribute('role');
    const checked = el.getAttribute('aria-checked') || (el.checked ? 'true' : null);
    const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

    let desc = tag;
    if (tag === 'a') desc = 'link';
    else if (tag === 'button' || role === 'button') desc = 'button';
    else if (tag === 'input') desc = 'input[' + (el.type || 'text') + ']';
    else if (role && role !== tag) desc = role;

    if (disabled) desc += ' (disabled)';
    if (checked) desc += ' [' + (checked === 'true' ? '✓' : '○') + ']';

    if (ariaLabel) return desc + ' "' + ariaLabel + '"';
    if (text && text.length < 80 && !text.includes('\\n')) return desc + ' "' + text + '"';
    if (alt) return desc + ' "' + alt + '"';
    if (placeholder) return desc + ' placeholder="' + placeholder + '"';
    if (title) return desc + ' "' + title + '"';
    if (value && tag === 'input') return desc + ' value="' + String(value).slice(0, 40) + '"';
    if (name) return desc + ' name="' + name + '"';
    return desc;
  }

  function buildTree(el, depth, maxDepth) {
    if (!el || depth > maxDepth || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    const skip = ['script','style','noscript','svg','path','meta','link','br','hr','template','iframe'];
    if (skip.includes(tag)) return '';
    if (!isVisible(el)) return '';

    const indent = '  '.repeat(depth);
    let result = '';

    if (isInteractive(el)) {
      const ref = 'e' + (++refId);
      el.setAttribute('data-kxref', ref);
      result += indent + '[' + ref + '] ' + getLabel(el) + '\\n';
      return result;
    }

    const headings = ['h1','h2','h3','h4','h5','h6'];
    const semantic = ['main','nav','header','footer','section','article','aside','form','dialog'];

    if (headings.includes(tag)) {
      result += indent + tag + ': ' + (el.innerText || '').trim().slice(0, 120) + '\\n';
    } else if (semantic.includes(tag)) {
      const lbl = el.getAttribute('aria-label') ? ' "' + el.getAttribute('aria-label') + '"' : '';
      result += indent + '<' + tag + lbl + '>\\n';
    } else if (tag === 'img') {
      const imgAlt = el.alt || '';
      if (imgAlt) result += indent + 'img: "' + imgAlt.slice(0, 80) + '"\\n';
    } else if (tag === 'table') {
      result += indent + '<table>\\n';
    } else if (tag === 'ul' || tag === 'ol') {
      result += indent + '<' + tag + '>\\n';
    } else if (tag === 'li') {
      if (el.children.length === 0 && el.innerText && el.innerText.trim()) {
        result += indent + '• ' + el.innerText.trim().slice(0, 150) + '\\n';
        return result;
      }
    } else if (['p','span','div','label','td','th','blockquote','pre','code'].includes(tag)) {
      if (el.children.length === 0 && el.innerText && el.innerText.trim()) {
        const txt = el.innerText.trim().slice(0, 200);
        if (txt) result += indent + txt + '\\n';
        return result;
      }
    }

    for (const child of Array.from(el.children)) {
      result += buildTree(child, depth + 1, maxDepth);
    }
    return result;
  }

  const tree = buildTree(document.body, 0, 18);
  return {
    url: location.href,
    title: document.title,
    tree: tree.slice(0, 25000),
    totalRefs: refId,
  };
})()`;

export class BrowserService {
  // Native CDP client — replaces playwright-core
  private cdpBrowser: CDPBrowser | null = null;
  private activePage: CDPPage | null = null;
  private activePageIdx = 0;
  private browserProcess: ChildProcess | null = null;
  private debugPort = 0;
  private userDataDir: string;

  constructor() {
    // Persistent dedicated profile in app data — survives restarts,
    // keeps cookies, sessions, extensions across launches
    this.userDataDir = path.join(app.getPath('userData'), 'browser-profile');
  }

  // ════════════════════════════════════════════════════
  //  User Profile Detection
  // ════════════════════════════════════════════════════

  /**
   * Get the user's real browser profile directory based on the detected browser executable.
   * This allows the agent to use existing cookies, logins, and sessions.
   */
  private async getUserProfileDir(browserExe: string): Promise<string> {
    const name = path.basename(browserExe).toLowerCase();
    const platform = process.platform;

    let profileDir: string | null = null;

    if (platform === 'win32') {
      const localAppData = process.env['LOCALAPPDATA'] || '';
      if (name.includes('chrome')) profileDir = path.join(localAppData, 'Google', 'Chrome', 'User Data');
      else if (name.includes('msedge') || name.includes('edge'))
        profileDir = path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
      else if (name.includes('brave'))
        profileDir = path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data');
    } else if (platform === 'darwin') {
      const home = os.homedir();
      if (name.includes('chrome')) profileDir = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
      else if (name.includes('edge')) profileDir = path.join(home, 'Library', 'Application Support', 'Microsoft Edge');
      else if (name.includes('brave'))
        profileDir = path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser');
    } else {
      const home = os.homedir();
      if (name.includes('chromium')) profileDir = path.join(home, '.config', 'chromium');
      else if (name.includes('chrome')) profileDir = path.join(home, '.config', 'google-chrome');
      else if (name.includes('edge')) profileDir = path.join(home, '.config', 'microsoft-edge');
      else if (name.includes('brave')) profileDir = path.join(home, '.config', 'BraveSoftware', 'Brave-Browser');
    }

    if (profileDir) {
      try {
        await fs.promises.access(profileDir);
        log.info(`Znaleziono profil użytkownika: ${profileDir}`);
        return profileDir;
      } catch {
        // profile dir doesn't exist — fall through
      }
    }

    log.info('Brak profilu użytkownika, używam profilu KxAI');
    return path.join(app.getPath('userData'), 'browser-profile');
  }

  /**
   * Try to connect to an already-running browser via its DevToolsActivePort file.
   * Chrome writes this file when started with --remote-debugging-port.
   */
  private async tryConnectToExisting(profileDir: string): Promise<boolean> {
    const activePortFile = path.join(profileDir, 'DevToolsActivePort');
    try {
      await fs.promises.access(activePortFile);
    } catch {
      return false;
    }

    try {
      const content = await fs.promises.readFile(activePortFile, 'utf-8');
      const port = parseInt(content.split('\n')[0], 10);
      if (!port || port <= 0) return false;

      log.info(`Znaleziono DevToolsActivePort na porcie ${port}, próbuję połączyć...`);
      const wsUrl = await this.waitForBrowserReady(port, 5000);

      this.cdpBrowser = await CDPBrowser.connect(wsUrl);
      this.debugPort = port;

      // Attach to existing pages
      const targets = await this.cdpBrowser.getTargets();
      if (targets.length > 0) {
        this.activePage = await this.cdpBrowser.attachToPage(targets[0]);
        this.activePageIdx = 0;
      } else {
        this.activePage = await this.cdpBrowser.newPage();
        this.activePageIdx = 0;
      }

      log.info(`Połączono z istniejącą przeglądarką na porcie ${port}`);
      return true;
    } catch (err: any) {
      log.info(`Nie udało się połączyć z istniejącą przeglądarką: ${err.message}`);
      return false;
    }
  }

  /**
   * Check if the browser is already running with the given user data dir.
   * Chrome creates a lockfile 'SingletonLock' (Linux/Mac) or 'lockfile' (Windows).
   */
  private async isBrowserProfileLocked(profileDir: string, browserExe?: string): Promise<boolean> {
    const lockFiles = [path.join(profileDir, 'SingletonLock'), path.join(profileDir, 'lockfile')];

    for (const lf of lockFiles) {
      try {
        await fs.promises.lstat(lf);
        return true;
      } catch {
        /* not found */
      }
    }

    // Windows: check if the specific browser process is running
    if (process.platform === 'win32') {
      const processName = browserExe ? path.basename(browserExe).toLowerCase() : null;
      const targets = processName ? [processName] : ['chrome.exe', 'msedge.exe', 'brave.exe'];
      try {
        const result = execSync('tasklist /FI "STATUS eq Running" /FO CSV /NH', {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        });
        const lower = result.toLowerCase();
        return targets.some((t) => lower.includes(t));
      } catch {
        /* ignore */
      }
    }

    return false;
  }

  // ════════════════════════════════════════════════════
  //  CDP Discovery & Profile Sharing
  // ════════════════════════════════════════════════════

  /**
   * Quick check if a CDP endpoint responds on a given port.
   * Optionally verifies the owning process matches the expected browser executable.
   */
  private checkCDPPort(port: number, browserExe?: string): Promise<string | null> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', async () => {
          try {
            const info = JSON.parse(data);
            const ws = info.webSocketDebuggerUrl;
            if (!ws) {
              resolve(null);
              return;
            }

            // If no browserExe provided, skip ownership check
            if (!browserExe) {
              resolve(ws);
              return;
            }

            // Verify process ownership of this port
            const ownerMatch = await this.verifyPortOwner(port, browserExe, info);
            if (ownerMatch) {
              resolve(ws);
            } else {
              log.warn(`CDP port ${port} belongs to a different process, skipping`);
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  /**
   * Verify that the process listening on a given port matches the expected browser executable.
   * Uses OS-specific methods to determine the PID owning the port, then checks the process path.
   * Falls back to checking the Browser field in /json/version response.
   */
  private async verifyPortOwner(port: number, browserExe: string, versionInfo: any): Promise<boolean> {
    const expectedName = path
      .basename(browserExe)
      .toLowerCase()
      .replace(/\.exe$/i, '');

    // OS-specific PID lookup
    try {
      if (process.platform === 'win32') {
        // Use netstat to find PID listening on the port, then verify process name
        const netstatResult = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        }).trim();
        const pidMatch = netstatResult.match(/\s(\d+)\s*$/m);
        if (pidMatch) {
          const pid = pidMatch[1];
          try {
            const wmicResult = execSync(`wmic process where "ProcessId=${pid}" get ExecutablePath /FORMAT:LIST`, {
              encoding: 'utf-8',
              timeout: 5000,
              windowsHide: true,
            });
            const exeMatch = wmicResult.match(/ExecutablePath=(.+)/);
            if (exeMatch) {
              const ownerExe = exeMatch[1].trim().toLowerCase();
              if (ownerExe.includes(expectedName)) return true;
              log.info(`Port ${port} owned by ${ownerExe}, expected ${expectedName}`);
              return false;
            }
          } catch {
            /* WMIC may fail for system processes */
          }
        }
      } else if (process.platform === 'linux') {
        // Use /proc/net/tcp or lsof
        try {
          const lsofResult = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`, {
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
          const pid = lsofResult.split('\n')[0];
          if (pid) {
            try {
              const exePath = fs.readlinkSync(`/proc/${pid}/exe`);
              if (exePath.toLowerCase().includes(expectedName)) return true;
              log.info(`Port ${port} owned by ${exePath}, expected ${expectedName}`);
              return false;
            } catch {
              /* readlink may fail without permissions */
            }
          }
        } catch {
          /* lsof may not be available */
        }
      } else if (process.platform === 'darwin') {
        try {
          const lsofResult = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`, {
            encoding: 'utf-8',
            timeout: 5000,
          }).trim();
          const pid = lsofResult.split('\n')[0];
          if (pid) {
            const psResult = execSync(`ps -p ${pid} -o comm= 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 })
              .trim()
              .toLowerCase();
            if (psResult.includes(expectedName)) return true;
            log.info(`Port ${port} owned by ${psResult}, expected ${expectedName}`);
            return false;
          }
        } catch {
          /* lsof/ps may fail */
        }
      }
    } catch {
      /* OS-level check failed, fall through to secondary check */
    }

    // Secondary fallback: check /json/version Browser field
    const browser = (versionInfo?.Browser || versionInfo?.['User-Agent'] || '').toLowerCase();
    if (browser && (browser.includes('chrome') || browser.includes('edge') || browser.includes('brave'))) {
      // Check if the browser name in version info matches what we expect
      if (expectedName.includes('chrome') && browser.includes('chrome')) return true;
      if (expectedName.includes('msedge') && browser.includes('edge')) return true;
      if (expectedName.includes('brave') && browser.includes('brave')) return true;
      // Browser responded but doesn't match expected
      log.info(`CDP /json/version reports "${browser}", expected ${expectedName}`);
      return false;
    }

    // If we can't determine ownership, accept the port (best-effort)
    return true;
  }

  /**
   * Find a running browser with CDP debug port.
   *   1. Parse process command line for --remote-debugging-port (Windows)
   *   2. Scan common debug ports (9222-9225, 9229)
   */
  private async findRunningCDPPort(browserExe: string): Promise<{ port: number; wsUrl: string } | null> {
    const name = path.basename(browserExe).toLowerCase();

    // Strategy 1: Windows — extract port from process command line
    if (process.platform === 'win32') {
      try {
        const result = execSync(`wmic process where "name='${name}'" get CommandLine /FORMAT:LIST`, {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        });
        const match = result.match(/--remote-debugging-port=(\d+)/);
        if (match) {
          const port = parseInt(match[1], 10);
          if (port > 0) {
            const wsUrl = await this.checkCDPPort(port, browserExe);
            if (wsUrl) {
              log.info(`Znaleziono CDP port ${port} w procesie ${name}`);
              return { port, wsUrl };
            }
          }
        }
      } catch {
        /* process not found */
      }
    }

    // Strategy 2: Scan common debug ports (verify ownership against detected browser)
    for (const port of [9222, 9223, 9224, 9225, 9229]) {
      const wsUrl = await this.checkCDPPort(port, browserExe);
      if (wsUrl) {
        log.info(`Znaleziono CDP na porcie ${port} (skan portów)`);
        return { port, wsUrl };
      }
    }

    return null;
  }

  /**
   * Prevent "Chrome didn't shut down correctly" crash bar by marking the profile
   * as cleanly exited. Mirrors OpenClaw's `ensureProfileCleanExit`.
   */
  private async ensureProfileCleanExit(userDataDir: string): Promise<void> {
    const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
    try {
      let prefs: Record<string, any> = {};
      let prefsExists = false;
      try {
        await fs.promises.access(prefsPath);
        prefsExists = true;
      } catch {
        prefsExists = false;
      }
      if (prefsExists) {
        const raw = await fs.promises.readFile(prefsPath, 'utf-8');
        try {
          prefs = JSON.parse(raw);
        } catch {
          prefs = {};
        }
      } else {
        await fs.promises.mkdir(path.join(userDataDir, 'Default'), { recursive: true });
      }

      // Mark as clean exit — prevents "Restore pages?" crash bar
      prefs['exit_type'] = 'Normal';
      prefs['exited_cleanly'] = true;

      // Suppress "Your settings were changed by another application" popup
      if (!prefs['browser']) prefs['browser'] = {};
      prefs['browser']['check_default_browser'] = false;

      await fs.promises.writeFile(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
      log.info('ensureProfileCleanExit: Preferences patched');
    } catch (err: any) {
      log.warn(`ensureProfileCleanExit failed: ${err.message}`);
    }
  }

  /**
   * Suppress the yellow "Unsupported command-line flag" warning bar by setting
   * `commandLineFlagSecurityWarningsEnabled: false` in Chrome's Local State file.
   */
  private async suppressCommandLineFlagWarning(userDataDir: string): Promise<void> {
    const localStatePath = path.join(userDataDir, 'Local State');
    try {
      let state: Record<string, any> = {};
      let stateExists = false;
      try {
        await fs.promises.access(localStatePath);
        stateExists = true;
      } catch {
        stateExists = false;
      }
      if (stateExists) {
        const raw = await fs.promises.readFile(localStatePath, 'utf-8');
        try {
          state = JSON.parse(raw);
        } catch {
          state = {};
        }
      }

      if (!state['browser']) state['browser'] = {};
      state['browser']['enabled_labs_experiments'] = state['browser']['enabled_labs_experiments'] || [];
      state['browser']['command_line_flag_security_warnings_enabled'] = false;

      await fs.promises.writeFile(localStatePath, JSON.stringify(state, null, 2), 'utf-8');
      log.info('suppressCommandLineFlagWarning: Local State patched');
    } catch (err: any) {
      log.warn(`suppressCommandLineFlagWarning failed: ${err.message}`);
    }
  }

  /**
   * Copy key profile files (cookies, logins, preferences) from user's profile
   * to a target dir. Enables session sharing when the original profile is locked
   * by a running browser instance.
   *
   * WARNING: SQLite DB files (Cookies, Login Data, Web Data) may be open with WAL
   * by the running Chrome process. Direct copy can produce inconsistent/corrupt DBs.
   * We mitigate this by:
   *   1. Attempting `sqlite3 ".backup"` subprocess for a consistent snapshot
   *   2. Falling back to a short retry loop with delay before direct copy
   * Non-DB files (Preferences, Local State) are safe to copy directly.
   */
  private async copyProfileForSharing(userProfileDir: string, targetDir: string): Promise<boolean> {
    const rootFiles = ['Local State'];
    // SQLite DB files that Chrome may hold open with WAL — need safe copy
    const sqliteFiles = ['Cookies', 'Login Data', 'Web Data', 'Extension Cookies'];
    const profileFiles = [
      'Cookies',
      'Cookies-journal',
      'Login Data',
      'Login Data-journal',
      'Web Data',
      'Web Data-journal',
      'Preferences',
      'Secure Preferences',
      'Extension Cookies',
      'Extension Cookies-journal',
    ];

    try {
      await fs.promises.mkdir(path.join(targetDir, 'Default'), { recursive: true });
    } catch {
      /* exists */
    }

    let copied = 0;
    const warnings: string[] = [];

    for (const file of rootFiles) {
      try {
        const src = path.join(userProfileDir, file);
        let srcExists = false;
        try {
          await fs.promises.access(src);
          srcExists = true;
        } catch {
          srcExists = false;
        }
        if (srcExists) {
          await fs.promises.copyFile(src, path.join(targetDir, file));
          copied++;
        }
      } catch (err: any) {
        log.warn(`Nie skopiowano ${file}: ${err.message}`);
      }
    }

    for (const file of profileFiles) {
      const src = path.join(userProfileDir, 'Default', file);
      const dst = path.join(targetDir, 'Default', file);
      let srcExists = false;
      try {
        await fs.promises.access(src);
        srcExists = true;
      } catch {
        // srcExists remains false
      }
      if (!srcExists) continue;

      const isSqliteDb = sqliteFiles.includes(file);

      if (isSqliteDb) {
        // Try sqlite3 .backup for a consistent snapshot
        if (await this.trySqliteBackup(src, dst)) {
          log.info(`${file}: skopiowano przez sqlite3 backup (bezpieczne)`);
          copied++;
          continue;
        }

        // Fallback: retry loop with short delay before direct copy
        let directCopyOk = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) {
              // Short delay — acceptable here as this runs once at launch
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            await fs.promises.copyFile(src, dst);
            directCopyOk = true;
            break;
          } catch {
            /* retry */
          }
        }

        if (directCopyOk) {
          log.warn(`${file}: skopiowano bezpośrednio (WAL może powodować niespójność)`);
          warnings.push(file);
          copied++;
        } else {
          log.warn(`${file}: nie udało się skopiować po 3 próbach`);
        }
      } else {
        // Non-SQLite files — safe to copy directly
        try {
          await fs.promises.copyFile(src, dst);
          copied++;
        } catch (err: any) {
          log.warn(`Nie skopiowano Default/${file}: ${err.message}`);
        }
      }
    }

    if (warnings.length > 0) {
      log.warn(`Pliki skopiowane bezpośrednio (ryzyko WAL): ${warnings.join(', ')}`);
    }
    log.info(`Skopiowano ${copied} plików profilu → ${targetDir}`);
    return copied > 0;
  }

  /**
   * Attempt a consistent SQLite backup via `sqlite3` CLI subprocess.
   * Returns true if successful, false otherwise (sqlite3 not installed, locked, etc.).
   */
  private async trySqliteBackup(srcDb: string, dstDb: string): Promise<boolean> {
    try {
      execSync(`sqlite3 "${srcDb}" ".backup '${dstDb}'"`, { timeout: 5000, windowsHide: true, stdio: 'ignore' });
      try {
        await fs.promises.access(dstDb);
        return true;
      } catch {
        return false;
      }
    } catch (err: any) {
      log.info(`sqlite3 backup niedostępny/błąd: ${err.message}`);
      return false;
    }
  }

  // ════════════════════════════════════════════════════
  //  Browser Detection — cross-platform
  // ════════════════════════════════════════════════════

  /**
   * Detect installed Chromium-based browser.
   * Priority: Chrome → Edge → Brave → Chromium.
   */
  private async detectBrowser(): Promise<string | null> {
    const platform = process.platform;
    if (platform === 'win32') return this.detectBrowserWindows();
    if (platform === 'darwin') return this.detectBrowserMac();
    return this.detectBrowserLinux();
  }

  private async detectBrowserWindows(): Promise<string | null> {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';

    const candidates = [
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
    ];

    for (const p of candidates) {
      try {
        await fs.promises.access(p);
        return p;
      } catch {
        // not found — try next
      }
    }
    return null;
  }

  private async detectBrowserMac(): Promise<string | null> {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      `${os.homedir()}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
    ];

    for (const p of candidates) {
      try {
        await fs.promises.access(p);
        return p;
      } catch {
        // not found — try next
      }
    }

    // macOS Spotlight fallback
    try {
      const result = execSync('mdfind "kMDItemCFBundleIdentifier == \'com.google.Chrome\'" 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      if (result) {
        const chromePath = path.join(result.split('\n')[0], 'Contents/MacOS/Google Chrome');
        try {
          await fs.promises.access(chromePath);
          return chromePath;
        } catch {
          // not found
        }
      }
    } catch {
      /* not found */
    }

    return null;
  }

  private async detectBrowserLinux(): Promise<string | null> {
    const names = [
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      'microsoft-edge',
      'microsoft-edge-stable',
      'brave-browser',
    ];

    for (const name of names) {
      try {
        const result = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
        if (result) return result;
      } catch {
        /* not found */
      }
    }
    return null;
  }

  // ════════════════════════════════════════════════════
  //  Launch & Connect
  // ════════════════════════════════════════════════════

  /**
   * Launch a visible browser and optionally navigate to a URL.
   */
  async launch(options?: BrowserLaunchOptions): Promise<BrowserResult> {
    if (this.cdpBrowser) {
      return { success: false, error: 'Przeglądarka jest już uruchomiona. Zamknij ją najpierw (browser_close).' };
    }

    const execPath = await this.detectBrowser();
    if (!execPath) {
      return {
        success: false,
        error: 'Nie znaleziono przeglądarki Chromium (Chrome / Edge / Brave). Zainstaluj jedną z nich.',
      };
    }

    try {
      // Resolve user's real browser profile
      const realProfileDir = await this.getUserProfileDir(execPath);
      this.userDataDir = realProfileDir;

      // ── Strategy 1: DevToolsActivePort file in profile dir ──
      if (await this.tryConnectToExisting(realProfileDir)) {
        log.info('Połączono przez DevToolsActivePort — sesja użytkownika');
        return this.afterConnect(execPath, options, 'istniejąca sesja');
      }

      // ── Strategy 2: Find running browser with CDP debug port ──
      const existing = await this.findRunningCDPPort(execPath);
      if (existing) {
        try {
          this.cdpBrowser = await CDPBrowser.connect(existing.wsUrl);
          this.debugPort = existing.port;
          // Open a new tab for the agent — don't hijack existing user tabs
          this.activePage = await this.cdpBrowser.newPage();
          const targets = await this.cdpBrowser.getTargets();
          this.activePageIdx = targets.findIndex((t) => t.id === this.activePage!.targetId);
          if (this.activePageIdx < 0) this.activePageIdx = 0;
          log.info(`Połączono z istniejącym CDP na porcie ${existing.port} — sesja użytkownika`);
          return this.afterConnect(execPath, options, 'istniejąca sesja CDP');
        } catch (err: any) {
          log.warn(`CDP połączenie nie powiodło się: ${err.message}`);
        }
      }

      // ── Strategy 3: Profile not locked → launch with user's real profile ──
      if (!(await this.isBrowserProfileLocked(realProfileDir, execPath))) {
        try {
          this.userDataDir = realProfileDir;
          try {
            await fs.promises.access(this.userDataDir);
          } catch {
            await fs.promises.mkdir(this.userDataDir, { recursive: true });
          }
          await this.launchViaCDP(execPath, options);
          log.info('Uruchomiono z profilem użytkownika (przeglądarka nie działała)');
          return this.afterConnect(execPath, options, 'profil użytkownika');
        } catch (strategyErr: any) {
          log.warn(`Strategy 3 failed (TOCTOU race?): ${strategyErr.message}`);
          log.warn('Falling back to Strategy 4 (temporary profile with copied cookies)...');
          this.cdpBrowser = null;
          this.activePage = null;
          if (this.browserProcess) {
            try {
              this.browserProcess.kill();
            } catch {
              /* ignore */
            }
            this.browserProcess = null;
          }
        }
      }

      // ── Strategy 4: Profile locked → use persistent KxAI profile ──
      const kxaiProfileDir = path.join(app.getPath('userData'), 'browser-profile');
      let isFirstLaunch = false;
      try {
        await fs.promises.access(path.join(kxaiProfileDir, 'Default', 'Preferences'));
      } catch {
        isFirstLaunch = true;
      }

      let cookiesCopied = false;

      if (isFirstLaunch) {
        log.info('Pierwsza sesja KxAI — próbuję skopiować cookies z profilu użytkownika...');
        try {
          cookiesCopied = await this.copyProfileForSharing(realProfileDir, kxaiProfileDir);
          log.info(
            `Kopia cookies: ${cookiesCopied ? 'OK — cookies skopiowane' : 'BRAK — profil izolowany (zaloguj się ręcznie)'}`,
          );
        } catch (copyErr: any) {
          log.warn(`Kopia cookies nieudana: ${copyErr.message} — profil izolowany`);
        }
      } else {
        log.info('Używam istniejącego profilu KxAI (sesje zachowane z poprzednich uruchomień)');
        cookiesCopied = true;
      }

      this.userDataDir = kxaiProfileDir;
      try {
        await fs.promises.access(this.userDataDir);
      } catch {
        await fs.promises.mkdir(this.userDataDir, { recursive: true });
      }
      await this.launchViaCDP(execPath, options);

      const label = isFirstLaunch
        ? cookiesCopied
          ? 'profil KxAI (cookies skopiowane)'
          : 'profil KxAI — izolowany (zaloguj się raz, sesje zostaną zapamiętane)'
        : 'profil KxAI (zachowane sesje)';
      log.info(`Uruchomiono z ${label}`);
      return this.afterConnect(execPath, options, label);
    } catch (err: any) {
      await this.close();
      return { success: false, error: `Błąd uruchamiania przeglądarki: ${err.message}` };
    }
  }

  /**
   * Common post-connection logic: navigate to URL if specified, return result.
   */
  private async afterConnect(execPath: string, options?: BrowserLaunchOptions, label?: string): Promise<BrowserResult> {
    if (options?.url && this.activePage) {
      await this.activePage.navigate(options.url, { timeout: 30000 });
    }
    return {
      success: true,
      data: {
        browser: path.basename(execPath) + (label ? ` (${label})` : ''),
        url: this.activePage?.url() || 'about:blank',
        title: this.activePage ? await this.activePage.title() : '',
      },
    };
  }

  /**
   * Spawn browser with remote debugging and connect via CDP.
   */
  private async launchViaCDP(execPath: string, options?: BrowserLaunchOptions): Promise<void> {
    this.debugPort = await this.findFreePort();

    const width = options?.width || 1280;
    const height = options?.height || 900;
    const headless = options?.headless ?? false;

    // ── Pre-launch: patch profile to suppress crash/warning bars ──
    this.ensureProfileCleanExit(this.userDataDir);
    this.suppressCommandLineFlagWarning(this.userDataDir);

    const args = [
      `--remote-debugging-port=${this.debugPort}`,
      `--user-data-dir=${this.userDataDir}`,
      `--window-size=${width},${height}`,
      // ── Stealth: suppress all Chrome info bars, popups, crash bubbles ──
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--password-store=basic',
      '--disable-features=Translate,MediaRouter,AutomationControlled',
      '--disable-component-update',
      '--disable-search-engine-choice-screen',
      '--disable-default-apps',
      '--disable-domain-reliability',
      '--disable-client-side-phishing-detection',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--metrics-recording-only',
      '--no-service-autorun',
      '--safebrowsing-disable-auto-update',
    ];

    if (headless) {
      args.push('--headless=new');
    }

    if (process.platform === 'linux') {
      args.push('--disable-dev-shm-usage', '--no-sandbox');
    }

    // Start with blank page — avoids restoring previous session
    args.push('about:blank');

    this.browserProcess = spawn(execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this.browserProcess.on('error', (err) => {
      log.error('Process error:', err);
    });

    this.browserProcess.on('exit', (code) => {
      log.info(`Browser process exited (code ${code})`);
      this.cdpBrowser = null;
      this.activePage = null;
      this.browserProcess = null;
    });

    // Wait for browser ready
    const wsEndpoint = await this.waitForBrowserReady(this.debugPort, 15000);

    // Connect via native CDP (no Playwright!)
    this.cdpBrowser = await CDPBrowser.connect(wsEndpoint);

    // Attach to the first available page target
    const targets = await this.cdpBrowser.getTargets();
    if (targets.length > 0) {
      this.activePage = await this.cdpBrowser.attachToPage(targets[0]);
    } else {
      this.activePage = await this.cdpBrowser.newPage();
    }
    this.activePageIdx = 0;

    log.info(`Connected via native CDP on port ${this.debugPort}`);
  }

  /**
   * Poll /json/version until Chrome's WebSocket debugger URL appears.
   */
  private waitForBrowserReady(port: number, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      const poll = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout (${timeoutMs}ms) — przeglądarka nie wystartowała`));
          return;
        }

        const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => {
            try {
              const ws = JSON.parse(data).webSocketDebuggerUrl;
              if (ws) {
                resolve(ws);
                return;
              }
            } catch {
              /* retry */
            }
            setTimeout(poll, 250);
          });
        });

        req.on('error', () => setTimeout(poll, 250));
        req.setTimeout(2000, () => {
          req.destroy();
          setTimeout(poll, 250);
        });
      };

      poll();
    });
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  // ════════════════════════════════════════════════════
  //  Internal helpers
  // ════════════════════════════════════════════════════

  private getActivePage(): CDPPage | null {
    if (!this.activePage || !this.activePage.connected) return null;
    return this.activePage;
  }

  isRunning(): boolean {
    return this.cdpBrowser !== null && this.cdpBrowser.connected;
  }

  // ════════════════════════════════════════════════════
  //  Navigation
  // ════════════════════════════════════════════════════

  async navigate(url: string): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      await page.navigate(url, { timeout: 30000 });
      return { success: true, data: { url: page.url(), title: await page.title() } };
    } catch (err: any) {
      return { success: false, error: `Nawigacja: ${err.message}` };
    }
  }

  async goBack(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };
    try {
      await page.goBack(15000);
      return { success: true, data: { url: page.url(), title: await page.title() } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async goForward(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };
    try {
      await page.goForward(15000);
      return { success: true, data: { url: page.url(), title: await page.title() } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  // ════════════════════════════════════════════════════
  //  Snapshot — Accessibility Tree with Refs
  // ════════════════════════════════════════════════════

  /**
   * Returns a text representation of the page with numbered refs
   * ([e1], [e2]...) on interactive elements.
   *
   * AI reads the text tree, picks a ref, then calls browser_click / browser_type.
   */
  async snapshot(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const result: SnapshotResult = await page.evaluate(SNAPSHOT_SCRIPT);

      if (result.totalRefs === 0) {
        return {
          success: true,
          data: {
            ...result,
            hint: 'Brak interaktywnych elementów. Użyj browser_navigate lub browser_evaluate.',
          },
        };
      }

      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: `Snapshot error: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  Actions (ref-based)
  // ════════════════════════════════════════════════════

  /**
   * Click element by ref (e.g., "e5").
   */
  async click(
    ref: string,
    options?: {
      button?: 'left' | 'right' | 'middle';
      doubleClick?: boolean;
    },
  ): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const selector = `[data-kxref="${ref}"]`;
      const count = await page.queryCount(selector);
      if (count === 0) {
        return { success: false, error: `Element [${ref}] nie znaleziony. Weź nowy snapshot.` };
      }

      const urlBefore = page.url();

      await page.click(selector, {
        button: options?.button || 'left',
        doubleClick: options?.doubleClick,
        timeout: 10000,
      });

      // Smart wait: if click triggered navigation, wait for load; otherwise short delay
      try {
        await page.waitForLoad(3000);
      } catch {
        // Timeout = no navigation happened, that's fine
      }
      const urlAfter = page.url();
      const navigated = urlAfter !== urlBefore;
      return {
        success: true,
        data: {
          action: options?.doubleClick ? 'double-click' : 'click',
          ref,
          navigated,
          url: urlAfter,
          title: await page.title(),
        },
      };
    } catch (err: any) {
      return { success: false, error: `Click [${ref}]: ${err.message}` };
    }
  }

  /**
   * Type text into input element by ref.
   */
  async type(
    ref: string,
    text: string,
    options?: {
      clear?: boolean;
      submit?: boolean;
    },
  ): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const selector = `[data-kxref="${ref}"]`;
      const count = await page.queryCount(selector);
      if (count === 0) {
        return { success: false, error: `Element [${ref}] nie znaleziony. Weź nowy snapshot.` };
      }

      if (options?.clear !== false) {
        // fill = clear + set value (default behavior)
        await page.fill(selector, text, { timeout: 10000 });
      } else {
        // Type char by char (realistic keyboard simulation)
        // First focus the element
        await page.click(selector, { timeout: 10000 });
        await page.typeText(text, { delay: 30 });
      }

      if (options?.submit) {
        await page.press('Enter');
        await page.sleep(500);
      }

      return {
        success: true,
        data: { action: 'type', ref, text: text.slice(0, 50), submitted: !!options?.submit },
      };
    } catch (err: any) {
      return { success: false, error: `Type [${ref}]: ${err.message}` };
    }
  }

  /**
   * Hover over element by ref.
   */
  async hover(ref: string): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      await page.hover(`[data-kxref="${ref}"]`, { timeout: 10000 });
      return { success: true, data: { action: 'hover', ref } };
    } catch (err: any) {
      return { success: false, error: `Hover [${ref}]: ${err.message}` };
    }
  }

  /**
   * Select option from <select> by ref.
   */
  async selectOption(ref: string, values: string | string[]): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      await page.selectOption(`[data-kxref="${ref}"]`, values, { timeout: 10000 });
      return { success: true, data: { action: 'select', ref, values } };
    } catch (err: any) {
      return { success: false, error: `Select [${ref}]: ${err.message}` };
    }
  }

  /**
   * Press keyboard key(s) — e.g., "Enter", "Tab", "Control+a", "Escape".
   */
  async press(key: string): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      await page.press(key);
      await page.sleep(200);
      return { success: true, data: { action: 'press', key } };
    } catch (err: any) {
      return { success: false, error: `Press "${key}": ${err.message}` };
    }
  }

  /**
   * Scroll the page.
   */
  async scroll(direction: 'up' | 'down' | 'top' | 'bottom', amount?: number): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      switch (direction) {
        case 'up':
          await page.mouseWheel(0, -(amount || 500));
          break;
        case 'down':
          await page.mouseWheel(0, amount || 500);
          break;
        case 'top':
          await page.evaluate('window.scrollTo(0, 0)');
          break;
        case 'bottom':
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
          break;
      }
      await page.sleep(300);
      return { success: true, data: { action: 'scroll', direction, amount } };
    } catch (err: any) {
      return { success: false, error: `Scroll: ${err.message}` };
    }
  }

  /**
   * Scroll to a specific element by ref — brings it into view.
   */
  async scrollToRef(ref: string): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const selector = `[data-kxref="${ref}"]`;
      const count = await page.queryCount(selector);
      if (count === 0) {
        return { success: false, error: `Element [${ref}] nie znaleziony. Weź nowy snapshot.` };
      }
      await page.scrollIntoView(selector, { timeout: 5000 });
      await page.sleep(300);
      return { success: true, data: { action: 'scroll-to-ref', ref } };
    } catch (err: any) {
      return { success: false, error: `ScrollToRef [${ref}]: ${err.message}` };
    }
  }

  /**
   * Dismiss cookie/consent banners — tries common patterns.
   */
  async dismissPopups(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const dismissed: string[] = [];
      // Common cookie consent selectors
      const selectors = [
        '[id*="cookie"] button[id*="accept"]',
        '[id*="cookie"] button[id*="agree"]',
        '[class*="cookie"] button[class*="accept"]',
        '[class*="consent"] button[class*="accept"]',
        '[id*="consent"] button:first-of-type',
        'button[id*="accept-cookies"]',
        'button[id*="onetrust-accept"]',
        '.cc-btn.cc-dismiss',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        'button[data-testid*="cookie-accept"]',
        '[aria-label*="Accept"]',
        '[aria-label*="Akceptuj"]',
        '[aria-label*="Zamknij"]',
      ];

      for (const sel of selectors) {
        try {
          const visible = await page.isVisible(sel);
          if (visible) {
            await page.click(sel, { timeout: 2000 });
            dismissed.push(sel);
            await page.sleep(500);
            break; // One dismissal is usually enough
          }
        } catch {
          /* selector not found — try next */
        }
      }

      return {
        success: true,
        data:
          dismissed.length > 0
            ? { dismissed: dismissed.length, selectors: dismissed }
            : { dismissed: 0, message: 'Nie znaleziono popupów do zamknięcia' },
      };
    } catch (err: any) {
      return { success: false, error: `DismissPopups: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  Screenshot
  // ════════════════════════════════════════════════════

  async screenshot(options?: { fullPage?: boolean; ref?: string }): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      let buffer: Buffer;

      if (options?.ref) {
        buffer = await page.screenshotElement(`[data-kxref="${options.ref}"]`, {
          quality: 80,
          format: 'jpeg',
          timeout: 10000,
        });
      } else {
        buffer = await page.screenshot({
          quality: 80,
          format: 'jpeg',
          fullPage: options?.fullPage ?? false,
        });
      }

      return {
        success: true,
        data: { base64: buffer.toString('base64'), url: page.url(), title: await page.title() },
      };
    } catch (err: any) {
      return { success: false, error: `Screenshot: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  Tab Management
  // ════════════════════════════════════════════════════

  async tabs(): Promise<BrowserResult> {
    if (!this.cdpBrowser) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const targets = await this.cdpBrowser.getTargets();
      const list: TabInfo[] = [];

      for (let i = 0; i < targets.length; i++) {
        list.push({
          index: i,
          url: targets[i].url,
          title: targets[i].title,
          active: this.activePage?.targetId === targets[i].id,
        });
      }

      return { success: true, data: list };
    } catch (err: any) {
      return { success: false, error: `Tabs: ${err.message}` };
    }
  }

  async newTab(url?: string): Promise<BrowserResult> {
    if (!this.cdpBrowser) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const newPage = await this.cdpBrowser.newPage(url);
      this.activePage = newPage;

      const targets = await this.cdpBrowser.getTargets();
      this.activePageIdx = targets.findIndex((t) => t.id === newPage.targetId);
      if (this.activePageIdx < 0) this.activePageIdx = targets.length - 1;

      return {
        success: true,
        data: {
          index: this.activePageIdx,
          url: newPage.url(),
          title: await newPage.title(),
          totalTabs: targets.length,
        },
      };
    } catch (err: any) {
      return { success: false, error: `New tab: ${err.message}` };
    }
  }

  async switchTab(index: number): Promise<BrowserResult> {
    if (!this.cdpBrowser) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const targets = await this.cdpBrowser.getTargets();
      if (index < 0 || index >= targets.length) {
        return { success: false, error: `Tab ${index} nie istnieje (0-${targets.length - 1})` };
      }

      this.activePageIdx = index;
      this.activePage = await this.cdpBrowser.attachToPage(targets[index]);
      try {
        await this.activePage.bringToFront();
      } catch {
        /* ok */
      }

      return { success: true, data: { index, url: this.activePage.url(), title: await this.activePage.title() } };
    } catch (err: any) {
      return { success: false, error: `Switch tab: ${err.message}` };
    }
  }

  async closeTab(index?: number): Promise<BrowserResult> {
    if (!this.cdpBrowser) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const targets = await this.cdpBrowser.getTargets();
      const idx = index ?? this.activePageIdx;

      if (idx < 0 || idx >= targets.length) return { success: false, error: `Tab ${idx} nie istnieje` };
      if (targets.length <= 1)
        return { success: false, error: 'Nie można zamknąć ostatniego taba. Użyj browser_close.' };

      await this.cdpBrowser.closePage(targets[idx].id);

      // Update active page
      const remainingTargets = await this.cdpBrowser.getTargets();
      if (this.activePageIdx >= remainingTargets.length) {
        this.activePageIdx = remainingTargets.length - 1;
      }
      if (remainingTargets.length > 0) {
        this.activePage = await this.cdpBrowser.attachToPage(remainingTargets[this.activePageIdx]);
      }

      return {
        success: true,
        data: { closedIndex: idx, activeIndex: this.activePageIdx, totalTabs: remainingTargets.length },
      };
    } catch (err: any) {
      return { success: false, error: `Close tab: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  JavaScript Evaluation
  // ════════════════════════════════════════════════════

  async evaluate(script: string): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const wrappedScript = `(() => {
        try {
          const fn = new Function(${JSON.stringify(script)});
          const r = fn();
          return { ok: true, value: typeof r === 'object' ? JSON.stringify(r, null, 2) : String(r ?? 'undefined') };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()`;
      const result: { ok: boolean; value?: string; error?: string } = await page.evaluate(wrappedScript);

      return result.ok ? { success: true, data: result.value } : { success: false, error: `JS error: ${result.error}` };
    } catch (err: any) {
      return { success: false, error: `Evaluate: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  Wait
  // ════════════════════════════════════════════════════

  async wait(options: {
    type: 'selector' | 'url' | 'load' | 'timeout';
    value?: string;
    timeout?: number;
  }): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    const ms = Math.min(options.timeout || 10000, 30000);

    try {
      switch (options.type) {
        case 'selector':
          if (!options.value) return { success: false, error: 'Brak selektora' };
          await page.waitForSelector(options.value, ms);
          return { success: true, data: `Selector "${options.value}" znaleziony` };
        case 'url':
          if (!options.value) return { success: false, error: 'Brak URL' };
          await page.waitForURL(options.value, ms);
          return { success: true, data: `URL matches "${options.value}"` };
        case 'load':
          await page.waitForNetworkIdle(ms);
          return { success: true, data: 'Network idle' };
        case 'timeout': {
          const delay = Math.min(parseInt(options.value || '1000', 10), 10000);
          await page.sleep(delay);
          return { success: true, data: `Waited ${delay}ms` };
        }
        default:
          return { success: false, error: `Nieznany typ: ${options.type}` };
      }
    } catch (err: any) {
      return { success: false, error: `Wait: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  Page Info
  // ════════════════════════════════════════════════════

  async getPageInfo(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const targets = this.cdpBrowser ? await this.cdpBrowser.getTargets() : [];
      return {
        success: true,
        data: { url: page.url(), title: await page.title(), tabIndex: this.activePageIdx, totalTabs: targets.length },
      };
    } catch (err: any) {
      return { success: false, error: `PageInfo: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  Batch Form Fill
  // ════════════════════════════════════════════════════

  async fillForm(fields: Array<{ ref: string; value: string }>): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    const results: Array<{ ref: string; ok: boolean; error?: string }> = [];

    for (const f of fields) {
      try {
        const selector = `[data-kxref="${f.ref}"]`;
        const count = await page.queryCount(selector);
        if (count === 0) {
          results.push({ ref: f.ref, ok: false, error: 'nie znaleziony' });
          continue;
        }

        const tag = await page.tagName(selector);
        if (tag === 'select') {
          await page.selectOption(selector, f.value, { timeout: 5000 });
        } else {
          await page.fill(selector, f.value, { timeout: 5000 });
        }
        results.push({ ref: f.ref, ok: true });
      } catch (err: any) {
        results.push({ ref: f.ref, ok: false, error: err.message });
      }
    }

    const allOk = results.every((r) => r.ok);
    return { success: allOk, data: results, error: allOk ? undefined : 'Niektóre pola nie wypełnione' };
  }

  // ════════════════════════════════════════════════════
  //  Extract Text
  // ════════════════════════════════════════════════════

  async extractText(selector?: string): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      let text: string;
      if (selector) {
        text = await page.innerText(selector, { timeout: 10000 });
      } else {
        text = await page.evaluate('document.body.innerText');
      }
      return { success: true, data: text.slice(0, 15000) };
    } catch (err: any) {
      return { success: false, error: `Extract text: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  Page Monitoring (Faza 1.5)
  // ════════════════════════════════════════════════════

  /**
   * Start real-time monitoring on the active page.
   * Captures: navigation, load, console, network, DOM mutation, dialog events.
   * Events are buffered internally — retrieve with getConsoleLogs / getNetworkLogs.
   */
  async startMonitoring(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      await page.enableMonitoring((event) => {
        log.debug(`[Monitor] ${event.type}: ${JSON.stringify(event.data).slice(0, 200)}`);
      });
      return { success: true, data: 'Monitoring strony włączony — zbieranie logów konsoli, sieci i nawigacji.' };
    } catch (err: any) {
      return { success: false, error: `Monitor: ${err.message}` };
    }
  }

  /** Stop monitoring and clear buffered logs */
  async stopMonitoring(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    page.disableMonitoring();
    return { success: true, data: 'Monitoring strony wyłączony.' };
  }

  /** Get buffered console log entries (max 500) */
  getConsoleLogs(limit = 50): BrowserResult {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    const logs = page.getConsoleLog().slice(-limit);
    return { success: true, data: logs };
  }

  /** Get buffered network log entries (max 500) */
  getNetworkLogs(limit = 50): BrowserResult {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    const logs = page.getNetworkLog().slice(-limit);
    return { success: true, data: logs };
  }

  /** Check monitoring status */
  isMonitoring(): boolean {
    const page = this.getActivePage();
    return page?.monitoring ?? false;
  }

  // ════════════════════════════════════════════════════
  //  Cleanup
  // ════════════════════════════════════════════════════

  async close(): Promise<void> {
    try {
      if (this.cdpBrowser) {
        this.cdpBrowser.close();
        this.cdpBrowser = null;
        this.activePage = null;
      }
    } catch {
      /* ignore */
    }

    if (this.browserProcess) {
      try {
        this.browserProcess.kill();
      } catch {
        /* ignore */
      }
      this.browserProcess = null;
    }

    this.activePageIdx = 0;
    log.info('Browser closed');
  }

  /**
   * Reset the KxAI browser profile — deletes persistent profile and reimports cookies
   * from user's real browser profile on next launch.
   */
  async resetProfile(): Promise<BrowserResult> {
    if (this.cdpBrowser) {
      return { success: false, error: 'Zamknij przeglądarkę (browser_close) przed resetem profilu.' };
    }

    const kxaiProfileDir = path.join(app.getPath('userData'), 'browser-profile');
    try {
      if (fs.existsSync(kxaiProfileDir)) {
        fs.rmSync(kxaiProfileDir, { recursive: true, force: true });
        log.info('Profil KxAI usunięty — cookies zostaną skopiowane przy następnym uruchomieniu');
      }
      return {
        success: true,
        data: 'Profil przeglądarki KxAI został zresetowany. Przy następnym uruchomieniu cookies zostaną skopiowane z Twojego profilu Chrome.',
      };
    } catch (err: any) {
      return { success: false, error: `Błąd resetu profilu: ${err.message}` };
    }
  }

  /**
   * Refresh cookies in KxAI profile from user's real browser (without full reset).
   * Must be called with browser closed.
   */
  async refreshCookies(): Promise<BrowserResult> {
    if (this.cdpBrowser) {
      return { success: false, error: 'Zamknij przeglądarkę (browser_close) przed odświeżeniem cookies.' };
    }

    const execPath = await this.detectBrowser();
    if (!execPath) {
      return { success: false, error: 'Nie znaleziono przeglądarki.' };
    }

    const realProfileDir = await this.getUserProfileDir(execPath);
    const kxaiProfileDir = path.join(app.getPath('userData'), 'browser-profile');

    try {
      const hasCookies = await this.copyProfileForSharing(realProfileDir, kxaiProfileDir);
      return {
        success: true,
        data: hasCookies
          ? 'Cookies/sesje odświeżone z profilu Chrome. Uruchom przeglądarkę ponownie.'
          : 'Nie udało się skopiować cookies — przeglądarka może być zablokowana.',
      };
    } catch (err: any) {
      return { success: false, error: `Błąd odświeżania cookies: ${err.message}` };
    }
  }

  closeAll(): void {
    this.close().catch(() => {});
  }
}
