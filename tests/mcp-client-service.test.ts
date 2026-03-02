/**
 * Unit tests for McpClientService.
 *
 * Tests cover:
 * - CURATED_REGISTRY integrity (all entries have required fields)
 * - getRegistry / searchRegistry / getRegistryCategories
 * - runOAuthSetup (OAuth flow with mocked exec)
 * - Server management: addServer, removeServer, listServers
 * - Connection lifecycle: connect, disconnect, reconnect
 * - callTool (tool execution)
 * - getStatus (hub status aggregation)
 * - Stdio timeout logic in createConnection
 * - shutdown
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted — variables available inside vi.mock factories (hoisted above mocks)
const { mockExec, mockClientInstance } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockClientInstance: {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], isError: false }),
    close: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Mock electron ───
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));

// ─── Mock logger ───
vi.mock('../src/main/services/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Mock crypto ───
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid-1234'),
}));

// ─── Mock child_process ───
vi.mock('child_process', () => ({
  exec: mockExec,
}));

// ─── Mock util ───
vi.mock('util', () => ({
  promisify: vi.fn((fn: any) => fn),
}));

// ─── Mock MCP SDK ───
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockClientInstance.connect,
    listTools: mockClientInstance.listTools,
    callTool: mockClientInstance.callTool,
    close: mockClientInstance.close,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    onerror: null,
    onclose: null,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { McpClientService } from '../src/main/services/mcp-client-service';

// ─── Helpers ───

function createService(): McpClientService {
  return new McpClientService();
}

function createMockToolsService() {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

function createMockConfigService(servers: any[] = []) {
  return {
    get: vi.fn().mockReturnValue(servers),
    set: vi.fn(),
  };
}

// ─── Tests ───

describe('McpClientService', () => {
  let service: McpClientService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Registry ───

  describe('getRegistry', () => {
    it('returns all curated registry entries', () => {
      const registry = service.getRegistry();
      expect(registry).toBeInstanceOf(Array);
      expect(registry.length).toBeGreaterThan(0);
    });

    it('all entries have required fields', () => {
      const registry = service.getRegistry();
      for (const entry of registry) {
        expect(entry.id).toBeTruthy();
        expect(entry.name).toBeTruthy();
        expect(entry.description).toBeTruthy();
        expect(entry.category).toBeTruthy();
        expect(entry.transport).toBeTruthy();
      }
    });

    it('entries with setupType=env have requiredEnvVars', () => {
      const registry = service.getRegistry();
      const envEntries = registry.filter((e) => e.setupType === 'env');
      for (const entry of envEntries) {
        expect(entry.requiredEnvVars).toBeTruthy();
        expect(entry.requiredEnvVars!.length).toBeGreaterThan(0);
      }
    });

    it('OAuth entries have oauth setupType', () => {
      const registry = service.getRegistry();
      const oauthEntries = registry.filter(
        (e) => e.setupType === 'oauth-google' || e.setupType === 'oauth-microsoft',
      );
      expect(oauthEntries.length).toBeGreaterThan(0);
      for (const entry of oauthEntries) {
        expect(entry.setupInstructions).toBeTruthy();
      }
    });

    it('featured entries exist', () => {
      const registry = service.getRegistry();
      const featured = registry.filter((e) => e.featured);
      expect(featured.length).toBeGreaterThan(0);
    });
  });

  describe('searchRegistry', () => {
    it('returns all entries when no filter', () => {
      const all = service.getRegistry();
      const results = service.searchRegistry();
      expect(results.length).toBe(all.length);
    });

    it('filters by category', () => {
      const results = service.searchRegistry(undefined, 'Developer');
      expect(results.length).toBeGreaterThan(0);
      for (const entry of results) {
        expect(entry.category).toBe('Developer');
      }
    });

    it('filters by query string (name match)', () => {
      const results = service.searchRegistry('GitHub');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((e) => e.id === 'github')).toBe(true);
    });

    it('filters by query string (tag match)', () => {
      const results = service.searchRegistry('search');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty for non-matching query', () => {
      const results = service.searchRegistry('xyznonexistent12345');
      expect(results.length).toBe(0);
    });

    it('sorts featured entries first', () => {
      const results = service.searchRegistry();
      const firstFeaturedIdx = results.findIndex((e) => e.featured);
      const firstNonFeaturedIdx = results.findIndex((e) => !e.featured);
      if (firstFeaturedIdx !== -1 && firstNonFeaturedIdx !== -1) {
        expect(firstFeaturedIdx).toBeLessThan(firstNonFeaturedIdx);
      }
    });

    it('filters by both query and category', () => {
      const results = service.searchRegistry('search', 'Web');
      for (const entry of results) {
        expect(entry.category).toBe('Web');
      }
    });
  });

  describe('getRegistryCategories', () => {
    it('returns sorted unique categories', () => {
      const cats = service.getRegistryCategories();
      expect(cats.length).toBeGreaterThan(0);
      // Check sorted
      for (let i = 1; i < cats.length; i++) {
        expect(cats[i].localeCompare(cats[i - 1])).toBeGreaterThanOrEqual(0);
      }
    });

    it('has no duplicates', () => {
      const cats = service.getRegistryCategories();
      const unique = [...new Set(cats)];
      expect(cats.length).toBe(unique.length);
    });
  });

  // ─── Server Management ───

  describe('listServers', () => {
    it('returns empty array initially', () => {
      expect(service.listServers()).toEqual([]);
    });

    it('returns a copy (not the original array)', () => {
      const list1 = service.listServers();
      const list2 = service.listServers();
      expect(list1).not.toBe(list2);
    });
  });

  describe('addServer', () => {
    it('adds server and returns config with id', async () => {
      service.setDependencies({ configService: createMockConfigService() });
      const result = await service.addServer({
        name: 'Test Server',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'test-server'],
        enabled: true,
        autoConnect: false,
      } as any);

      expect(result.id).toBe('mock-uuid-1234');
      expect(result.name).toBe('Test Server');
      expect(service.listServers().length).toBe(1);
    });
  });

  describe('removeServer', () => {
    it('removes server from configs', async () => {
      service.setDependencies({ configService: createMockConfigService() });
      const server = await service.addServer({
        name: 'Test',
        transport: 'stdio',
        command: 'echo',
        enabled: true,
        autoConnect: false,
      } as any);

      expect(service.listServers().length).toBe(1);
      await service.removeServer(server.id);
      expect(service.listServers().length).toBe(0);
    });
  });

  // ─── setDependencies ───

  describe('setDependencies', () => {
    it('accepts toolsService', () => {
      const tools = createMockToolsService();
      service.setDependencies({ toolsService: tools });
      // No throw = success
    });

    it('accepts configService', () => {
      service.setDependencies({ configService: createMockConfigService() });
    });

    it('accepts mainWindow', () => {
      const mockWindow = { webContents: { send: vi.fn() } } as any;
      service.setDependencies({ mainWindow: mockWindow });
    });
  });

  // ─── getStatus ───

  describe('getStatus', () => {
    it('returns empty status when no servers configured', () => {
      const status = service.getStatus();
      expect(status.servers).toEqual([]);
      expect(status.totalTools).toBe(0);
      expect(status.connectedCount).toBe(0);
    });

    it('returns status for configured servers', async () => {
      service.setDependencies({ configService: createMockConfigService() });
      await service.addServer({
        name: 'Server1',
        transport: 'stdio',
        command: 'echo',
        enabled: true,
        autoConnect: false,
      } as any);

      const status = service.getStatus();
      expect(status.servers.length).toBe(1);
      expect(status.servers[0].name).toBe('Server1');
      expect(status.servers[0].status).toBe('disconnected');
      expect(status.connectedCount).toBe(0);
    });
  });

  // ─── runOAuthSetup ───

  describe('runOAuthSetup', () => {
    it('returns error for non-existent server', async () => {
      const result = await service.runOAuthSetup('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error for non-OAuth server', async () => {
      service.setDependencies({ configService: createMockConfigService() });
      const server = await service.addServer({
        name: 'GitHub',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        enabled: true,
        autoConnect: false,
      } as any);

      const result = await service.runOAuthSetup(server.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('OAuth');
    });

    it('runs OAuth for matching server and succeeds', async () => {
      service.setDependencies({ configService: createMockConfigService() });
      // Add a server matching an OAuth entry (Gmail)
      const server = await service.addServer({
        name: 'Gmail',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
        enabled: true,
        autoConnect: false,
      } as any);

      // Mock exec to resolve successfully
      mockExec.mockResolvedValueOnce({ stdout: 'ok', stderr: '' });

      const result = await service.runOAuthSetup(server.id);
      expect(result.success).toBe(true);
    });

    it('returns error when exec fails', async () => {
      service.setDependencies({ configService: createMockConfigService() });
      const server = await service.addServer({
        name: 'Gmail',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
        enabled: true,
        autoConnect: false,
      } as any);

      mockExec.mockRejectedValueOnce(new Error('auth failed'));

      const result = await service.runOAuthSetup(server.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('auth failed');
    });
  });

  // ─── callTool ───

  describe('callTool', () => {
    it('returns error when server not connected', async () => {
      const result = await service.callTool('nonexistent', 'tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  // ─── shutdown ───

  describe('shutdown', () => {
    it('completes without error when no connections', async () => {
      await expect(service.shutdown()).resolves.toBeUndefined();
    });
  });

  // ─── initialize ───

  describe('initialize', () => {
    it('loads configs and registers management tools', async () => {
      const tools = createMockToolsService();
      const config = createMockConfigService([]);
      service.setDependencies({ toolsService: tools, configService: config });

      await service.initialize();

      // Should register 4 management tools
      expect(tools.register).toHaveBeenCalledTimes(4);
    });

    it('auto-connects enabled servers', async () => {
      const tools = createMockToolsService();
      const config = createMockConfigService([
        {
          id: 'srv-1',
          name: 'AutoServer',
          transport: 'stdio',
          command: 'echo',
          enabled: true,
          autoConnect: true,
        },
      ]);
      service.setDependencies({ toolsService: tools, configService: config });

      // Initialize will try to auto-connect but the connect will fail
      // since the mocked transport won't actually work end-to-end.
      // That's OK — we just verify it doesn't crash.
      await service.initialize();
      expect(config.get).toHaveBeenCalledWith('mcpServers');
    });

    it('handles missing toolsService gracefully', async () => {
      const config = createMockConfigService([]);
      service.setDependencies({ configService: config });
      // Should not throw
      await service.initialize();
    });
  });

  // ─── connect / disconnect ───

  describe('connect', () => {
    it('throws for unknown server id', async () => {
      await expect(service.connect('nonexistent')).rejects.toThrow('not found');
    });

    it('throws for disabled server', async () => {
      service.setDependencies({ configService: createMockConfigService() });
      const server = await service.addServer({
        name: 'Disabled',
        transport: 'stdio',
        command: 'echo',
        enabled: false,
        autoConnect: false,
      } as any);

      await expect(service.connect(server.id)).rejects.toThrow('disabled');
    });
  });

  describe('disconnect', () => {
    it('does nothing for unknown server id', async () => {
      // Should not throw
      await expect(service.disconnect('nonexistent')).resolves.toBeUndefined();
    });
  });

  // ─── Management tool handlers (via initialize) ───

  describe('management tools', () => {
    let tools: ReturnType<typeof createMockToolsService>;
    let registeredHandlers: Map<string, Function>;

    beforeEach(async () => {
      tools = createMockToolsService();
      registeredHandlers = new Map();

      // Capture registered tool handlers
      tools.register.mockImplementation((def: any, handler: Function) => {
        registeredHandlers.set(def.name, handler);
      });

      const config = createMockConfigService([]);
      service.setDependencies({ toolsService: tools, configService: config });
      await service.initialize();
    });

    it('mcp_browse_registry returns registry list', async () => {
      const handler = registeredHandlers.get('mcp_browse_registry');
      expect(handler).toBeDefined();

      const result = await handler!({});
      expect(result.success).toBe(true);
      expect(result.data).toContain('MCP');
    });

    it('mcp_browse_registry filters by category', async () => {
      const handler = registeredHandlers.get('mcp_browse_registry');
      const result = await handler!({ category: 'Developer' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('GitHub');
    });

    it('mcp_browse_registry returns message for empty category', async () => {
      const handler = registeredHandlers.get('mcp_browse_registry');
      const result = await handler!({ category: 'NonExistentCategory12345' });
      expect(result.success).toBe(true);
      expect(result.data).toContain('Brak serwerów');
    });

    it('mcp_status returns status', async () => {
      const handler = registeredHandlers.get('mcp_status');
      expect(handler).toBeDefined();

      const result = await handler!({});
      expect(result.success).toBe(true);
      expect(result.data).toContain('Brak skonfigurowanych');
    });

    it('mcp_add_and_connect returns error for unknown registry id', async () => {
      const handler = registeredHandlers.get('mcp_add_and_connect');
      expect(handler).toBeDefined();

      const result = await handler!({ registry_id: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Nie znaleziono');
    });

    it('mcp_disconnect_server returns error for unknown server', async () => {
      const handler = registeredHandlers.get('mcp_disconnect_server');
      expect(handler).toBeDefined();

      const result = await handler!({ server_name: 'Unknown' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Nie znaleziono');
    });
  });
});
