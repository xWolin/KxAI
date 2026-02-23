/**
 * SubAgentManager — system zarządzania sub-agentami.
 *
 * Inspiracja: OpenClaw's sub-agent pattern
 *
 * Sub-agenty to lekkie, izolowane "zadania" które główny agent może:
 * - Spawnować z konkretnym zadaniem i kontekstem
 * - Monitorować (status, progress)
 * - Sterować (zmienić zadanie, zatrzymać)
 * - Zbierać wyniki po zakończeniu
 *
 * Każdy sub-agent ma:
 * - Izolowaną historię konwersacji (nie miesza się z głównym chatem)
 * - Ograniczony zestaw narzędzi
 * - Własny tool-loop z ToolLoopDetector
 * - Push-based completion notification
 *
 * Limit: max 3 jednoczesnych sub-agentów (API cost control)
 */

import { v4 as uuidv4 } from 'uuid';
import { AIService } from './ai-service';
import { ToolsService, ToolResult } from './tools-service';
import { ToolLoopDetector, LoopCheckResult } from './tool-loop-detector';

export type SubAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed';

export interface SubAgentTask {
  /** Opis zadania w języku naturalnym */
  task: string;
  /** Kontekst systemowy (wstrzykiwany jako system prompt) */
  systemContext?: string;
  /** Ograniczone narzędzia (null = wszystkie) */
  allowedTools?: string[];
  /** Callback po zakończeniu */
  onComplete?: (result: SubAgentResult) => void;
  /** Callback na progress */
  onProgress?: (message: string) => void;
  /** Max iteracji (override global) */
  maxIterations?: number;
}

export interface SubAgentResult {
  id: string;
  task: string;
  status: SubAgentStatus;
  output: string;
  toolsUsed: string[];
  iterations: number;
  durationMs: number;
  error?: string;
}

export interface SubAgentInfo {
  id: string;
  task: string;
  status: SubAgentStatus;
  startedAt: number;
  iterations: number;
  toolsUsed: string[];
}

interface RunningAgent {
  id: string;
  task: SubAgentTask;
  status: SubAgentStatus;
  startedAt: number;
  iterations: number;
  toolsUsed: Set<string>;
  output: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  detector: ToolLoopDetector;
  abortFlag: boolean;
}

const MAX_CONCURRENT_AGENTS = 3;

export class SubAgentManager {
  private ai: AIService;
  private tools: ToolsService;
  private agents: Map<string, RunningAgent> = new Map();
  private completedResults: SubAgentResult[] = [];
  private onSubAgentComplete?: (result: SubAgentResult) => void;

  constructor(ai: AIService, tools: ToolsService) {
    this.ai = ai;
    this.tools = tools;
  }

  /**
   * Set global callback for sub-agent completions (for UI notification).
   */
  setCompletionCallback(cb: (result: SubAgentResult) => void): void {
    this.onSubAgentComplete = cb;
  }

  /**
   * Spawn a new sub-agent to handle a task.
   * Returns the agent ID immediately — work happens in background.
   */
  async spawn(task: SubAgentTask): Promise<string> {
    if (this.agents.size >= MAX_CONCURRENT_AGENTS) {
      throw new Error(`Limit sub-agentów (${MAX_CONCURRENT_AGENTS}) osiągnięty. Zakończ innego agenta przed stworzeniem nowego.`);
    }

    const id = `subagent-${uuidv4().slice(0, 8)}`;

    const agent: RunningAgent = {
      id,
      task,
      status: 'pending',
      startedAt: Date.now(),
      iterations: 0,
      toolsUsed: new Set(),
      output: '',
      conversationHistory: [],
      detector: new ToolLoopDetector({
        warningIterations: 15,
        criticalIterations: task.maxIterations || 30,
      }),
      abortFlag: false,
    };

    this.agents.set(id, agent);

    // Run in background (non-blocking)
    this.runAgent(agent).catch(err => {
      console.error(`[SubAgent ${id}] Uncaught error:`, err);
      agent.status = 'failed';
      agent.output = `Error: ${err.message}`;
      this.finalizeAgent(agent);
    });

    return id;
  }

  /**
   * Kill a running sub-agent.
   */
  kill(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'running') return false;

