/**
 * ContextBuilder — Intelligent context assembly for AI system prompts.
 *
 * Extracted from AgentLoop to provide a dedicated module for:
 * - Building tiered system prompts (identity → reasoning → guardrails → capabilities → dynamic → tools)
 * - Context compaction (AI-powered summarization when context exceeds threshold)
 * - Memory flush (pre-compaction memory save)
 * - Token usage tracking
 *
 * Handles 10+ dynamic context sources: memory, workflow, cron, RAG, screen monitor,
 * system monitor, sub-agents, background tasks, active hours, automation state.
 */

import { MemoryService } from './memory';
import { WorkflowService } from './workflow-service';
import { ConfigService } from './config';
import { CronService } from './cron-service';
import { RAGService } from './rag-service';
import { ToolsService } from './tools-service';
import { AIService } from './ai-service';
import { SystemMonitor } from './system-monitor';
import { PromptService } from './prompt-service';
import { SubAgentManager } from './sub-agent';
import { createLogger } from './logger';

const log = createLogger('ContextBuilder');

// ─── Types ───

export interface BackgroundTaskInfo {
  id: string;
  task: string;
  elapsed: number;
}

export interface ContextBuildDeps {
  memory: MemoryService;
  workflow: WorkflowService;
  config: ConfigService;
  cron: CronService;
  tools: ToolsService;
  ai: AIService;
  systemMonitor: SystemMonitor;
  promptService: PromptService;
  subAgentManager: SubAgentManager;
  rag?: RAGService;
  automation?: { enabled: boolean };
  screenMonitor?: {
    isRunning(): boolean;
    buildMonitorContext(): string;
  };
}

// ─── ContextBuilder ───

export class ContextBuilder {
  private memory: MemoryService;
  private workflow: WorkflowService;
  private config: ConfigService;
  private cron: CronService;
  private tools: ToolsService;
  private ai: AIService;
  private systemMonitor: SystemMonitor;
  private promptService: PromptService;
  private subAgentManager: SubAgentManager;
  private rag?: RAGService;
  private automationEnabled = false;
  private screenMonitor?: ContextBuildDeps['screenMonitor'];

  /** Track if memory flush was done this compaction cycle */
  private memoryFlushDone = false;

  /** Approximate token usage in current session */
  private totalSessionTokens = 0;

  /** Active hours — heartbeat context display only */
  private activeHours: { start: number; end: number } | null = null;

  /** Background tasks — for context injection */
  private backgroundTasksProvider?: () => BackgroundTaskInfo[];

  constructor(deps: ContextBuildDeps) {
    this.memory = deps.memory;
    this.workflow = deps.workflow;
    this.config = deps.config;
    this.cron = deps.cron;
    this.tools = deps.tools;
    this.ai = deps.ai;
    this.systemMonitor = deps.systemMonitor;
    this.promptService = deps.promptService;
    this.subAgentManager = deps.subAgentManager;
    this.rag = deps.rag;
    this.automationEnabled = !!deps.automation;
    this.screenMonitor = deps.screenMonitor;
  }

  // ─── Setters for optional/late-bound dependencies ───

  setRAGService(rag: RAGService): void {
    this.rag = rag;
  }

  setAutomationEnabled(enabled: boolean): void {
    this.automationEnabled = enabled;
  }

  setScreenMonitor(monitor: ContextBuildDeps['screenMonitor']): void {
    this.screenMonitor = monitor;
  }

  setActiveHours(hours: { start: number; end: number } | null): void {
    this.activeHours = hours;
  }

  setBackgroundTasksProvider(provider: () => BackgroundTaskInfo[]): void {
    this.backgroundTasksProvider = provider;
  }

  // ─── Session state ───

  /**
   * Reset session-level state (call when conversation history is cleared).
   */
  resetSessionState(): void {
    this.memoryFlushDone = false;
    this.totalSessionTokens = 0;
  }

  addTokens(count: number): void {
    this.totalSessionTokens += count;
  }

  getTokenUsage(): number {
    return this.totalSessionTokens;
  }

  // ─── Memory Flush ───

