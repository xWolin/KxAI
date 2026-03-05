/**
 * CronExecutor — Cron job execution via AI tool loop.
 *
 * Extracted from AgentLoop. Wraps cron execution with enriched context
 * (memory, calendar, knowledge graph) and delegates to processWithTools.
 */

import { CronJob } from './cron-service';
import { WorkflowService } from './workflow-service';
import type { MemoryService } from './memory';
import type { KnowledgeGraphService } from './knowledge-graph-service';
import { createLogger } from './logger';

const log = createLogger('CronExecutor');

// CalendarService imported as type to avoid circular deps
type CalendarServiceLike = {
  getUpcomingEvents(minutesAhead?: number): Array<{ start: string | Date; summary: string }>;
  isConnected(): boolean;
};

// ─── Types ───

/** Function that processes a message with tool support, returning final response. */
export type ProcessWithToolsFn = (
  userMessage: string,
  extraContext?: string,
  options?: { skipHistory?: boolean; signal?: AbortSignal },
) => Promise<string>;

// ─── CronExecutor ───

export class CronExecutor {
  private memory?: MemoryService;
  private calendar?: CalendarServiceLike;
  private knowledgeGraph?: KnowledgeGraphService;

  constructor(
    private workflow: WorkflowService,
    private processWithTools: ProcessWithToolsFn,
  ) {}

  setMemoryService(memory: MemoryService): void {
    this.memory = memory;
  }

  setCalendarService(calendar: CalendarServiceLike): void {
    this.calendar = calendar;
  }

  setKnowledgeGraphService(kg: KnowledgeGraphService): void {
    this.knowledgeGraph = kg;
  }

  /**
   * Build enriched context from memory, calendar, and knowledge graph.
   */
  private async buildEnrichedContext(): Promise<string> {
    const parts: string[] = [];

    // Memory context (USER.md, MEMORY.md)
    if (this.memory) {
      try {
        const userMd = await this.memory.get('USER.md');
        if (userMd) parts.push(`## O użytkowniku\n${userMd.slice(0, 500)}`);
        const memoryMd = await this.memory.get('MEMORY.md');
        if (memoryMd) parts.push(`## Notatki\n${memoryMd.slice(0, 500)}`);
      } catch (err) {
        log.warn('Failed to load memory for cron context:', err);
      }
    }

    // Calendar context
    if (this.calendar) {
      try {
        if (this.calendar.isConnected()) {
          const upcoming = this.calendar.getUpcomingEvents(60);
          if (upcoming.length > 0) {
            const events = upcoming
              .slice(0, 5)
              .map((e) => {
                const time = new Date(e.start).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
                return `• ${time} — ${e.summary}`;
              })
              .join('\n');
            parts.push(`## Nadchodzące wydarzenia\n${events}`);
          }
        }
      } catch (err) {
        log.warn('Failed to load calendar for cron context:', err);
      }
    }

    // Knowledge Graph context
    if (this.knowledgeGraph) {
      try {
        const kgSummary = this.knowledgeGraph.getContextSummary(10);
        if (kgSummary) parts.push(`## Wiedza o użytkowniku\n${kgSummary}`);
      } catch (err) {
        log.warn('Failed to load KG for cron context:', err);
      }
    }

    return parts.length > 0 ? `\n\n--- Kontekst ---\n${parts.join('\n\n')}` : '';
  }

  /**
   * Execute a cron job by sending its action to the AI with enriched context.
   */
  async executeCronJob(job: CronJob): Promise<string> {
    const timeCtx = this.workflow.buildTimeContext();
    const enrichedContext = await this.buildEnrichedContext();
    const prompt = `[CRON JOB: ${job.name}]\n\nZadanie: ${job.action}\n\n${timeCtx}${enrichedContext}\n\nWykonaj to zadanie. Jeśli potrzebujesz użyć narzędzi, użyj ich.`;

    log.info(`Executing cron job: ${job.name}`);

    try {
      // skipHistory: true — cron prompts must NOT pollute conversation history.
      // The AI response is returned to CronService for logging, but never shown
      // as a user message in chat. Notifications go through send_notification tool.
      const result = await this.processWithTools(prompt, undefined, { skipHistory: true });
      return result;
    } catch (error: any) {
      log.error(`Cron job "${job.name}" failed:`, error);
      return `Błąd wykonania cron job: ${error.message}`;
    }
  }
}
