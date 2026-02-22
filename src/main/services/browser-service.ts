import { execSync, ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';

/**
 * BrowserService — Playwright-based browser automation.
 *
 * Launches system Chrome / Edge / Chromium (headful, visible on screen),
 * connects via CDP, provides accessibility snapshots with numbered refs
 * for AI interaction (snapshot + ref pattern inspired by OpenClaw).
 *
 * Cross-platform: Windows, macOS, Linux.
 *
 * Flow:
 *   1. browser_launch  → spawn Chrome + connect via CDP
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
  // Playwright loaded dynamically (playwright-core)
  private pw: any = null;
  private browser: any = null;      // playwright Browser
  private context: any = null;      // playwright BrowserContext
  private activePageIdx = 0;
  private browserProcess: ChildProcess | null = null;
  private debugPort = 0;
  private userDataDir: string;

  constructor() {
    this.userDataDir = path.join(os.tmpdir(), 'kxai-browser-profile');
  }

  // ════════════════════════════════════════════════════
  //  Browser Detection — cross-platform
  // ════════════════════════════════════════════════════

  /**
   * Detect installed Chromium-based browser.
   * Priority: Chrome → Edge → Brave → Chromium.
   */
  private detectBrowser(): string | null {
    const platform = process.platform;
    if (platform === 'win32') return this.detectBrowserWindows();
    if (platform === 'darwin') return this.detectBrowserMac();
    return this.detectBrowserLinux();
  }

  private detectBrowserWindows(): string | null {
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
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private detectBrowserMac(): string | null {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      `${os.homedir()}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    // macOS Spotlight fallback
    try {
      const result = execSync(
        "mdfind \"kMDItemCFBundleIdentifier == 'com.google.Chrome'\" 2>/dev/null",
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      if (result) {
        const chromePath = path.join(result.split('\n')[0], 'Contents/MacOS/Google Chrome');
        if (fs.existsSync(chromePath)) return chromePath;
      }
    } catch { /* not found */ }

    return null;
  }

  private detectBrowserLinux(): string | null {
    const names = [
      'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
      'microsoft-edge', 'microsoft-edge-stable', 'brave-browser',
    ];

    for (const name of names) {
      try {
        const result = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 }).trim();
        if (result) return result;
      } catch { /* not found */ }
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
    if (this.browser) {
      return { success: false, error: 'Przeglądarka jest już uruchomiona. Zamknij ją najpierw (browser_close).' };
    }

    const execPath = this.detectBrowser();
    if (!execPath) {
      return {
        success: false,
        error: 'Nie znaleziono przeglądarki Chromium (Chrome / Edge / Brave). Zainstaluj jedną z nich.',
      };
    }

    try {
      if (!this.pw) {
        this.pw = require('playwright-core');
      }

      if (!fs.existsSync(this.userDataDir)) {
        fs.mkdirSync(this.userDataDir, { recursive: true });
      }

      await this.launchViaCDP(execPath, options);

      if (options?.url) {
        const page = this.getActivePage();
        if (page) {
          await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
      }

      const page = this.getActivePage();
      return {
        success: true,
        data: {
          browser: path.basename(execPath),
          url: page?.url() || 'about:blank',
          title: page ? await page.title() : '',
        },
      };
    } catch (err: any) {
      await this.close();
      return { success: false, error: `Błąd uruchamiania przeglądarki: ${err.message}` };
    }
  }

  /**
   * Spawn browser with remote debugging and connect via CDP.
   */
  private async launchViaCDP(execPath: string, options?: BrowserLaunchOptions): Promise<void> {
    this.debugPort = await this.findFreePort();

    const width = options?.width || 1280;
    const height = options?.height || 900;
    const headless = options?.headless ?? false;

    const args = [
      `--remote-debugging-port=${this.debugPort}`,
      `--user-data-dir=${this.userDataDir}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-background-networking',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
    ];

    if (headless) {
      args.push('--headless=new');
    }

    if (process.platform === 'linux') {
      args.push('--disable-dev-shm-usage', '--no-sandbox');
    }

    this.browserProcess = spawn(execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this.browserProcess.on('error', (err) => {
      console.error('[BrowserService] Process error:', err);
    });

    this.browserProcess.on('exit', (code) => {
      console.log(`[BrowserService] Browser process exited (code ${code})`);
      this.browser = null;
      this.context = null;
      this.browserProcess = null;
    });

    // Wait for browser ready
    const wsEndpoint = await this.waitForBrowserReady(this.debugPort, 15000);

    // Connect via Playwright CDP
    this.browser = await this.pw.chromium.connectOverCDP(wsEndpoint);

    const contexts = this.browser.contexts();
    this.context = contexts.length > 0
      ? contexts[0]
      : await this.browser.newContext({ viewport: { width, height }, locale: 'pl-PL' });

    this.activePageIdx = 0;

    if (this.context.pages().length === 0) {
      await this.context.newPage();
    }

    console.log(`[BrowserService] Connected via CDP on port ${this.debugPort}`);
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
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            try {
              const ws = JSON.parse(data).webSocketDebuggerUrl;
              if (ws) { resolve(ws); return; }
            } catch { /* retry */ }
            setTimeout(poll, 250);
          });
        });

        req.on('error', () => setTimeout(poll, 250));
        req.setTimeout(2000, () => { req.destroy(); setTimeout(poll, 250); });
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

  private getActivePage(): any | null {
    if (!this.context) return null;
    const pages = this.context.pages();
    if (pages.length === 0) return null;
    return pages[Math.min(this.activePageIdx, pages.length - 1)];
  }

  isRunning(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  // ════════════════════════════════════════════════════
  //  Navigation
  // ════════════════════════════════════════════════════

  async navigate(url: string): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { success: true, data: { url: page.url(), title: await page.title() } };
    } catch (err: any) {
      return { success: false, error: `Nawigacja: ${err.message}` };
    }
  }

  async goBack(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };
    try {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 });
      return { success: true, data: { url: page.url(), title: await page.title() } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async goForward(): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };
    try {
      await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 });
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
  async click(ref: string, options?: {
    button?: 'left' | 'right' | 'middle';
    doubleClick?: boolean;
  }): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const loc = page.locator(`[data-kxref="${ref}"]`);
      if (await loc.count() === 0) {
        return { success: false, error: `Element [${ref}] nie znaleziony. Weź nowy snapshot.` };
      }

      const urlBefore = page.url();

      if (options?.doubleClick) {
        await loc.dblclick({ button: options?.button || 'left', timeout: 10000 });
      } else {
        await loc.click({ button: options?.button || 'left', timeout: 10000 });
      }

      // Smart wait: if click triggered navigation, wait for load; otherwise short delay
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 3000 });
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
  async type(ref: string, text: string, options?: {
    clear?: boolean;
    submit?: boolean;
  }): Promise<BrowserResult> {
    const page = this.getActivePage();
    if (!page) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const loc = page.locator(`[data-kxref="${ref}"]`);
      if (await loc.count() === 0) {
        return { success: false, error: `Element [${ref}] nie znaleziony. Weź nowy snapshot.` };
      }

      if (options?.clear !== false) {
        await loc.fill(text, { timeout: 10000 });
      } else {
        await loc.pressSequentially(text, { delay: 30, timeout: 10000 });
      }

      if (options?.submit) {
        await loc.press('Enter');
        await page.waitForTimeout(500);
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
      await page.locator(`[data-kxref="${ref}"]`).hover({ timeout: 10000 });
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
      await page.locator(`[data-kxref="${ref}"]`).selectOption(values, { timeout: 10000 });
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
      await page.keyboard.press(key);
      await page.waitForTimeout(200);
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
        case 'up':    await page.mouse.wheel(0, -(amount || 500)); break;
        case 'down':  await page.mouse.wheel(0, amount || 500); break;
        case 'top':   await page.evaluate('window.scrollTo(0, 0)'); break;
        case 'bottom': await page.evaluate('window.scrollTo(0, document.body.scrollHeight)'); break;
      }
      await page.waitForTimeout(300);
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
      const loc = page.locator(`[data-kxref="${ref}"]`);
      if (await loc.count() === 0) {
        return { success: false, error: `Element [${ref}] nie znaleziony. Weź nowy snapshot.` };
      }
      await loc.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(300);
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
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 500 })) {
            await btn.click({ timeout: 2000 });
            dismissed.push(sel);
            await page.waitForTimeout(500);
            break; // One dismissal is usually enough
          }
        } catch { /* selector not found — try next */ }
      }

      return {
        success: true,
        data: dismissed.length > 0
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
        buffer = await page.locator(`[data-kxref="${options.ref}"]`).screenshot({
          type: 'jpeg', quality: 80, timeout: 10000,
        });
      } else {
        buffer = await page.screenshot({
          type: 'jpeg', quality: 80, fullPage: options?.fullPage ?? false,
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
    if (!this.context) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    const pages = this.context.pages();
    const list: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      let title = pages[i].url();
      try { title = await pages[i].title(); } catch { /* use URL */ }
      list.push({ index: i, url: pages[i].url(), title, active: i === this.activePageIdx });
    }

    return { success: true, data: list };
  }

  async newTab(url?: string): Promise<BrowserResult> {
    if (!this.context) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    try {
      const page = await this.context.newPage();
      this.activePageIdx = this.context.pages().indexOf(page);

      if (url) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      return {
        success: true,
        data: { index: this.activePageIdx, url: page.url(), title: await page.title(), totalTabs: this.context.pages().length },
      };
    } catch (err: any) {
      return { success: false, error: `New tab: ${err.message}` };
    }
  }

  async switchTab(index: number): Promise<BrowserResult> {
    if (!this.context) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    const pages = this.context.pages();
    if (index < 0 || index >= pages.length) {
      return { success: false, error: `Tab ${index} nie istnieje (0-${pages.length - 1})` };
    }

    this.activePageIdx = index;
    try { await pages[index].bringToFront(); } catch { /* ok */ }

    return { success: true, data: { index, url: pages[index].url(), title: await pages[index].title() } };
  }

  async closeTab(index?: number): Promise<BrowserResult> {
    if (!this.context) return { success: false, error: 'Przeglądarka nie jest uruchomiona' };

    const pages = this.context.pages();
    const idx = index ?? this.activePageIdx;

    if (idx < 0 || idx >= pages.length) return { success: false, error: `Tab ${idx} nie istnieje` };
    if (pages.length <= 1) return { success: false, error: 'Nie można zamknąć ostatniego taba. Użyj browser_close.' };

    try {
      await pages[idx].close();
      if (this.activePageIdx >= this.context.pages().length) {
        this.activePageIdx = this.context.pages().length - 1;
      }
      return { success: true, data: { closedIndex: idx, activeIndex: this.activePageIdx, totalTabs: this.context.pages().length } };
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

      return result.ok
        ? { success: true, data: result.value }
        : { success: false, error: `JS error: ${result.error}` };
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
          await page.waitForSelector(options.value, { timeout: ms });
          return { success: true, data: `Selector "${options.value}" znaleziony` };
        case 'url':
          if (!options.value) return { success: false, error: 'Brak URL' };
          await page.waitForURL(options.value, { timeout: ms });
          return { success: true, data: `URL matches "${options.value}"` };
        case 'load':
          await page.waitForLoadState('networkidle', { timeout: ms });
          return { success: true, data: 'Network idle' };
        case 'timeout': {
          const delay = Math.min(parseInt(options.value || '1000', 10), 10000);
          await page.waitForTimeout(delay);
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

    return {
      success: true,
      data: { url: page.url(), title: await page.title(), tabIndex: this.activePageIdx, totalTabs: this.context?.pages().length || 0 },
    };
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
        const loc = page.locator(`[data-kxref="${f.ref}"]`);
        if (await loc.count() === 0) { results.push({ ref: f.ref, ok: false, error: 'nie znaleziony' }); continue; }

        const tag: string = await loc.evaluate('(el) => el.tagName.toLowerCase()');
        if (tag === 'select') {
          await loc.selectOption(f.value, { timeout: 5000 });
        } else {
          await loc.fill(f.value, { timeout: 5000 });
        }
        results.push({ ref: f.ref, ok: true });
      } catch (err: any) {
        results.push({ ref: f.ref, ok: false, error: err.message });
      }
    }

    const allOk = results.every(r => r.ok);
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
        text = await page.locator(selector).innerText({ timeout: 10000 });
      } else {
        text = await page.evaluate('document.body.innerText');
      }
      return { success: true, data: text.slice(0, 15000) };
    } catch (err: any) {
      return { success: false, error: `Extract text: ${err.message}` };
    }
  }

  // ════════════════════════════════════════════════════
  //  Cleanup
  // ════════════════════════════════════════════════════

  async close(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
        this.context = null;
      }
    } catch { /* ignore */ }

    if (this.browserProcess) {
      try { this.browserProcess.kill(); } catch { /* ignore */ }
      this.browserProcess = null;
    }

    this.activePageIdx = 0;
    console.log('[BrowserService] Browser closed');
  }

  closeAll(): void {
    this.close().catch(() => {});
  }
}
