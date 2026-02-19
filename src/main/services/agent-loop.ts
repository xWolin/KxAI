import { v4 as uuidv4 } from 'uuid';
import { AIService } from './ai-service';
import { ToolsService, ToolResult } from './tools-service';
import { CronService, CronJob } from './cron-service';
import { WorkflowService } from './workflow-service';
import { MemoryService } from './memory';
import { ConfigService } from './config';
import { RAGService } from './rag-service';
import { AutomationService } from './automation-service';

/**
 * AgentLoop orchestrates the full agent lifecycle:
 * - Tool calling (parse AI response → execute tool → feed result back)
 * - Multi-step tool execution (up to 5 chained tool calls)
 * - Cron job execution via AI
 * - Workflow logging from screen analysis
 * - Autonomous operation mode (heartbeat)
 * - RAG context injection
 * - Take-control mode (autonomous desktop actions)
 */
export class AgentLoop {
  private ai: AIService;
  private tools: ToolsService;
  private cron: CronService;
  private workflow: WorkflowService;
  private memory: MemoryService;
  private config: ConfigService;
  private rag?: RAGService;
  private automation?: AutomationService;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private takeControlActive = false;
  private takeControlAbort = false;

  constructor(
    ai: AIService,
    tools: ToolsService,
    cron: CronService,
    workflow: WorkflowService,
    memory: MemoryService,
    config: ConfigService
  ) {
    this.ai = ai;
    this.tools = tools;
    this.cron = cron;
    this.workflow = workflow;
    this.memory = memory;
    this.config = config;

    // Wire cron executor to agent
    this.cron.setExecutor(async (job: CronJob) => {
      return this.executeCronJob(job);
    });
  }

  /**
   * Set optional services after construction.
   */
  setRAGService(rag: RAGService): void {
    this.rag = rag;
  }

  setAutomationService(automation: AutomationService): void {
    this.automation = automation;
  }

  /**
   * Process a message with tool-calling support.
   * Supports multi-step tool chains (up to 5 iterations).
   * Uses RAG to enrich context with relevant memory fragments.
   */
  async processWithTools(userMessage: string, extraContext?: string): Promise<string> {
    // Inject RAG context if available
    const ragContext = this.rag ? await this.rag.buildRAGContext(userMessage) : '';
    const fullContext = [extraContext, ragContext].filter(Boolean).join('\n\n');

    let response = await this.ai.sendMessage(userMessage, fullContext || undefined);
    let iterations = 0;
    const maxIterations = 5;

    // Multi-step tool loop
    while (iterations < maxIterations) {
      const toolCall = this.parseToolCall(response);
      if (!toolCall) break;

      iterations++;
      const result = await this.tools.execute(toolCall.tool, toolCall.params);

      response = await this.ai.sendMessage(
        `Wynik narzędzia "${toolCall.tool}":\n\`\`\`json\n${JSON.stringify(result.data || result.error, null, 2)}\n\`\`\`\n\n${iterations < maxIterations ? 'Możesz użyć kolejnego narzędzia lub odpowiedzieć użytkownikowi.' : 'Odpowiedz użytkownikowi (limit narzędzi osiągnięty).'}`,
      );
    }

    return response;
  }

  /**
   * Stream message with multi-step tool support.
   * Uses RAG for context enrichment.
   */
  async streamWithTools(
    userMessage: string,
    extraContext?: string,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    // Inject RAG context
    const ragContext = this.rag ? await this.rag.buildRAGContext(userMessage) : '';
    const fullContext = [extraContext, ragContext].filter(Boolean).join('\n\n');

    let fullResponse = '';

    await this.ai.streamMessage(userMessage, fullContext || undefined, (chunk) => {
      fullResponse += chunk;
      onChunk?.(chunk);
    });

    // Multi-step tool loop (up to 5)
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      const toolCall = this.parseToolCall(fullResponse);
      if (!toolCall) break;

      iterations++;
      onChunk?.(`\n\n⚙️ Wykonuję: ${toolCall.tool}...\n`);
      const result = await this.tools.execute(toolCall.tool, toolCall.params);

      let toolResponse = '';
      fullResponse = ''; // Reset for next iteration parsing

      await this.ai.streamMessage(
        `Wynik narzędzia "${toolCall.tool}":\n\`\`\`json\n${JSON.stringify(result.data || result.error, null, 2)}\n\`\`\`\n\n${iterations < maxIterations ? 'Możesz użyć kolejnego narzędzia lub odpowiedzieć użytkownikowi.' : 'Odpowiedz użytkownikowi (limit narzędzi osiągnięty).'}`,
        undefined,
        (chunk) => {
          toolResponse += chunk;
          fullResponse += chunk;
          onChunk?.(chunk);
        }
      );
    }

