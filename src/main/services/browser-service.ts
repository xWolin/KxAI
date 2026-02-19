import { BrowserWindow } from 'electron';

/**
 * BrowserService — automatyzacja przeglądarki z użyciem Electron BrowserWindow.
 * Wykorzystuje wbudowany Chromium — bez dodatkowych zależności.
 * 
 * Umożliwia: nawigację, ekstrakcję treści, wypełnianie formularzy,
 * klikanie elementów, robienie screenshotów stron.
 */
export class BrowserService {
  private windows: Map<string, BrowserWindow> = new Map();
  private nextId = 1;
  private loadTimeoutMs = 30000; // 30s default timeout for URL loading

  /**
   * Load a URL with timeout protection.
   */
  private async loadURLWithTimeout(win: BrowserWindow, url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout ładowania URL (${this.loadTimeoutMs}ms): ${url}`));
      }, this.loadTimeoutMs);

      win.loadURL(url)
        .then(() => { clearTimeout(timer); resolve(); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  }

  /**
   * Open a new browser window (hidden by default).
   */
  async open(url: string, options?: { visible?: boolean; width?: number; height?: number }): Promise<BrowserSession> {
    const id = `browser-${this.nextId++}`;
    const win = new BrowserWindow({
      width: options?.width || 1280,
      height: options?.height || 900,
      show: options?.visible || false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    this.windows.set(id, win);

    win.on('closed', () => {
      this.windows.delete(id);
    });

    try {
      await this.loadURLWithTimeout(win, url);
    } catch (err: any) {
      win.destroy();
      this.windows.delete(id);
      throw err;
    }
    return { id, url };
  }

  /**
   * Navigate to a URL in an existing session.
   */
  async navigate(sessionId: string, url: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      await this.loadURLWithTimeout(win, url);
      return { success: true, data: `Nawigacja do ${url} zakończona` };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Extract text content from the page.
   */
  async extractText(sessionId: string, selector?: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const script = selector
        ? `document.querySelector(${JSON.stringify(selector)})?.innerText || ''`
        : `document.body.innerText`;
      const text = await win.webContents.executeJavaScript(script);
      return { success: true, data: typeof text === 'string' ? text.slice(0, 10000) : String(text) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Extract HTML from the page.
   */
  async extractHTML(sessionId: string, selector?: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const script = selector
        ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML || ''`
        : `document.documentElement.outerHTML`;
      const html = await win.webContents.executeJavaScript(script);
      return { success: true, data: typeof html === 'string' ? html.slice(0, 20000) : '' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Click an element on the page.
   */
  async click(sessionId: string, selector: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const safeSelector = JSON.stringify(selector);
      const result = await win.webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${safeSelector});
          if (!el) return 'Element nie znaleziony: ' + ${safeSelector};
          el.click();
          return 'Kliknięto: ' + ${safeSelector};
        })()
      `);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Type text into an input element.
   */
  async type(sessionId: string, selector: string, text: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const safeSelector = JSON.stringify(selector);
      const safeText = JSON.stringify(text);
      const result = await win.webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${safeSelector});
          if (!el) return 'Element nie znaleziony: ' + ${safeSelector};
          el.focus();
          el.value = ${safeText};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return 'Wpisano tekst w: ' + ${safeSelector};
        })()
      `);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Submit a form.
   */
  async submitForm(sessionId: string, selector: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const safeSelector = JSON.stringify(selector);
      const result = await win.webContents.executeJavaScript(`
        (function() {
          const form = document.querySelector(${safeSelector});
          if (!form) return 'Formularz nie znaleziony';
          form.submit();
          return 'Formularz wysłany';
        })()
      `);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Execute custom JavaScript on the page.
   */
  async evaluate(sessionId: string, script: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const result = await win.webContents.executeJavaScript(script);
      return { success: true, data: typeof result === 'object' ? JSON.stringify(result) : String(result) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Take a screenshot of the browser page.
   */
  async screenshot(sessionId: string): Promise<{ success: boolean; data?: string; error?: string }> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const image = await win.webContents.capturePage();
      const base64 = image.toJPEG(80).toString('base64');
      return { success: true, data: base64 };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get page info (URL, title).
   */
  async getPageInfo(sessionId: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    return {
      success: true,
      data: JSON.stringify({
        url: win.webContents.getURL(),
        title: win.webContents.getTitle(),
      }),
    };
  }

  /**
   * Wait for a specific selector to appear.
   */
  async waitForSelector(sessionId: string, selector: string, timeoutMs: number = 10000): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const safeSelector = JSON.stringify(selector);
      const result = await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const sel = ${safeSelector};
          const existing = document.querySelector(sel);
          if (existing) { resolve('Element znaleziony'); return; }
          
          const observer = new MutationObserver(() => {
            if (document.querySelector(sel)) {
              observer.disconnect();
              resolve('Element znaleziony');
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          
          setTimeout(() => {
            observer.disconnect();
            resolve('Timeout — element nie znaleziony');
          }, ${Math.min(Math.max(timeoutMs, 1000), 60000)});
        })
      `);
      return { success: true, data: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get all links on the page.
   */
  async getLinks(sessionId: string): Promise<BrowserResult> {
    const win = this.getWindow(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    try {
      const links = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ text: a.innerText.trim().slice(0, 100), href: a.href }))
          .filter(l => l.text && l.href)
          .slice(0, 50)
      `);
      return { success: true, data: JSON.stringify(links) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Close a browser session.
   */
  close(sessionId: string): BrowserResult {
    const win = this.windows.get(sessionId);
    if (!win) return { success: false, error: `Sesja ${sessionId} nie istnieje` };

    win.close();
    this.windows.delete(sessionId);
    return { success: true, data: `Sesja ${sessionId} zamknięta` };
  }

  /**
   * Close all browser sessions.
   */
  closeAll(): void {
    for (const [id, win] of this.windows) {
      try { win.close(); } catch { /* already closed */ }
    }
    this.windows.clear();
  }

  /**
   * List active sessions.
   */
  listSessions(): BrowserSession[] {
    const sessions: BrowserSession[] = [];
    for (const [id, win] of this.windows) {
      sessions.push({
        id,
        url: win.webContents.getURL(),
        title: win.webContents.getTitle(),
      });
    }
    return sessions;
  }

  private getWindow(sessionId: string): BrowserWindow | undefined {
    return this.windows.get(sessionId);
  }
}

export interface BrowserSession {
  id: string;
  url: string;
  title?: string;
}

export interface BrowserResult {
  success: boolean;
  data?: string;
  error?: string;
}
