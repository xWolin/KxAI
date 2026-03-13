/**
 * CronExecutor — Cron job execution via AI tool loop.
 *
 * Extracted from AgentLoop. Wraps cron execution with enriched context
 * (memory, calendar, knowledge graph) and delegates to processWithTools.
 */

import { CronJob } from './cron-service';
import { WorkflowService } from './workflow-service';
import { MemoryService } from './memory';
import { CalendarService } from './calendar-service';
import { KnowledgeGraphService } from './knowledge-graph-service';
import { createLogger } from './logger';

const log = createLogger('CronExecutor');

// ─── Types ───

/** Function that processes a message with tool support, returning final response. */
export type ProcessWithToolsFn = (
  userMessage: string,
  extraContext?: string,
  options?: { skipHistory?: boolean; signal?: AbortSignal; mode?: 'chat' | 'heartbeat' | 'cron' },
) => Promise<string>;

// ─── CronExecutor ───

export class CronExecutor {
  private calendarService?: CalendarService;
  private knowledgeGraph?: KnowledgeGraphService;

  constructor(
    private workflow: WorkflowService,
    private memory: MemoryService,
    private processWithTools: ProcessWithToolsFn,
  ) {}

  setCalendarService(cal: CalendarService): void {
    this.calendarService = cal;
  }

  setKnowledgeGraphService(kg: KnowledgeGraphService): void {
    this.knowledgeGraph = kg;
  }

  /**
   * Execute a cron job by sending its action to the AI with enriched context.
   */
  async executeCronJob(job: CronJob): Promise<string> {
    const timeCtx = this.workflow.buildTimeContext();

    // Enrich context
    const [userMd, memoryMd] = await Promise.all([
      this.memory.get('USER.md').catch(() => ''),
      this.memory.get('MEMORY.md').catch(() => ''),
    ]);

    let calendarCtx = '';
    if (this.calendarService && this.calendarService.isConnected()) {
      try {
        const events = this.calendarService.getUpcomingEvents(1440); // next 24h
        if (events.length > 0) {
          calendarCtx = `\n## Nadchodzące wydarzenia (24h):\n${events
            .map(
              (e) =>
                `- ${e.summary} (${new Date(e.start).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })})`,
            )
            .join('\n')}\n`;
        }
      } catch {
        /* ignore */
      }
    }

    let kgCtx = '';
    if (this.knowledgeGraph) {
      try {
        const kgSummary = this.knowledgeGraph.getContextSummary(10);
        if (kgSummary) kgCtx = `\n## Wiedza o użytkowniku (Knowledge Graph):\n${kgSummary}\n`;
      } catch {
        /* ignore */
      }
    }

    const prompt = `[CRON JOB: ${job.name}]\n\nZadanie: ${job.action}\n\n${timeCtx}${calendarCtx}${kgCtx}\n## Kontekst użytkownika:\n${userMd || '(brak)'}\n\n## Pamięć agenta:\n${memoryMd || '(brak)'}\n\nWykonaj to zadanie. Jeśli potrzebujesz użyć narzędzi, użyj ich. Odpowiedz zwięźle.`;

    log.info(`Executing cron job: ${job.name}`);

    try {
      // skipHistory: true — cron prompts must NOT pollute conversation history.
      // mode: 'cron' — tells ContextBuilder to provide relevant prompt modules.
      const result = await this.processWithTools(prompt, undefined, { skipHistory: true, mode: 'cron' });
      return result;
    } catch (error: any) {
      log.error(`Cron job "${job.name}" failed:`, error);
      return `Błąd wykonania cron job: ${error.message}`;
    }
  }
}
