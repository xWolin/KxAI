import { exec, execFile } from 'child_process';
import * as dns from 'dns';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { app, clipboard, shell } from 'electron';
import { AutomationService } from './automation-service';
import { BrowserService } from './browser-service';
import { RAGService } from './rag-service';
import { PluginService } from './plugin-service';
import { CronService } from './cron-service';
import { FileIntelligenceService } from './file-intelligence';
import { CalendarService } from './calendar-service';
import { PrivacyService } from './privacy-service';
import { SecurityGuard } from './security-guard';
import { SystemMonitor } from './system-monitor';

// Re-export from shared types (canonical source)
export type { ToolDefinition, ToolResult, ToolCategory } from '../../shared/types/tools';
import type { ToolDefinition, ToolResult } from '../../shared/types/tools';

export class ToolsService {
  private toolRegistry: Map<string, (params: any) => Promise<ToolResult>> = new Map();
  private definitions: ToolDefinition[] = [];
  private automationService?: AutomationService;
  private browserService?: BrowserService;
  private ragService?: RAGService;
  private pluginService?: PluginService;
  private cronService?: CronService;
  private fileIntelligenceService?: FileIntelligenceService;
  private calendarService?: CalendarService;
  private privacyService?: PrivacyService;
  private securityGuard: SecurityGuard;
  private systemMonitor: SystemMonitor;

  /** Callback for workflow recording — called after every tool execution */
  private onToolExecuted?: (name: string, params: any, result: ToolResult, durationMs: number) => void;

  constructor() {
    this.securityGuard = new SecurityGuard();
    this.systemMonitor = new SystemMonitor();
    this.registerBuiltinTools();
  }

  /**
   * Shared SSRF validator — blocks localhost, private IPs, link-local,
   * IPv6 loopback/ULA/link-local, and reserved TLDs.
   * Performs DNS resolution to prevent DNS rebinding and numeric/IPv6-mapped bypasses.
   */
  private async validateSSRF(
    url: string,
  ): Promise<{ blocked: boolean; error?: string; parsed?: URL; resolvedIPs?: string[] }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { blocked: true, error: '🛡️ Nieprawidłowy URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { blocked: true, error: `🛡️ Dozwolone tylko http/https (otrzymano: ${parsed.protocol})` };
    }
    // Strip brackets from IPv6 for consistent matching
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const blockedHostPatterns = [/^localhost$/i, /\.local$/i, /\.internal$/i, /\.localhost$/i];
    for (const pattern of blockedHostPatterns) {
      if (pattern.test(hostname)) {
        return { blocked: true, error: '🛡️ Dostęp do adresów wewnętrznych zablokowany (SSRF protection)' };
      }
    }

    // Resolve DNS and validate each resolved IP
    let resolvedIPs: string[];
    try {
      // If hostname is already an IP literal, use it directly
      if (net.isIP(hostname)) {
        resolvedIPs = [hostname];
      } else {
        const results = await dns.promises.resolve4(hostname).catch(() => [] as string[]);
        const results6 = await dns.promises.resolve6(hostname).catch(() => [] as string[]);
        resolvedIPs = [...results, ...results6];
        if (resolvedIPs.length === 0) {
          // Fallback to lookup (respects /etc/hosts)
          const lookupResult = await dns.promises.lookup(hostname, { all: true });
          resolvedIPs = lookupResult.map((r) => r.address);
        }
      }
    } catch {
      return { blocked: true, error: '🛡️ Nie można rozwiązać DNS dla podanego hosta' };
    }

    for (const ip of resolvedIPs) {
      if (this.isPrivateIP(ip)) {
        return {
          blocked: true,
          error: '🛡️ Dostęp do adresów wewnętrznych zablokowany (SSRF protection — DNS resolved to private IP)',
          resolvedIPs,
        };
      }
    }

