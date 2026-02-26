/**
 * ResponseProcessor — Unified AI response post-processing.
 *
 * Consolidates 4× duplicated post-processing sequences:
 * - Parse cron suggestions (```cron blocks)
 * - Parse take_control requests (```take_control blocks)
 * - Process memory updates (```update_memory blocks)
 * - Check bootstrap completion
 *
 * Also provides response cleaning for conversation history.
 */

import { CronService, CronJob } from './cron-service';
import { MemoryService } from './memory';
import { createLogger } from './logger';
import { CronSuggestionSchema, TakeControlSchema, MemoryUpdateSchema } from '../../shared/schemas/ai-responses';

const log = createLogger('ResponseProcessor');

// ─── Types ───

export type CronSuggestion = Omit<CronJob, 'id' | 'createdAt' | 'runCount'>;

export interface PostProcessResult {
  /** Parsed cron suggestion, if any */
  cronSuggestion: CronSuggestion | null;
  /** Parsed take_control task, if any */
  takeControlTask: string | null;
  /** Whether bootstrap completion was detected */
  bootstrapComplete: boolean;
  /** Number of memory updates applied */
  memoryUpdatesApplied: number;
}

// ─── ResponseProcessor ───

export class ResponseProcessor {
  private pendingCronSuggestions: CronSuggestion[] = [];

  constructor(
    private memory: MemoryService,
    private cron: CronService,
  ) {}

  /**
   * Run full post-processing on an AI response.
   * Parses cron, take_control, memory updates, and bootstrap completion.
   *
   * @param response - The AI response text
   * @param onChunk - Optional UI feedback callback
   */
  async postProcess(response: string, onChunk?: (chunk: string) => void): Promise<PostProcessResult> {
    const result: PostProcessResult = {
      cronSuggestion: null,
      takeControlTask: null,
      bootstrapComplete: false,
      memoryUpdatesApplied: 0,
    };

    // 1. Cron suggestions
    result.cronSuggestion = this.parseCronSuggestion(response);
    if (result.cronSuggestion) {
      this.pendingCronSuggestions.push(result.cronSuggestion);
      onChunk?.('\n\n📋 Zasugerowano nowy cron job (oczekuje na zatwierdzenie) — sprawdź zakładkę Cron Jobs.\n');
    }

    // 2. Take control request
    result.takeControlTask = this.parseTakeControlRequest(response);

    // 3. Memory updates
    result.memoryUpdatesApplied = await this.processMemoryUpdates(response);

    // 4. Bootstrap completion
    if (response.includes('BOOTSTRAP_COMPLETE')) {
      result.bootstrapComplete = true;
      await this.memory.completeBootstrap();
    }

    return result;
  }

  /**
   * Parse cron job suggestion from AI response.
   * Validates with zod schema — logs and returns null on invalid data.
   */
  parseCronSuggestion(response: string): CronSuggestion | null {
    const cronMatch = response.match(/```cron\s*\n([\s\S]*?)\n```/);
    if (!cronMatch) return null;

    try {
      const raw = JSON.parse(cronMatch[1]);
      const parsed = CronSuggestionSchema.safeParse(raw);
      if (!parsed.success) {
        log.warn('Invalid cron suggestion schema:', parsed.error.message);
        return null;
      }
      return {
        name: parsed.data.name,
        schedule: parsed.data.schedule,
        action: parsed.data.action,
        category: parsed.data.category,
        autoCreated: true,
        enabled: true,
      };
    } catch (err) {
      log.warn('Failed to parse cron suggestion JSON:', err);
    }
    return null;
  }

  /**
   * Parse take_control request from AI response.
   * Validates with zod schema — logs and returns null on invalid data.
   */
  parseTakeControlRequest(response: string): string | null {
    const match = response.match(/```take_control\s*\n([\s\S]*?)\n```/);
    if (!match) return null;

    try {
      const raw = JSON.parse(match[1]);
      const parsed = TakeControlSchema.safeParse(raw);
      if (!parsed.success) {
        log.warn('Invalid take_control schema:', parsed.error.message);
        return null;
      }
      return parsed.data.task;
    } catch (err) {
      log.warn('Failed to parse take_control JSON:', err);
    }
    return null;
  }

  /**
   * Parse and apply memory updates from AI response.
   * Supports multiple ```update_memory blocks in one response.
   * Validates each with zod schema — logs and skips invalid entries.
   * Returns the number of updates applied.
   */
  async processMemoryUpdates(response: string): Promise<number> {
    const regex = /```update_memory\s*\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;
    let count = 0;

    while ((match = regex.exec(response)) !== null) {
      try {
        const raw = JSON.parse(match[1]);
        const parsed = MemoryUpdateSchema.safeParse(raw);
        if (!parsed.success) {
          log.warn('Invalid memory update schema:', parsed.error.message);
          continue;
        }

        const fileMap: Record<string, 'SOUL.md' | 'USER.md' | 'MEMORY.md'> = {
          soul: 'SOUL.md',
          user: 'USER.md',
          memory: 'MEMORY.md',
        };

        const file = fileMap[parsed.data.file];
        if (!file) continue;

        await this.memory.updateMemorySection(file, parsed.data.section, parsed.data.content);
        count++;
      } catch (err) {
        log.warn('Failed to parse memory update JSON:', err);
      }
    }

    return count;
  }

  /**
   * Clean AI response for conversation history.
   * Strips tool blocks, tool outputs, and progress indicators.
   */
  cleanForHistory(response: string): string {
    return response
      .replace(/```tool\s*\n[\s\S]*?```/g, '')
      .replace(/```cron\s*\n[\s\S]*?```/g, '')
      .replace(/```take_control\s*\n[\s\S]*?```/g, '')
      .replace(/```update_memory\s*\n[\s\S]*?```/g, '')
      .replace(/\[TOOL OUTPUT[^\]]*\][\s\S]*?\[END TOOL OUTPUT\]/g, '')
      .replace(/⚙️ Wykonuję:.*?\n/g, '')
      .replace(/[✅❌] [^:]+:.*?\n/g, '')
      .trim();
  }

  /**
   * Check if response is a suppress-worthy heartbeat reply.
   */
  isHeartbeatSuppressed(response: string): boolean {
    const normalized = response.trim().replace(/[\s\n]+/g, ' ');
    return normalized === 'HEARTBEAT_OK' || normalized === 'NO_REPLY' || normalized.length < 10;
  }

  // ─── Cron Suggestions Management ───

  getPendingCronSuggestions(): CronSuggestion[] {
    return [...this.pendingCronSuggestions];
  }

  approveCronSuggestion(index: number): CronJob | null {
    if (index < 0 || index >= this.pendingCronSuggestions.length) return null;
    const suggestion = this.pendingCronSuggestions.splice(index, 1)[0];
    return this.cron.addJob(suggestion);
  }

  rejectCronSuggestion(index: number): boolean {
    if (index < 0 || index >= this.pendingCronSuggestions.length) return false;
    this.pendingCronSuggestions.splice(index, 1);
    return true;
  }
}
