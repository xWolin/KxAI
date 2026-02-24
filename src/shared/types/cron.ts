/**
 * Shared cron job types — used by both main process and renderer.
 */

export interface CronJob {
  id: string;
  name: string;
  /** Cron expression (5-field: min hour dom month dow) or interval keyword */
  schedule: string;
  /** What the agent should do */
  action: string;
  /** Whether the agent created this itself vs user-created */
  autoCreated: boolean;
  enabled: boolean;
  /** Category: routine, workflow, reminder, cleanup, health-check */
  category: 'routine' | 'workflow' | 'reminder' | 'cleanup' | 'health-check' | 'custom';
  createdAt: number;
  lastRun?: number;
  lastResult?: string;
  runCount: number;
}

export interface CronExecution {
  jobId: string;
  timestamp: number;
  result: string;
  success: boolean;
}
