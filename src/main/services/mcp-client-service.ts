/**
 * MCP Client Service — connects KxAI to external MCP servers.
 *
 * Supports three transport types:
 * - Streamable HTTP (modern, recommended)
 * - SSE (legacy fallback)
 * - stdio (local process — spawn MCP server as child process)
 *
 * Auto-discovers tools from connected servers and registers them
 * with ToolsService so the AI agent can use them natively.
 *
 * @module mcp-client-service
 * @phase 8.1
 */

import { randomUUID } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createLogger } from './logger';
import type {
  McpServerConfig,
  McpServerStatus,
  McpConnectionStatus,
  McpHubStatus,
  McpToolInfo,
  McpRegistryEntry,
} from '@shared/types';
import type { ToolDefinition, ToolResult } from '@shared/types';

const log = createLogger('McpClient');

/** Curated registry of popular MCP servers users can one-click install */
const CURATED_REGISTRY: McpRegistryEntry[] = [
  {
    id: 'caldav',
    name: 'CalDAV Calendar',
    description: 'Kalendarz via CalDAV — Google Calendar, Apple iCloud, Nextcloud, ownCloud. CRUD eventów, recurrence, reminders.',
    command: 'npx',
    args: ['-y', 'caldav-mcp'],
    category: 'Komunikacja',
    icon: '📅',
    transport: 'stdio',
    requiresSetup: true,
    docsUrl: 'https://github.com/madbonez/caldav-mcp',
  },
  {
    id: 'google-tasks',
    name: 'Google Tasks',
    description: 'Zarządzanie listami zadań Google Tasks — tworzenie, edycja, usuwanie, oznaczanie jako wykonane.',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-googletasks'],
    category: 'Produktywność',
    icon: '✅',
    transport: 'stdio',
    requiresSetup: true,
    docsUrl: 'https://github.com/arpitbatra123/mcp-googletasks',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Zarządzanie repozytoriami, issues, pull requests, code search — pełna integracja z GitHub.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    category: 'Developer',
    icon: '🐙',
    transport: 'stdio',
    requiresSetup: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'filesystem',
    name: 'File System',
    description: 'Bezpieczny dostęp do plików i katalogów na dysku — odczyt, zapis, wyszukiwanie.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    category: 'System',
    icon: '📁',
    transport: 'stdio',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Wyszukiwanie w internecie przez Brave Search API — wyniki, newsy, obrazki.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    category: 'Web',
    icon: '🔍',
    transport: 'stdio',
    requiresSetup: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Wysyłanie wiadomości, czytanie kanałów, zarządzanie Slack workspace.',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-slack'],
    category: 'Komunikacja',
    icon: '💬',
    transport: 'stdio',
    requiresSetup: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Interakcja z Notion — strony, bazy danych, bloki, wyszukiwanie.',
    command: 'npx',
    args: ['-y', 'mcp-notion-server'],
    category: 'Produktywność',
    icon: '📝',
    transport: 'stdio',
    requiresSetup: true,
    docsUrl: 'https://github.com/suekou/mcp-notion-server',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Połączenie z bazą PostgreSQL — schema inspection, queries, analiza danych.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    category: 'Bazy danych',
    icon: '🐘',
    transport: 'stdio',
    requiresSetup: true,
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'memory',
    name: 'Knowledge Graph Memory',
    description: 'Persistent memory system oparty na grafie wiedzy — przechowywanie i wyszukiwanie kontekstu.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    category: 'AI',
    icon: '🧠',
    transport: 'stdio',
    docsUrl: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'context7',
    name: 'Context7 — Library Docs',
    description: 'Aktualna dokumentacja bibliotek programistycznych dla agenta AI.',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    category: 'Developer',
    icon: '📚',
    transport: 'stdio',
    docsUrl: 'https://github.com/upstash/context7',
  },
  {
    id: 'obsidian',
    name: 'Obsidian Vault',
    description: 'Odczyt/zapis notatek w Obsidian vault — wyszukiwanie, tagi, frontmatter.',
    command: 'npx',
    args: ['-y', 'mcp-obsidian'],
    category: 'Produktywność',
    icon: '💎',
    transport: 'stdio',
    requiresSetup: true,
    docsUrl: 'https://github.com/bitbonsai/mcp-obsidian',
  },
  {
    id: 'docker',
    name: 'Docker',
    description: 'Zarządzanie kontenerami, obrazami, wolumenami Docker.',
    command: 'npx',
    args: ['-y', '@QuantGeekDev/docker-mcp'],
    category: 'Developer',
    icon: '🐳',
    transport: 'stdio',
    docsUrl: 'https://github.com/QuantGeekDev/docker-mcp',
  },
];

