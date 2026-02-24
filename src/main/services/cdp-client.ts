/**
 * cdp-client.ts — Native Chrome DevTools Protocol client.
 *
 * Replaces playwright-core with a lightweight WebSocket-based CDP client (~400 LOC).
 * Zero heavy dependencies — only `ws` (already in project) and Node.js `http`.
 *
 * Architecture:
 *   CDPConnection  — Low-level WebSocket wrapper for a single CDP target
 *   CDPPage        — Page-level commands (navigate, evaluate, click, type, screenshot, etc.)
 *   CDPBrowser     — Target management via HTTP API (/json/list, /json/new, /json/close)
 *
 * Usage by BrowserService:
 *   1. CDPBrowser.connect(wsUrl) → gets browser handle
 *   2. cdpBrowser.getTargets() → lists tabs
 *   3. cdpBrowser.attachToPage(target) → returns CDPPage
 *   4. CDPPage methods replace Playwright page API
 */

import WebSocket from 'ws';
import * as http from 'http';
import { createLogger } from './logger';

const log = createLogger('CDP');

// ═══════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════

export interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface CDPResponse {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: any;
  error?: { code: number; message: string; data?: string };
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ═══════════════════════════════════════════════════════
//  Key Mapping (Playwright key names → CDP key codes)
// ═══════════════════════════════════════════════════════

const KEY_MAP: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter:      { key: 'Enter',      code: 'Enter',      keyCode: 13 },
  Tab:        { key: 'Tab',        code: 'Tab',        keyCode: 9 },
  Escape:     { key: 'Escape',     code: 'Escape',     keyCode: 27 },
  Backspace:  { key: 'Backspace',  code: 'Backspace',  keyCode: 8 },
  Delete:     { key: 'Delete',     code: 'Delete',     keyCode: 46 },
  ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home:       { key: 'Home',       code: 'Home',       keyCode: 36 },
  End:        { key: 'End',        code: 'End',        keyCode: 35 },
  PageUp:     { key: 'PageUp',     code: 'PageUp',     keyCode: 33 },
  PageDown:   { key: 'PageDown',   code: 'PageDown',   keyCode: 34 },
  Space:      { key: ' ',          code: 'Space',      keyCode: 32 },
  Control:    { key: 'Control',    code: 'ControlLeft', keyCode: 17 },
  Shift:      { key: 'Shift',      code: 'ShiftLeft',  keyCode: 16 },
  Alt:        { key: 'Alt',        code: 'AltLeft',    keyCode: 18 },
  Meta:       { key: 'Meta',       code: 'MetaLeft',   keyCode: 91 },
};

