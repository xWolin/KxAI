/**
 * MCP (Model Context Protocol) Client types — shared main ↔ renderer.
 *
 * Defines configuration, status, and tool types for connecting
 * to external MCP servers and making their tools available to the agent.
 */

/** Transport type for connecting to an MCP server */
export type McpTransportType = 'streamable-http' | 'sse' | 'stdio';

/** Configuration for a single MCP server connection */
export interface McpServerConfig {
  /** Unique identifier (generated) */
  id: string;
  /** Display name (e.g. "Google Calendar", "Jira", "Custom RAG") */
  name: string;
  /** Transport type */
  transport: McpTransportType;
  /** URL for HTTP/SSE transports */
  url?: string;
  /** Command + args for stdio transport (local process) */
  command?: string;
  args?: string[];
  /** Environment variables for stdio transport */
  env?: Record<string, string>;
  /** Auto-connect on app startup */
  autoConnect: boolean;
  /** Whether this server is enabled */
  enabled: boolean;
  /** Optional icon emoji for dashboard display */
  icon?: string;
  /** Optional category for grouping in UI */
  category?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

/** Connection status for an MCP server */
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

/** Information about a discovered MCP tool */
export interface McpToolInfo {
  /** Original tool name from MCP server */
  name: string;
  /** Tool description */
  description?: string;
  /** JSON Schema for tool input */
  inputSchema?: Record<string, unknown>;
}

/** Runtime status of an MCP server connection */
export interface McpServerStatus {
  /** Server config id */
  id: string;
  /** Server name */
  name: string;
  /** Connection status */
  status: McpConnectionStatus;
  /** Error message if status === 'error' */
  error?: string;
  /** Discovered tools from this server */
  tools: McpToolInfo[];
  /** Timestamp of last successful connection */
  connectedAt?: number;
  /** Number of tool calls made to this server */
  callCount: number;
  /** Transport type */
  transport: McpTransportType;
  /** Server icon */
  icon?: string;
}

/** Aggregated MCP status pushed to renderer */
export interface McpHubStatus {
  /** All configured servers with their statuses */
  servers: McpServerStatus[];
  /** Total number of available tools across all connected servers */
  totalTools: number;
  /** Total number of connected servers */
  connectedCount: number;
}

/** Category keys for MCP registry grouping */
export type McpCategory =
  | 'Komunikacja'
  | 'Developer'
  | 'Produktywność'
  | 'Web'
  | 'Bazy danych'
  | 'System'
  | 'AI'
  | 'Finanse'
  | 'Bezpieczeństwo'
  | 'Monitoring'
  | 'Dane'
  | 'Media'
  | 'Inne';

/** Entry in the curated MCP server registry (popular servers) */
export interface McpRegistryEntry {
  /** Unique key */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Default URL or command */
  url?: string;
  command?: string;
  args?: string[];
  /** Default environment variables */
  env?: Record<string, string>;
  /** Category for grouping */
  category: McpCategory;
  /** Icon emoji */
  icon: string;
  /** Transport type */
  transport: McpTransportType;
  /** Whether it requires API keys or setup */
  requiresSetup?: boolean;
  /** Link to docs/setup instructions */
  docsUrl?: string;
  /** Searchable tags for discovery */
  tags?: string[];
  /** Featured / recommended server */
  featured?: boolean;
}
