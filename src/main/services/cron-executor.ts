/**
 * CronExecutor — Cron job execution via AI tool loop.
 *
 * Extracted from AgentLoop. Smallest module — wraps cron execution
 * with time context and delegates to the main processWithTools pipeline.
 */

import { CronJob } from './cron-service';
import { WorkflowService } from './workflow-service';
import { createLogger } from './logger';

const log = createLogger('CronExecutor');

// ─── Types ───

/** Function that processes a message with tool support, returning final response. */
export type ProcessWithToolsFn = (
  userMessage: string,
  extraContext?: string,
  options?: { skipHistory?: boolean; signal?: AbortSignal },
) => Promise<string>;

// ─── CronExecutor ───

export class CronExecutor {
  constructor(
    private workflow: WorkflowService,
    private processWithTools: ProcessWithToolsFn,
  ) {}

  /**
   * Execute a cron job by sending its action to the AI.
   */
  async executeCronJob(job: CronJob): Promise<string> {
    const timeCtx = this.workflow.buildTimeContext();
    const prompt = `[CRON JOB: ${job.name}]\n\nZadanie: ${job.action}\n\n${timeCtx}\n\nWykonaj to zadanie. Jeśli potrzebujesz użyć narzędzi, użyj ich.`;

    log.info(`Executing cron job: ${job.name}`);

    try {
      const result = await this.processWithTools(prompt);
      return result;
    } catch (error: any) {
      log.error(`Cron job "${job.name}" failed:`, error);
      return `Błąd wykonania cron job: ${error.message}`;
    }
  }
}