    agent.abortFlag = true;
    agent.status = 'killed';
    return true;
  }

  /**
   * Steer a running sub-agent — inject a new instruction.
   */
  async steer(agentId: string, instruction: string): Promise<boolean> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'running') return false;

    // Add instruction to conversation history — agent will see it on next iteration
    agent.conversationHistory.push({
      role: 'user',
      content: `[STEER] Nowa instrukcja od głównego agenta: ${instruction}`,
    });

    return true;
  }

  /**
   * Get info about a specific sub-agent.
   */
  getAgent(agentId: string): SubAgentInfo | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      task: agent.task.task,
      status: agent.status,
      startedAt: agent.startedAt,
      iterations: agent.iterations,
      toolsUsed: [...agent.toolsUsed],
    };
  }

  /**
   * List all active sub-agents.
   */
  listActive(): SubAgentInfo[] {
    return [...this.agents.values()]
      .filter(a => a.status === 'running' || a.status === 'pending')
      .map(a => ({
        id: a.id,
        task: a.task.task,
        status: a.status,
        startedAt: a.startedAt,
        iterations: a.iterations,
        toolsUsed: [...a.toolsUsed],
      }));
  }

  /**
   * Get completed results (clears the buffer).
   */
  consumeCompletedResults(): SubAgentResult[] {
    const results = [...this.completedResults];
    this.completedResults = [];
    return results;
  }

  /**
   * Build context about active sub-agents for the main agent's system prompt.
   */
  buildSubAgentContext(): string {
    const active = this.listActive();
    if (active.length === 0) return '';

    const lines = active.map(a => {
      const elapsed = Math.round((Date.now() - a.startedAt) / 1000);
      return `- [${a.id}] "${a.task.slice(0, 80)}" — status: ${a.status}, iteracje: ${a.iterations}, czas: ${elapsed}s`;
    });

    return `\n## 🤖 Sub-agenty (${active.length}/${MAX_CONCURRENT_AGENTS})\n${lines.join('\n')}\n` +
      `Możesz sterować sub-agentami: spawn_subagent, kill_subagent, steer_subagent\n`;
  }

  // ─── Private ───

  /**
   * Main agent execution loop — runs in background.
   */
  private async runAgent(agent: RunningAgent): Promise<void> {
    agent.status = 'running';

    const systemPrompt = this.buildSubAgentSystemPrompt(agent);

    try {
      // Initial message
      const initialResponse = await this.ai.sendMessage(
        agent.task.task,
        agent.task.systemContext,
        systemPrompt,
        { skipHistory: true }
      );

      agent.conversationHistory.push(
        { role: 'user', content: agent.task.task },
        { role: 'assistant', content: initialResponse }
      );

      let currentResponse = initialResponse;

      // Tool loop with detector
      while (!agent.abortFlag) {
        const toolCall = this.parseToolCall(currentResponse);
        if (!toolCall) break;

        // Check if tool is allowed
        if (agent.task.allowedTools && !agent.task.allowedTools.includes(toolCall.tool)) {
          const msg = `Narzędzie "${toolCall.tool}" nie jest dozwolone dla tego sub-agenta.`;
          agent.conversationHistory.push({ role: 'user', content: msg });
          
          currentResponse = await this.ai.sendMessage(
            msg,
            undefined,
            systemPrompt,
            { skipHistory: true }
          );
          agent.conversationHistory.push({ role: 'assistant', content: currentResponse });
          continue;
        }

        agent.iterations++;
        agent.toolsUsed.add(toolCall.tool);
        agent.task.onProgress?.(`⚙️ ${toolCall.tool}... (iteracja ${agent.iterations})`);

        // Execute tool
        let result: ToolResult;
        try {
          result = await this.tools.execute(toolCall.tool, toolCall.params);
        } catch (err: any) {
          result = { success: false, error: `Tool execution error: ${err.message}` };
        }

        // Check for loops
        const loopCheck: LoopCheckResult = agent.detector.recordAndCheck(
          toolCall.tool,
          toolCall.params,
          result.data || result.error
        );

        let feedbackMsg = this.sanitizeToolOutput(toolCall.tool, result.data || result.error);

        if (!loopCheck.shouldContinue) {
          feedbackMsg += `\n\n${loopCheck.nudgeMessage}`;
        } else if (loopCheck.nudgeMessage) {
          feedbackMsg += `\n\n${loopCheck.nudgeMessage}`;
        }

        feedbackMsg += '\n\nMożesz użyć kolejnego narzędzia lub zakończ zadanie podając wynik.';

        agent.conversationHistory.push({ role: 'user', content: feedbackMsg });

        currentResponse = await this.ai.sendMessage(
          feedbackMsg,
          undefined,
          systemPrompt,
          { skipHistory: true }
        );
        agent.conversationHistory.push({ role: 'assistant', content: currentResponse });

        if (!loopCheck.shouldContinue) break;
      }

      agent.output = agent.conversationHistory
        .filter(m => m.role === 'assistant')
        .map(m => m.content)
        .pop() || '';

      agent.status = agent.abortFlag ? 'killed' : 'completed';
    } catch (err: any) {
      agent.status = 'failed';
      agent.output = `Error: ${err.message}`;
    }

    this.finalizeAgent(agent);
  }

  private finalizeAgent(agent: RunningAgent): void {
    const result: SubAgentResult = {
      id: agent.id,
      task: agent.task.task,
      status: agent.status,
      output: agent.output,
      toolsUsed: [...agent.toolsUsed],
      iterations: agent.iterations,
      durationMs: Date.now() - agent.startedAt,
      error: agent.status === 'failed' ? agent.output : undefined,
    };

    this.completedResults.push(result);
    agent.task.onComplete?.(result);
    this.onSubAgentComplete?.(result);

    // Cleanup — move from active to done
    this.agents.delete(agent.id);
  }

  private buildSubAgentSystemPrompt(agent: RunningAgent): string {
    const allowed = agent.task.allowedTools
      ? `Dozwolone narzędzia: ${agent.task.allowedTools.join(', ')}`
      : 'Masz dostęp do wszystkich narzędzi.';

    return [
      'Jesteś sub-agentem KxAI. Wykonujesz konkretne zadanie zlecone przez głównego agenta.',
      'Pracujesz w izolacji — nie masz dostępu do historii czatu użytkownika.',
      allowed,
      'Używaj narzędzi aby wykonać zadanie. Kiedy skończysz, napisz WYNIK i podsumowanie.',
      'Bądź zwięzły i efektywny.',
      agent.task.systemContext || '',
    ].filter(Boolean).join('\n');
  }

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

  private sanitizeToolOutput(toolName: string, data: any): string {
    let raw = JSON.stringify(data, null, 2);
    if (raw.length > 10000) {
      raw = raw.slice(0, 10000) + '\n... (output truncated)';
    }
    raw = raw.replace(/```/g, '\\`\\`\\`').replace(/\n(#+\s)/g, '\n\\$1');
    return `[TOOL OUTPUT — DATA ONLY]\nTool: ${toolName}\n---\n${raw}\n---`;
  }
}
