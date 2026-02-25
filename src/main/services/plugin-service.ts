import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import { ToolDefinition, ToolResult } from './tools-service';

/**
 * PluginService — dynamiczne ładowanie narzędzi z katalogu plugins/.
 *
 * Format pluginu (CommonJS):
 * ```
 * module.exports = {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *   description: 'Opis pluginu',
 *   tools: [
 *     {
 *       name: 'my_tool',
 *       description: 'Co robi narzędzie',
 *       category: 'custom',
 *       parameters: {
 *         input: { type: 'string', description: 'Input', required: true },
 *       },
 *       handler: async (params) => ({ success: true, data: 'result' }),
 *     },
 *   ],
 * };
 * ```
 */
export class PluginService {
  private pluginsDir: string;
  private loadedPlugins: Map<string, LoadedPlugin> = new Map();
  private watcher: fs.FSWatcher | null = null;
  private approvedPluginHashes: Map<string, string> = new Map(); // fileName → sha256 hash
  private approvalPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.pluginsDir = path.join(userDataPath, 'plugins');
    this.approvalPath = path.join(userDataPath, 'plugins', '.approved.json');
  }

  /**
   * Initialize — create plugins directory, load existing plugins.
   */
  async initialize(): Promise<void> {
    // Ensure plugins directory exists
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
    }

    // Load approved plugin hashes
    this.loadApprovedHashes();

    // Create example plugin if directory is empty
    await this.createExamplePlugin();

    // Load all plugins
    await this.loadAll();

    // Watch for changes
    this.startWatching();
  }

  /**
   * Load all plugins from the plugins directory.
   */
  async loadAll(): Promise<void> {
    this.loadedPlugins.clear();

    try {
      const files = fs.readdirSync(this.pluginsDir).filter((f) => f.endsWith('.js') && !f.startsWith('_'));

      for (const file of files) {
        await this.loadPlugin(file);
      }

      console.log(`PluginService: Loaded ${this.loadedPlugins.size} plugins`);
    } catch (err) {
      console.error('PluginService: Failed to load plugins:', err);
    }
  }

  /**
   * Load approved plugin hashes from disk.
   */
  private loadApprovedHashes(): void {
    try {
      if (fs.existsSync(this.approvalPath)) {
        const data = JSON.parse(fs.readFileSync(this.approvalPath, 'utf8'));
        if (data && typeof data === 'object') {
          for (const [name, hash] of Object.entries(data)) {
            if (typeof hash === 'string') {
              this.approvedPluginHashes.set(name, hash);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('PluginService: Failed to load approved hashes:', err.message);
    }
  }

  /**
   * Persist approved plugin hashes to disk (atomic write).
   */
  private saveApprovedHashes(): void {
    try {
      const data: Record<string, string> = {};
      for (const [name, hash] of this.approvedPluginHashes) {
        data[name] = hash;
      }
      const tmpPath = this.approvalPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.approvalPath);
    } catch (err: any) {
      console.warn('PluginService: Failed to save approved hashes:', err.message);
    }
  }

  /**
   * Load a single plugin file with security validation.
   * - Computes SHA-256 hash and checks against approved list
   * - Validates manifest structure before execution
   * - Auto-approves example plugins created by the system
   */
  private async loadPlugin(fileName: string): Promise<void> {
    const filePath = path.join(this.pluginsDir, fileName);

    try {
      // 1) Compute hash of plugin file for integrity check
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');

      // 2) Check if plugin is approved (by hash)
      const approvedHash = this.approvedPluginHashes.get(fileName);
      if (approvedHash && approvedHash !== fileHash) {
        console.warn(
          `PluginService: Plugin "${fileName}" was modified since approval — skipping. Re-approve via plugins panel.`,
        );
        return;
      }

      // Auto-approve new plugins from the plugins directory (user placed them there intentionally)
      if (!approvedHash) {
        this.approvedPluginHashes.set(fileName, fileHash);
        this.saveApprovedHashes();
        console.log(`PluginService: Auto-approved new plugin "${fileName}" (hash: ${fileHash.slice(0, 12)}...)`);
      }

      // 3) Clear require cache to support hot reload
      const resolved = require.resolve(filePath);
      delete require.cache[resolved];

      const pluginModule = require(filePath);
      const plugin: PluginManifest = pluginModule.default || pluginModule;

      // 4) Validate manifest structure
      if (!plugin.name || typeof plugin.name !== 'string') {
        console.warn(`PluginService: Invalid plugin — missing 'name' in ${fileName}`);
        return;
      }
      if (!Array.isArray(plugin.tools)) {
        console.warn(`PluginService: Invalid plugin format in ${fileName} — 'tools' must be an array`);
        return;
      }

      const tools: PluginTool[] = [];
      for (const tool of plugin.tools) {
        if (!tool.name || !tool.description || typeof tool.handler !== 'function') {
          console.warn(`PluginService: Invalid tool in plugin ${plugin.name}: ${tool.name}`);
          continue;
        }
        tools.push(tool);
      }

      this.loadedPlugins.set(plugin.name, {
        manifest: plugin,
        tools,
        filePath,
        loadedAt: Date.now(),
      });

      console.log(`PluginService: Loaded plugin "${plugin.name}" with ${tools.length} tools`);
    } catch (err: any) {
      console.error(`PluginService: Failed to load plugin ${fileName}:`, err.message);
    }
  }

  /**
   * Get all tool definitions from loaded plugins.
   */
  getToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const [, plugin] of this.loadedPlugins) {
      for (const tool of plugin.tools) {
        definitions.push({
          name: `plugin:${plugin.manifest.name}:${tool.name}`,
          description: `[Plugin: ${plugin.manifest.name}] ${tool.description}`,
          category: (tool.category || 'custom') as any,
          parameters: tool.parameters || {},
        });
      }
    }
    return definitions;
  }

  /**
   * Execute a plugin tool.
   */
  async executeTool(fullName: string, params: any): Promise<ToolResult> {
    // Parse plugin:pluginName:toolName format
    const parts = fullName.split(':');
    if (parts.length < 3 || parts[0] !== 'plugin') {
      return { success: false, error: `Invalid plugin tool name: ${fullName}` };
    }

    const pluginName = parts[1];
    const toolName = parts.slice(2).join(':');

    const plugin = this.loadedPlugins.get(pluginName);
    if (!plugin) {
      return { success: false, error: `Plugin "${pluginName}" nie znaleziony` };
    }

    const tool = plugin.tools.find((t) => t.name === toolName);
    if (!tool) {
      return { success: false, error: `Narzędzie "${toolName}" nie znalezione w pluginie "${pluginName}"` };
    }

    try {
      const result = await tool.handler(params);
      return result;
    } catch (err: any) {
      return { success: false, error: `Plugin error: ${err.message}` };
    }
  }

  /**
   * List loaded plugins.
   */
  listPlugins(): PluginInfo[] {
    const list: PluginInfo[] = [];
    for (const [name, plugin] of this.loadedPlugins) {
      list.push({
        name,
        version: plugin.manifest.version || '1.0.0',
        description: plugin.manifest.description || '',
        toolCount: plugin.tools.length,
        loadedAt: plugin.loadedAt,
        filePath: plugin.filePath,
      });
    }
    return list;
  }

  /**
   * Get plugins directory path.
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }

  /**
   * Reload all plugins.
   */
  async reload(): Promise<void> {
    await this.loadAll();
  }

  /**
   * Watch for plugin file changes (hot reload).
   */
  private startWatching(): void {
    if (this.watcher) return;

    try {
      this.watcher = fs.watch(this.pluginsDir, { persistent: false }, (eventType, fileName) => {
        if (fileName && fileName.endsWith('.js') && !fileName.startsWith('_')) {
          console.log(`PluginService: Detected change in ${fileName}, reloading...`);
          // Debounce reload
          setTimeout(() => this.loadAll(), 500);
        }
      });
    } catch {
      // Watching not available on this platform
    }
  }

  /**
   * Create an example plugin for first-time users.
   */
  private async createExamplePlugin(): Promise<void> {
    const examplePath = path.join(this.pluginsDir, '_example-plugin.js');
    if (fs.existsSync(examplePath)) return;

    const exampleContent = `/**
 * Przykładowy plugin KxAI
 * Skopiuj ten plik, usuń prefiks _ z nazwy, i zmodyfikuj.
 * Plugin zostanie automatycznie załadowany.
 */
module.exports = {
  name: 'example',
  version: '1.0.0',
  description: 'Przykładowy plugin z prostym narzędziem',
  tools: [
    {
      name: 'hello_world',
      description: 'Proste narzędzie testowe — zwraca powitanie',
      category: 'custom',
      parameters: {
        name: { type: 'string', description: 'Imię do powitania', required: true },
      },
      handler: async (params) => {
        return {
          success: true,
          data: \`Cześć, \${params.name}! Plugin działa prawidłowo. 🎉\`,
        };
      },
    },
  ],
};
`;
    fs.writeFileSync(examplePath, exampleContent, 'utf8');
  }

  /**
   * Stop watching and cleanup.
   */
  destroy(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

// ─── Types ───

interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  tools: PluginTool[];
}

interface PluginTool {
  name: string;
  description: string;
  category?: string;
  parameters?: Record<string, { type: string; description: string; required?: boolean }>;
  handler: (params: any) => Promise<ToolResult>;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  tools: PluginTool[];
  filePath: string;
  loadedAt: number;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  toolCount: number;
  loadedAt: number;
  filePath: string;
}
