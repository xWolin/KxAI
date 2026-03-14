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

/** Details of a single applied memory update — used for user-visible confirmation */
export interface MemoryUpdateDetail {
  /** Logical file key: 'soul' | 'user' | 'memory' */
  file: string;
  /** The section heading that was updated */
  section: string;
  /** First 80 characters of the saved content for quick preview */
  contentSnippet: string;
}

export interface PostProcessResult {
  /** Parsed cron suggestion, if any */
  cronSuggestion: CronSuggestion | null;
  /** The auto-approved cron job, if any */
  autoApprovedCron: CronJob | null;
  /** Parsed take_control task, if any */
  takeControlTask: string | null;
  /** Whether bootstrap completion was detected */
  bootstrapComplete: boolean;
  /** Number of memory updates applied */
  memoryUpdatesApplied: number;
  /** Details of each applied memory update (file, section, snippet) */
  memoryUpdateDetails: MemoryUpdateDetail[];
}

/** Categories that are safe to auto-approve without user confirmation */
const SAFE_CRON_CATEGORIES = new Set([
  'briefing',
  'reminder',
  'digest',
  'monitoring',
  'review',
  'summary',
  'optimization',
  'research',
]);

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
   * @param options - Optional: { autoApproveCrons: true } to auto-approve safe cron categories from autonomous mode
   */
  async postProcess(
    response: string,
    onChunk?: (chunk: string) => void,
    options?: { autoApproveCrons?: boolean },
  ): Promise<PostProcessResult> {
    const result: PostProcessResult = {
      cronSuggestion: null,
      autoApprovedCron: null,
      takeControlTask: null,
      bootstrapComplete: false,
      memoryUpdatesApplied: 0,
      memoryUpdateDetails: [],
    };

    // 1. Cron suggestions
    result.cronSuggestion = this.parseCronSuggestion(response);
    if (result.cronSuggestion) {
      // Auto-approve safe categories from autonomous/heartbeat mode
      if (options?.autoApproveCrons && this.isSafeCronCategory(result.cronSuggestion.category)) {
        result.autoApprovedCron = this.cron.addJob(result.cronSuggestion);
        log.info(
          `Auto-approved cron job "${result.cronSuggestion.name}" (category: ${result.cronSuggestion.category})`,
        );
        onChunk?.(`\n\n✅ Automatycznie utworzono cron job: "${result.cronSuggestion.name}".\n`);
      } else {
        this.pendingCronSuggestions.push(result.cronSuggestion);
        onChunk?.('\n\n📋 Zasugerowano nowy cron job (oczekuje na zatwierdzenie) — sprawdź zakładkę Cron Jobs.\n');
      }
    }

    // 2. Take control request
    result.takeControlTask = this.parseTakeControlRequest(response);

    // 3. Memory updates
    const memResult = await this.processMemoryUpdates(response);
    result.memoryUpdatesApplied = memResult.count;
    result.memoryUpdateDetails = memResult.details;

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
      // Strip comment lines (# ...) that AI sometimes prepends before the JSON object
      const cleaned = cronMatch[1]
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n')
        .trim();
      let raw = JSON.parse(cleaned);
      // AI sometimes wraps the suggestion in an array — unwrap first element
      if (Array.isArray(raw)) raw = raw[0];
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
   * Returns a count and per-update details for user-visible confirmation.
   */
  async processMemoryUpdates(response: string): Promise<{ count: number; details: MemoryUpdateDetail[] }> {
    const regex = /```update_memory\s*\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;
    let count = 0;
    const details: MemoryUpdateDetail[] = [];

    while ((match = regex.exec(response)) !== null) {
      try {
        // Strip comment/header lines (# or ## ...) that AI sometimes writes before JSON
        const cleaned = match[1]
          .split('\n')
          .filter((line) => !line.trim().startsWith('#'))
          .join('\n')
          .trim();
        let raw = JSON.parse(cleaned);
        // Normalize: AI sometimes sends alternative formats
        raw = this.normalizeMemoryUpdate(raw);
        const parsed = MemoryUpdateSchema.safeParse(raw);
        if (!parsed.success) {
          log.warn('Invalid memory update schema:', parsed.error.message);
          log.warn('Raw data was:', JSON.stringify(raw));
          continue;
        }

        const fileMap: Record<string, 'SOUL.md' | 'USER.md' | 'MEMORY.md'> = {
          soul: 'SOUL.md',
          user: 'USER.md',
          memory: 'MEMORY.md',
        };

        const file = fileMap[parsed.data.file];
        if (!file) continue;

        const ok = await this.memory.updateMemorySection(file, parsed.data.section, parsed.data.content);
        if (ok) {
          log.info(`Memory update: ${file} → ## ${parsed.data.section} (${parsed.data.content.length} chars)`);
          count++;
          details.push({
            file: parsed.data.file,
            section: parsed.data.section,
            contentSnippet: parsed.data.content.slice(0, 80).replace(/\n/g, ' '),
          });
        } else {
          log.warn(`Memory update failed: ${file} → ## ${parsed.data.section} (file missing or empty content?)`);
        }
      } catch (err) {
        log.warn('Failed to parse memory update JSON:', err);
      }
    }

    return { count, details };
  }

  /**
   * Normalize alternative memory update formats to {file, section, content}.
   * Handles:
   * - "SOUL.md" / "SOUL" / "Soul" → "soul"
   * - {user: {name, role, notes}} → {file:"user", section:"Profil", content:"..."}
   * - Arrays → unwrap first element
   */
  private normalizeMemoryUpdate(raw: unknown): unknown {
    if (Array.isArray(raw)) raw = raw[0];
    if (!raw || typeof raw !== 'object') return raw;

    const obj = raw as Record<string, unknown>;

    // Standard format — just normalize file field
    if ('file' in obj && typeof obj.file === 'string') {
      obj.file = obj.file.toLowerCase().replace(/\.md$/, '');
      return obj;
    }

    // Alternative format: {user: {...}} or {memory: {...}} or {soul: {...}}
    const fileNames = ['soul', 'user', 'memory'];
    for (const fname of fileNames) {
      if (fname in obj && typeof obj[fname] === 'object' && obj[fname] !== null) {
        const data = obj[fname] as Record<string, unknown>;
        // Convert the structured data to content string
        const lines: string[] = [];
        for (const [key, value] of Object.entries(data)) {
          if (Array.isArray(value)) {
            lines.push(`**${key}**: ${value.join(', ')}`);
          } else if (typeof value === 'object' && value !== null) {
            lines.push(`**${key}**: ${JSON.stringify(value)}`);
          } else {
            lines.push(`**${key}**: ${value}`);
          }
        }
        return {
          file: fname,
          section: data.name ? String(data.name) : 'Info',
          content: lines.join('\n'),
        };
      }
    }

    return raw;
  }

  /**
   * Clean AI response for conversation history.
   * Strips tool blocks, tool outputs, bare JSON tool calls, and progress indicators.
   */
  cleanForHistory(response: string): string {
    let cleaned = response
      .replace(/```tool\s*\n[\s\S]*?```/g, '')
      .replace(/```cron\s*\n[\s\S]*?```/g, '')
      .replace(/```take_control\s*\n[\s\S]*?```/g, '')
      .replace(/```update_memory\s*\n[\s\S]*?```/g, '')
      .replace(/\[TOOL OUTPUT[^\]]*\][\s\S]*?\[END TOOL OUTPUT\]/g, '')
      .replace(/⚙️ Wykonuję:.*?\n/g, '')
      .replace(/[✅❌] [^:]+:.*?\n/g, '');
    // Strip bare JSON tool calls with proper brace matching (handles nested params)
    cleaned = this.stripBareToolCalls(cleaned);
    return cleaned.trim();
  }

  /**
   * Remove bare {"tool":"...","params":{...}} JSON from text using brace matching.
   */
  private stripBareToolCalls(text: string): string {
    const toolPattern = /\{"tool"\s*:\s*"/g;
    let result = '';
    let lastIndex = 0;
    let match;

    while ((match = toolPattern.exec(text)) !== null) {
      let depth = 0;
      let i = match.index;
      let balanced = false;
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) {
            balanced = true;
            break;
          }
        }
      }
      if (balanced) {
        const candidate = text.substring(match.index, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed.tool && typeof parsed.tool === 'string') {
            result += text.substring(lastIndex, match.index);
            lastIndex = i + 1;
            toolPattern.lastIndex = i + 1;
            continue;
          }
        } catch {
          /* not valid JSON — skip */
        }
      }
    }

    result += text.substring(lastIndex);
    return result;
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

  /** Check if a cron category is safe to auto-approve */
  private isSafeCronCategory(category?: string): boolean {
    if (!category) return false;
    return SAFE_CRON_CATEGORIES.has(category.toLowerCase());
  }
}
