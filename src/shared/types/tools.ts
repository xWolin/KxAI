/**
 * Shared tool types — used by both main process and renderer.
 */

export type ToolCategory =
  | 'system'
  | 'web'
  | 'files'
  | 'automation'
  | 'memory'
  | 'cron'
  | 'browser'
  | 'rag'
  | 'coding'
  | 'agent'
  | 'observation'
  | 'mcp'
  | 'calendar'
  | 'privacy';

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}
