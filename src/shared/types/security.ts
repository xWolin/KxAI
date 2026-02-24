/**
 * Shared security types — used by both main process and renderer.
 */

export interface AuditEntry {
  timestamp: number;
  action: string;
  params: Record<string, unknown>;
  source: 'tool' | 'automation' | 'browser' | 'plugin' | 'cron';
  result: 'allowed' | 'blocked' | 'rate-limited';
  reason?: string;
}

export interface SecurityStats {
  totalActions: number;
  blockedActions: number;
  rateLimitedActions: number;
  last24h: { total: number; blocked: number };
}
