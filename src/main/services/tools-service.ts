import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app, clipboard, shell } from 'electron';
import { AutomationService } from './automation-service';
import { BrowserService } from './browser-service';
import { RAGService } from './rag-service';
import { PluginService } from './plugin-service';

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

  constructor() {
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
      description: 'Wykonuje komendę w terminalu systemowym (PowerShell/bash)',
      category: 'system',
      parameters: {
        command: { type: 'string', description: 'Komenda do wykonania', required: true },
        timeout: { type: 'number', description: 'Timeout w ms (default 30000)' },
      },
    }, async (params) => {
      return new Promise((resolve) => {
        const timeout = params.timeout || 30000;
        exec(params.command, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            resolve({ success: false, error: err.message, data: { stdout, stderr } });
          } else {
            resolve({ success: true, data: { stdout: stdout.trim(), stderr: stderr.trim() } });
          }
        });
      });
    });

    this.register({
      name: 'open_url',
      description: 'Otwiera URL w domyślnej przeglądarce',
      category: 'web',
      parameters: {
        url: { type: 'string', description: 'URL do otwarcia', required: true },
      },
    }, async (params) => {
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
      try {
        const content = fs.readFileSync(params.path, 'utf8');
        return { success: true, data: content.slice(0, 10000) };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    this.register({
      name: 'write_file',
      description: 'Zapisuje treść do pliku (tworzy go jeśli nie istnieje)',
      category: 'files',
      parameters: {
        path: { type: 'string', description: 'Ścieżka do pliku', required: true },
        content: { type: 'string', description: 'Treść do zapisania', required: true },
      },
    }, async (params) => {
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
      description: 'Pobiera treść strony internetowej (text)',
      category: 'web',
      parameters: {
        url: { type: 'string', description: 'URL strony', required: true },
      },
    }, async (params) => {
      try {
        const https = require('https');
        const http = require('http');
        const client = params.url.startsWith('https') ? https : http;
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

  // ─── Browser Tools ───

  private registerBrowserTools(): void {
    if (!this.browserService) return;
    const browser = this.browserService;

    this.register({
      name: 'browser_open',
      description: 'Otwiera nową sesję przeglądarki i nawiguje na URL',
      category: 'browser',
      parameters: {
        url: { type: 'string', description: 'URL strony do otwarcia', required: true },
        visible: { type: 'boolean', description: 'Czy okno ma być widoczne (domyślnie: false)' },
      },
    }, async (params) => {
      const session = await browser.open(params.url, { visible: params.visible });
      return { success: true, data: session };
    });

    this.register({
      name: 'browser_navigate',
      description: 'Nawiguje do nowego URL w istniejącej sesji',
      category: 'browser',
      parameters: {
        sessionId: { type: 'string', description: 'ID sesji przeglądarki', required: true },
        url: { type: 'string', description: 'URL docelowy', required: true },
      },
    }, async (params) => browser.navigate(params.sessionId, params.url));

    this.register({
      name: 'browser_extract_text',
      description: 'Pobiera tekst ze strony (opcjonalnie z konkretnego selektora CSS)',
      category: 'browser',
      parameters: {
        sessionId: { type: 'string', description: 'ID sesji', required: true },
        selector: { type: 'string', description: 'CSS selector (opcjonalny, domyślnie cała strona)' },
      },
    }, async (params) => browser.extractText(params.sessionId, params.selector));

    this.register({
      name: 'browser_click',
      description: 'Klika element na stronie po CSS selektorze',
      category: 'browser',
      parameters: {
        sessionId: { type: 'string', description: 'ID sesji', required: true },
        selector: { type: 'string', description: 'CSS selector elementu', required: true },
      },
    }, async (params) => browser.click(params.sessionId, params.selector));

    this.register({
      name: 'browser_type',
      description: 'Wpisuje tekst w pole input na stronie',
      category: 'browser',
      parameters: {
        sessionId: { type: 'string', description: 'ID sesji', required: true },
        selector: { type: 'string', description: 'CSS selector pola input', required: true },
        text: { type: 'string', description: 'Tekst do wpisania', required: true },
      },
    }, async (params) => browser.type(params.sessionId, params.selector, params.text));

    this.register({
      name: 'browser_evaluate',
      description: 'Wykonuje JavaScript na stronie i zwraca wynik',
      category: 'browser',
      parameters: {
        sessionId: { type: 'string', description: 'ID sesji', required: true },
        script: { type: 'string', description: 'Kod JavaScript do wykonania', required: true },
      },
    }, async (params) => browser.evaluate(params.sessionId, params.script));

    this.register({
      name: 'browser_get_links',
      description: 'Pobiera listę linków ze strony',
      category: 'browser',
      parameters: {
        sessionId: { type: 'string', description: 'ID sesji', required: true },
      },
    }, async (params) => browser.getLinks(params.sessionId));

    this.register({
      name: 'browser_close',
      description: 'Zamyka sesję przeglądarki',
      category: 'browser',
      parameters: {
        sessionId: { type: 'string', description: 'ID sesji', required: true },
      },
    }, async (params) => browser.close(params.sessionId));
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
  getToolsPrompt(): string {
    const tools = this.definitions.map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `  - ${k} (${v.type}${v.required ? ', required' : ''}): ${v.description}`)
        .join('\n');
      return `### ${t.name}\n${t.description}\nCategory: ${t.category}\n${params ? `Parameters:\n${params}` : 'No parameters'}`;
    });

    return `# Available Tools\n\nYou can use tools by responding with a JSON block:\n\`\`\`tool\n{"tool": "tool_name", "params": { ... }}\n\`\`\`\n\nAvailable tools:\n\n${tools.join('\n\n')}`;
  }
}