/** Active connection state for one MCP server */
interface McpConnection {
  config: McpServerConfig;
  client: Client;
  transport: Transport;
  status: McpConnectionStatus;
  error?: string;
  tools: McpToolInfo[];
  connectedAt?: number;
  callCount: number;
  registeredToolNames: string[];
}

export class McpClientService {
  private connections = new Map<string, McpConnection>();
  private configs: McpServerConfig[] = [];
  private toolsService: any = null;
  private configService: any = null;
  private mainWindow: Electron.BrowserWindow | null = null;

  /**
   * Set dependencies after construction (DI wiring phase).
   */
  setDependencies(opts: {
    toolsService?: any;
    configService?: any;
    mainWindow?: Electron.BrowserWindow;
  }): void {
    if (opts.toolsService) this.toolsService = opts.toolsService;
    if (opts.configService) this.configService = opts.configService;
    if (opts.mainWindow) this.mainWindow = opts.mainWindow;
  }

  /**
   * Initialize — load saved configs and auto-connect.
   */
  async initialize(): Promise<void> {
    log.info('Initializing MCP Client Service...');
    await this.loadConfigs();

    // Auto-connect enabled servers
    const autoConnectServers = this.configs.filter((c) => c.autoConnect && c.enabled);
    if (autoConnectServers.length > 0) {
      log.info(`Auto-connecting ${autoConnectServers.length} MCP servers...`);
      for (const config of autoConnectServers) {
        // Don't await — connect in background
        void this.connect(config.id).catch((err) => {
          log.warn(`Auto-connect failed for "${config.name}": ${err.message}`);
        });
      }
    }
  }

  // ─── Server Management ───

  /**
   * Add a new MCP server configuration.
   */
  async addServer(config: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
    const fullConfig: McpServerConfig = { ...config, id: randomUUID() };
    this.configs.push(fullConfig);
    await this.saveConfigs();
    this.pushStatus();
    log.info(`Added MCP server: "${fullConfig.name}" (${fullConfig.transport})`);
    return fullConfig;
  }

  /**
   * Remove an MCP server and disconnect if active.
   */
  async removeServer(id: string): Promise<void> {
    await this.disconnect(id);
    this.configs = this.configs.filter((c) => c.id !== id);
    await this.saveConfigs();
    this.pushStatus();
    log.info(`Removed MCP server: ${id}`);
  }

  /**
   * Get all configured servers.
   */
  listServers(): McpServerConfig[] {
    return [...this.configs];
  }

  // ─── Connection Management ───

  /**
   * Connect to an MCP server by id.
   */
  async connect(id: string): Promise<void> {
    const config = this.configs.find((c) => c.id === id);
    if (!config) throw new Error(`MCP server not found: ${id}`);
    if (!config.enabled) throw new Error(`MCP server "${config.name}" is disabled`);

    // Disconnect existing connection if any
    if (this.connections.has(id)) {
      await this.disconnect(id);
    }

    const conn: McpConnection = {
      config,
      client: null as any,
      transport: null as any,
      status: 'connecting',
      tools: [],
      callCount: 0,
      registeredToolNames: [],
    };
    this.connections.set(id, conn);
    this.pushStatus();

    try {
      log.info(`Connecting to MCP server "${config.name}" via ${config.transport}...`);

      const { client, transport } = await this.createConnection(config);
      conn.client = client;
      conn.transport = transport;
      conn.status = 'connected';
      conn.connectedAt = Date.now();

      // Discover tools
      const { tools } = await client.listTools();
      conn.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));