  /**
   * Memory flush — ask AI to save important memories before context compaction.
   * Only runs once per compaction cycle.
   *
   * @param processMemoryUpdates - callback to process ```update_memory blocks from AI response
   */
  async maybeRunMemoryFlush(processMemoryUpdates: (response: string) => Promise<void>): Promise<void> {
    if (this.memoryFlushDone) return;

    const history = this.memory.getConversationHistory();
    const historyTokens = history.reduce((sum, m) => sum + Math.ceil(m.content.length / 3.5), 0);

    // Flush threshold — ~60% of compaction threshold
    const FLUSH_THRESHOLD = 50000;
    if (historyTokens < FLUSH_THRESHOLD || history.length < 20) return;

    this.memoryFlushDone = true;
    log.info(`Running memory flush (${historyTokens} tokens, ${history.length} messages)`);

    try {
      const response = await this.ai.sendMessage(
        '[MEMORY FLUSH — Pre-kompakcja]\n\n' +
        'Sesja zbliża się do limitu kontekstu. Zapisz trwałe wspomnienia do pamięci.\n' +
        'Użyj bloków ```update_memory aby zapisać ważne informacje z tej rozmowy:\n' +
        '- Nowe fakty o użytkowniku\n' +
        '- Ważne decyzje\n' +
        '- Kontekst który powinien przetrwać reset kontekstu\n\n' +
        'Jeśli nie ma nic do zapisania, odpowiedz "NO_REPLY".'
      );

      if (response.trim() !== 'NO_REPLY') {
        await processMemoryUpdates(response);
      }
    } catch (err) {
      log.error('Memory flush error:', err);
      this.memoryFlushDone = false; // Retry next cycle
    }
  }

  // ─── Context Compaction ───

  /**
   * Context compaction — AI-powered summarization of old messages.
   * When context exceeds threshold, older messages are summarized and replaced.
   */
  async maybeCompactContext(): Promise<void> {
    const history = this.memory.getConversationHistory();
    const historyTokens = history.reduce((sum, m) => sum + Math.ceil(m.content.length / 3.5), 0);

    const COMPACT_THRESHOLD = 80000;
    const MIN_MESSAGES = 40;
    const KEEP_RECENT = 20;

    if (historyTokens < COMPACT_THRESHOLD || history.length < MIN_MESSAGES) return;

    const messagesToSummarize = history.slice(0, -KEEP_RECENT);
    if (messagesToSummarize.length < 5) return;

    log.info(`Summarizing ${messagesToSummarize.length} messages (${historyTokens} tokens total)`);

    try {
      const conversationText = messagesToSummarize
        .map(m => `${m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System'}: ${m.content.slice(0, 2000)}`)
        .join('\n---\n');

      const summary = await this.ai.sendMessage(
        `[CONTEXT COMPACTION]\n\n` +
        `Podsumuj tę rozmowę w 500-1500 słów. Zachowaj WSZYSTKIE istotne detale:\n` +
        `- Kluczowe decyzje i ustalenia\n` +
        `- Wyniki narzędzi i ich kontekst\n` +
        `- Preferencje wyrażone przez użytkownika\n` +
        `- Aktualne zadania w toku\n` +
        `- Komendy i wyniki narzędzi\n` +
        `- Pliki nad którymi pracowano\n\n` +
        `Rozmowa do podsumowania:\n${conversationText.slice(0, 50000)}`,
        undefined,
        undefined,
        { skipHistory: true }
      );

      if (summary && summary.length > 50) {
        this.memory.compactHistory(KEEP_RECENT, `[Podsumowanie wcześniejszej rozmowy]\n${summary}`);
        log.info(`Compacted ${messagesToSummarize.length} messages → summary (${summary.length} chars)`);
      }
    } catch (err) {
      log.error('Context compaction error:', err);
    }
  }

  // ─── Enhanced Context Builder ───