// F1-F12
for (let i = 1; i <= 12; i++) {
  KEY_MAP[`F${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };
}

// ═══════════════════════════════════════════════════════
//  CDPConnection — Low-level WebSocket CDP session
// ═══════════════════════════════════════════════════════

export class CDPConnection {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  /** Connect to a CDP WebSocket endpoint */
  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl, { perMessageDeflate: false });

      const timeout = setTimeout(() => {
        reject(new Error(`CDP connection timeout: ${wsUrl}`));
        this.ws?.close();
      }, 10_000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this._connected = true;
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg: CDPResponse = JSON.parse(data.toString());

          if (msg.id !== undefined) {
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              clearTimeout(p.timer);
              if (msg.error) {
                p.reject(new Error(`CDP: ${msg.error.message} (${msg.error.code})`));
              } else {
                p.resolve(msg.result ?? {});
              }
            }
          } else if (msg.method) {
            const handlers = this.listeners.get(msg.method);
            if (handlers) {
              for (const h of handlers) {
                try { h(msg.params || {}); } catch { /* handler error */ }
              }
            }
          }
        } catch {
          log.warn('Failed to parse CDP message');
        }
      });

      this.ws.on('close', () => {
        this._connected = false;
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('CDP connection closed'));
        }
        this.pending.clear();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        if (!this._connected) reject(err);
      });
    });
  }

  /** Send a CDP command and wait for the response */
  async send(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
    if (!this.ws || !this._connected) {
      throw new Error('CDP not connected');
    }

    const id = ++this.msgId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout (${timeoutMs}ms): ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Subscribe to a CDP event */
  on(event: string, handler: (...args: any[]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  /** Unsubscribe from a CDP event */
  off(event: string, handler: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  /** Close the connection */
  close(): void {
    this._connected = false;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('CDP connection closed'));
    }
    this.pending.clear();
    this.listeners.clear();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}

// ═══════════════════════════════════════════════════════
//  CDPPage — Page-level CDP commands
// ═══════════════════════════════════════════════════════

export class CDPPage {
  private cdp: CDPConnection;
  private _url = '';
  private _title = '';
  readonly targetId: string;

  constructor(cdp: CDPConnection, targetId: string, initialUrl = '') {
    this.cdp = cdp;
    this.targetId = targetId;
    this._url = initialUrl;

    // Track top-level frame navigations
    cdp.on('Page.frameNavigated', (params: any) => {
      if (!params.frame?.parentId) {
        this._url = params.frame.url || this._url;
      }
    });
  }

  /** Enable required CDP domains after connection */
  async init(): Promise<void> {
    await Promise.all([
      this.cdp.send('Page.enable'),
      this.cdp.send('Runtime.enable'),
    ]);
    await this.refreshInfo();
  }

  get connected(): boolean {
    return this.cdp.connected;
  }

  // ── Navigation ──────────────────────────────────────

  async navigate(url: string, opts?: { timeout?: number }): Promise<void> {
    const timeout = opts?.timeout ?? 30_000;

    // Set up load listener BEFORE sending navigate (race-safe)
    const loadPromise = this.waitForEvent('Page.domContentEventFired', timeout);

    const result = await this.cdp.send('Page.navigate', { url });
    if (result.errorText) {
      throw new Error(`Navigation failed: ${result.errorText}`);
    }

    try {
      await loadPromise;
    } catch {
      // Timeout — page may be slow or same-URL navigation
    }
    await this.refreshInfo();
  }

  async goBack(timeout = 15_000): Promise<void> {
    const { currentIndex, entries } = await this.cdp.send('Page.getNavigationHistory');
    if (currentIndex > 0) {
      const loadPromise = this.waitForEvent('Page.domContentEventFired', timeout);
      await this.cdp.send('Page.navigateToHistoryEntry', {
        entryId: entries[currentIndex - 1].id,
      });
      try { await loadPromise; } catch { /* BFCache may skip events */ }
      await this.refreshInfo();
    }
  }

  async goForward(timeout = 15_000): Promise<void> {
    const { currentIndex, entries } = await this.cdp.send('Page.getNavigationHistory');
    if (currentIndex < entries.length - 1) {
      const loadPromise = this.waitForEvent('Page.domContentEventFired', timeout);
      await this.cdp.send('Page.navigateToHistoryEntry', {
        entryId: entries[currentIndex + 1].id,
      });
      try { await loadPromise; } catch { /* BFCache may skip events */ }
      await this.refreshInfo();
    }
  }

  // ── Evaluation ──────────────────────────────────────

  async evaluate<T = any>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (exceptionDetails) {
      const msg =
        exceptionDetails.exception?.description || exceptionDetails.text || 'Evaluation failed';
      throw new Error(msg);
    }

    return result?.value as T;
  }

  // ── Page Info ───────────────────────────────────────

  url(): string {
    return this._url;
  }

  async title(): Promise<string> {
    try {
      this._title = await this.evaluate<string>('document.title');
    } catch {
      /* use cached */
    }
    return this._title;
  }

  async refreshInfo(): Promise<void> {
    try {
      const info = await this.evaluate<string>(
        'JSON.stringify({ url: location.href, title: document.title })',
      );
      const parsed = JSON.parse(info);
      this._url = parsed.url;
      this._title = parsed.title;
    } catch {
      /* ignore */
    }
  }

  // ── Element Queries ─────────────────────────────────

  /** Count elements matching a CSS selector */
  async queryCount(selector: string): Promise<number> {
    return this.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
  }

  /** Check if the first matching element is visible */
  async isVisible(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0;
    })()`);
  }

  /** Get bounding box center of the first matching element */
  private async getElementCenter(
    selector: string,
  ): Promise<{ x: number; y: number }> {
    const box = await this.evaluate<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);

    if (!box) throw new Error(`Element not found: ${selector}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  // ── Mouse Actions ───────────────────────────────────

  /** Dispatch a mouse click at absolute coordinates */
  async clickAt(
    x: number,
    y: number,
    opts?: { button?: 'left' | 'right' | 'middle'; clickCount?: number },
  ): Promise<void> {
    const button = opts?.button || 'left';
    const clickCount = opts?.clickCount || 1;

    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    });
    await this.sleep(30);
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount,
    });
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount,
    });
  }

  /** Click element by CSS selector */
  async click(
    selector: string,
    opts?: {
      button?: 'left' | 'right' | 'middle';
      doubleClick?: boolean;
      timeout?: number;
    },
  ): Promise<void> {
    await this.waitForSelector(selector, opts?.timeout ?? 10_000);
    const { x, y } = await this.getElementCenter(selector);

    if (opts?.doubleClick) {
      await this.clickAt(x, y, { button: opts?.button, clickCount: 2 });
    } else {
      await this.clickAt(x, y, { button: opts?.button });
    }
  }

  /** Hover over element by CSS selector */
  async hover(selector: string, opts?: { timeout?: number }): Promise<void> {
    await this.waitForSelector(selector, opts?.timeout ?? 10_000);
    const { x, y } = await this.getElementCenter(selector);
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    });
  }

  /** Scroll the mouse wheel */
  async mouseWheel(deltaX: number, deltaY: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 0,
      y: 0,
      deltaX,
      deltaY,
    });
  }

  // ── Keyboard Actions ────────────────────────────────

  /** Fill input by selector (focus → clear → set value → fire events) */
  async fill(
    selector: string,
    text: string,
    opts?: { timeout?: number },
  ): Promise<void> {
    await this.waitForSelector(selector, opts?.timeout ?? 10_000);
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found');
      el.focus();
      el.value = '';
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  /** Type text char-by-char with realistic delays */
  async typeText(text: string, opts?: { delay?: number }): Promise<void> {
    const delay = opts?.delay ?? 30;
    for (const char of text) {
      await this.dispatchChar(char);
      if (delay > 0) await this.sleep(delay);
    }
  }

  /** Press a key or key combination (e.g., "Enter", "Control+a") */
  async press(keyDesc: string): Promise<void> {
    const parts = keyDesc.split('+');
    const key = parts[parts.length - 1];
    const modifiers = parts.slice(0, -1);

    let modFlags = 0;
    for (const mod of modifiers) {
      if (mod === 'Control') modFlags |= 2;
      else if (mod === 'Shift') modFlags |= 8;
      else if (mod === 'Alt') modFlags |= 1;
      else if (mod === 'Meta') modFlags |= 4;
    }

    // Press modifier keys down
    for (const mod of modifiers) {
      const info = KEY_MAP[mod];
      if (info) {
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: info.key,
          code: info.code,
          windowsVirtualKeyCode: info.keyCode,
          modifiers: modFlags,
        });
      }
    }

    // Press the main key
    const info = KEY_MAP[key];
    if (info) {
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: info.key,
        code: info.code,
        windowsVirtualKeyCode: info.keyCode,
        modifiers: modFlags,
      });
      if (info.key.length === 1) {
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: info.key,
          modifiers: modFlags,
        });
      }
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: info.key,
        code: info.code,
        windowsVirtualKeyCode: info.keyCode,
        modifiers: modFlags,
      });
    } else if (key.length === 1) {
      // Single printable character
      const code = `Key${key.toUpperCase()}`;
      const keyCode = key.toUpperCase().charCodeAt(0);
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        modifiers: modFlags,
      });
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'char',
        text: key,
        modifiers: modFlags,
      });
      await this.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        modifiers: modFlags,
      });
    }

    // Release modifier keys (reversed order)
    for (const mod of modifiers.reverse()) {
      const modInfo = KEY_MAP[mod];
      if (modInfo) {
        await this.cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: modInfo.key,
          code: modInfo.code,
          windowsVirtualKeyCode: modInfo.keyCode,
        });
      }
    }
  }

  /** Dispatch a single character as keyDown+char+keyUp */
  private async dispatchChar(char: string): Promise<void> {
    const info = KEY_MAP[char];
    const key = info?.key ?? char;
    const code = info?.code ?? `Key${char.toUpperCase()}`;
    const keyCode = info?.keyCode ?? char.charCodeAt(0);

    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
    });
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'char',
      text: key.length === 1 ? key : char,
    });
    await this.cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
    });
  }

  // ── Form Interactions ───────────────────────────────

  /** Select option(s) from a <select> element */
  async selectOption(
    selector: string,
    values: string | string[],
    opts?: { timeout?: number },
  ): Promise<void> {
    await this.waitForSelector(selector, opts?.timeout ?? 10_000);
    const valArray = Array.isArray(values) ? values : [values];
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found');
      const vals = ${JSON.stringify(valArray)};
      Array.from(el.options).forEach(o => { o.selected = vals.includes(o.value); });
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  /** Get the tag name of the first matching element */
  async tagName(selector: string): Promise<string> {
    return this.evaluate<string>(
      `(document.querySelector(${JSON.stringify(selector)})?.tagName || '').toLowerCase()`,
    );
  }

  /** Get innerText of the first matching element */
  async innerText(
    selector: string,
    opts?: { timeout?: number },
  ): Promise<string> {
    await this.waitForSelector(selector, opts?.timeout ?? 10_000);
    return this.evaluate<string>(
      `document.querySelector(${JSON.stringify(selector)}).innerText`,
    );
  }

  /** Scroll element into view */
  async scrollIntoView(
    selector: string,
    opts?: { timeout?: number },
  ): Promise<void> {
    await this.waitForSelector(selector, opts?.timeout ?? 5_000);
    await this.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoViewIfNeeded()`,
    );
  }

  // ── Screenshot ──────────────────────────────────────

  /** Capture page screenshot */
  async screenshot(opts?: {
    fullPage?: boolean;
    quality?: number;
    format?: string;
    clip?: { x: number; y: number; width: number; height: number; scale?: number };
  }): Promise<Buffer> {
    const format = opts?.format || 'jpeg';
    const params: Record<string, unknown> = {
      format,
      quality: opts?.quality ?? 80,
    };

    if (opts?.fullPage) {
      const metrics = await this.cdp.send('Page.getLayoutMetrics');
      const { width, height } = metrics.cssContentSize || metrics.contentSize;
      params.clip = { x: 0, y: 0, width, height, scale: 1 };
    }

    if (opts?.clip) {
      params.clip = { ...opts.clip, scale: opts.clip.scale ?? 1 };
    }

    const { data } = await this.cdp.send('Page.captureScreenshot', params);
    return Buffer.from(data, 'base64');
  }

  /** Capture screenshot of a specific element */
  async screenshotElement(
    selector: string,
    opts?: { quality?: number; format?: string; timeout?: number },
  ): Promise<Buffer> {
    await this.waitForSelector(selector, opts?.timeout ?? 10_000);
    const box = await this.evaluate<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found');
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);

    return this.screenshot({
      clip: box,
      quality: opts?.quality,
      format: opts?.format,
    });
  }

  // ── Waiting ─────────────────────────────────────────

  /** Wait for the DOMContentLoaded event */
  async waitForLoad(timeout = 30_000): Promise<void> {
    await this.waitForEvent('Page.domContentEventFired', timeout);
  }

  /** Wait for an element matching selector to appear in the DOM */
  async waitForSelector(selector: string, timeout = 10_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const count = await this.queryCount(selector);
      if (count > 0) return;
      await this.sleep(100);
    }
    throw new Error(`Timeout (${timeout}ms) waiting for selector: ${selector}`);
  }

  /** Wait for the page URL to match a pattern */
  async waitForURL(urlPattern: string, timeout = 10_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await this.refreshInfo();
      if (this._url.includes(urlPattern)) return;
      try {
        if (new RegExp(urlPattern).test(this._url)) return;
      } catch {
        /* not a valid regex, use includes only */
      }
      await this.sleep(100);
    }
    throw new Error(`Timeout (${timeout}ms) waiting for URL: ${urlPattern}`);
  }

  /** Wait for network idle (approximation via readyState polling) */
  async waitForNetworkIdle(timeout = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const readyState = await this.evaluate<string>('document.readyState');
        if (readyState === 'complete') return;
      } catch {
        /* page might be transitioning */
      }
      await this.sleep(200);
    }
  }

  // ── Tab Control ─────────────────────────────────────

  async bringToFront(): Promise<void> {
    await this.cdp.send('Page.bringToFront');
  }

  async closePage(): Promise<void> {
    try {
      await this.cdp.send('Page.close');
    } catch {
      /* may already be closed */
    }
    this.cdp.close();
  }

  // ── Utilities ───────────────────────────────────────

  /** Wait for a specific CDP event to fire */
  waitForEvent(event: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cdp.off(event, handler);
        reject(new Error(`Timeout (${timeout}ms) waiting for ${event}`));
      }, timeout);

      const handler = () => {
        clearTimeout(timer);
        this.cdp.off(event, handler);
        resolve();
      };

      this.cdp.on(event, handler);
    });
  }

  sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Close the underlying CDP connection */
  close(): void {
    this.cdp.close();
  }
}

