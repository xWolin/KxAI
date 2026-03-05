/**
 * Shared security types — used by both main process and renderer.
 */

export interface AuditEntry {
  timestamp: number;
  action: string;
  params: Record<string, unknown>;
  source: 'tool' | 'automation' | 'browser' | 'plugin' | 'cron' | 'cortex';
  result: 'allowed' | 'blocked' | 'rate-limited' | 'warned' | 'confirmed' | 'denied';
  reason?: string;
}

export interface SecurityStats {
  totalActions: number;
  blockedActions: number;
  rateLimitedActions: number;
  last24h: { total: number; blocked: number };
}

// ─── Action Policy (3-level risk classification) ───

/** Three-level risk classification for tool actions */
export type ActionRisk = 'safe' | 'moderate' | 'dangerous';

/** Result of assessing risk for a tool call */
export interface ActionPolicyDecision {
  risk: ActionRisk;
  requiresApproval: boolean;
  reason?: string;
}

/** Request sent to renderer for user approval */
export interface ActionApprovalRequest {
  requestId: string;
  toolName: string;
  params: Record<string, unknown>;
  risk: ActionRisk;
  reason: string;
  timestamp: number;
}

/** User's response to an approval request */
export interface ActionApprovalResponse {
  requestId: string;
  approved: boolean;
  /** If true, auto-approve this tool in the future */
  alwaysApprove?: boolean;
  /** Modified params if user edited them before approving */
  modifiedParams?: Record<string, unknown>;
}