      log.info(
        `Connected to "${config.name}" — discovered ${conn.tools.length} tools: ${conn.tools.map((t) => t.name).join(', ')}`,
      );

      // Register tools with ToolsService
      this.registerMcpTools(conn);
      this.pushStatus();
    } catch (err: any) {
      conn.status = 'error';
      conn.error = err.message || String(err);
      log.error(`Failed to connect to "${config.name}": ${conn.error}`);
      this.pushStatus();
      throw err;
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;

    // Unregister tools
    this.unregisterMcpTools(conn);

    // Close transport
    try {
      await conn.transport?.close?.();
    } catch (err: any) {
      log.warn(`Error closing transport for "${conn.config.name}": ${err.message}`);
    }

    try {
      await conn.client?.close?.();
    } catch {
      // Ignore
    }

    this.connections.delete(id);
    this.pushStatus();
    log.info(`Disconnected from "${conn.config.name}"`);
  }

  /**
   * Reconnect to an MCP server (disconnect + connect).
   */
  async reconnect(id: string): Promise<void> {
    await this.disconnect(id);
    await this.connect(id);
  }

  // ─── Tool Execution ───

  /**
   * Call a tool on a specific MCP server.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const conn = this.connections.get(serverId);
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: `MCP server "${serverId}" is not connected` };
    }

    try {
      const result = await conn.client.callTool({ name: toolName, arguments: args });
      conn.callCount++;

      // Extract text content from MCP result
      const textContent = (result.content as any[])
        ?.filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      return {
        success: !result.isError,
        data: textContent || result.content,
        error: result.isError ? textContent : undefined,
      };
    } catch (err: any) {
      log.error(`MCP tool call failed: ${conn.config.name}/${toolName}: ${err.message}`);

      // If connection lost, mark as error
      if (err.message?.includes('closed') || err.message?.includes('ECONNREFUSED')) {
        conn.status = 'error';
        conn.error = 'Connection lost';
        this.pushStatus();
      }

      return { success: false, error: err.message || String(err) };
    }
  }

  // ─── Status & Registry ───

  /**
   * Get aggregated MCP hub status.
   */
  getStatus(): McpHubStatus {
    const servers: McpServerStatus[] = this.configs.map((config) => {
      const conn = this.connections.get(config.id);
      return {
        id: config.id,
        name: config.name,
        status: conn?.status ?? 'disconnected',
        error: conn?.error,
        tools: conn?.tools ?? [],
        connectedAt: conn?.connectedAt,
        callCount: conn?.callCount ?? 0,
        transport: config.transport,
        icon: config.icon,
      };
    });

    const connectedCount = servers.filter((s) => s.status === 'connected').length;
    const totalTools = servers.reduce((sum, s) => sum + s.tools.length, 0);

    return { servers, totalTools, connectedCount };
  }

  /**
   * Get curated registry of popular MCP servers.
   */
  getRegistry(): McpRegistryEntry[] {
    return CURATED_REGISTRY;
  }

  // ─── Shutdown ───

  async shutdown(): Promise<void> {
    log.info('Shutting down MCP Client Service...');
    const ids = [...this.connections.keys()];
    for (const id of ids) {
      await this.disconnect(id).catch(() => {});
    }
    log.info('MCP Client Service shut down');
  }

  // ─── Private Methods ───

  /**
   * Create MCP client + transport based on config.
   */
  private async createConnection(
    config: McpServerConfig,
  ): Promise<{ client: Client; transport: Transport }> {
    const timeout = config.timeout ?? 30_000;

    if (config.transport === 'stdio') {
      if (!config.command) throw new Error('stdio transport requires a command');

      const client = new Client({ name: 'kxai', version: '1.0.0' });
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
      });

      await client.connect(transport);
      return { client, transport };
    }

    if (!config.url) throw new Error('HTTP/SSE transport requires a URL');
    const baseUrl = new URL(config.url);

    if (config.transport === 'streamable-http') {
      // Try Streamable HTTP first, fallback to SSE
      try {
        const client = new Client({ name: 'kxai', version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(baseUrl, {
          requestInit: { signal: AbortSignal.timeout(timeout) },
        });
        await client.connect(transport);
        return { client, transport };
      } catch {
        log.info(`Streamable HTTP failed for "${config.name}", trying SSE fallback...`);
        const client = new Client({ name: 'kxai', version: '1.0.0' });
        const transport = new SSEClientTransport(baseUrl);
        await client.connect(transport);
        return { client, transport };
      }
    }

    // SSE transport
    const client = new Client({ name: 'kxai', version: '1.0.0' });
    const transport = new SSEClientTransport(baseUrl);
    await client.connect(transport);
    return { client, transport };
  }

  /**
   * Register discovered MCP tools with the ToolsService.
   * Tools are prefixed with `mcp_{serverName}_` to avoid name collisions.
   */
  private registerMcpTools(conn: McpConnection): void {
    if (!this.toolsService) {
      log.warn('ToolsService not available — MCP tools will not be registered');
      return;
    }

    const serverSlug = conn.config.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    for (const tool of conn.tools) {
      const toolName = `mcp_${serverSlug}_${tool.name}`;

      // Convert MCP JSON Schema to KxAI parameter format
      const parameters = this.convertMcpParams(tool.inputSchema);

      const definition: ToolDefinition = {
        name: toolName,
        description: `[MCP: ${conn.config.name}] ${tool.description || tool.name}`,
        category: 'mcp',
        parameters,
      };

      const handler = async (params: any): Promise<ToolResult> => {
        return this.callTool(conn.config.id, tool.name, params);
      };

      this.toolsService.register(definition, handler);
      conn.registeredToolNames.push(toolName);
    }

    log.info(
      `Registered ${conn.registeredToolNames.length} MCP tools from "${conn.config.name}"`,
    );
  }

  /**
   * Unregister MCP tools when disconnecting.
   */
  private unregisterMcpTools(conn: McpConnection): void {
    if (!this.toolsService || conn.registeredToolNames.length === 0) return;

    for (const toolName of conn.registeredToolNames) {
      this.toolsService.unregister(toolName);
    }

    log.info(
      `Unregistered ${conn.registeredToolNames.length} MCP tools from "${conn.config.name}"`,
    );
    conn.registeredToolNames = [];
  }

  /**
   * Convert MCP JSON Schema to KxAI parameter format.
   */
  private convertMcpParams(
    inputSchema?: Record<string, unknown>,
  ): Record<string, { type: string; description: string; required?: boolean }> {
    if (!inputSchema) return {};

    const properties = (inputSchema.properties ?? {}) as Record<string, any>;
    const required = (inputSchema.required ?? []) as string[];
    const result: Record<string, { type: string; description: string; required?: boolean }> = {};

    for (const [key, schema] of Object.entries(properties)) {
      result[key] = {
        type: schema.type ?? 'string',
        description: schema.description ?? key,
        required: required.includes(key),
      };
    }

    return result;
  }

  /**
   * Push status to renderer via IPC.
   */
  private pushStatus(): void {
    if (!this.mainWindow?.webContents) return;
    try {
      this.mainWindow.webContents.send('mcp:status', this.getStatus());
    } catch {
      // Window may be destroyed
    }
  }

  /**
   * Load saved MCP server configs from app config.
   */
  private async loadConfigs(): Promise<void> {
    try {
      if (this.configService) {
        const config = await this.configService.get();
        this.configs = config.mcpServers ?? [];
        log.info(`Loaded ${this.configs.length} MCP server configs`);
      }
    } catch (err: any) {
      log.warn(`Failed to load MCP configs: ${err.message}`);
      this.configs = [];
    }
  }

  /**
   * Save MCP server configs to app config.
   */
  private async saveConfigs(): Promise<void> {
    try {
      if (this.configService) {
        const config = await this.configService.get();
        config.mcpServers = this.configs;
        await this.configService.save(config);
      }
    } catch (err: any) {
      log.warn(`Failed to save MCP configs: ${err.message}`);
    }
  }
}