// ═══════════════════════════════════════════════════════
//  CDPBrowser — Target management via HTTP endpoints
// ═══════════════════════════════════════════════════════

export class CDPBrowser {
  private baseUrl: string; // e.g. http://127.0.0.1:9222
  private pageMap = new Map<string, CDPPage>();
  private _connected = true;

  private constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Connect to a browser's CDP debug endpoint.
   * Accepts either a WebSocket URL (ws://...) or a port number.
   */
  static async connect(wsUrlOrPort: string | number): Promise<CDPBrowser> {
    let baseUrl: string;

    if (typeof wsUrlOrPort === 'number') {
      baseUrl = `http://127.0.0.1:${wsUrlOrPort}`;
    } else {
      // Extract port from ws://127.0.0.1:PORT/devtools/browser/UUID
      const match = wsUrlOrPort.match(/:(\d+)\//);
      if (!match) throw new Error(`Invalid WebSocket URL: ${wsUrlOrPort}`);
      baseUrl = `http://127.0.0.1:${match[1]}`;
    }

    const browser = new CDPBrowser(baseUrl);
    // Verify connection by listing targets
    await browser.getTargets();
    log.info(`Connected to browser at ${baseUrl}`);
    return browser;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** List all page-type targets (tabs) */
  async getTargets(): Promise<CDPTarget[]> {
    const data = await this.httpGet('/json/list');
    const targets: CDPTarget[] = JSON.parse(data);
    return targets.filter((t) => t.type === 'page');
  }

  /** Attach to an existing page target — returns CDPPage */
  async attachToPage(target: CDPTarget): Promise<CDPPage> {
    // Return cached connection if available and still alive
    const existing = this.pageMap.get(target.id);
    if (existing?.connected) return existing;

    const cdp = new CDPConnection();
    await cdp.connect(target.webSocketDebuggerUrl);

    const page = new CDPPage(cdp, target.id, target.url);
    await page.init();
    this.pageMap.set(target.id, page);
    return page;
  }

  /** Create a new tab and return a CDPPage for it */
  async newPage(url?: string): Promise<CDPPage> {
    const encodedUrl = url ? encodeURIComponent(url) : '';
    const endpoint = encodedUrl ? `/json/new?${encodedUrl}` : '/json/new';
    const data = await this.httpGet(endpoint);
    const target: CDPTarget = JSON.parse(data);

    // Brief delay for Chrome to fully initialize the target's WebSocket
    await new Promise((r) => setTimeout(r, 200));

    return this.attachToPage(target);
  }

  /** Close a page target by its ID */
  async closePage(targetId: string): Promise<void> {
    const page = this.pageMap.get(targetId);
    if (page) {
      page.close();
      this.pageMap.delete(targetId);
    }
    try {
      await this.httpGet(`/json/close/${targetId}`);
    } catch {
      /* target may already be closed */
    }
  }

  /** Get a specific attached page (or attach on demand) */
  async getPage(targetId: string): Promise<CDPPage | null> {
    const existing = this.pageMap.get(targetId);
    if (existing?.connected) return existing;

    // Try to find the target and attach
    const targets = await this.getTargets();
    const target = targets.find((t) => t.id === targetId);
    if (!target) return null;

    return this.attachToPage(target);
  }

  /** Get all currently attached pages */
  getAttachedPages(): CDPPage[] {
    return Array.from(this.pageMap.values()).filter((p) => p.connected);
  }

  /** Disconnect from all pages (does NOT kill the browser process) */
  close(): void {
    this._connected = false;
    for (const [, page] of this.pageMap) {
      page.close();
    }
    this.pageMap.clear();
    log.info('CDPBrowser disconnected');
  }

  /** Make an HTTP GET request to the CDP HTTP endpoint */
  private httpGet(urlPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = http.get(`${this.baseUrl}${urlPath}`, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => resolve(data));
      });
      req.on('error', (err) => {
        this._connected = false;
        reject(err);
      });
      req.setTimeout(5_000, () => {
        req.destroy();
        reject(new Error('CDP HTTP timeout'));
      });
    });
  }
}
