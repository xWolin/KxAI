/**
 * ContextBuilder — Intelligent context assembly for AI system prompts.
 *
 * Extracted from AgentLoop to provide a dedicated module for:
 * - Building tiered system prompts (identity → reasoning → guardrails → capabilities → dynamic → tools)
 * - Conditional module loading based on intent/mode (OpenClaw 2.0 pattern)
 * - Structured context output (stable vs dynamic) for prompt caching
 * - Token budget enforcement for system prompt
 * - Context compaction (AI-powered summarization when context exceeds threshold)
 * - Memory flush (pre-compaction memory save)
 *
 * Architecture (5 tiers, conditionally loaded):
 * 1. Identity — SOUL.md, USER.md, MEMORY.md (always loaded, memory may be selective)
 * 2. Reasoning & Safety — REASONING.md, GUARDRAILS.md (always loaded)
 * 3. Capabilities — AGENTS.md, RESOURCEFUL.md (conditional on mode)
 * 4. Dynamic Context — time, cron, RAG, screen, system, tasks (conditional)
 * 5. Tools — TOOLS.md, tool format instructions (conditional on FC mode)
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
import { ContextManager } from './context-manager';
import { createLogger } from './logger';
import type { IntentType } from './intent-detector';

const log = createLogger('ContextBuilder');

// ─── Types ───

export interface BackgroundTaskInfo {
  id: string;
  task: string;
  elapsed: number;
}

/**
 * Hint for conditional context assembly.
 * Tells ContextBuilder what mode the agent is in and what the user wants,
 * so it can load only the relevant prompt modules.
 */
export interface ContextHint {
  /** Detected user intent from IntentDetector */
  intent?: IntentType;
  /** Current operating mode */
  mode?: 'chat' | 'heartbeat' | 'take_control' | 'cron' | 'sub_agent' | 'vision';
  /** User message — used for selective memory recall */
  userMessage?: string;
}

/**
 * Structured context output — separates stable (cacheable) from dynamic content.
 * Enables Anthropic prompt caching on the stable portion.
 */
export interface StructuredContext {
  /** Stable content that changes rarely — identity, reasoning, guardrails, capabilities.
   *  Suitable for Anthropic prompt caching (cache_control: ephemeral). */
  stable: string;
  /** Dynamic content that changes every turn — time, cron, system state, screen monitor. */
  dynamic: string;
  /** Full context (stable + dynamic) for providers without prompt caching. */
  full: string;
  /** Estimated token count of the full context. */
  estimatedTokens: number;
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

