/**
 * Shared agent types — used by both main process and renderer.
 */

/** Agent status for UI feedback */
export interface AgentStatus {
  state: 'idle' | 'thinking' | 'tool-calling' | 'streaming' | 'heartbeat' | 'take-control' | 'sub-agent';
  detail?: string;        // e.g., tool name, sub-agent task
  toolName?: string;
  subAgentCount?: number;
}

export type SubAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed';

export interface SubAgentInfo {
  id: string;
  task: string;
  status: SubAgentStatus;
  startedAt: number;
  iterations: number;
  toolsUsed: string[];
}

export interface SubAgentResult {
  id: string;
  task: string;
  status: SubAgentStatus;
  output: string;
  toolsUsed: string[];
  iterations: number;
  durationMs: number;
  error?: string;
}

export interface BackgroundTaskInfo {
  id: string;
  task: string;
  elapsed: number;
}