  /**
   * Build the full enhanced system context with tools + time + workflow + RAG + cron + screen + system.
   *
   * Tiered structure:
   * 1. Identity (SOUL.md, USER.md, MEMORY.md)
   * 2. Reasoning & Safety (REASONING.md, GUARDRAILS.md)
   * 3. Capabilities (AGENTS.md, RESOURCEFUL.md)
   * 4. Dynamic Context (time, cron, RAG, screen, system, tasks)
   * 5. Tools (format instructions, tool list)
   */
  async buildEnhancedContext(): Promise<string> {
    const baseCtx = await this.memory.buildSystemContext();
    const timeCtx = this.workflow.buildTimeContext();

    // Native FC: tools are passed via API parameters, skip tool list in prompt
    const useNativeFC = this.config.get('useNativeFunctionCalling') ?? true;
    const toolsPrompt = useNativeFC ? '' : this.tools.getToolsPrompt(['automation']);

    // Bootstrap ritual — first conversation detection
    let bootstrapCtx = '';
    if (await this.memory.isBootstrapPending()) {
      const bootstrapMd = await this.memory.get('BOOTSTRAP.md');
      if (bootstrapMd) {
        bootstrapCtx = `\n## 🚀 BOOTSTRAP — Pierwsze Uruchomienie\n${bootstrapMd}\n\nWAŻNE: To jest twoje PIERWSZE uruchomienie. Postępuj zgodnie z BOOTSTRAP.md.\nKiedy skończysz rytuał, odpowiedz "BOOTSTRAP_COMPLETE" na końcu wiadomości.\n`;
      }
    }

    // Cron jobs context
    const cronJobs = this.cron.getJobs();
    let cronCtx = '';
    if (cronJobs.length > 0) {
      const lines = cronJobs.map((j) =>
        `- [${j.enabled ? '✓' : '✗'}] "${j.name}" — ${j.schedule} — ${j.action.slice(0, 80)}`
      );
      cronCtx = `\n## Cron Jobs\n${lines.join('\n')}\n`;
    }

    // RAG stats
    const ragStats = this.rag ? this.rag.getStats() : null;
    const ragCtx = ragStats
      ? `\n## RAG Status\nZaindeksowane: ${ragStats.totalChunks} chunków z ${ragStats.totalFiles} plików | Embeddingi: ${ragStats.embeddingType === 'openai' ? 'OpenAI' : 'TF-IDF fallback'}\n`
      : '';

    // Desktop automation availability
    const automationCtx = this.automationEnabled
      ? `\n## Desktop Automation\nMasz możliwość przejęcia sterowania pulpitem użytkownika (myszka + klawiatura) w trybie autonomicznym.\nAby to zrobić, MUSISZ użyć bloku \`\`\`take_control (patrz instrukcje niżej).\nNIE próbuj sterować komputerem za pomocą narzędzi (mouse_click, keyboard_type itp.) w normalnym czacie — one działają TYLKO w trybie take_control.\n`
      : '';

    // Load instructions from markdown prompt files
    const agentsCapabilities = this.promptService.load('AGENTS.md');
    const reasoningPrompt = this.promptService.load('REASONING.md');
    const guardrailsPrompt = this.promptService.load('GUARDRAILS.md');
    const resourcefulPrompt = this.promptService.load('RESOURCEFUL.md');
    const toolsInstructions = this.promptService.load('TOOLS.md');

    // System health warnings
    let systemCtx = '';
    try {
      const warnings = await this.systemMonitor.getWarnings();
      if (warnings.length > 0) {
        systemCtx = `\n## ⚠️ System Warnings\n${warnings.join('\n')}\n`;
      }
      const statusSummary = await this.systemMonitor.getStatusSummary();
      systemCtx += `\n## System Status\n${statusSummary}\n`;
    } catch { /* non-critical */ }

    // Screen monitor context
    const monitorCtx = this.screenMonitor?.isRunning()
      ? this.screenMonitor.buildMonitorContext()
      : '';

    // Sub-agent context
    const subAgentCtx = this.subAgentManager.buildSubAgentContext();

    // Background tasks context
    let bgCtx = '';
    if (this.backgroundTasksProvider) {
      const bgTasks = this.backgroundTasksProvider();
      if (bgTasks.length > 0) {
        const lines = bgTasks.map(t =>
          `- [${t.id}] "${t.task.slice(0, 80)}" — od ${Math.round(t.elapsed / 1000)}s`
        );
        bgCtx = `\n## ⏳ Zadania w tle\n${lines.join('\n')}\n`;
      }
    }

    // Active hours info
    let activeHoursCtx = '';
    if (this.activeHours) {
      activeHoursCtx = `\n## ⏰ Godziny aktywności\nHeartbeat aktywny: ${this.activeHours.start}:00-${this.activeHours.end}:00\n`;
    }

    // Memory & cron nudge — reminds agent to populate empty memory/cron
    let memoryCronNudge = '';
    try {
      const memContent = await this.memory.get('MEMORY.md') || '';
      const memIsEmpty = memContent.includes('(Uzupełnia się automatycznie') || memContent.includes('(Bieżące obserwacje') || memContent.trim().length < 200;
      const hasCrons = cronJobs.length > 0;

      const nudges: string[] = [];
      if (memIsEmpty) {
        nudges.push('⚠️ MEMORY.md jest PUSTY! Zapisuj obserwacje o użytkowniku po każdej rozmowie za pomocą bloków ```update_memory.');
      }
      if (!hasCrons) {
        nudges.push('⚠️ Nie masz żadnych cron jobów! Zasugeruj przydatne zadania cykliczne (poranny briefing, przypomnienie o przerwie, podsumowanie dnia) za pomocą bloków ```cron.');
      }
      if (nudges.length > 0) {
        memoryCronNudge = '\n## 🔔 Przypomnienie\n' + nudges.join('\n') + '\n';
      }
    } catch { /* non-critical */ }

    // Assemble final context — tiered priority
    return [
      // === TIER 1: Identity ===
      baseCtx,
      '\n',
      // === TIER 2: Reasoning & Safety ===
      reasoningPrompt,
      '\n',
      guardrailsPrompt,
      '\n',
      // === TIER 3: Capabilities ===
      agentsCapabilities,
      '\n',
      resourcefulPrompt,
      '\n',
      // === TIER 4: Dynamic Context ===
      timeCtx,
      bootstrapCtx,
      cronCtx,
      ragCtx,
      automationCtx,
      monitorCtx,
      subAgentCtx,
      bgCtx,
      activeHoursCtx,
      systemCtx,
      memoryCronNudge,
      '\n',
      // === TIER 5: Tools (detailed, longest section) ===
      toolsPrompt,
      '\n',
      toolsInstructions,
    ].join('\n');
  }
}