    return { blocked: false, parsed, resolvedIPs };
  }

  /**
   * Check whether an IP address (IPv4 or IPv6) belongs to a private, loopback,
   * link-local, or otherwise reserved range.
   */
  private isPrivateIP(ip: string): boolean {
    // IPv4 checks
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(Number);
      // 127.0.0.0/8 — loopback
      if (parts[0] === 127) return true;
      // 10.0.0.0/8 — private
      if (parts[0] === 10) return true;
      // 172.16.0.0/12 — private
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16 — private
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 169.254.0.0/16 — link-local
      if (parts[0] === 169 && parts[1] === 254) return true;
      // 0.0.0.0/8 — "this" network
      if (parts[0] === 0) return true;
      return false;
    }

    // IPv6 checks
    const normalized = ip.toLowerCase();
    // ::1 — loopback
    if (normalized === '::1' || /^0*:0*:0*:0*:0*:0*:0*:0*1$/.test(normalized)) return true;
    // :: — unspecified
    if (normalized === '::' || /^0*:0*:0*:0*:0*:0*:0*:0*$/.test(normalized)) return true;
    // fc00::/7 — unique local (ULA)
    if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;
    // fe80::/10 — link-local
    if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true;
    // ::ffff:x.x.x.x — IPv4-mapped IPv6
    const v4mapped = normalized.match(/^::ffff:([\d.]+)$/);
    if (v4mapped) return this.isPrivateIP(v4mapped[1]);
    // ::x.x.x.x — IPv4-compatible IPv6 (deprecated but still possible)
    const v4compat = normalized.match(/^::([\d.]+)$/);
    if (v4compat) return this.isPrivateIP(v4compat[1]);

    return false;
  }

  /**
   * Wire external services after construction.
   */
  setServices(services: {
    automation?: AutomationService;
    browser?: BrowserService;
    rag?: RAGService;
    plugins?: PluginService;
    cron?: CronService;
    fileIntelligence?: FileIntelligenceService;
    calendar?: CalendarService;
    privacy?: PrivacyService;
    securityGuard?: SecurityGuard;
    systemMonitor?: SystemMonitor;
  }): void {
    this.automationService = services.automation;
    this.browserService = services.browser;
    this.ragService = services.rag;
    this.pluginService = services.plugins;
    this.cronService = services.cron;
    this.fileIntelligenceService = services.fileIntelligence;
    this.calendarService = services.calendar;
    this.privacyService = services.privacy;
    // Use container instances instead of duplicates (if provided)
    if (services.securityGuard) this.securityGuard = services.securityGuard;
    if (services.systemMonitor) this.systemMonitor = services.systemMonitor;

    this.registerAutomationTools();
    this.registerBrowserTools();
    this.registerRAGTools();
    this.registerPluginTools();
    this.registerReminderTools();
    this.registerFileIntelligenceTools();
    this.registerCalendarTools();
    this.registerPrivacyTools();
  }

  /**
   * Set callback for workflow recording — called after every tool execution.
   * Used by WorkflowAutomator to record macro steps.
   */
  setToolExecutedCallback(cb: (name: string, params: any, result: ToolResult, durationMs: number) => void): void {
    this.onToolExecuted = cb;
  }

  private registerBuiltinTools(): void {
    // ─── System Tools ───
    this.register(
      {
        name: 'get_current_time',
        description: 'Pobiera aktualną datę i godzinę',
        category: 'system',
        parameters: {},
      },
      async () => {
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
      },
    );

    // Determine default shell based on platform
    const defaultShell =
      process.platform === 'win32' ? 'PowerShell' : process.platform === 'darwin' ? 'zsh/bash' : 'bash';

    this.register(
      {
        name: 'run_shell_command',
        description: `Wykonuje komendę w terminalu systemowym (${defaultShell}). Komenda jest walidowana pod kątem bezpieczeństwa. OS: ${process.platform}.`,
        category: 'system',
        parameters: {
          command: { type: 'string', description: `Komenda do wykonania w ${defaultShell}`, required: true },
          timeout: { type: 'number', description: 'Timeout w ms (default 30000)' },
        },
      },
      async (params) => {
        // Security validation
        const validation = this.securityGuard.validateCommand(params.command);
        if (!validation.allowed) {
          return { success: false, error: `🛡️ ${validation.reason}` };
        }

        // Use platform-appropriate shell
        const shellOpts: Record<string, any> =
          process.platform === 'win32' ? { shell: 'powershell.exe' } : { shell: '/bin/sh' };

        return new Promise((resolve) => {
          const timeout = Math.min(params.timeout || 30000, 60000); // Max 60s
          exec(params.command, { timeout, maxBuffer: 1024 * 1024, ...shellOpts }, (err, stdout, stderr) => {
            if (err) {
              resolve({
                success: false,
                error: err.message,
                data: { stdout: stdout?.slice(0, 5000), stderr: stderr?.slice(0, 2000) },
              });
            } else {
              resolve({
                success: true,
                data: { stdout: stdout.trim().slice(0, 10000), stderr: stderr.trim().slice(0, 2000) },
              });
            }
          });
        });
      },
    );

    this.register(
      {
        name: 'open_url',
        description: 'Otwiera URL w domyślnej przeglądarce (tylko http/https)',
        category: 'web',
        parameters: {
          url: { type: 'string', description: 'URL do otwarcia', required: true },
        },
      },
      async (params) => {
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
      },
    );

    this.register(
      {
        name: 'open_path',
        description: 'Otwiera plik lub folder w domyślnej aplikacji',
        category: 'files',
        parameters: {
          path: { type: 'string', description: 'Ścieżka do pliku lub folderu', required: true },
        },
      },
      async (params) => {
        // Security: validate path before opening
        const openValidation = this.securityGuard.validateReadPath(params.path);
        if (!openValidation.allowed) {
          return { success: false, error: `🛡️ ${openValidation.reason}` };
        }
        await shell.openPath(params.path);
        return { success: true, data: `Otwarto: ${params.path}` };
      },
    );

    this.register(
      {
        name: 'clipboard_read',
        description: 'Odczytuje zawartość schowka',
        category: 'system',
        parameters: {},
      },
      async () => {
        const text = clipboard.readText();
        return { success: true, data: text };
      },
    );

    this.register(
      {
        name: 'clipboard_write',
        description: 'Zapisuje tekst do schowka',
        category: 'system',
        parameters: {
          text: { type: 'string', description: 'Tekst do skopiowania', required: true },
        },
      },
      async (params) => {
        clipboard.writeText(params.text);
        return { success: true, data: 'Zapisano do schowka' };
      },
    );

    // ─── File Tools ───
    this.register(
      {
        name: 'read_file',
        description: 'Czyta zawartość pliku tekstowego',
        category: 'files',
        parameters: {
          path: { type: 'string', description: 'Ścieżka do pliku', required: true },
        },
      },
      async (params) => {
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
      },
    );

    this.register(
      {
        name: 'write_file',
        description: 'Zapisuje treść do pliku (tworzy go jeśli nie istnieje). Ścieżka jest walidowana.',
        category: 'files',
        parameters: {
          path: { type: 'string', description: 'Ścieżka do pliku', required: true },
          content: { type: 'string', description: 'Treść do zapisania', required: true },
        },
      },
      async (params) => {
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
      },
    );

    this.register(
      {
        name: 'list_directory',
        description: 'Listuje pliki i foldery w katalogu',
        category: 'files',
        parameters: {
          path: { type: 'string', description: 'Ścieżka do katalogu', required: true },
        },
      },
      async (params) => {
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
      },
    );

    // ─── Web Search ───
    this.register(
      {
        name: 'web_search',
        description: 'Wyszukuje w internecie używając DuckDuckGo',
        category: 'web',
        parameters: {
          query: { type: 'string', description: 'Zapytanie wyszukiwania', required: true },
        },
      },
      async (params) => {
        try {
          const https = require('https');

          // Use DuckDuckGo HTML endpoint which returns actual search results
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
          const data = await new Promise<string>((resolve, reject) => {
            const req = https.get(url, { headers: { 'User-Agent': 'KxAI/1.0' } }, (res: any) => {
              let body = '';
              res.on('data', (chunk: string) => (body += chunk));
              res.on('end', () => resolve(body));
              res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(10000, () => {
              req.destroy();
              reject(new Error('Timeout'));
            });
          });

          // Parse HTML results — extract result blocks
          const results: Array<{ title: string; text: string; url: string }> = [];
          const resultBlocks =
            data.match(
              /<a[^>]+class="result__a"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>[\s\S]*?<\/a>/g,
            ) || [];
          for (const block of resultBlocks.slice(0, 8)) {
            const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/);
            const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
            const urlMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/);
            if (titleMatch && snippetMatch) {
              const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
              const text = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
              const resultUrl = urlMatch
                ? decodeURIComponent(urlMatch[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0])
                : '';
              if (title && text) results.push({ title, text, url: resultUrl });
            }
          }

          // Fallback: try Instant Answer API if HTML parsing yielded nothing
          if (results.length === 0) {
            const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(params.query)}&format=json&no_html=1`;
            const iaData = await new Promise<string>((resolve, reject) => {
              https
                .get(iaUrl, (res: any) => {
                  let body = '';
                  res.on('data', (chunk: string) => (body += chunk));
                  res.on('end', () => resolve(body));
                  res.on('error', reject);
                })
                .on('error', reject);
            });
            const json = JSON.parse(iaData);
            if (json.AbstractText) results.push({ title: 'Summary', text: json.AbstractText, url: json.AbstractURL });
            if (json.RelatedTopics) {
              for (const t of json.RelatedTopics.slice(0, 5)) {
                if (t.Text) results.push({ title: t.Text.slice(0, 100), text: t.Text, url: t.FirstURL });
              }
            }
          }

          return { success: true, data: results.length ? results : 'Brak wyników' };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    this.register(
      {
        name: 'fetch_url',
        description: 'Pobiera treść strony internetowej (text). Blokuje adresy wewnętrzne (SSRF protection).',
        category: 'web',
        parameters: {
          url: { type: 'string', description: 'URL strony', required: true },
        },
      },
      async (params) => {
        try {
          // SSRF protection: validate URL and block internal addresses
          const ssrf = await this.validateSSRF(params.url);
          if (ssrf.blocked) return { success: false, error: ssrf.error! };
          const parsedUrl = ssrf.parsed!;

          const https = require('https');
          const http = require('http');
          const client = parsedUrl.protocol === 'https:' ? https : http;
          const data = await new Promise<string>((resolve, reject) => {
            client
              .get(params.url, { headers: { 'User-Agent': 'KxAI/1.0' } }, (res: any) => {
                let body = '';
                res.on('data', (chunk: string) => (body += chunk));
                res.on('end', () => resolve(body));
                res.on('error', reject);
              })
              .on('error', reject);
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
      },
    );

    // ─── Notification ───
    this.register(
      {
        name: 'send_notification',
        description: 'Wysyła systemowe powiadomienie',
        category: 'system',
        parameters: {
          title: { type: 'string', description: 'Tytuł powiadomienia', required: true },
          body: { type: 'string', description: 'Treść powiadomienia', required: true },
        },
      },
      async (params) => {
        const { Notification } = require('electron');
        new Notification({ title: params.title, body: params.body }).show();
        return { success: true, data: 'Powiadomienie wysłane' };
      },
    );

    // ─── System Monitor Tools ───
    this.register(
      {
        name: 'system_info',
        description:
          'Pobiera pełne informacje o systemie: CPU, RAM, dysk, bateria, sieć, procesy. Agent zna stan komputera.',
        category: 'system',
        parameters: {},
      },
      async () => {
        try {
          const snapshot = await this.systemMonitor.getSnapshot();
          return { success: true, data: snapshot };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    this.register(
      {
        name: 'system_status',
        description: 'Krótki status systemu jednolinijkowy (CPU, RAM, dysk, bateria). Do szybkiego przeglądu.',
        category: 'system',
        parameters: {},
      },
      async () => {
        try {
          const summary = await this.systemMonitor.getStatusSummary();
          const warnings = await this.systemMonitor.getWarnings();
          return {
            success: true,
            data: warnings.length > 0 ? `${summary}\n\n⚠️ Ostrzeżenia:\n${warnings.join('\n')}` : summary,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    this.register(
      {
        name: 'process_list',
        description: 'Lista najaktywniejszych procesów (top N by CPU usage)',
        category: 'system',
        parameters: {
          limit: { type: 'number', description: 'Liczba procesów (domyślnie: 10)' },
        },
      },
      async (params) => {
        try {
          const processes = await this.systemMonitor.getTopProcesses(params.limit || 10);
          return { success: true, data: processes };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    this.register(
      {
        name: 'math_eval',
        description: 'Oblicza wyrażenie matematyczne (bezpieczna ewaluacja, bez eval())',
        category: 'system',
        parameters: {
          expression: { type: 'string', description: 'Wyrażenie matematyczne np. "2 * (3 + 4) / 5"', required: true },
        },
      },
      async (params) => {
        try {
          const result = this.safeMathEval(params.expression);
          return { success: true, data: { expression: params.expression, result } };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    this.register(
      {
        name: 'security_audit',
        description: 'Pobiera statystyki bezpieczeństwa i ostatnie zablokowane akcje',
        category: 'system',
        parameters: {
          limit: { type: 'number', description: 'Liczba wpisów audytu (domyślnie: 20)' },
        },
      },
      async (params) => {
        const stats = this.securityGuard.getSecurityStats();
        const blocked = this.securityGuard.getAuditLog(params.limit || 20, { result: 'blocked' });
        return { success: true, data: { stats, recentBlocked: blocked } };
      },
    );

    // ─── Coding / Self-Programming Tools ───

    this.register(
      {
        name: 'execute_code',
        description:
          'Wykonuje kod w wybranym języku (node/python/powershell/bash). Kod jest zapisywany do pliku tymczasowego i uruchamiany. Używaj gdy potrzebujesz przetworzyć dane, skonwertować pliki, wykonać obliczenia, lub zbudować jednorazowe narzędzie.',
        category: 'coding',
        parameters: {
          language: { type: 'string', description: 'Język: "node", "python", "powershell", "bash"', required: true },
          code: { type: 'string', description: 'Kod do wykonania', required: true },
          timeout: { type: 'number', description: 'Timeout w ms (domyślnie 60000)' },
        },
      },
      async (params) => {
        const { language, code } = params;
        const timeout = Math.min(params.timeout || 60000, 120000);

        // Map language to interpreter + file extension (platform-aware)
        const isWin = process.platform === 'win32';
        const pythonCmd = isWin ? 'python' : 'python3';
        const psCmd = isWin ? 'powershell' : 'pwsh';
        const psArgs = isWin ? ['-ExecutionPolicy', 'Bypass', '-File'] : ['-File'];

        const langMap: Record<string, { cmd: string; ext: string; args?: string[] }> = {
          node: { cmd: 'node', ext: '.js' },
          javascript: { cmd: 'node', ext: '.js' },
          python: { cmd: pythonCmd, ext: '.py' },
          powershell: { cmd: psCmd, ext: '.ps1', args: psArgs },
          bash: { cmd: isWin ? 'bash' : '/bin/bash', ext: '.sh' },
          sh: { cmd: '/bin/sh', ext: '.sh' },
          typescript: { cmd: 'npx', ext: '.ts', args: ['tsx'] },
        };

        const lang = langMap[language.toLowerCase()];
        if (!lang) {
          return {
            success: false,
            error: `Nieobsługiwany język: ${language}. Dostępne: ${Object.keys(langMap).join(', ')}`,
          };
        }

        // Write code to temp file
        const tempDir = path.join(app.getPath('temp'), 'kxai-scripts');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const tempFile = path.join(tempDir, `script_${Date.now()}${lang.ext}`);
        fs.writeFileSync(tempFile, code, 'utf8');

        const cmdArgs = lang.args ? [...lang.args, tempFile] : [tempFile];
        const fullCmd = `${lang.cmd} ${cmdArgs.map((a) => `"${a}"`).join(' ')}`;

        return new Promise((resolve) => {
          exec(fullCmd, { timeout, maxBuffer: 5 * 1024 * 1024, cwd: app.getPath('home') }, (err, stdout, stderr) => {
            // Cleanup temp file
            try {
              fs.unlinkSync(tempFile);
            } catch {
              /* ok */
            }

            if (err) {
              resolve({
                success: false,
                error: err.message,
                data: {
                  stdout: stdout?.slice(0, 10000),
                  stderr: stderr?.slice(0, 5000),
                  exitCode: err.code,
                },
              });
            } else {
              resolve({
                success: true,
                data: {
                  stdout: stdout.trim().slice(0, 15000),
                  stderr: stderr.trim().slice(0, 3000),
                },
              });
            }
          });
        });
      },
    );

    this.register(
      {
        name: 'http_request',
        description:
          'Wykonuje pełne żądanie HTTP (GET/POST/PUT/DELETE) z headerami i body. Odpowiednik curl. Używaj do komunikacji z API (OpenAI, GitHub, Whisper, etc.).',
        category: 'coding',
        parameters: {
          url: { type: 'string', description: 'URL żądania', required: true },
          method: { type: 'string', description: 'Metoda: GET, POST, PUT, DELETE, PATCH (domyślnie: GET)' },
          headers: { type: 'object', description: 'Nagłówki HTTP jako obiekt klucz-wartość' },
          body: { type: 'string', description: 'Body żądania (dla POST/PUT/PATCH)' },
          timeout: { type: 'number', description: 'Timeout w ms (domyślnie 30000)' },
        },
      },
      async (params) => {
        const { url, method = 'GET', headers = {}, body, timeout: reqTimeout = 30000 } = params;

        // SSRF protection
        const ssrf = await this.validateSSRF(url);
        if (ssrf.blocked) return { success: false, error: ssrf.error! };

        return new Promise((resolve) => {
          try {
            const parsedUrl = new URL(url);
            const isHttps = parsedUrl.protocol === 'https:';
            const client = isHttps ? require('https') : require('http');

            const options = {
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || (isHttps ? 443 : 80),
              path: parsedUrl.pathname + parsedUrl.search,
              method: method.toUpperCase(),
              headers: {
                'User-Agent': 'KxAI/1.0',
                ...headers,
              },
              timeout: Math.min(reqTimeout, 60000),
            };

            if (body && !options.headers['Content-Type']) {
              // Auto-detect content type
              try {
                JSON.parse(body);
                options.headers['Content-Type'] = 'application/json';
              } catch {
                options.headers['Content-Type'] = 'text/plain';
              }
            }

            const req = client.request(options, (res: any) => {
              let responseData = '';
              const chunks: Buffer[] = [];
              const contentType = (res.headers['content-type'] || '').toLowerCase();
              const isBinary =
                !contentType.includes('text') &&
                !contentType.includes('json') &&
                !contentType.includes('xml') &&
                !contentType.includes('html');

              if (isBinary) {
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                  const buffer = Buffer.concat(chunks);
                  resolve({
                    success: true,
                    data: {
                      statusCode: res.statusCode,
                      headers: res.headers,
                      bodyBase64: buffer.toString('base64').slice(0, 50000),
                      bodySize: buffer.length,
                      contentType,
                    },
                  });
                });
              } else {
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => (responseData += chunk));
                res.on('end', () => {
                  resolve({
                    success: true,
                    data: {
                      statusCode: res.statusCode,
                      headers: res.headers,
                      body: responseData.slice(0, 30000),
                      contentType,
                    },
                  });
                });
              }
            });

            req.on('error', (err: any) => {
              resolve({ success: false, error: `HTTP request failed: ${err.message}` });
            });

            req.on('timeout', () => {
              req.destroy();
              resolve({ success: false, error: 'HTTP request timeout' });
            });

            if (body) {
              req.write(body);
            }
            req.end();
          } catch (err: any) {
            resolve({ success: false, error: `HTTP request setup failed: ${err.message}` });
          }
        });
      },
    );

    this.register(
      {
        name: 'find_program',
        description:
          'Odkrywa zainstalowane programy i narzędzia na komputerze (node, python, ffmpeg, git, gh, curl, etc.). Użyj gdy musisz wiedzieć jakie narzędzia są dostępne, zanim zaczniesz z nich korzystać.',
        category: 'coding',
        parameters: {
          programs: {
            type: 'string[]',
            description: 'Lista nazw programów do sprawdzenia, np. ["python", "ffmpeg", "git", "curl"]',
            required: true,
          },
        },
      },
      async (params) => {
        const programs: string[] = Array.isArray(params.programs) ? params.programs : [params.programs];
        const results: Record<string, { found: boolean; path?: string; version?: string }> = {};

        for (const prog of programs) {
          // Security: only allow simple program names (no paths, no args)
          if (!/^[\w.-]+$/.test(prog)) {
            results[prog] = { found: false };
            continue;
          }

          try {
            const whereCmd = process.platform === 'win32' ? `where ${prog}` : `which ${prog}`;
            const location = await new Promise<string>((resolve, reject) => {
              exec(whereCmd, { timeout: 5000 }, (err, stdout) => {
                if (err) reject(err);
                else resolve(stdout.trim().split('\n')[0]);
              });
            });

            // Try to get version
            let version = '';
            try {
              version = await new Promise<string>((resolve) => {
                exec(`${prog} --version`, { timeout: 5000 }, (err, stdout, stderr) => {
                  const out = (stdout || stderr || '').trim().split('\n')[0].slice(0, 100);
                  resolve(out);
                });
              });
            } catch {
              /* no version flag */
            }

            results[prog] = { found: true, path: location, version };
          } catch {
            results[prog] = { found: false };
          }
        }

        return { success: true, data: results };
      },
    );

    this.register(
      {
        name: 'install_package',
        description: `Instaluje pakiet/bibliotekę. Dostępne menedżery: pip, npm, cargo${process.platform === 'win32' ? ', choco, winget' : ''}${process.platform === 'darwin' ? ', brew' : ''}${process.platform === 'linux' ? ', apt, dnf' : ''}.`,
        category: 'coding',
        parameters: {
          manager: {
            type: 'string',
            description: `Menedżer pakietów: "pip", "npm", "cargo"${process.platform === 'win32' ? ', "choco", "winget"' : ''}${process.platform === 'darwin' ? ', "brew"' : ''}${process.platform === 'linux' ? ', "apt", "dnf"' : ''}`,
            required: true,
          },
          package: { type: 'string', description: 'Nazwa pakietu do instalacji', required: true },
        },
      },
      async (params) => {
        const { manager, package: pkg } = params;

        // Security: only allow simple package names
        if (!/^[@\w./-]+$/.test(pkg)) {
          return { success: false, error: '🛡️ Nieprawidłowa nazwa pakietu' };
        }

        const pipCmd = process.platform === 'win32' ? 'pip' : 'pip3';
        const cmdMap: Record<string, string> = {
          pip: `${pipCmd} install ${pkg}`,
          pip3: `pip3 install ${pkg}`,
          npm: `npm install -g ${pkg}`,
          cargo: `cargo install ${pkg}`,
          choco: `choco install ${pkg} -y`,
          winget: `winget install ${pkg}`,
          brew: `brew install ${pkg}`,
          apt: `sudo apt-get install -y ${pkg}`,
          dnf: `sudo dnf install -y ${pkg}`,
        };

        const cmd = cmdMap[manager.toLowerCase()];
        if (!cmd) {
          return {
            success: false,
            error: `Nieobsługiwany menedżer: ${manager}. Dostępne: ${Object.keys(cmdMap).join(', ')}`,
          };
        }

        // Validate through security guard
        const validation = this.securityGuard.validateCommand(cmd);
        if (!validation.allowed) {
          return { success: false, error: `🛡️ ${validation.reason}` };
        }

        return new Promise((resolve) => {
          exec(cmd, { timeout: 120000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
              resolve({
                success: false,
                error: err.message,
                data: { stdout: stdout?.slice(0, 5000), stderr: stderr?.slice(0, 3000) },
              });
            } else {
              resolve({ success: true, data: { stdout: stdout.trim().slice(0, 5000), package: pkg, manager } });
            }
          });
        });
      },
    );

    this.register(
      {
        name: 'create_and_run_script',
        description:
          'Tworzy plik skryptu (na dysku), uruchamia go, i zwraca wynik. Skrypt zostaje na dysku do późniejszego użycia. Używaj do tworzenia trwałych narzędzi/skryptów wielokrotnego użytku.',
        category: 'coding',
        parameters: {
          path: { type: 'string', description: 'Ścieżka do zapisania skryptu', required: true },
          code: { type: 'string', description: 'Kod skryptu', required: true },
          language: { type: 'string', description: 'Język: "node", "python", "powershell", "bash"', required: true },
          args: { type: 'string', description: 'Argumenty do przekazania (opcjonalne)' },
        },
      },
      async (params) => {
        const { code, language, args = '' } = params;
        const scriptPath = params.path;

        // Validate write path
        const writeValidation = this.securityGuard.validateWritePath(scriptPath);
        if (!writeValidation.allowed) {
          return { success: false, error: `🛡️ ${writeValidation.reason}` };
        }

        // Platform-aware interpreters
        const isWin = process.platform === 'win32';
        const pythonCmd = isWin ? 'python' : 'python3';
        const psCmd = isWin ? 'powershell' : 'pwsh';
        const psArgs = isWin ? ['-ExecutionPolicy', 'Bypass', '-File'] : ['-File'];

        const langMap: Record<string, { cmd: string; ext: string; cmdArgs?: string[] }> = {
          node: { cmd: 'node', ext: '.js' },
          javascript: { cmd: 'node', ext: '.js' },
          python: { cmd: pythonCmd, ext: '.py' },
          powershell: { cmd: psCmd, ext: '.ps1', cmdArgs: psArgs },
          bash: { cmd: isWin ? 'bash' : '/bin/bash', ext: '.sh' },
          sh: { cmd: '/bin/sh', ext: '.sh' },
          typescript: { cmd: 'npx', ext: '.ts', cmdArgs: ['tsx'] },
        };

        const lang = langMap[language.toLowerCase()];
        if (!lang) {
          return { success: false, error: `Nieobsługiwany język: ${language}` };
        }

        // Write the script
        try {
          const dir = path.dirname(scriptPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(scriptPath, code, 'utf8');
        } catch (err: any) {
          return { success: false, error: `Nie udało się zapisać skryptu: ${err.message}` };
        }

        // Execute — use execFile to prevent shell injection via args
        const cmdArgs = lang.cmdArgs ? [...lang.cmdArgs, scriptPath] : [scriptPath];
        // Safely split user args (shell-style quoting not supported — simple whitespace split)
        const userArgs = args ? args.trim().split(/\s+/).filter(Boolean) : [];
        const allArgs = [...cmdArgs, ...userArgs];

        return new Promise((resolve) => {
          execFile(
            lang.cmd,
            allArgs,
            { timeout: 120000, maxBuffer: 5 * 1024 * 1024, cwd: path.dirname(scriptPath) },
            (err, stdout, stderr) => {
              if (err) {
                resolve({
                  success: false,
                  error: err.message,
                  data: { stdout: stdout?.slice(0, 10000), stderr: stderr?.slice(0, 5000), scriptPath },
                });
              } else {
                resolve({
                  success: true,
                  data: {
                    stdout: stdout.trim().slice(0, 15000),
                    stderr: stderr.trim().slice(0, 3000),
                    scriptPath,
                    message: `Skrypt zapisany: ${scriptPath}`,
                  },
                });
              }
            },
          );
        });
      },
    );
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
      sqrt: { arity: 1, fn: Math.sqrt },
      abs: { arity: 1, fn: Math.abs },
      round: { arity: 1, fn: Math.round },
      floor: { arity: 1, fn: Math.floor },
      ceil: { arity: 1, fn: Math.ceil },
      sin: { arity: 1, fn: Math.sin },
      cos: { arity: 1, fn: Math.cos },
      tan: { arity: 1, fn: Math.tan },
      log: { arity: 1, fn: Math.log },
      log10: { arity: 1, fn: Math.log10 },
      pow: { arity: 2, fn: Math.pow },
      min: { arity: 2, fn: Math.min },
      max: { arity: 2, fn: Math.max },
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
      if (peek() === '-') {
        consume('-');
        return -parseUnary();
      }
      if (peek() === '+') {
        consume('+');
        return parseUnary();
      }
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
      if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < src.length && src[i + 1] >= '0' && src[i + 1] <= '9')) {
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
        while (
          i < src.length &&
          ((src[i] >= 'a' && src[i] <= 'z') || (src[i] >= 'A' && src[i] <= 'Z') || (src[i] >= '0' && src[i] <= '9'))
        ) {
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

    this.register(
      {
        name: 'mouse_move',
        description: 'Przesuwa kursor myszy na podaną pozycję (x, y)',
        category: 'automation',
        parameters: {
          x: { type: 'number', description: 'Pozycja X', required: true },
          y: { type: 'number', description: 'Pozycja Y', required: true },
        },
      },
      async (params) => auto.mouseMove(params.x, params.y),
    );

    this.register(
      {
        name: 'mouse_click',
        description: 'Klika myszką w podanej pozycji (opcjonalnie z pozycją x,y)',
        category: 'automation',
        parameters: {
          x: { type: 'number', description: 'Pozycja X (opcjonalne)' },
          y: { type: 'number', description: 'Pozycja Y (opcjonalne)' },
          button: { type: 'string', description: 'Przycisk: left lub right (domyślnie: left)' },
        },
      },
      async (params) => auto.mouseClick(params.x, params.y, params.button || 'left'),
    );

    this.register(
      {
        name: 'keyboard_type',
        description: 'Wpisuje tekst z klawiatury (symulacja)',
        category: 'automation',
        parameters: {
          text: { type: 'string', description: 'Tekst do wpisania', required: true },
        },
      },
      async (params) => auto.keyboardType(params.text),
    );

    this.register(
      {
        name: 'keyboard_shortcut',
        description: 'Wykonuje skrót klawiszowy (np. ctrl+c, ctrl+shift+p)',
        category: 'automation',
        parameters: {
          keys: { type: 'string[]', description: 'Lista klawiszy, np. ["ctrl", "c"]', required: true },
        },
      },
      async (params) => auto.keyboardShortcut(params.keys),
    );

    this.register(
      {
        name: 'keyboard_press',
        description: 'Naciska pojedynczy klawisz (enter, tab, escape, f5, etc.)',
        category: 'automation',
        parameters: {
          key: { type: 'string', description: 'Klawisz do naciśnięcia', required: true },
        },
      },
      async (params) => auto.keyboardPress(params.key),
    );

    this.register(
      {
        name: 'get_active_window',
        description: 'Pobiera tytuł aktywnego okna na pulpicie',
        category: 'automation',
        parameters: {},
      },
      async () => {
        const title = await auto.getActiveWindowTitle();
        return { success: true, data: title };
      },
    );

    this.register(
      {
        name: 'get_mouse_position',
        description: 'Pobiera aktualną pozycję kursora myszy',
        category: 'automation',
        parameters: {},
      },
      async () => {
        const pos = await auto.getMousePosition();
        return { success: true, data: pos };
      },
    );
  }

  // ─── Browser Tools (Native CDP) ───

  private registerBrowserTools(): void {
    if (!this.browserService) return;
    const browser = this.browserService;

    // ── Launch / Close ──

    this.register(
      {
        name: 'browser_launch',
        description: 'Uruchamia przeglądarkę Chrome/Edge (widoczną na ekranie). Opcjonalnie otwiera URL.',
        category: 'browser',
        parameters: {
          url: { type: 'string', description: 'URL do otwarcia (opcjonalny)' },
          headless: { type: 'boolean', description: 'Tryb bez okna (domyślnie: false — widoczna)' },
        },
      },
      async (params) => browser.launch({ url: params.url, headless: params.headless }),
    );

    this.register(
      {
        name: 'browser_close',
        description: 'Zamyka przeglądarkę',
        category: 'browser',
        parameters: {},
      },
      async () => {
        await browser.close();
        return { success: true, data: 'Przeglądarka zamknięta' };
      },
    );

    // ── Navigation ──

    this.register(
      {
        name: 'browser_navigate',
        description: 'Nawiguje aktywny tab do podanego URL',
        category: 'browser',
        parameters: {
          url: { type: 'string', description: 'URL docelowy', required: true },
        },
      },
      async (params) => browser.navigate(params.url),
    );

    this.register(
      {
        name: 'browser_back',
        description: 'Cofnij w historii przeglądarki',
        category: 'browser',
        parameters: {},
      },
      async () => browser.goBack(),
    );

    this.register(
      {
        name: 'browser_forward',
        description: 'Do przodu w historii przeglądarki',
        category: 'browser',
        parameters: {},
      },
      async () => browser.goForward(),
    );

    // ── Snapshot (key feature) ──

    this.register(
      {
        name: 'browser_snapshot',
        description:
          'Pobiera snapshot strony — drzewo tekstowe z elementami interaktywnymi oznaczonymi [e1], [e2]... Używaj PRZED kliknięciem/pisaniem, żeby poznać ref elementów.',
        category: 'browser',
        parameters: {},
      },
      async () => browser.snapshot(),
    );

    // ── Actions (ref-based) ──

    this.register(
      {
        name: 'browser_click',
        description: 'Klika element po ref ze snapshota (np. "e5"). Weź snapshot najpierw!',
        category: 'browser',
        parameters: {
          ref: { type: 'string', description: 'Ref elementu ze snapshota, np. "e5"', required: true },
          doubleClick: { type: 'boolean', description: 'Podwójne kliknięcie (domyślnie: false)' },
        },
      },
      async (params) => browser.click(params.ref, { doubleClick: params.doubleClick }),
    );

    this.register(
      {
        name: 'browser_type',
        description: 'Wpisuje tekst w pole input po ref ze snapshota',
        category: 'browser',
        parameters: {
          ref: { type: 'string', description: 'Ref elementu input/textarea', required: true },
          text: { type: 'string', description: 'Tekst do wpisania', required: true },
          submit: { type: 'boolean', description: 'Naciśnij Enter po wpisaniu (domyślnie: false)' },
        },
      },
      async (params) => browser.type(params.ref, params.text, { submit: params.submit }),
    );

    this.register(
      {
        name: 'browser_hover',
        description: 'Najeżdża na element po ref (hover)',
        category: 'browser',
        parameters: {
          ref: { type: 'string', description: 'Ref elementu', required: true },
        },
      },
      async (params) => browser.hover(params.ref),
    );

    this.register(
      {
        name: 'browser_select',
        description: 'Wybiera opcję z elementu <select> po ref',
        category: 'browser',
        parameters: {
          ref: { type: 'string', description: 'Ref elementu <select>', required: true },
          value: { type: 'string', description: 'Wartość opcji do wybrania', required: true },
        },
      },
      async (params) => browser.selectOption(params.ref, params.value),
    );

    this.register(
      {
        name: 'browser_press',
        description: 'Naciska klawisz na klawiaturze (np. "Enter", "Tab", "Escape", "Control+a")',
        category: 'browser',
        parameters: {
          key: { type: 'string', description: 'Klawisz do naciśnięcia', required: true },
        },
      },
      async (params) => browser.press(params.key),
    );

    this.register(
      {
        name: 'browser_scroll',
        description: 'Przewija stronę (up/down/top/bottom)',
        category: 'browser',
        parameters: {
          direction: { type: 'string', description: 'Kierunek: "up", "down", "top", "bottom"', required: true },
          amount: { type: 'number', description: 'Piksele przewijania (domyślnie 500)' },
        },
      },
      async (params) => browser.scroll(params.direction, params.amount),
    );

    this.register(
      {
        name: 'browser_scroll_to_element',
        description: 'Scrolluje stronę do konkretnego elementu po ref — przydatne do elementów poza widokiem',
        category: 'browser',
        parameters: {
          ref: { type: 'string', description: 'Ref elementu ze snapshota (np. "e5")', required: true },
        },
      },
      async (params) => browser.scrollToRef(params.ref),
    );

    this.register(
      {
        name: 'browser_dismiss_popups',
        description: 'Próbuje zamknąć popupy cookie/consent na stronie — automatycznie szuka typowych przycisków',
        category: 'browser',
        parameters: {},
      },
      async () => browser.dismissPopups(),
    );

    this.register(
      {
        name: 'browser_fill_form',
        description: 'Wypełnia wiele pól formularza naraz',
        category: 'browser',
        parameters: {
          fields: {
            type: 'array',
            description: 'Tablica obiektów: [{"ref": "e3", "value": "tekst"}, {"ref": "e5", "value": "inny tekst"}]',
            required: true,
          },
        },
      },
      async (params) => browser.fillForm(params.fields),
    );

    // ── Screenshot ──

    this.register(
      {
        name: 'browser_screenshot',
        description: 'Robi screenshot strony (zwraca base64 JPEG)',
        category: 'browser',
        parameters: {
          fullPage: { type: 'boolean', description: 'Cała strona vs widoczna część (domyślnie: false)' },
          ref: { type: 'string', description: 'Screenshot konkretnego elementu po ref' },
        },
      },
      async (params) => browser.screenshot({ fullPage: params.fullPage, ref: params.ref }),
    );

    // ── Tabs ──

    this.register(
      {
        name: 'browser_tabs',
        description: 'Lista otwartych tabów',
        category: 'browser',
        parameters: {},
      },
      async () => browser.tabs(),
    );

    this.register(
      {
        name: 'browser_tab_new',
        description: 'Otwiera nowy tab (opcjonalnie z URL)',
        category: 'browser',
        parameters: {
          url: { type: 'string', description: 'URL do otwarcia w nowym tabie' },
        },
      },
      async (params) => browser.newTab(params.url),
    );

    this.register(
      {
        name: 'browser_tab_switch',
        description: 'Przełącza aktywny tab po indeksie',
        category: 'browser',
        parameters: {
          index: { type: 'number', description: 'Indeks taba (od 0)', required: true },
        },
      },
      async (params) => browser.switchTab(params.index),
    );

    this.register(
      {
        name: 'browser_tab_close',
        description: 'Zamyka tab po indeksie (lub aktywny)',
        category: 'browser',
        parameters: {
          index: { type: 'number', description: 'Indeks taba do zamknięcia (domyślnie aktywny)' },
        },
      },
      async (params) => browser.closeTab(params.index),
    );

    // ── Other ──

    this.register(
      {
        name: 'browser_evaluate',
        description: 'Wykonuje kod JavaScript na stronie i zwraca wynik',
        category: 'browser',
        parameters: {
          script: { type: 'string', description: 'Kod JS do wykonania', required: true },
        },
      },
      async (params) => browser.evaluate(params.script),
    );

    this.register(
      {
        name: 'browser_wait',
        description: 'Czeka na warunek: selector / url / load / timeout',
        category: 'browser',
        parameters: {
          type: { type: 'string', description: '"selector" | "url" | "load" | "timeout"', required: true },
          value: { type: 'string', description: 'Selector CSS, wzorzec URL, lub czas w ms' },
          timeout: { type: 'number', description: 'Max czas oczekiwania w ms (domyślnie 10000)' },
        },
      },
      async (params) => browser.wait({ type: params.type, value: params.value, timeout: params.timeout }),
    );

    this.register(
      {
        name: 'browser_extract_text',
        description:
          'Pobiera pełny tekst ze strony (cały DOM, nie tylko widoczna część). Opcjonalnie z konkretnego selektora CSS. Limit: 15000 znaków.',
        category: 'browser',
        parameters: {
          selector: { type: 'string', description: 'CSS selector (opcjonalny, domyślnie cała strona)' },
        },
      },
      async (params) => browser.extractText(params.selector),
    );

    // Alias: browser_get_content → browser_extract_text
    this.register(
      {
        name: 'browser_get_content',
        description: '[Alias browser_extract_text] Pobiera tekst ze strony',
        category: 'browser',
        parameters: {
          selector: { type: 'string', description: 'CSS selector (opcjonalny)' },
        },
      },
      async (params) => browser.extractText(params.selector),
    );

    this.register(
      {
        name: 'browser_page_info',
        description: 'Pobiera info o aktywnej stronie (URL, tytuł, numer taba)',
        category: 'browser',
        parameters: {},
      },
      async () => browser.getPageInfo(),
    );

    this.register(
      {
        name: 'browser_reset_profile',
        description:
          'Resetuje profil przeglądarki KxAI — usuwa wszystkie zapisane dane. Przy następnym uruchomieniu cookies zostaną ponownie skopiowane z profilu użytkownika. Wymaga zamkniętej przeglądarki.',
        category: 'browser',
        parameters: {},
      },
      async () => browser.resetProfile(),
    );

    this.register(
      {
        name: 'browser_refresh_cookies',
        description:
          'Odświeża cookies/sesje w profilu KxAI z profilu Chrome użytkownika (bez kasowania reszty danych). Wymaga zamkniętej przeglądarki.',
        category: 'browser',
        parameters: {},
      },
      async () => browser.refreshCookies(),
    );

    // ── Monitoring tools (Faza 1.5) ──

    this.register(
      {
        name: 'browser_monitor_start',
        description:
          'Włącza monitoring strony w tle: logi konsoli (console.log/warn/error), zapytania sieciowe (HTTP requests/responses), nawigacje, zmiany DOM, dialogi JS. Wyniki pobieraj za pomocą browser_console_logs i browser_network_logs.',
        category: 'browser',
        parameters: {},
      },
      async () => browser.startMonitoring(),
    );

    this.register(
      {
        name: 'browser_monitor_stop',
        description: 'Wyłącza monitoring strony i czyści bufor logów.',
        category: 'browser',
        parameters: {},
      },
      async () => browser.stopMonitoring(),
    );

    this.register(
      {
        name: 'browser_console_logs',
        description:
          'Pobiera logi konsoli przeglądarki (console.log, console.error itd.). Wymaga wcześniejszego browser_monitor_start.',
        category: 'browser',
        parameters: {
          limit: { type: 'number', description: 'Maks. liczba wpisów (domyślnie 50)' },
        },
      },
      async (params) => browser.getConsoleLogs(params.limit || 50),
    );

    this.register(
      {
        name: 'browser_network_logs',
        description:
          'Pobiera log zapytań sieciowych (URL, metoda, status). Wymaga wcześniejszego browser_monitor_start.',
        category: 'browser',
        parameters: {
          limit: { type: 'number', description: 'Maks. liczba wpisów (domyślnie 50)' },
        },
      },
      async (params) => browser.getNetworkLogs(params.limit || 50),
    );
  }

  // ─── RAG Tools ───

  private registerRAGTools(): void {
    if (!this.ragService) return;
    const rag = this.ragService;

    this.register(
      {
        name: 'search_memory',
        description: 'Semantic search po pamięci agenta (pliki .md). Zwraca najbardziej relevantne fragmenty.',
        category: 'memory',
        parameters: {
          query: { type: 'string', description: 'Zapytanie wyszukiwania', required: true },
          topK: { type: 'number', description: 'Liczba wyników (domyślnie: 5)' },
        },
      },
      async (params) => {
        const results = await rag.search(params.query, params.topK || 5);
        if (results.length === 0) return { success: true, data: 'Brak wyników w pamięci' };
        const formatted = results
          .map(
            (r) =>
              `[${r.chunk.fileName} > ${r.chunk.section}] (score: ${r.score.toFixed(2)})\n${r.chunk.content.slice(0, 500)}`,
          )
          .join('\n\n---\n\n');
        return { success: true, data: formatted };
      },
    );

    this.register(
      {
        name: 'reindex_memory',
        description: 'Przeindeksuj pamięć agenta (po dodaniu nowych plików .md)',
        category: 'memory',
        parameters: {},
      },
      async () => {
        await rag.reindex();
        const stats = rag.getStats();
        return {
          success: true,
          data: `Reindeksacja zakończona: ${stats.totalChunks} chunków z ${stats.totalFiles} plików`,
        };
      },
    );
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

  // ─── Reminder Tools ───

  private registerReminderTools(): void {
    if (!this.cronService) return;

    // ── set_reminder ──
    this.register(
      {
        name: 'set_reminder',
        description:
          'Ustawia przypomnienie na podany czas. Obsługuje naturalny język polski/angielski: "jutro o 9:00", "za 2 godziny", "w piątek o 15:30", "2025-03-15 10:00". Jednorazowe (one-shot) lub powtarzalne.',
        category: 'cron',
        parameters: {
          message: { type: 'string', description: 'Treść przypomnienia — co agent ma powiedzieć/zrobić' },
          time: {
            type: 'string',
            description:
              'Kiedy: "za 30 minut", "jutro o 9:00", "w piątek o 15:30", "2025-03-15 10:00", "codziennie o 8:00"',
          },
          recurring: { type: 'boolean', description: 'Czy powtarzalne (domyślnie: false = jednorazowe)' },
        },
      },
      async (params: { message: string; time: string; recurring?: boolean }) => {
        const cron = this.cronService!;
        const { message, time, recurring } = params;
        if (!message || !time) {
          return { success: false, error: 'Wymagane parametry: message i time' };
        }

        const parsed = this.parseReminderTime(time);
        if (!parsed) {
          return {
            success: false,
            error: `Nie udało się zrozumieć czasu: "${time}". Spróbuj np. "za 30 minut", "jutro o 9:00", "2025-03-15 10:00"`,
          };
        }

        const isOneShot = !recurring;

        const job = cron.addJob({
          name: `🔔 ${message.slice(0, 80)}`,
          schedule: parsed.schedule,
          action: `PRZYPOMNIENIE: ${message}. Powiadom użytkownika o tym przypomnieniu — użyj send_notification i wyświetl wiadomość w czacie.`,
          autoCreated: true,
          enabled: true,
          category: 'reminder',
          oneShot: isOneShot,
          runAt: isOneShot ? parsed.timestamp : undefined,
        });

        const timeStr = parsed.timestamp
          ? new Date(parsed.timestamp).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })
          : parsed.schedule;

        return {
          success: true,
          data: `✅ Przypomnienie ustawione!\n📝 ${message}\n⏰ ${timeStr}\n${isOneShot ? '🔂 Jednorazowe' : '🔄 Powtarzalne: ' + parsed.schedule}\n🆔 ${job.id}`,
        };
      },
    );

    // ── list_reminders ──
    this.register(
      {
        name: 'list_reminders',
        description: 'Wyświetla listę aktywnych przypomnień użytkownika',
        category: 'cron',
        parameters: {
          include_past: {
            type: 'boolean',
            description: 'Czy pokazać też przeszłe/wyłączone przypomnienia (domyślnie: false)',
          },
        },
      },
      async (params: { include_past?: boolean }) => {
        const cron = this.cronService!;
        const jobs = cron.getJobs();
        let reminders = jobs.filter((j) => j.category === 'reminder');
        if (!params.include_past) {
          reminders = reminders.filter((j) => j.enabled);
        }

        if (reminders.length === 0) {
          return { success: true, data: '📭 Brak aktywnych przypomnień.' };
        }

        const lines = reminders.map((r, i) => {
          const status = r.enabled ? '🟢' : '⚪';
          const type = r.oneShot ? '🔂' : '🔄';
          const timeStr = r.runAt
            ? new Date(r.runAt).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })
            : r.schedule;
          return `${i + 1}. ${status} ${type} ${r.name}\n   ⏰ ${timeStr} | Wykonań: ${r.runCount} | ID: ${r.id}`;
        });

        return { success: true, data: `🔔 Przypomnienia (${reminders.length}):\n\n${lines.join('\n\n')}` };
      },
    );

    // ── cancel_reminder ──
    this.register(
      {
        name: 'cancel_reminder',
        description: 'Anuluje/usuwa przypomnienie po ID lub nazwie (fragment)',
        category: 'cron',
        parameters: {
          id: { type: 'string', description: 'ID przypomnienia (UUID) — dokładne dopasowanie' },
          name: { type: 'string', description: 'Fragment nazwy przypomnienia — szuka w nazwie i treści' },
        },
      },
      async (params: { id?: string; name?: string }) => {
        const cron = this.cronService!;
        if (!params.id && !params.name) {
          return { success: false, error: 'Podaj id lub name przypomnienia do anulowania' };
        }

        const jobs = cron.getJobs();
        let target = params.id
          ? jobs.find((j) => j.id === params.id && j.category === 'reminder')
          : jobs.find(
              (j) =>
                j.category === 'reminder' &&
                (j.name.toLowerCase().includes((params.name || '').toLowerCase()) ||
                  j.action.toLowerCase().includes((params.name || '').toLowerCase())),
            );

        if (!target) {
          return {
            success: false,
            error: `Nie znaleziono przypomnienia${params.id ? ` o ID: ${params.id}` : ` zawierającego: "${params.name}"`}`,
          };
        }

        cron.removeJob(target.id);
        return { success: true, data: `🗑️ Anulowano przypomnienie: ${target.name}` };
      },
    );
  }

  /**
   * Parse natural language time expression to schedule + optional timestamp.
   * Supports Polish and English date/time expressions.
   */
  private parseReminderTime(input: string): { schedule: string; timestamp?: number } | null {
    const now = new Date();
    const text = input.trim().toLowerCase();

    // ── Relative time: "za X minut/godzin/sekund" or "in X minutes/hours" ──
    const relMatch = text.match(
      /^(?:za|in|om)\s+(\d+)\s*(min|minut|minute|minutes|m|godz|godzin|godziny|hour|hours|h|sek|sekund|sekundy|second|seconds|s|dni|dni|day|days|d)(?:y|ę)?$/i,
    );
    if (relMatch) {
      const val = parseInt(relMatch[1]);
      const unit = relMatch[2].toLowerCase();
      let ms: number;
      if (unit.startsWith('min') || unit === 'm') ms = val * 60_000;
      else if (unit.startsWith('godz') || unit.startsWith('hour') || unit === 'h') ms = val * 3_600_000;
      else if (unit.startsWith('sek') || unit.startsWith('sec') || unit === 's') ms = val * 1000;
      else if (unit.startsWith('dn') || unit.startsWith('day') || unit === 'd') ms = val * 86_400_000;
      else ms = val * 60_000;
      const target = now.getTime() + ms;
      return { schedule: `${val}${unit[0]}`, timestamp: target };
    }

    // ── "jutro o HH:MM" / "tomorrow at HH:MM" ──
    const tomorrowMatch = text.match(/^(?:jutro|tomorrow)\s*(?:o|at|@)?\s*(\d{1,2})[:.](\d{2})$/);
    if (tomorrowMatch) {
      const target = new Date(now);
      target.setDate(target.getDate() + 1);
      target.setHours(parseInt(tomorrowMatch[1]), parseInt(tomorrowMatch[2]), 0, 0);
      const min = target.getMinutes();
      const hour = target.getHours();
      return { schedule: `${min} ${hour} * * *`, timestamp: target.getTime() };
    }

    // ── "dziś/dzisiaj/today o HH:MM" ──
    const todayMatch = text.match(/^(?:dzi[sś](?:iaj)?|today)\s*(?:o|at|@)?\s*(\d{1,2})[:.](\d{2})$/);
    if (todayMatch) {
      const target = new Date(now);
      target.setHours(parseInt(todayMatch[1]), parseInt(todayMatch[2]), 0, 0);
      if (target.getTime() <= now.getTime()) {
        // Already past today — set for tomorrow
        target.setDate(target.getDate() + 1);
      }
      const min = target.getMinutes();
      const hour = target.getHours();
      return { schedule: `${min} ${hour} * * *`, timestamp: target.getTime() };
    }

    // ── Day of week: "w poniedziałek o HH:MM" / "on monday at HH:MM" ──
    const dayNames: Record<string, number> = {
      poniedziałek: 1,
      poniedzialek: 1,
      pon: 1,
      monday: 1,
      mon: 1,
      wtorek: 2,
      wt: 2,
      tuesday: 2,
      tue: 2,
      środa: 3,
      sroda: 3,
      śr: 3,
      sr: 3,
      wednesday: 3,
      wed: 3,
      czwartek: 4,
      czw: 4,
      thursday: 4,
      thu: 4,
      piątek: 5,
      piatek: 5,
      pt: 5,
      friday: 5,
      fri: 5,
      sobota: 6,
      sob: 6,
      saturday: 6,
      sat: 6,
      niedziela: 0,
      niedz: 0,
      nd: 0,
      sunday: 0,
      sun: 0,
    };
    const dayMatch = text.match(/^(?:w\s+|we\s+|on\s+|next\s+)?(\w+)\s*(?:o|at|@)?\s*(\d{1,2})[:.](\d{2})$/);
    if (dayMatch) {
      const dayName = dayMatch[1];
      const targetDay = dayNames[dayName];
      if (targetDay !== undefined) {
        const hour = parseInt(dayMatch[2]);
        const minute = parseInt(dayMatch[3]);
        const target = new Date(now);
        const currentDay = target.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil < 0) daysUntil += 7;
        if (daysUntil === 0 && (hour < now.getHours() || (hour === now.getHours() && minute <= now.getMinutes()))) {
          daysUntil = 7;
        }
        target.setDate(target.getDate() + daysUntil);
        target.setHours(hour, minute, 0, 0);
        return { schedule: `${minute} ${hour} * * ${targetDay}`, timestamp: target.getTime() };
      }
    }

    // ── Absolute date: "YYYY-MM-DD HH:MM" or "DD.MM.YYYY HH:MM" ──
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2})[:.](\d{2})$/);
    if (isoMatch) {
      const target = new Date(
        parseInt(isoMatch[1]),
        parseInt(isoMatch[2]) - 1,
        parseInt(isoMatch[3]),
        parseInt(isoMatch[4]),
        parseInt(isoMatch[5]),
        0,
      );
      if (target.getTime() <= now.getTime()) {
        return null; // Past date
      }
      const min = target.getMinutes();
      const hour = target.getHours();
      return { schedule: `${min} ${hour} ${target.getDate()} ${target.getMonth() + 1} *`, timestamp: target.getTime() };
    }

    const plDateMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2})[:.](\d{2})$/);
    if (plDateMatch) {
      const target = new Date(
        parseInt(plDateMatch[3]),
        parseInt(plDateMatch[2]) - 1,
        parseInt(plDateMatch[1]),
        parseInt(plDateMatch[4]),
        parseInt(plDateMatch[5]),
        0,
      );
      if (target.getTime() <= now.getTime()) {
        return null;
      }
      const min = target.getMinutes();
      const hour = target.getHours();
      return { schedule: `${min} ${hour} ${target.getDate()} ${target.getMonth() + 1} *`, timestamp: target.getTime() };
    }

    // ── Recurring: "codziennie o HH:MM" / "every day at HH:MM" ──
    const dailyMatch = text.match(/^(?:codziennie|every\s*day|daily)\s*(?:o|at|@)?\s*(\d{1,2})[:.](\d{2})$/);
    if (dailyMatch) {
      const hour = parseInt(dailyMatch[1]);
      const minute = parseInt(dailyMatch[2]);
      return { schedule: `${minute} ${hour} * * *` };
    }

    // ── Recurring: "co X minut/godzin" / "every X minutes/hours" ──
    const everyMatch = text.match(
      /^(?:co|every)\s+(\d+)\s*(min|minut|minute|minutes|m|godz|godzin|godziny|hour|hours|h)(?:y|ę)?$/i,
    );
    if (everyMatch) {
      const val = parseInt(everyMatch[1]);
      const unit = everyMatch[2].toLowerCase();
      if (unit.startsWith('min') || unit === 'm') return { schedule: `${val}m` };
      if (unit.startsWith('godz') || unit.startsWith('hour') || unit === 'h') return { schedule: `${val}h` };
    }

    // ── Just time: "o HH:MM" / "at HH:MM" / "HH:MM" ──
    const timeOnly = text.match(/^(?:o|at|@)?\s*(\d{1,2})[:.](\d{2})$/);
    if (timeOnly) {
      const hour = parseInt(timeOnly[1]);
      const minute = parseInt(timeOnly[2]);
      const target = new Date(now);
      target.setHours(hour, minute, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }
      return { schedule: `${minute} ${hour} * * *`, timestamp: target.getTime() };
    }

    return null;
  }

  // ─── Registry ───

  register(definition: ToolDefinition, handler: (params: any) => Promise<ToolResult>): void {
    this.definitions.push(definition);
    this.toolRegistry.set(definition.name, handler);
  }

  /**
   * Unregister a tool by name — removes from definitions and registry.
   * Used by MCP Client Service when disconnecting servers.
   */
  unregister(name: string): boolean {
    const idx = this.definitions.findIndex((d) => d.name === name);
    if (idx !== -1) this.definitions.splice(idx, 1);
    return this.toolRegistry.delete(name) || idx !== -1;
  }

  /**
   * Unregister all tools matching a name prefix.
   * @returns number of tools removed
   */
  unregisterByPrefix(prefix: string): number {
    const toRemove = this.definitions.filter((d) => d.name.startsWith(prefix));
    for (const def of toRemove) {
      this.toolRegistry.delete(def.name);
    }
    this.definitions = this.definitions.filter((d) => !d.name.startsWith(prefix));
    return toRemove.length;
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
    const startTime = Date.now();
    const result = await handler(params);
    // Notify workflow recorder (if active)
    if (this.onToolExecuted) {
      try {
        this.onToolExecuted(name, params, result, Date.now() - startTime);
      } catch {
        /* recording should never break tool execution */
      }
    }
    return result;
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.definitions];
  }

  /**
   * Returns tool descriptions formatted for AI system prompt injection.
   */
  /**
   * Register sub-agent and background execution tools.
   * These are wired from AgentLoop which has access to SubAgentManager.
   */
  registerAgentTools(handlers: {
    spawnSubagent: (params: any) => Promise<ToolResult>;
    killSubagent: (params: any) => Promise<ToolResult>;
    steerSubagent: (params: any) => Promise<ToolResult>;
    listSubagents: (params: any) => Promise<ToolResult>;
    backgroundExec: (params: any) => Promise<ToolResult>;
    screenshotAnalyze: (params: any) => Promise<ToolResult>;
  }): void {
    this.definitions.push({
      name: 'spawn_subagent',
      description: 'Stwórz sub-agenta do wykonania zadania w tle. Sub-agent ma izolowaną sesję i własny tool loop.',
      category: 'agent',
      parameters: {
        task: { type: 'string', description: 'Opis zadania dla sub-agenta', required: true },
        allowed_tools: {
          type: 'string[]',
          description: 'Lista dozwolonych narzędzi (puste = wszystkie)',
          required: false,
        },
      },
    });
    this.toolRegistry.set('spawn_subagent', handlers.spawnSubagent);

    this.definitions.push({
      name: 'kill_subagent',
      description: 'Zatrzymaj działającego sub-agenta.',
      category: 'agent',
      parameters: {
        agent_id: { type: 'string', description: 'ID sub-agenta do zatrzymania', required: true },
      },
    });
    this.toolRegistry.set('kill_subagent', handlers.killSubagent);

    this.definitions.push({
      name: 'steer_subagent',
      description: 'Wstrzyknij nową instrukcję do działającego sub-agenta.',
      category: 'agent',
      parameters: {
        agent_id: { type: 'string', description: 'ID sub-agenta', required: true },
        instruction: { type: 'string', description: 'Nowa instrukcja', required: true },
      },
    });
    this.toolRegistry.set('steer_subagent', handlers.steerSubagent);

    this.definitions.push({
      name: 'list_subagents',
      description: 'Wyświetl listę aktywnych sub-agentów.',
      category: 'agent',
      parameters: {},
    });
    this.toolRegistry.set('list_subagents', handlers.listSubagents);

    this.definitions.push({
      name: 'background_exec',
      description: 'Wykonaj zadanie w tle bez blokowania czatu. Wynik zostanie dostarczony jako powiadomienie.',
      category: 'agent',
      parameters: {
        task: { type: 'string', description: 'Zadanie do wykonania w tle', required: true },
      },
    });
    this.toolRegistry.set('background_exec', handlers.backgroundExec);

    this.definitions.push({
      name: 'screenshot_analyze',
      description: 'Zrób screenshot ekranu i przeanalizuj go. Używaj gdy potrzebujesz zobaczyć co jest na ekranie.',
      category: 'observation',
      parameters: {
        question: { type: 'string', description: 'Pytanie o ekran (opcjonalne)', required: false },
      },
    });
    this.toolRegistry.set('screenshot_analyze', handlers.screenshotAnalyze);
  }

  // ─── File Intelligence Tools (Phase 6.6) ───

  private registerFileIntelligenceTools(): void {
    if (!this.fileIntelligenceService) return;
    const fi = this.fileIntelligenceService;

    this.register(
      {
        name: 'analyze_file',
        description:
          'Analizuje plik dowolnego typu — PDF, DOCX, XLSX, EPUB, tekst, kod. Wyciąga tekst, metadane, strukturę. Dla obrazów/audio zwraca metadane (analiza wymaga vision/transkrypcji).',
        category: 'files',
        parameters: {
          path: { type: 'string', description: 'Ścieżka do pliku do analizy', required: true },
        },
      },
      async (params) => {
        const readValidation = this.securityGuard.validateReadPath(params.path);
        if (!readValidation.allowed) {
          return { success: false, error: `🛡️ ${readValidation.reason}` };
        }
        try {
          const result = await fi.extractText(params.path);
          const summary = [
            `📄 ${result.metadata.name} (${result.metadata.format.toUpperCase()}, ${result.metadata.sizeFormatted})`,
            result.pageCount ? `Strony: ${result.pageCount}` : null,
            result.sheets ? `Arkusze: ${result.sheets.map((s) => `${s.name} (${s.rows}×${s.cols})`).join(', ')}` : null,
            `Słowa: ${result.wordCount} | Znaki: ${result.charCount}${result.truncated ? ' (ucięto)' : ''}`,
            '',
            result.text,
          ]
            .filter(Boolean)
            .join('\n');
          return { success: true, data: summary };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    this.register(
      {
        name: 'file_info',
        description:
          'Pobiera metadane pliku — rozmiar, typ, daty modyfikacji/utworzenia, MIME type. Lekkie — nie czyta zawartości.',
        category: 'files',
        parameters: {
          path: { type: 'string', description: 'Ścieżka do pliku lub katalogu', required: true },
        },
      },
      async (params) => {
        const readValidation = this.securityGuard.validateReadPath(params.path);
        if (!readValidation.allowed) {
          return { success: false, error: `🛡️ ${readValidation.reason}` };
        }
        try {
          const info = await fi.getFileInfo(params.path);
          return { success: true, data: info };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    this.register(
      {
        name: 'search_files',
        description:
          'Przeszukuje pliki w katalogu po nazwie (glob) i/lub treści (regex/tekst). Rekurencyjnie. Przykłady: "*.pdf", "raport*", treść "faktura".',
        category: 'files',
        parameters: {
          directory: { type: 'string', description: 'Katalog startowy do przeszukania', required: true },
          name_pattern: {
            type: 'string',
            description: 'Wzorzec nazwy (glob): *.pdf, report*, *.docx',
            required: false,
          },
          content_pattern: {
            type: 'string',
            description: 'Tekst lub regex do szukania w treści plików',
            required: false,
          },
          extensions: {
            type: 'string',
            description: 'Rozszerzenia oddzielone przecinkiem: .pdf,.docx,.xlsx',
            required: false,
          },
          max_results: {
            type: 'number',
            description: 'Max wyników (domyślnie 50)',
            required: false,
          },
        },
      },
      async (params) => {
        const readValidation = this.securityGuard.validateReadPath(params.directory);
        if (!readValidation.allowed) {
          return { success: false, error: `🛡️ ${readValidation.reason}` };
        }
        try {
          const extensions = params.extensions ? params.extensions.split(',').map((e: string) => e.trim()) : undefined;
          const result = await fi.searchFiles(params.directory, {
            namePattern: params.name_pattern,
            contentPattern: params.content_pattern,
            extensions,
            maxResults: params.max_results,
          });
          const summary = [
            `🔍 Znaleziono ${result.totalMatches} wyników (przeszukano ${result.searchedFiles} plików w ${result.searchedDirs} katalogach)${result.truncated ? ' [ucięto]' : ''}`,
            '',
            ...result.matches.map((m) => {
              const parts = [m.path];
              if (m.line) parts.push(`linia ${m.line}: ${m.content}`);
              else parts.push(`(${formatSize(m.size)}, ${m.modified.split('T')[0]})`);
              return parts.join(' — ');
            }),
          ].join('\n');
          return { success: true, data: summary };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    this.register(
      {
        name: 'analyze_folder',
        description:
          'Analizuje folder — dystrybucja typów plików, największe pliki, ostatnio zmodyfikowane, struktura drzewiasta. Użyj do zrozumienia zawartości katalogu.',
        category: 'files',
        parameters: {
          path: { type: 'string', description: 'Ścieżka do katalogu', required: true },
          max_depth: {
            type: 'number',
            description: 'Maksymalna głębokość skanowania (domyślnie 5)',
            required: false,
          },
        },
      },
      async (params) => {
        const readValidation = this.securityGuard.validateReadPath(params.path);
        if (!readValidation.allowed) {
          return { success: false, error: `🛡️ ${readValidation.reason}` };
        }
        try {
          const analysis = await fi.analyzeFolder(params.path, params.max_depth);
          const typesList = Object.entries(analysis.filesByType)
            .sort(([, a], [, b]) => b - a)
            .map(([ext, count]) => `  ${ext}: ${count}`)
            .join('\n');
          const summary = [
            `📁 ${analysis.path}`,
            `Pliki: ${analysis.totalFiles} | Katalogi: ${analysis.totalDirectories} | Rozmiar: ${analysis.totalSizeFormatted}`,
            '',
            '--- Typy plików ---',
            typesList,
            '',
            '--- Największe pliki ---',
            ...analysis.largestFiles.map((f) => `  ${f.sizeFormatted} — ${f.path}`),
            '',
            '--- Ostatnio zmodyfikowane ---',
            ...analysis.recentlyModified.map((f) => `  ${f.modified.split('T')[0]} — ${f.path}`),
            '',
            '--- Struktura ---',
            analysis.structure,
          ].join('\n');
          return { success: true, data: summary };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );
  }

  // ─── Calendar Tools (Faza 8.2) ───

  private registerCalendarTools(): void {
    if (!this.calendarService) return;
    const cal = this.calendarService;

    // --- calendar_list_events ---
    this.register(
      {
        name: 'calendar_list_events',
        description:
          'Pobiera eventy z kalendarza użytkownika w podanym zakresie dat. ' +
          'Zwraca listę wydarzeń z tytułem, datą, lokalizacją, uczestnikami. ' +
          'Domyślnie pobiera eventy z kolejnych 7 dni ze wszystkich podłączonych kalendarzy.',
        category: 'calendar',
        parameters: {
          start: {
            type: 'string',
            description: 'Początek zakresu dat (ISO 8601, np. "2026-03-01T00:00:00Z"). Domyślnie: teraz.',
            required: false,
          },
          end: {
            type: 'string',
            description: 'Koniec zakresu dat (ISO 8601, np. "2026-03-07T23:59:59Z"). Domyślnie: 7 dni od teraz.',
            required: false,
          },
          connection_id: {
            type: 'string',
            description: 'ID połączenia kalendarza (jeśli pominięte, pobiera z wszystkich).',
            required: false,
          },
        },
      },
      async (params) => {
        try {
          if (!cal.isConnected()) {
            return {
              success: false,
              error:
                'Brak podłączonych kalendarzy. Użytkownik musi skonfigurować połączenie CalDAV w Ustawieniach → Kalendarz.',
            };
          }

          const now = new Date();
          const start = (params.start as string) || now.toISOString();
          const end = (params.end as string) || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

          const events = await cal.fetchEvents({
            start,
            end,
            connectionId: params.connection_id as string | undefined,
          });

          if (events.length === 0) {
            return {
              success: true,
              result: `Brak wydarzeń w zakresie ${start} — ${end}.`,
            };
          }

          const formatted = events.map((e) => {
            const startDate = new Date(e.start);
            const endDate = new Date(e.end);
            const timeStr = e.allDay
              ? 'cały dzień'
              : `${startDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} — ${endDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`;
            const dateStr = startDate.toLocaleDateString('pl-PL', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            });

            let line = `• ${dateStr}, ${timeStr}: **${e.summary}**`;
            if (e.location) line += ` 📍 ${e.location}`;
            if (e.attendees?.length) line += ` 👥 ${e.attendees.join(', ')}`;
            if (e.calendarName) line += ` [${e.calendarName}]`;
            return line;
          });

          return {
            success: true,
            result: `Znaleziono ${events.length} wydarzeń:\n\n${formatted.join('\n')}`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // --- calendar_create_event ---
    this.register(
      {
        name: 'calendar_create_event',
        description:
          'Tworzy nowe wydarzenie w kalendarzu użytkownika. ' +
          'Podaj tytuł, datę rozpoczęcia i zakończenia. Opcjonalnie opis, lokalizację, uczestników.',
        category: 'calendar',
        parameters: {
          summary: {
            type: 'string',
            description: 'Tytuł wydarzenia.',
            required: true,
          },
          start: {
            type: 'string',
            description: 'Data i godzina rozpoczęcia (ISO 8601, np. "2026-03-01T10:00:00Z").',
            required: true,
          },
          end: {
            type: 'string',
            description: 'Data i godzina zakończenia (ISO 8601, np. "2026-03-01T11:00:00Z").',
            required: true,
          },
          description: {
            type: 'string',
            description: 'Opis wydarzenia.',
            required: false,
          },
          location: {
            type: 'string',
            description: 'Lokalizacja wydarzenia.',
            required: false,
          },
          all_day: {
            type: 'boolean',
            description: 'Czy to wydarzenie całodniowe (true/false).',
            required: false,
          },
          attendees: {
            type: 'string',
            description: 'Lista uczestników — adresy email oddzielone przecinkami.',
            required: false,
          },
          connection_id: {
            type: 'string',
            description: 'ID połączenia kalendarza. Jeśli pominięte, użyje pierwszego podłączonego.',
            required: false,
          },
        },
      },
      async (params) => {
        try {
          if (!cal.isConnected()) {
            return {
              success: false,
              error: 'Brak podłączonych kalendarzy.',
            };
          }

          // Find connection
          const connections = cal.getConnections();
          const connId = (params.connection_id as string) || connections.find((c) => c.enabled)?.id;
          if (!connId) {
            return {
              success: false,
              error: 'Brak aktywnego połączenia kalendarza.',
            };
          }

          const attendeeList = params.attendees
            ? (params.attendees as string).split(',').map((a: string) => a.trim())
            : undefined;

          const result = await cal.createEvent({
            connectionId: connId,
            summary: params.summary as string,
            start: params.start as string,
            end: params.end as string,
            allDay: params.all_day === true || params.all_day === 'true',
            description: params.description as string | undefined,
            location: params.location as string | undefined,
            attendees: attendeeList,
          });

          return {
            success: result.success,
            result: result.message,
            error: result.success ? undefined : result.message,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // --- calendar_delete_event ---
    this.register(
      {
        name: 'calendar_delete_event',
        description: 'Usuwa wydarzenie z kalendarza. Wymaga event_url (dostępne z calendar_list_events).',
        category: 'calendar',
        parameters: {
          event_url: {
            type: 'string',
            description: 'URL eventu do usunięcia (z calendar_list_events).',
            required: true,
          },
          connection_id: {
            type: 'string',
            description: 'ID połączenia kalendarza.',
            required: true,
          },
          etag: {
            type: 'string',
            description: 'ETag eventu (opcjonalny, dla bezpiecznego usuwania).',
            required: false,
          },
        },
      },
      async (params) => {
        try {
          const result = await cal.deleteEvent(
            params.connection_id as string,
            params.event_url as string,
            params.etag as string | undefined,
          );
          return {
            success: result.success,
            result: result.message,
            error: result.success ? undefined : result.message,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // --- calendar_upcoming ---
    this.register(
      {
        name: 'calendar_upcoming',
        description:
          'Pobiera nadchodzące wydarzenia (domyślnie w ciągu najbliższych 60 minut). ' +
          'Szybkie narzędzie do sprawdzenia co zaraz się wydarzy.',
        category: 'calendar',
        parameters: {
          minutes: {
            type: 'number',
            description: 'Ile minut do przodu sprawdzić (domyślnie 60).',
            required: false,
          },
        },
      },
      async (params) => {
        try {
          const minutes = (params.minutes as number) || 60;
          const events = cal.getUpcomingEvents(minutes);

          if (events.length === 0) {
            return {
              success: true,
              result: `Brak wydarzeń w ciągu najbliższych ${minutes} minut.`,
            };
          }

          const formatted = events.map((e) => {
            const startDate = new Date(e.start);
            const minutesUntil = Math.round((startDate.getTime() - Date.now()) / 60000);
            let line = `• Za ${minutesUntil} min: **${e.summary}**`;
            if (e.location) line += ` 📍 ${e.location}`;
            if (e.attendees?.length) line += ` 👥 ${e.attendees.join(', ')}`;
            return line;
          });

          return {
            success: true,
            result: `Nadchodzące wydarzenia:\n\n${formatted.join('\n')}`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );
  }

  // ─── Privacy & GDPR Tools ───

  private registerPrivacyTools(): void {
    if (!this.privacyService) return;
    const privacy = this.privacyService;

    // --- data_summary ---
    this.register(
      {
        name: 'data_summary',
        description:
          'Pokazuje podsumowanie wszystkich danych użytkownika przechowywanych przez KxAI. ' +
          'Zwraca kategorie danych, ich rozmiar i liczbę rekordów. ' +
          'Użyj gdy użytkownik pyta "jakie dane masz o mnie?" lub "co o mnie wiesz?".',
        category: 'privacy',
        parameters: {},
      },
      async () => {
        try {
          const summary = await privacy.getDataSummary();
          const lines = [
            `📊 **Podsumowanie danych KxAI**`,
            `Łączny rozmiar: ${formatSize(summary.totalSizeBytes)}`,
            summary.dataCollectionStart
              ? `Zbieranie danych od: ${new Date(summary.dataCollectionStart).toLocaleDateString('pl-PL')}`
              : '',
            '',
            ...summary.categories
              .filter((c) => c.itemCount > 0)
              .map(
                (c) => `• **${c.label}** — ${c.itemCount} elementów (${formatSize(c.sizeBytes)})\n  ${c.description}`,
              ),
          ].filter(Boolean);

          return { success: true, data: lines.join('\n') };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // --- data_export ---
    this.register(
      {
        name: 'data_export',
        description:
          'Eksportuje dane użytkownika do folderu (GDPR Art. 20 — prawo do przenoszenia danych). ' +
          'Tworzy kopię wszystkich danych w formacie JSON/Markdown w folderze Dokumenty. ' +
          'Klucze API NIE są eksportowane. Użyj gdy użytkownik mówi "eksportuj moje dane" lub "chcę kopię danych".',
        category: 'privacy',
        parameters: {
          include_rag: {
            type: 'boolean',
            description: 'Czy dołączyć zaindeksowane pliki RAG (mogą być duże). Domyślnie: false.',
            required: false,
          },
        },
      },
      async (params) => {
        try {
          const result = await privacy.exportData({
            includeRAG: params.include_rag === true,
          });

          if (result.success) {
            return {
              success: true,
              data: `✅ Dane wyeksportowane do: ${result.exportPath}\nRozmiar: ${formatSize(result.sizeBytes ?? 0)}\nKategorie: ${result.categories.join(', ')}`,
            };
          }
          return { success: false, error: result.error ?? 'Eksport nieudany' };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // --- data_delete ---
    this.register(
      {
        name: 'data_delete',
        description:
          'Usuwa dane użytkownika (GDPR Art. 17 — prawo do usunięcia). ' +
          'UWAGA: Ta operacja jest NIEODWRACALNA! Przed użyciem ZAWSZE zapytaj użytkownika o potwierdzenie. ' +
          'Możesz usunąć wszystko lub tylko wybrane kategorie. ' +
          'Użyj gdy użytkownik mówi "usuń moje dane", "zapomnij o mnie" lub "wyczyść wszystko".',
        category: 'privacy',
        parameters: {
          categories: {
            type: 'string',
            description:
              'Kategorie do usunięcia (oddzielone przecinkami). Dostępne: conversations, memory, activity, meetings, cron, rag, audit, config, prompts, browser, secrets, temp. Puste = wszystko.',
            required: false,
          },
          keep_config: {
            type: 'boolean',
            description: 'Zachowaj konfigurację aplikacji (ustawienia modelu, persona). Domyślnie: false.',
            required: false,
          },
          keep_persona: {
            type: 'boolean',
            description: 'Zachowaj plik SOUL.md (tożsamość agenta). Domyślnie: false.',
            required: false,
          },
        },
      },
      async (params) => {
        try {
          const categories = params.categories
            ? ((params.categories as string).split(',').map((c: string) => c.trim()) as any[])
            : undefined;

          const result = await privacy.deleteData({
            categories,
            keepConfig: params.keep_config === true,
            keepPersona: params.keep_persona === true,
          });

          if (result.success) {
            const msg = [
              `🗑️ Dane usunięte: ${result.deletedCategories.join(', ')}`,
              result.requiresRestart ? '⚠️ Wymagany restart aplikacji.' : '',
            ]
              .filter(Boolean)
              .join('\n');
            return { success: true, data: msg };
          }

          const failMsg = result.failedCategories.map((f) => `${f.category}: ${f.error}`).join('; ');
          return {
            success: result.deletedCategories.length > 0,
            data: `Usunięto: ${result.deletedCategories.join(', ')}. Błędy: ${failMsg}`,
            error: failMsg || undefined,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );
  }

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

// ─── Standalone helpers ───

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