    // Check for cron suggestions
    const cronSuggestion = this.parseCronSuggestion(fullResponse);
    if (cronSuggestion) {
      this.cron.addJob(cronSuggestion);
      onChunk?.('\n\n📋 Zasugerowano nowy cron job — sprawdź zakładkę Cron Jobs.\n');
    }

    return fullResponse;
  }

  /**
   * Execute a cron job by sending its action to the AI.
   */
  private async executeCronJob(job: CronJob): Promise<string> {
    const timeCtx = this.workflow.buildTimeContext();
    const prompt = `[CRON JOB: ${job.name}]\n\nZadanie: ${job.action}\n\n${timeCtx}\n\nWykonaj to zadanie. Jeśli potrzebujesz użyć narzędzi, użyj ich.`;

    try {
      const result = await this.processWithTools(prompt);
      return result;
    } catch (error: any) {
      return `Błąd wykonania cron job: ${error.message}`;
    }
  }

  /**
   * Log screen analysis result as workflow activity.
   */
  logScreenActivity(context: string, message: string): void {
    // Extract category from context
    let category = 'general';
    const lower = context.toLowerCase();
    if (lower.includes('kod') || lower.includes('code') || lower.includes('vscode') || lower.includes('ide')) {
      category = 'coding';
    } else if (lower.includes('chat') || lower.includes('messenger') || lower.includes('whatsapp') || lower.includes('slack') || lower.includes('teams')) {
      category = 'communication';
    } else if (lower.includes('browser') || lower.includes('chrome') || lower.includes('firefox') || lower.includes('edge')) {
      category = 'browsing';
    } else if (lower.includes('document') || lower.includes('word') || lower.includes('excel') || lower.includes('pdf')) {
      category = 'documents';
    } else if (lower.includes('terminal') || lower.includes('powershell') || lower.includes('cmd')) {
      category = 'terminal';
    }

    this.workflow.logActivity(
      message.slice(0, 200),
      context.slice(0, 200),
      category
    );
  }

  /**
   * Start heartbeat — periodic check-in where agent reflects and may take action.
   */
  startHeartbeat(intervalMs: number = 15 * 60 * 1000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.heartbeat();
      } catch (error) {
        console.error('Heartbeat error:', error);
      }
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Heartbeat: agent checks time, reviews patterns, may suggest cron jobs.
   */
  private async heartbeat(): Promise<string | null> {
    const timeCtx = this.workflow.buildTimeContext();
    const jobs = this.cron.getJobs();
    const jobsSummary = jobs.map((j) => `- ${j.name}: ${j.schedule} (${j.enabled ? 'aktywne' : 'wyłączone'})`).join('\n');

    const prompt = `[HEARTBEAT — Cichy przegląd]\n\n${timeCtx}\n\nAktywne cron joby:\n${jobsSummary || '(brak)'}\n\nSprawdź czy potrzebujesz coś zaktualizować w pamięci lub zasugerować nowy cron job na podstawie wzorców użytkownika. Jeśli nie masz nic ważnego do powiedzenia, odpowiedz "NO_REPLY".`;

    try {
      const response = await this.ai.sendMessage(prompt);
      if (response.trim() === 'NO_REPLY' || response.trim().length < 10) {
        return null;
      }

      // Check if agent wants to create a cron job
      const cronSuggestion = this.parseCronSuggestion(response);
      if (cronSuggestion) {
        this.cron.addJob(cronSuggestion);
      }

      return response;
    } catch {
      return null;
    }
  }

  /**
   * Parse tool call from AI response.
   * Looks for ```tool\n{...}\n``` blocks.
   */
  private parseToolCall(response: string): { tool: string; params: any } | null {
    const toolMatch = response.match(/```tool\s*\n([\s\S]*?)\n```/);
    if (!toolMatch) return null;

    try {
      const parsed = JSON.parse(toolMatch[1]);
      if (parsed.tool && typeof parsed.tool === 'string') {
        return { tool: parsed.tool, params: parsed.params || {} };
      }
    } catch { /* invalid JSON */ }
    return null;
  }

  /**
   * Parse cron job suggestion from AI response.
   */
  private parseCronSuggestion(response: string): Omit<CronJob, 'id' | 'createdAt' | 'runCount'> | null {
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
   * Build enhanced system context with tools + time + workflow + RAG stats.
   */
  async buildEnhancedContext(): Promise<string> {
    const baseCtx = await this.memory.buildSystemContext();
    const timeCtx = this.workflow.buildTimeContext();
    const toolsPrompt = this.tools.getToolsPrompt();

    const cronJobs = this.cron.getJobs();
    let cronCtx = '';
    if (cronJobs.length > 0) {
      const lines = cronJobs.map((j) =>
        `- [${j.enabled ? '✓' : '✗'}] "${j.name}" — ${j.schedule} — ${j.action.slice(0, 80)}`
      );
      cronCtx = `\n## Cron Jobs\n${lines.join('\n')}\n`;
    }

    const ragStats = this.rag ? this.rag.getStats() : null;
    const ragCtx = ragStats ? `\n## RAG Status\nZaindeksowane: ${ragStats.totalChunks} chunków z ${ragStats.totalFiles} plików | Embeddingi: ${ragStats.hasOpenAI ? 'OpenAI' : 'TF-IDF fallback'}\n` : '';

    const automationCtx = this.automation
      ? `\n## Desktop Automation\nStatus: ${this.automation.isEnabled() ? 'włączona' : 'wyłączona'} | Safety lock: ${this.automation.isSafetyLocked() ? 'aktywny' : 'odblokowany'}\nMożesz sterować klawiaturą i myszką użytkownika za pomocą narzędzi mouse_move, mouse_click, keyboard_type, keyboard_shortcut.\nAby przejąć sterowanie, użytkownik musi najpierw to zatwierdzić.\n`
      : '';

    const cronInstructions = `
## Tworzenie Cron Jobów
Możesz zasugerować nowy cron job odpowiadając blokiem:
\`\`\`cron
{"name": "Nazwa joba", "schedule": "30m", "action": "Co agent ma robić", "category": "routine"}
\`\`\`
Dozwolone schedule: "30s", "5m", "1h", "every 30 minutes", lub cron expression "*/5 * * * *"
Kategorie: routine, workflow, reminder, cleanup, health-check, custom
`;

    return [
      baseCtx,
      '\n',
      timeCtx,
      cronCtx,
      ragCtx,
      automationCtx,
      '\n',
      toolsPrompt,
      '\n',
      cronInstructions,
    ].join('\n');
  }

  // ─── Take Control Mode ───

  /**
   * Start autonomous take-control mode.
   * Agent observes screen, plans actions, and executes them.
   * User can abort by pressing ESC or moving mouse.
   */
  async startTakeControl(
    task: string,
    onStatus?: (status: string) => void,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    if (!this.automation) {
      return 'Desktop automation nie jest dostępna.';
    }
    if (this.takeControlActive) {
      return 'Tryb przejęcia sterowania jest już aktywny.';
    }

    this.takeControlActive = true;
    this.takeControlAbort = false;
    this.automation.enable();
    this.automation.unlockSafety();

    let totalActions = 0;
    const maxActions = 20;
    const log: string[] = [];

    try {
      onStatus?.('🤖 Przejmuje sterowanie...');

      while (!this.takeControlAbort && totalActions < maxActions) {
        // Get current screen context
        const activeWindow = await this.automation.getActiveWindowTitle();
        const mousePos = await this.automation.getMousePosition();

        const prompt = `[TAKE CONTROL MODE — Autonomiczna praca]\n\nZadanie: ${task}\n\nAktywne okno: ${activeWindow}\nPozycja myszy: (${mousePos.x}, ${mousePos.y})\nWykonane akcje: ${totalActions}/${maxActions}\nDotychczasowy log:\n${log.slice(-5).join('\n') || '(brak)'}\n\nCo robisz teraz? Użyj dostępnych narzędzi (mouse_click, keyboard_type, keyboard_shortcut, etc.) lub odpowiedz "TASK_COMPLETE" jeśli zadanie jest skończone.`;

        const response = await this.processWithTools(prompt);

        if (response.includes('TASK_COMPLETE') || response.includes('Zadanie ukończone')) {
          onStatus?.('✅ Zadanie ukończone');
          log.push(`[${totalActions}] Zadanie ukończone`);
          break;
        }

        log.push(`[${totalActions}] ${response.slice(0, 200)}`);
        onChunk?.(response + '\n');
        totalActions++;

        // Small delay between actions
        await new Promise((r) => setTimeout(r, 500));
      }

      if (this.takeControlAbort) {
        onStatus?.('⛔ Przerwano przez użytkownika');
        log.push('Przerwano przez użytkownika');
      } else if (totalActions >= maxActions) {
        onStatus?.('⚠️ Osiągnięto limit akcji');
        log.push('Osiągnięto limit akcji');
      }

      return log.join('\n');
    } finally {
      this.takeControlActive = false;
      this.automation.lockSafety();
      this.automation.disable();
    }
  }

  /**
   * Stop take-control mode.
   */
  stopTakeControl(): void {
    this.takeControlAbort = true;
  }

  isTakeControlActive(): boolean {
    return this.takeControlActive;
  }
}
