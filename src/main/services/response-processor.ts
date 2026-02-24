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
  async postProcess(
    response: string,
    onChunk?: (chunk: string) => void,
  ): Promise<PostProcessResult> {
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
   */
  parseCronSuggestion(response: string): CronSuggestion | null {
    const cronMatch = response.match(/```cron\s*\n([\s\S]*?)\n```/);
    if (!cronMatch) return null;

    try {
      const parsed = JSON.parse(cronMatch[1]);
      if (parsed.name && parsed.schedule && parsed.action) {
        return {
          name: parsed.name,
          schedule: parsed.schedule,
          action: parsed.action,
          category: parsed.category || 'custom',
          autoCreated: true,
          enabled: true,
        };
      }
    } catch { /* invalid JSON */ }
    return null;
  }

  /**
   * Parse take_control request from AI response.
   */
  parseTakeControlRequest(response: string): string | null {
    const match = response.match(/```take_control\s*\n([\s\S]*?)\n```/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.task && typeof parsed.task === 'string') {
        return parsed.task.slice(0, 500);
      }
    } catch { /* invalid JSON */ }
    return null;
  }

  /**
   * Parse and apply memory updates from AI response.
   * Supports multiple ```update_memory blocks in one response.
   * Returns the number of updates applied.
   */
  async processMemoryUpdates(response: string): Promise<number> {
    const regex = /```update_memory\s*\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;
    let count = 0;

    while ((match = regex.exec(response)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (typeof parsed.file !== 'string') continue;

        const fileMap: Record<string, 'SOUL.md' | 'USER.md' | 'MEMORY.md'> = {
          soul: 'SOUL.md',
          user: 'USER.md',
          memory: 'MEMORY.md',
        };

        const file = fileMap[parsed.file.toLowerCase()];
        if (!file || !parsed.section || !parsed.content) continue;

        const content = String(parsed.content).slice(0, 2000);
        const section = String(parsed.section).slice(0, 100);

        await this.memory.updateMemorySection(file, section, content);
        count++;
      } catch { /* invalid JSON, skip */ }
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