  /** Cached stable context — invalidated when memory or prompts change */
  private stableContextCache: { content: string; hash: number; timestamp: number } | null = null;
  private static readonly STABLE_CACHE_TTL_MS = 30_000; // 30s — prompts/memory rarely change mid-conversation

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
    this.stableContextCache = null;
  }

  addTokens(count: number): void {
    this.totalSessionTokens += count;
  }

  getTokenUsage(): number {
    return this.totalSessionTokens;
  }

  /** Invalidate stable context cache (call when memory or prompts change). */
  invalidateCache(): void {
    this.stableContextCache = null;
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

  // ─── Conditional Module Resolution ───

  /**
   * Determine which prompt modules to load based on mode and intent.
   * This implements the OpenClaw 2.0 "dynamic assembly" pattern —
   * only relevant modules are included in the system prompt.
   */
  private resolveModules(hint?: ContextHint): {
    loadAgents: boolean;
    loadReasoning: boolean;
    loadGuardrails: boolean;
    loadResourceful: boolean;
    loadToolsInstructions: boolean;
    loadBootstrap: boolean;
    loadAutomation: boolean;
    loadScreenMonitor: boolean;
    loadSystemHealth: boolean;
    loadCronContext: boolean;
    loadMemoryNudge: boolean;
    loadActiveHours: boolean;
    loadBackgroundTasks: boolean;
    loadSubAgents: boolean;
    loadRagStats: boolean;
  } {
    const mode = hint?.mode ?? 'chat';

    // Default: load everything (safest for chat)
    const modules = {
      loadAgents: true,
      loadReasoning: true,
      loadGuardrails: true,
      loadResourceful: true,
      loadToolsInstructions: true,
      loadBootstrap: true,
      loadAutomation: true,
      loadScreenMonitor: true,
      loadSystemHealth: true,
      loadCronContext: true,
      loadMemoryNudge: true,
      loadActiveHours: false,
      loadBackgroundTasks: true,
      loadSubAgents: true,
      loadRagStats: true,
    };

    switch (mode) {
      case 'heartbeat':
        // Heartbeat is lightweight — skip heavy capability docs
        modules.loadAgents = false;
        modules.loadToolsInstructions = false;
        modules.loadBootstrap = false;
        modules.loadMemoryNudge = false;
        modules.loadActiveHours = true;
        break;

      case 'cron':
        // Cron execution needs tools but not full capability docs
        modules.loadAgents = false;
        modules.loadBootstrap = false;
        modules.loadScreenMonitor = false;
        modules.loadMemoryNudge = false;
        modules.loadActiveHours = false;
        break;

      case 'sub_agent':
        // Sub-agents are focused — minimal context
        modules.loadBootstrap = false;
        modules.loadScreenMonitor = false;
        modules.loadMemoryNudge = false;
        modules.loadActiveHours = false;
        modules.loadSystemHealth = false;
        break;

      case 'vision':
        // Vision/screenshot mode — include screen but skip agents
        modules.loadAgents = false;
        modules.loadBootstrap = false;
        modules.loadActiveHours = false;
        break;

      case 'take_control':
        // Take control — full context needed
        modules.loadBootstrap = false;
        modules.loadActiveHours = false;
        break;

      case 'chat':
      default:
        // Full chat — load everything
        break;
    }

    return modules;
  }

  // ─── Structured Context Builder ───

  /**
   * Build structured context with separate stable and dynamic parts.
   * The stable part is suitable for Anthropic prompt caching.
   *
   * @param hint - Controls which modules to load (conditional assembly)
   * @returns StructuredContext with stable, dynamic, and full fields
   */
  async buildStructuredContext(hint?: ContextHint): Promise<StructuredContext> {
    const modules = this.resolveModules(hint);

    // ── STABLE PART (changes rarely — identity, reasoning, capabilities) ──
    const stable = await this.buildStableContext(modules, hint);

    // ── DYNAMIC PART (changes every turn — time, cron, system state) ──
    const dynamic = await this.buildDynamicContext(modules);

    const full = stable + '\n' + dynamic;
    const estimatedTokens = ContextManager.prototype.estimateTokens.call(
      { config: {} }, full
    );

    // Token budget enforcement — warn if system prompt is too large
    const model = this.config.get('aiModel') || 'gpt-5';
    const modelLimit = ContextManager.getModelContextLimit(model);
    const budgetRatio = estimatedTokens / modelLimit;

    if (budgetRatio > 0.25) {
      log.warn(
        `System prompt uses ${Math.round(budgetRatio * 100)}% of model context ` +
        `(${estimatedTokens} tokens / ${modelLimit} limit). Consider reducing context.`
      );
    }

    return { stable, dynamic, full, estimatedTokens };
  }

  /**
   * Build the stable portion of the context — identity, reasoning, capabilities.
   * This content changes rarely and is suitable for prompt caching.
   */
  private async buildStableContext(
    modules: ReturnType<typeof this.resolveModules>,
    hint?: ContextHint,
  ): Promise<string> {
    // Check cache first
    const now = Date.now();
    if (
      this.stableContextCache &&
      now - this.stableContextCache.timestamp < ContextBuilder.STABLE_CACHE_TTL_MS
    ) {
      return this.stableContextCache.content;
    }

    // === TIER 1: Identity (always loaded) ===
    const baseCtx = await this.buildMemoryContext(hint);

    // === TIER 2: Reasoning & Safety ===
    const parts: string[] = [baseCtx, '\n'];

    if (modules.loadReasoning) {
      const reasoningPrompt = await this.promptService.load('REASONING.md');
      if (reasoningPrompt) parts.push(reasoningPrompt, '\n');
    }

    if (modules.loadGuardrails) {
      const guardrailsPrompt = await this.promptService.load('GUARDRAILS.md');
      if (guardrailsPrompt) parts.push(guardrailsPrompt, '\n');
    }

    // === TIER 3: Capabilities ===
    if (modules.loadAgents) {
      const agentsCapabilities = await this.promptService.load('AGENTS.md');
      if (agentsCapabilities) parts.push(agentsCapabilities, '\n');
    }

    if (modules.loadResourceful) {
      const resourcefulPrompt = await this.promptService.load('RESOURCEFUL.md');
      if (resourcefulPrompt) parts.push(resourcefulPrompt, '\n');
    }

    // === TIER 5: Tool instructions (stable — tool docs don't change mid-conversation) ===
    if (modules.loadToolsInstructions) {
      const toolsInstructions = await this.promptService.load('TOOLS.md');
      if (toolsInstructions) parts.push(toolsInstructions, '\n');
    }

    const content = parts.join('\n');

    // Cache the stable context
    this.stableContextCache = {
      content,
      hash: this.simpleHash(content),
      timestamp: now,
    };

    return content;
  }

  /**
   * Build the dynamic portion of the context — changes every turn.
   * Not suitable for prompt caching.
   */
  private async buildDynamicContext(
    modules: ReturnType<typeof this.resolveModules>,
  ): Promise<string> {
    const parts: string[] = [];

    // Time context (always — cheap and useful)
    parts.push(this.workflow.buildTimeContext());

    // Native FC: tools are passed via API parameters, skip tool list in prompt
    const useNativeFC = this.config.get('useNativeFunctionCalling') ?? true;
    if (!useNativeFC) {
      const toolsPrompt = this.tools.getToolsPrompt(['automation']);
      if (toolsPrompt) parts.push(toolsPrompt);
    }

    // Bootstrap ritual
    if (modules.loadBootstrap) {
      const bootstrapCtx = await this.buildBootstrapContext();
      if (bootstrapCtx) parts.push(bootstrapCtx);
    }

    // Cron jobs context
    if (modules.loadCronContext) {
      const cronCtx = this.buildCronContext();
      if (cronCtx) parts.push(cronCtx);
    }

    // RAG stats
    if (modules.loadRagStats) {
      const ragCtx = this.buildRagStatsContext();
      if (ragCtx) parts.push(ragCtx);
    }

    // Desktop automation availability
    if (modules.loadAutomation && this.automationEnabled) {
      parts.push(
        '\n## Desktop Automation\n' +
        'Masz możliwość przejęcia sterowania pulpitem użytkownika (myszka + klawiatura) w trybie autonomicznym.\n' +
        'Aby to zrobić, MUSISZ użyć bloku ```take_control (patrz instrukcje niżej).\n' +
        'NIE próbuj sterować komputerem za pomocą narzędzi (mouse_click, keyboard_type itp.) w normalnym czacie — one działają TYLKO w trybie take_control.\n'
      );
    }

    // Screen monitor context
    if (modules.loadScreenMonitor && this.screenMonitor?.isRunning()) {
      const monitorCtx = this.screenMonitor.buildMonitorContext();
      if (monitorCtx) parts.push(monitorCtx);
    }

    // Sub-agent context
    if (modules.loadSubAgents) {
      const subAgentCtx = this.subAgentManager.buildSubAgentContext();
      if (subAgentCtx) parts.push(subAgentCtx);
    }

    // Background tasks
    if (modules.loadBackgroundTasks && this.backgroundTasksProvider) {
      const bgTasks = this.backgroundTasksProvider();
      if (bgTasks.length > 0) {
        const lines = bgTasks.map(t =>
          `- [${t.id}] "${t.task.slice(0, 80)}" — od ${Math.round(t.elapsed / 1000)}s`
        );
        parts.push(`\n## ⏳ Zadania w tle\n${lines.join('\n')}\n`);
      }
    }

    // Active hours info
    if (modules.loadActiveHours && this.activeHours) {
      parts.push(
        `\n## ⏰ Godziny aktywności\nHeartbeat aktywny: ${this.activeHours.start}:00-${this.activeHours.end}:00\n`
      );
    }

    // System health warnings
    if (modules.loadSystemHealth) {
      const systemCtx = await this.buildSystemHealthContext();
      if (systemCtx) parts.push(systemCtx);
    }

    // Memory & cron nudge
    if (modules.loadMemoryNudge) {
      const nudge = await this.buildMemoryNudge();
      if (nudge) parts.push(nudge);
    }

    return parts.filter(Boolean).join('\n');
  }

  // ─── Context Segment Builders ───

  /**
   * Build memory context — SOUL.md + USER.md + selective MEMORY.md.
   * Uses keyword relevance scoring when a user message is provided.
   */
  private async buildMemoryContext(hint?: ContextHint): Promise<string> {
    const soul = await this.memory.get('SOUL.md') || '';
    const user = await this.memory.get('USER.md') || '';
    const fullMemory = await this.memory.get('MEMORY.md') || '';

    // Selective memory recall — if user message is provided, score memory sections
    let memoryContent: string;
    if (hint?.userMessage && fullMemory.length > 500) {
      memoryContent = this.selectRelevantMemory(fullMemory, hint.userMessage);
    } else {
      memoryContent = fullMemory;
    }

    // Daily memory — only in chat/vision modes (skip for heartbeat/cron)
    let dailyMemory = '';
    const mode = hint?.mode ?? 'chat';
    if (mode === 'chat' || mode === 'vision') {
      const now = new Date();
      const todayKey = `memory/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.md`;
      dailyMemory = await this.memory.get(todayKey) || '';
    }

    return [
      '# KxAI System Context',
      '',
      '## Soul (Persona & Boundaries)',
      soul,
      '',
      '## User Profile',
      user,
      '',
      '## Long-Term Memory',
      memoryContent,
      '',
      dailyMemory ? `## Today's Notes\n${dailyMemory}` : '',
    ].filter(Boolean).join('\n');
  }

  /**
   * Selective memory recall — score MEMORY.md sections by relevance to user message.
   * Keeps all sections but truncates less relevant ones.
   *
   * Sections are delimited by markdown headers (## or ###).
   */
  private selectRelevantMemory(fullMemory: string, userMessage: string): string {
    // Split memory into sections by markdown headers
    const sections = fullMemory.split(/(?=^#{2,3}\s)/m);
    if (sections.length <= 1) return fullMemory; // No sections to filter

    const query = userMessage.toLowerCase();
    const queryWords = query
      .split(/\s+/)
      .filter(w => w.length > 2)
      .map(w => w.replace(/[^a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ0-9]/g, ''));

    interface ScoredSection {
      content: string;
      score: number;
      isHeader: boolean;
    }

    const scored: ScoredSection[] = sections.map(section => {
      const sectionLower = section.toLowerCase();
      let score = 0;

      // Keyword matching — count query words appearing in section
      for (const word of queryWords) {
        if (word && sectionLower.includes(word)) {
          score += 2;
        }
      }

      // Boost sections with headers matching query
      const headerMatch = section.match(/^#{2,3}\s+(.+)/m);
      if (headerMatch) {
        const header = headerMatch[1].toLowerCase();
        for (const word of queryWords) {
          if (word && header.includes(word)) {
            score += 5; // Header match is worth more
          }
        }
      }

      // Recent sections (containing dates close to today) get a boost
      const datePattern = /\d{4}-\d{2}-\d{2}/g;
      const dates = section.match(datePattern);
      if (dates) {
        const now = Date.now();
        for (const d of dates) {
          const daysDiff = Math.abs(now - new Date(d).getTime()) / (1000 * 60 * 60 * 24);
          if (daysDiff < 7) score += 3;
          else if (daysDiff < 30) score += 1;
        }
      }

      return { content: section, score, isHeader: /^#{1,2}\s/.test(section) };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Token budget for memory — allocate up to ~4000 tokens (~14000 chars)
    const MEMORY_CHAR_BUDGET = 14000;
    let totalChars = 0;
    const included: string[] = [];

    for (const s of scored) {
      if (totalChars + s.content.length <= MEMORY_CHAR_BUDGET) {
        included.push(s.content);
        totalChars += s.content.length;
      } else if (s.score > 0) {
        // High-relevance section that exceeds budget — truncate
        const remaining = MEMORY_CHAR_BUDGET - totalChars;
        if (remaining > 200) {
          included.push(s.content.slice(0, remaining) + '\n... (truncated)');
          totalChars = MEMORY_CHAR_BUDGET;
        }
        break;
      }
    }

    if (included.length < scored.length) {
      const skipped = scored.length - included.length;
      included.push(`\n[${skipped} sekcji pamięci pominięto — mało relevantne do bieżącego zapytania]\n`);
    }

    return included.join('\n');
  }

  private async buildBootstrapContext(): Promise<string> {
    if (!(await this.memory.isBootstrapPending())) return '';

    const bootstrapMd = await this.memory.get('BOOTSTRAP.md');
    if (!bootstrapMd) return '';

    return (
      `\n## 🚀 BOOTSTRAP — Pierwsze Uruchomienie\n${bootstrapMd}\n\n` +
      'WAŻNE: To jest twoje PIERWSZE uruchomienie. Postępuj zgodnie z BOOTSTRAP.md.\n' +
      'Kiedy skończysz rytuał, odpowiedz "BOOTSTRAP_COMPLETE" na końcu wiadomości.\n'
    );
  }

  private buildCronContext(): string {
    const cronJobs = this.cron.getJobs();
    if (cronJobs.length === 0) return '';

    const lines = cronJobs.map((j) =>
      `- [${j.enabled ? '✓' : '✗'}] "${j.name}" — ${j.schedule} — ${j.action.slice(0, 80)}`
    );
    return `\n## Cron Jobs\n${lines.join('\n')}\n`;
  }

  private buildRagStatsContext(): string {
    const ragStats = this.rag ? this.rag.getStats() : null;
    if (!ragStats) return '';

    return (
      `\n## RAG Status\nZaindeksowane: ${ragStats.totalChunks} chunków z ${ragStats.totalFiles} plików` +
      ` | Embeddingi: ${ragStats.embeddingType === 'openai' ? 'OpenAI' : 'TF-IDF fallback'}\n`
    );
  }

  private async buildSystemHealthContext(): Promise<string> {
    try {
      const parts: string[] = [];
      const warnings = await this.systemMonitor.getWarnings();
      if (warnings.length > 0) {
        parts.push(`\n## ⚠️ System Warnings\n${warnings.join('\n')}\n`);
      }
      const statusSummary = await this.systemMonitor.getStatusSummary();
      parts.push(`\n## System Status\n${statusSummary}\n`);
      return parts.join('');
    } catch {
      return ''; // non-critical
    }
  }

  private async buildMemoryNudge(): Promise<string> {
    try {
      const memContent = await this.memory.get('MEMORY.md') || '';
      const memIsEmpty =
        memContent.includes('(Uzupełnia się automatycznie') ||
        memContent.includes('(Bieżące obserwacje') ||
        memContent.trim().length < 200;
      const hasCrons = this.cron.getJobs().length > 0;

      const nudges: string[] = [];
      if (memIsEmpty) {
        nudges.push('⚠️ MEMORY.md jest PUSTY! Zapisuj obserwacje o użytkowniku po każdej rozmowie za pomocą bloków ```update_memory.');
      }
      if (!hasCrons) {
        nudges.push('⚠️ Nie masz żadnych cron jobów! Zasugeruj przydatne zadania cykliczne (poranny briefing, przypomnienie o przerwie, podsumowanie dnia) za pomocą bloków ```cron.');
      }
      if (nudges.length === 0) return '';

      return '\n## 🔔 Przypomnienie\n' + nudges.join('\n') + '\n';
    } catch {
      return ''; // non-critical
    }
  }

  // ─── Legacy API (backward compat) ───

  /**
   * Build the full enhanced system context — legacy single-string API.
   * Delegates to buildStructuredContext() and returns the full string.
   *
   * @param hint - Optional context hint for conditional module loading
   */
  async buildEnhancedContext(hint?: ContextHint): Promise<string> {
    const structured = await this.buildStructuredContext(hint);
    return structured.full;
  }

  // ─── Utils ───

  /** Simple hash for cache invalidation (djb2). */
  private simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < Math.min(str.length, 1000); i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash;
  }
}
