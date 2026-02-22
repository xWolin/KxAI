import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app, clipboard, shell } from 'electron';
import { AutomationService } from './automation-service';
import { BrowserService } from './browser-service';
import { RAGService } from './rag-service';
import { PluginService } from './plugin-service';
import { SecurityGuard } from './security-guard';
import { SystemMonitor } from './system-monitor';

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'system' | 'web' | 'files' | 'automation' | 'memory' | 'cron' | 'browser' | 'rag';
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ToolsService {
  private toolRegistry: Map<string, (params: any) => Promise<ToolResult>> = new Map();
  private definitions: ToolDefinition[] = [];
  private automationService?: AutomationService;
  private browserService?: BrowserService;
  private ragService?: RAGService;
  private pluginService?: PluginService;
  private securityGuard: SecurityGuard;
  private systemMonitor: SystemMonitor;

  constructor() {
    this.securityGuard = new SecurityGuard();
    this.systemMonitor = new SystemMonitor();
    this.registerBuiltinTools();
  }

  /**
   * Wire external services after construction.
   */
  setServices(services: {
    automation?: AutomationService;
    browser?: BrowserService;
    rag?: RAGService;
    plugins?: PluginService;
  }): void {
    this.automationService = services.automation;
    this.browserService = services.browser;
    this.ragService = services.rag;
    this.pluginService = services.plugins;

    this.registerAutomationTools();
    this.registerBrowserTools();
    this.registerRAGTools();
    this.registerPluginTools();
  }

  private registerBuiltinTools(): void {
    // ─── System Tools ───
    this.register({
      name: 'get_current_time',
      description: 'Pobiera aktualną datę i godzinę',
      category: 'system',
      parameters: {},
    }, async () => {
      const now = new Date();
      return {
        success: true,
        data: {
          iso: now.toISOString(),
          date: now.toLocaleDateString('pl-PL'),
          time: now.toLocaleTimeString('pl-PL'),
          dayOfWeek: now.toLocaleDateString('pl-PL', { weekday: 'long' }),
          hour: now.getHours(),
          minute: now.getMinutes(),
          timestamp: now.getTime(),
        },
      };
    });

    this.register({
      name: 'run_shell_command',
      description: 'Wykonuje komendę w terminalu systemowym (PowerShell/bash). Komenda jest walidowana pod kątem bezpieczeństwa.',
      category: 'system',
      parameters: {
        command: { type: 'string', description: 'Komenda do wykonania', required: true },
        timeout: { type: 'number', description: 'Timeout w ms (default 30000)' },
      },
    }, async (params) => {
      // Security validation
      const validation = this.securityGuard.validateCommand(params.command);
      if (!validation.allowed) {
        return { success: false, error: `🛡️ ${validation.reason}` };
      }

      return new Promise((resolve) => {
        const timeout = Math.min(params.timeout || 30000, 60000); // Max 60s
        exec(params.command, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            resolve({ success: false, error: err.message, data: { stdout: stdout?.slice(0, 5000), stderr: stderr?.slice(0, 2000) } });
          } else {
            resolve({ success: true, data: { stdout: stdout.trim().slice(0, 10000), stderr: stderr.trim().slice(0, 2000) } });
          }
        });
      });
    });

    this.register({
      name: 'open_url',
      description: 'Otwiera URL w domyślnej przeglądarce (tylko http/https)',
      category: 'web',
      parameters: {
        url: { type: 'string', description: 'URL do otwarcia', required: true },
      },
    }, async (params) => {
      // Security: only allow http/https protocols
      try {
        const parsed = new URL(params.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return { success: false, error: `🛡️ Dozwolone tylko protokoły http/https (otrzymano: ${parsed.protocol})` };
        }
      } catch {
        return { success: false, error: '🛡️ Nieprawidłowy URL' };
      }
      await shell.openExternal(params.url);
      return { success: true, data: `Otwarto: ${params.url}` };
    });

    this.register({
      name: 'open_path',
      description: 'Otwiera plik lub folder w domyślnej aplikacji',
      category: 'files',
      parameters: {
        path: { type: 'string', description: 'Ścieżka do pliku lub folderu', required: true },
      },
    }, async (params) => {
      // Security: validate path before opening
      const openValidation = this.securityGuard.validateReadPath(params.path);
      if (!openValidation.allowed) {
        return { success: false, error: `🛡️ ${openValidation.reason}` };
      }
      await shell.openPath(params.path);
      return { success: true, data: `Otwarto: ${params.path}` };
    });

    this.register({
      name: 'clipboard_read',
      description: 'Odczytuje zawartość schowka',
      category: 'system',
      parameters: {},
    }, async () => {
      const text = clipboard.readText();
      return { success: true, data: text };
    });

    this.register({
      name: 'clipboard_write',
      description: 'Zapisuje tekst do schowka',
      category: 'system',
      parameters: {
        text: { type: 'string', description: 'Tekst do skopiowania', required: true },
      },
    }, async (params) => {
      clipboard.writeText(params.text);
      return { success: true, data: 'Zapisano do schowka' };
    });

    // ─── File Tools ───
    this.register({
      name: 'read_file',
      description: 'Czyta zawartość pliku tekstowego',
      category: 'files',
      parameters: {
        path: { type: 'string', description: 'Ścieżka do pliku', required: true },
      },
    }, async (params) => {
      // Security: validate read path
      const readValidation = this.securityGuard.validateReadPath(params.path);
      if (!readValidation.allowed) {
        return { success: false, error: `🛡️ ${readValidation.reason}` };
      }
      try {
        const content = fs.readFileSync(params.path, 'utf8');
        return { success: true, data: content.slice(0, 10000) };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    this.register({
      name: 'write_file',
      description: 'Zapisuje treść do pliku (tworzy go jeśli nie istnieje). Ścieżka jest walidowana.',
      category: 'files',
      parameters: {
        path: { type: 'string', description: 'Ścieżka do pliku', required: true },
        content: { type: 'string', description: 'Treść do zapisania', required: true },
      },
    }, async (params) => {
      // Security: validate write path
      const writeValidation = this.securityGuard.validateWritePath(params.path);
      if (!writeValidation.allowed) {
        return { success: false, error: `🛡️ ${writeValidation.reason}` };
      }
      try {
        const dir = path.dirname(params.path);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(params.path, params.content, 'utf8');
        return { success: true, data: `Zapisano: ${params.path}` };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    this.register({
      name: 'list_directory',
      description: 'Listuje pliki i foldery w katalogu',
      category: 'files',
      parameters: {
        path: { type: 'string', description: 'Ścieżka do katalogu', required: true },
      },
    }, async (params) => {
      // Security: validate read path
      const listValidation = this.securityGuard.validateReadPath(params.path);
      if (!listValidation.allowed) {
        return { success: false, error: `🛡️ ${listValidation.reason}` };
      }
      try {
        const entries = fs.readdirSync(params.path, { withFileTypes: true });
        const items = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
        return { success: true, data: items };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // ─── Web Search ───
    this.register({
      name: 'web_search',
      description: 'Wyszukuje w internecie używając DuckDuckGo',
      category: 'web',
      parameters: {
        query: { type: 'string', description: 'Zapytanie wyszukiwania', required: true },
      },
    }, async (params) => {
      try {
        const https = require('https');
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(params.query)}&format=json&no_html=1`;
        const data = await new Promise<string>((resolve, reject) => {
          https.get(url, (res: any) => {
            let body = '';
            res.on('data', (chunk: string) => body += chunk);
            res.on('end', () => resolve(body));
            res.on('error', reject);
          }).on('error', reject);
        });
        const json = JSON.parse(data);
        const results = [];
        if (json.AbstractText) results.push({ title: 'Summary', text: json.AbstractText, url: json.AbstractURL });
        if (json.RelatedTopics) {
          for (const t of json.RelatedTopics.slice(0, 5)) {
            if (t.Text) results.push({ title: t.Text.slice(0, 100), text: t.Text, url: t.FirstURL });
          }
        }
        return { success: true, data: results.length ? results : 'Brak wyników' };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    this.register({
      name: 'fetch_url',
      description: 'Pobiera treść strony internetowej (text). Blokuje adresy wewnętrzne (SSRF protection).',
      category: 'web',
      parameters: {
        url: { type: 'string', description: 'URL strony', required: true },
      },
    }, async (params) => {
      try {
        // SSRF protection: validate URL and block internal addresses
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(params.url);
        } catch {
          return { success: false, error: '🛡️ Nieprawidłowy URL' };
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return { success: false, error: `🛡️ Dozwolone tylko http/https (otrzymano: ${parsedUrl.protocol})` };
        }
        const hostname = parsedUrl.hostname.toLowerCase();
        // Block localhost and private IP ranges
        const blockedPatterns = [
          /^localhost$/i,
          /^127\./,
          /^10\./,
          /^172\.(1[6-9]|2\d|3[01])\./,
          /^192\.168\./,
          /^0\./,
          /^\[::1\]$/,
          /^\[fc/i,
          /^\[fd/i,
          /^\[fe80/i,
          /\.local$/i,
          /\.internal$/i,
          /\.localhost$/i,
          /^169\.254\./,
        ];
        for (const pattern of blockedPatterns) {
          if (pattern.test(hostname)) {
            return { success: false, error: `🛡️ Dostęp do adresów wewnętrznych zablokowany (SSRF protection)` };
          }
        }

        const https = require('https');
        const http = require('http');
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const data = await new Promise<string>((resolve, reject) => {
          client.get(params.url, { headers: { 'User-Agent': 'KxAI/1.0' } }, (res: any) => {
            let body = '';
            res.on('data', (chunk: string) => body += chunk);
            res.on('end', () => resolve(body));
            res.on('error', reject);
          }).on('error', reject);
        });
        // Strip HTML tags for a rough text extraction
        const text = data
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);
        return { success: true, data: text };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // ─── Notification ───
    this.register({
      name: 'send_notification',
      description: 'Wysyła systemowe powiadomienie',
      category: 'system',
      parameters: {
        title: { type: 'string', description: 'Tytuł powiadomienia', required: true },
        body: { type: 'string', description: 'Treść powiadomienia', required: true },
      },
    }, async (params) => {
      const { Notification } = require('electron');
      new Notification({ title: params.title, body: params.body }).show();
      return { success: true, data: 'Powiadomienie wysłane' };
    });

    // ─── System Monitor Tools ───
    this.register({
      name: 'system_info',
      description: 'Pobiera pełne informacje o systemie: CPU, RAM, dysk, bateria, sieć, procesy. Agent zna stan komputera.',
      category: 'system',
      parameters: {},
    }, async () => {
      try {
        const snapshot = await this.systemMonitor.getSnapshot();
        return { success: true, data: snapshot };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    this.register({
      name: 'system_status',
      description: 'Krótki status systemu jednolinijkowy (CPU, RAM, dysk, bateria). Do szybkiego przeglądu.',
      category: 'system',
      parameters: {},
    }, async () => {
      try {
        const summary = await this.systemMonitor.getStatusSummary();
        const warnings = await this.systemMonitor.getWarnings();
        return {
          success: true,
          data: warnings.length > 0
            ? `${summary}\n\n⚠️ Ostrzeżenia:\n${warnings.join('\n')}`
            : summary,
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    this.register({
      name: 'process_list',
      description: 'Lista najaktywniejszych procesów (top N by CPU usage)',
      category: 'system',
      parameters: {
        limit: { type: 'number', description: 'Liczba procesów (domyślnie: 10)' },
      },
    }, async (params) => {
      try {
        const processes = await this.systemMonitor.getTopProcesses(params.limit || 10);
        return { success: true, data: processes };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    this.register({
      name: 'math_eval',
      description: 'Oblicza wyrażenie matematyczne (bezpieczna ewaluacja, bez eval())',
      category: 'system',
      parameters: {
        expression: { type: 'string', description: 'Wyrażenie matematyczne np. "2 * (3 + 4) / 5"', required: true },
      },
    }, async (params) => {
      try {
        const result = this.safeMathEval(params.expression);
        return { success: true, data: { expression: params.expression, result } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    this.register({
      name: 'security_audit',
      description: 'Pobiera statystyki bezpieczeństwa i ostatnie zablokowane akcje',
      category: 'system',
      parameters: {
        limit: { type: 'number', description: 'Liczba wpisów audytu (domyślnie: 20)' },
      },
    }, async (params) => {
      const stats = this.securityGuard.getSecurityStats();
      const blocked = this.securityGuard.getAuditLog(params.limit || 20, { result: 'blocked' });
      return { success: true, data: { stats, recentBlocked: blocked } };
    });
  }

  /**
   * Safe math expression evaluator — recursive descent parser, no eval()/Function().
   *
   * Supports: numbers, +, -, *, /, %, ^ (power), parentheses,
   * functions (sqrt, abs, round, floor, ceil, sin, cos, tan, log, log10, pow, min, max),
   * constants (PI, E).
   */
  private safeMathEval(expr: string): number {
    const tokens = this.tokenizeMathExpr(expr);
    let pos = 0;

    const peek = (): string | undefined => tokens[pos];
    const consume = (expected?: string): string => {
      const tok = tokens[pos];
      if (tok === undefined) throw new Error('Nieoczekiwany koniec wyrażenia');
      if (expected !== undefined && tok !== expected) {
        throw new Error(`Oczekiwano '${expected}', otrzymano '${tok}'`);
      }
      pos++;
      return tok;
    };

    // Allowed functions → arity and implementation
    const FUNCS: Record<string, { arity: number; fn: (...args: number[]) => number }> = {
      sqrt:  { arity: 1, fn: Math.sqrt },
      abs:   { arity: 1, fn: Math.abs },
      round: { arity: 1, fn: Math.round },
      floor: { arity: 1, fn: Math.floor },
      ceil:  { arity: 1, fn: Math.ceil },
      sin:   { arity: 1, fn: Math.sin },
      cos:   { arity: 1, fn: Math.cos },
      tan:   { arity: 1, fn: Math.tan },
      log:   { arity: 1, fn: Math.log },
      log10: { arity: 1, fn: Math.log10 },
      pow:   { arity: 2, fn: Math.pow },
      min:   { arity: 2, fn: Math.min },
      max:   { arity: 2, fn: Math.max },
    };

    const CONSTANTS: Record<string, number> = { PI: Math.PI, E: Math.E };

    // Grammar: expr → add
    // add  → mul (('+' | '-') mul)*
    // mul  → pow (('*' | '/' | '%') pow)*
    // pow  → unary ('^' unary)*          (right-assoc handled iteratively with stack)
    // unary → ('-' | '+') unary | atom
    // atom → NUMBER | CONSTANT | FUNC '(' args ')' | '(' expr ')'

    const parseExpr = (): number => {
      const result = parseAdd();
      if (pos < tokens.length) {
        throw new Error(`Nieoczekiwany token: '${tokens[pos]}'`);
      }
      return result;
    };

    const parseAdd = (): number => {
      let left = parseMul();
      while (peek() === '+' || peek() === '-') {
        const op = consume();
        const right = parseMul();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    };

    const parseMul = (): number => {
      let left = parsePow();
      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const op = consume();
        const right = parsePow();
        if (op === '*') left = left * right;
        else if (op === '/') left = left / right;
        else left = left % right;
      }
      return left;
    };

    const parsePow = (): number => {
      // Right-associative: 2^3^2 = 2^(3^2) = 512
      const bases: number[] = [parseUnary()];
      while (peek() === '^') {
        consume('^');
        bases.push(parseUnary());
      }
      let result = bases[bases.length - 1];
      for (let i = bases.length - 2; i >= 0; i--) {
        result = bases[i] ** result;
      }
      return result;
    };

    const parseUnary = (): number => {
      if (peek() === '-') { consume('-'); return -parseUnary(); }
      if (peek() === '+') { consume('+'); return parseUnary(); }
      return parseAtom();
    };

    const parseAtom = (): number => {
      const tok = peek();
      if (tok === undefined) throw new Error('Nieoczekiwany koniec wyrażenia');

      // Parenthesized expression
      if (tok === '(') {
        consume('(');
        const val = parseAdd();
        consume(')');
        return val;
      }

      // Constant
      if (tok in CONSTANTS) {
        consume();
        return CONSTANTS[tok];
      }

      // Function call
      if (tok in FUNCS) {
        const funcName = consume();
        const def = FUNCS[funcName];
        consume('(');
        const args: number[] = [parseAdd()];
        while (peek() === ',') {
          consume(',');
          args.push(parseAdd());
        }
        consume(')');
        if (args.length < def.arity) {
          throw new Error(`${funcName}() wymaga co najmniej ${def.arity} argumentów`);
        }
        return def.fn(...args);
      }

      // Number
      const num = parseFloat(tok);
      if (!isNaN(num)) {
        consume();
        return num;
      }

      throw new Error(`Wyrażenie zawiera niedozwolone identyfikatory: '${tok}'`);
    };

    const result = parseExpr();

    if (typeof result !== 'number' || !isFinite(result)) {
      throw new Error('Wynik nie jest skończoną liczbą');
    }
    return result;
  }

  /**
   * Tokenizer for math expressions.
   * Returns tokens: numbers, identifiers (function/constant names), operators, parens, commas.
   */
  private tokenizeMathExpr(expr: string): string[] {
    const tokens: string[] = [];
    const src = expr.replace(/\s+/g, '');
    let i = 0;

    while (i < src.length) {
      const ch = src[i];

      // Number (integer or decimal, including leading dot like .5)
      if (ch >= '0' && ch <= '9' || (ch === '.' && i + 1 < src.length && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        let num = '';
        while (i < src.length && ((src[i] >= '0' && src[i] <= '9') || src[i] === '.')) {
          num += src[i++];
        }
        tokens.push(num);
        continue;
      }

      // Identifier (function name or constant)
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
        let id = '';
        while (i < src.length && ((src[i] >= 'a' && src[i] <= 'z') || (src[i] >= 'A' && src[i] <= 'Z') || (src[i] >= '0' && src[i] <= '9'))) {
          id += src[i++];
        }
        tokens.push(id);
        continue;
      }

      // Operators and delimiters
      if ('+-*/%^(),'.includes(ch)) {
        // Handle ** as ^ (power)
        if (ch === '*' && i + 1 < src.length && src[i + 1] === '*') {
          tokens.push('^');
          i += 2;
        } else {
          tokens.push(ch);
          i++;
        }
        continue;
      }

      throw new Error(`Wyrażenie zawiera niedozwolone znaki: '${ch}'`);
    }

    return tokens;
  }

  // ─── Automation Tools ───

  private registerAutomationTools(): void {
    if (!this.automationService) return;
    const auto = this.automationService;

    this.register({
      name: 'mouse_move',
      description: 'Przesuwa kursor myszy na podaną pozycję (x, y)',
      category: 'automation',
      parameters: {
        x: { type: 'number', description: 'Pozycja X', required: true },
        y: { type: 'number', description: 'Pozycja Y', required: true },
      },
    }, async (params) => auto.mouseMove(params.x, params.y));

    this.register({
      name: 'mouse_click',
      description: 'Klika myszką w podanej pozycji (opcjonalnie z pozycją x,y)',
      category: 'automation',
      parameters: {
        x: { type: 'number', description: 'Pozycja X (opcjonalne)' },
        y: { type: 'number', description: 'Pozycja Y (opcjonalne)' },
        button: { type: 'string', description: 'Przycisk: left lub right (domyślnie: left)' },
      },
    }, async (params) => auto.mouseClick(params.x, params.y, params.button || 'left'));

    this.register({
      name: 'keyboard_type',
      description: 'Wpisuje tekst z klawiatury (symulacja)',
      category: 'automation',
      parameters: {
        text: { type: 'string', description: 'Tekst do wpisania', required: true },
      },
    }, async (params) => auto.keyboardType(params.text));

    this.register({
      name: 'keyboard_shortcut',
      description: 'Wykonuje skrót klawiszowy (np. ctrl+c, ctrl+shift+p)',
      category: 'automation',
      parameters: {
        keys: { type: 'string[]', description: 'Lista klawiszy, np. ["ctrl", "c"]', required: true },
      },
    }, async (params) => auto.keyboardShortcut(params.keys));

    this.register({
      name: 'keyboard_press',
      description: 'Naciska pojedynczy klawisz (enter, tab, escape, f5, etc.)',
      category: 'automation',
      parameters: {
        key: { type: 'string', description: 'Klawisz do naciśnięcia', required: true },
      },
    }, async (params) => auto.keyboardPress(params.key));

    this.register({
      name: 'get_active_window',
      description: 'Pobiera tytuł aktywnego okna na pulpicie',
      category: 'automation',
      parameters: {},
    }, async () => {
      const title = await auto.getActiveWindowTitle();
      return { success: true, data: title };
    });

    this.register({
      name: 'get_mouse_position',
      description: 'Pobiera aktualną pozycję kursora myszy',
      category: 'automation',
      parameters: {},
    }, async () => {
      const pos = await auto.getMousePosition();
      return { success: true, data: pos };
    });
  }

  // ─── Browser Tools (Playwright + CDP) ───

  private registerBrowserTools(): void {
    if (!this.browserService) return;
    const browser = this.browserService;

    // ── Launch / Close ──

    this.register({
      name: 'browser_launch',
      description: 'Uruchamia przeglądarkę Chrome/Edge (widoczną na ekranie). Opcjonalnie otwiera URL.',
      category: 'browser',
      parameters: {
        url: { type: 'string', description: 'URL do otwarcia (opcjonalny)' },
        headless: { type: 'boolean', description: 'Tryb bez okna (domyślnie: false — widoczna)' },
      },
    }, async (params) => browser.launch({ url: params.url, headless: params.headless }));

    this.register({
      name: 'browser_close',
      description: 'Zamyka przeglądarkę',
      category: 'browser',
      parameters: {},
    }, async () => { await browser.close(); return { success: true, data: 'Przeglądarka zamknięta' }; });

    // ── Navigation ──

    this.register({
      name: 'browser_navigate',
      description: 'Nawiguje aktywny tab do podanego URL',
      category: 'browser',
      parameters: {
        url: { type: 'string', description: 'URL docelowy', required: true },
      },
    }, async (params) => browser.navigate(params.url));

    this.register({
      name: 'browser_back',
      description: 'Cofnij w historii przeglądarki',
      category: 'browser',
      parameters: {},
    }, async () => browser.goBack());

    this.register({
      name: 'browser_forward',
      description: 'Do przodu w historii przeglądarki',
      category: 'browser',
      parameters: {},
    }, async () => browser.goForward());

    // ── Snapshot (key feature) ──

    this.register({
      name: 'browser_snapshot',
      description: 'Pobiera snapshot strony — drzewo tekstowe z elementami interaktywnymi oznaczonymi [e1], [e2]... Używaj PRZED kliknięciem/pisaniem, żeby poznać ref elementów.',
      category: 'browser',
      parameters: {},
    }, async () => browser.snapshot());

    // ── Actions (ref-based) ──

    this.register({
      name: 'browser_click',
      description: 'Klika element po ref ze snapshota (np. "e5"). Weź snapshot najpierw!',
      category: 'browser',
      parameters: {
        ref: { type: 'string', description: 'Ref elementu ze snapshota, np. "e5"', required: true },
        doubleClick: { type: 'boolean', description: 'Podwójne kliknięcie (domyślnie: false)' },
      },
    }, async (params) => browser.click(params.ref, { doubleClick: params.doubleClick }));

    this.register({
      name: 'browser_type',
      description: 'Wpisuje tekst w pole input po ref ze snapshota',
      category: 'browser',
      parameters: {
        ref: { type: 'string', description: 'Ref elementu input/textarea', required: true },
        text: { type: 'string', description: 'Tekst do wpisania', required: true },
        submit: { type: 'boolean', description: 'Naciśnij Enter po wpisaniu (domyślnie: false)' },
      },
    }, async (params) => browser.type(params.ref, params.text, { submit: params.submit }));

    this.register({
      name: 'browser_hover',
      description: 'Najeżdża na element po ref (hover)',
      category: 'browser',
      parameters: {
        ref: { type: 'string', description: 'Ref elementu', required: true },
      },
    }, async (params) => browser.hover(params.ref));

    this.register({
      name: 'browser_select',
      description: 'Wybiera opcję z elementu <select> po ref',
      category: 'browser',
      parameters: {
        ref: { type: 'string', description: 'Ref elementu <select>', required: true },
        value: { type: 'string', description: 'Wartość opcji do wybrania', required: true },
      },
    }, async (params) => browser.selectOption(params.ref, params.value));

    this.register({
      name: 'browser_press',
      description: 'Naciska klawisz na klawiaturze (np. "Enter", "Tab", "Escape", "Control+a")',
      category: 'browser',
      parameters: {
        key: { type: 'string', description: 'Klawisz do naciśnięcia', required: true },
      },
    }, async (params) => browser.press(params.key));

    this.register({
      name: 'browser_scroll',
      description: 'Przewija stronę (up/down/top/bottom)',
      category: 'browser',
      parameters: {
        direction: { type: 'string', description: 'Kierunek: "up", "down", "top", "bottom"', required: true },
        amount: { type: 'number', description: 'Piksele przewijania (domyślnie 500)' },
      },
    }, async (params) => browser.scroll(params.direction, params.amount));

    this.register({
      name: 'browser_fill_form',
      description: 'Wypełnia wiele pól formularza naraz. fields: [{ref, value}]',
      category: 'browser',
      parameters: {
        fields: { type: 'array', description: 'Tablica obiektów {ref: string, value: string}', required: true },
      },
    }, async (params) => browser.fillForm(params.fields));

    // ── Screenshot ──

    this.register({
      name: 'browser_screenshot',
      description: 'Robi screenshot strony (zwraca base64 JPEG)',
      category: 'browser',
      parameters: {
        fullPage: { type: 'boolean', description: 'Cała strona vs widoczna część (domyślnie: false)' },
        ref: { type: 'string', description: 'Screenshot konkretnego elementu po ref' },
      },
    }, async (params) => browser.screenshot({ fullPage: params.fullPage, ref: params.ref }));

    // ── Tabs ──

    this.register({
      name: 'browser_tabs',
      description: 'Lista otwartych tabów',
      category: 'browser',
      parameters: {},
    }, async () => browser.tabs());

    this.register({
      name: 'browser_tab_new',
      description: 'Otwiera nowy tab (opcjonalnie z URL)',
      category: 'browser',
      parameters: {
        url: { type: 'string', description: 'URL do otwarcia w nowym tabie' },
      },
    }, async (params) => browser.newTab(params.url));

    this.register({
      name: 'browser_tab_switch',
      description: 'Przełącza aktywny tab po indeksie',
      category: 'browser',
      parameters: {
        index: { type: 'number', description: 'Indeks taba (od 0)', required: true },
      },
    }, async (params) => browser.switchTab(params.index));

    this.register({
      name: 'browser_tab_close',
      description: 'Zamyka tab po indeksie (lub aktywny)',
      category: 'browser',
      parameters: {
        index: { type: 'number', description: 'Indeks taba do zamknięcia (domyślnie aktywny)' },
      },
    }, async (params) => browser.closeTab(params.index));

    // ── Other ──

    this.register({
      name: 'browser_evaluate',
      description: 'Wykonuje kod JavaScript na stronie i zwraca wynik',
      category: 'browser',
      parameters: {
        script: { type: 'string', description: 'Kod JS do wykonania', required: true },
      },
    }, async (params) => browser.evaluate(params.script));

    this.register({
      name: 'browser_wait',
      description: 'Czeka na warunek: selector / url / load / timeout',
      category: 'browser',
      parameters: {
        type: { type: 'string', description: '"selector" | "url" | "load" | "timeout"', required: true },
        value: { type: 'string', description: 'Selector CSS, wzorzec URL, lub czas w ms' },
        timeout: { type: 'number', description: 'Max czas oczekiwania w ms (domyślnie 10000)' },
      },
    }, async (params) => browser.wait({ type: params.type, value: params.value, timeout: params.timeout }));

    this.register({
      name: 'browser_extract_text',
      description: 'Pobiera tekst ze strony (opcjonalnie z konkretnego selektora CSS)',
      category: 'browser',
      parameters: {
        selector: { type: 'string', description: 'CSS selector (opcjonalny, domyślnie cała strona)' },
      },
    }, async (params) => browser.extractText(params.selector));

    this.register({
      name: 'browser_page_info',
      description: 'Pobiera info o aktywnej stronie (URL, tytuł, numer taba)',
      category: 'browser',
      parameters: {},
    }, async () => browser.getPageInfo());
  }

  // ─── RAG Tools ───

  private registerRAGTools(): void {
    if (!this.ragService) return;
    const rag = this.ragService;

    this.register({
      name: 'search_memory',
      description: 'Semantic search po pamięci agenta (pliki .md). Zwraca najbardziej relevantne fragmenty.',
      category: 'memory',
      parameters: {
        query: { type: 'string', description: 'Zapytanie wyszukiwania', required: true },
        topK: { type: 'number', description: 'Liczba wyników (domyślnie: 5)' },
      },
    }, async (params) => {
      const results = await rag.search(params.query, params.topK || 5);
      if (results.length === 0) return { success: true, data: 'Brak wyników w pamięci' };
      const formatted = results.map((r) =>
        `[${r.chunk.fileName} > ${r.chunk.section}] (score: ${r.score.toFixed(2)})\n${r.chunk.content.slice(0, 500)}`
      ).join('\n\n---\n\n');
      return { success: true, data: formatted };
    });

    this.register({
      name: 'reindex_memory',
      description: 'Przeindeksuj pamięć agenta (po dodaniu nowych plików .md)',
      category: 'memory',
      parameters: {},
    }, async () => {
      await rag.reindex();
      const stats = rag.getStats();
      return { success: true, data: `Reindeksacja zakończona: ${stats.totalChunks} chunków z ${stats.totalFiles} plików` };
    });
  }

  // ─── Plugin Tools ───

  private registerPluginTools(): void {
    if (!this.pluginService) return;

    const pluginDefs = this.pluginService.getToolDefinitions();
    for (const def of pluginDefs) {
      this.definitions.push(def);
      this.toolRegistry.set(def.name, async (params: any) => {
        return this.pluginService!.executeTool(def.name, params);
      });
    }
  }

  // ─── Registry ───

  register(definition: ToolDefinition, handler: (params: any) => Promise<ToolResult>): void {
    this.definitions.push(definition);
    this.toolRegistry.set(definition.name, handler);
  }

  async execute(name: string, params: any): Promise<ToolResult> {
    const handler = this.toolRegistry.get(name);
    if (!handler) {
      // Try plugin tools (they may have been loaded after initial registration)
      if (name.startsWith('plugin:') && this.pluginService) {
        return this.pluginService.executeTool(name, params);
      }
      return { success: false, error: `Nieznane narzędzie: ${name}` };
    }
    return handler(params);
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.definitions];
  }

  /**
   * Returns tool descriptions formatted for AI system prompt injection.
   */
  getToolsPrompt(excludeCategories?: string[]): string {
    const filtered = excludeCategories
      ? this.definitions.filter((t) => !excludeCategories.includes(t.category))
      : this.definitions;

    const tools = filtered.map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `  - ${k} (${v.type}${v.required ? ', required' : ''}): ${v.description}`)
        .join('\n');
      return `### ${t.name}\n${t.description}\nCategory: ${t.category}\n${params ? `Parameters:\n${params}` : 'No parameters'}`;
    });

    return `# Available Tools\n\nYou can use tools by responding with a JSON block:\n\`\`\`tool\n{"tool": "tool_name", "params": { ... }}\n\`\`\`\n\nAvailable tools:\n\n${tools.join('\n\n')}`;
  }
}
