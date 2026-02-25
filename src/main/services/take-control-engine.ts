/**
 * TakeControlEngine — Desktop automation control system.
 *
 * Extracted from AgentLoop to isolate the take-control (Computer Use) mode:
 * - Anthropic native Computer Use API path (computer_20250124)
 * - OpenAI vision-based fallback path
 * - Coordinate scaling (AI space → native screen)
 * - Action execution via AutomationService
 * - Intent detection for take-control triggers
 *
 * Both paths use XGA resolution screenshots, coordinate scaling,
 * image history limiting, and action delay for UI settling.
 */

import { AIService, ComputerUseAction, ComputerUseMessage, ComputerUseStep } from './ai-service';
import { ToolsService } from './tools-service';
import { AutomationService } from './automation-service';
import { ScreenCaptureService, ComputerUseScreenshot } from './screen-capture';
import { MemoryService } from './memory';
import { PromptService } from './prompt-service';
import { IntentDetector } from './intent-detector';
import type { AgentStatus } from '../../shared/types/agent';
import { createLogger } from './logger';

const log = createLogger('TakeControl');

// ─── TakeControlEngine ───

export class TakeControlEngine {
  private ai: AIService;
  private tools: ToolsService;
  private memory: MemoryService;
  private promptService: PromptService;
  private intentDetector: IntentDetector;
  private automation?: AutomationService;
  private screenCapture?: ScreenCaptureService;

  private takeControlActive = false;
  private abortController: AbortController | null = null;
  private pendingTakeControlTask: string | null = null;

  onAgentStatus?: (status: AgentStatus) => void;

  constructor(
    ai: AIService,
    tools: ToolsService,
    memory: MemoryService,
    promptService: PromptService,
    intentDetector: IntentDetector,
  ) {
    this.ai = ai;
    this.tools = tools;
    this.memory = memory;
    this.promptService = promptService;
    this.intentDetector = intentDetector;
  }

  // ─── Configuration ───

  setAutomationService(automation: AutomationService): void {
    this.automation = automation;
  }

  setScreenCaptureService(screenCapture: ScreenCaptureService): void {
    this.screenCapture = screenCapture;
  }

  // ─── Public API ───

  isTakeControlActive(): boolean {
    return this.takeControlActive;
  }

  stopTakeControl(): void {
    this.abortController?.abort();
  }

  /** Check if the current take-control operation has been aborted. */
  private get isAborted(): boolean {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
   * Store a pending take-control request (parsed from AI response).
   */
  setPendingTask(task: string | null): void {
    this.pendingTakeControlTask = task;
  }

  /**
   * Get and clear pending take-control request.
   */
  consumePendingTakeControl(): string | null {
    const task = this.pendingTakeControlTask;
    this.pendingTakeControlTask = null;
    return task;
  }

  /**
   * Detect take-control intent from user message.
   * Returns the user message as task description if intent is detected.
   */
  detectTakeControlIntent(userMessage: string): string | null {
    if (!this.automation) return null;
    const lower = userMessage.toLowerCase();

    // Exclude web/browser intents — should use browser tools, not take_control
    const webPatterns = [
      /wyszukaj|szukaj|znajd[źz].*w\s+(internecie|necie|sieci|google|przeglądarce)/,
      /otw[oó]rz.*stron[eę]|otw[oó]rz.*url|otw[oó]rz.*link/,
      /poka[zż].*stron[eę]|poka[zż].*w\s+przeglądarce/,
      /przegląd(aj|nij)|browse|search.*web|google/,
      /odpal.*przeglądarke|uruchom.*przeglądarke|włącz.*przeglądarke/,
      /w\s+chrome|w\s+przeglądarce|w\s+google/,
      /sprawdź.*online|sprawdź.*w\s+(necie|internecie)/,
      /newsy|wiadomości.*internet|pogoda.*internet/,
    ];
    if (webPatterns.some((p) => p.test(lower))) return null;

    const patterns = [
      /przejmij\s+(kontrol[eę]|sterowanie)/,
      /take\s*control/,
      /przejmij\s+pulpit/,
      /zr[oó]b\s+to\s+(za\s+mnie\s+)?na\s+(komputerze|pulpicie)/,
      /id[eę].*przejmij/,
      /przejmuj\s+(kontrol[eę]|sterowanie)/,
      /steruj\s+(komputerem|pulpitem)/,
      /dzia[łl]aj\s+na\s+(pulpicie|komputerze|ekranie)/,
    ];
    return patterns.some((p) => p.test(lower)) ? userMessage.slice(0, 500) : null;
  }

  // ─── Main Entry Point ───

  /**
   * Start autonomous take-control mode.
   *
   * Two paths:
   * 1. Anthropic — Native Computer Use API
   * 2. OpenAI — Vision loop fallback with XGA scaling
   */
  async startTakeControl(
    task: string,
    onStatus?: (status: string) => void,
    onChunk?: (chunk: string) => void,
    confirmed: boolean = false
  ): Promise<string> {
    if (!this.automation) {
      return 'Desktop automation nie jest dostępna.';
    }
    if (this.takeControlActive) {
      return 'Tryb przejęcia sterowania jest już aktywny.';
    }
    if (!confirmed) {
      return 'Wymagane potwierdzenie użytkownika przed przejęciem sterowania.';
    }
    if (!this.screenCapture) {
      return 'Screen capture nie jest dostępny.';
    }

    this.takeControlActive = true;
    this.abortController = new AbortController();
    this.automation.enable();
    this.automation.unlockSafety();

    try {
      if (this.ai.supportsNativeComputerUse()) {
        return await this.takeControlNativeAnthropic(task, onStatus, onChunk);
      } else {
        return await this.takeControlVisionFallback(task, onStatus, onChunk);
      }
    } finally {
      this.takeControlActive = false;
      this.abortController = null;
      this.automation.lockSafety();
      this.automation.disable();
    }
  }

  // ─── Anthropic Native Computer Use ───

  /**
   * Native Anthropic Computer Use API loop.
   * Uses computer_20250124 tool type for structured actions.
   *
   * Optimizations:
   * - Prompt caching (system prompt cached across turns)
   * - Image pruning (keep last 3 screenshots)
   * - Native tool_use (model trained for this)
   * - XGA coordinate scaling
   */
  private async takeControlNativeAnthropic(
    task: string,
    onStatus?: (status: string) => void,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const maxActions = 30;
    let totalActions = 0;
    const actionLog: string[] = [];

    const takeControlPrompt = await this.promptService.render('TAKE_CONTROL.md', {
      maxSteps: String(maxActions),
    });

    const systemPrompt = [
      await this.memory.buildSystemContext(),
      '',
      takeControlPrompt,
      '',
      `Zadanie: ${task}`,
    ].join('\n');

    // Initial screenshot
    const initialCapture = await this.screenCapture!.captureForComputerUse();
    if (!initialCapture) {
      return 'Nie udało się przechwycić ekranu.';
    }

    const messages: ComputerUseMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: `Rozpocznij zadanie: ${task}` },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: initialCapture.base64 },
          },
        ],
      },
    ];

    onStatus?.('🤖 Przejmuje sterowanie (Computer Use API)...');
    onChunk?.(`\n🖥️ Rozdzielczość: ${initialCapture.width}x${initialCapture.height} (natywna: ${initialCapture.nativeWidth}x${initialCapture.nativeHeight})\n`);

    let latestCapture = initialCapture;

    while (!this.isAborted && totalActions < maxActions) {
      // Prune old images to keep costs down
      this.ai.pruneComputerUseImages(messages, 3);

      let steps: ComputerUseStep[];
      try {
        steps = await this.ai.computerUseStep(
          systemPrompt,
          messages,
          initialCapture.width,
          initialCapture.height
        );
      } catch (error: any) {
        const errMsg = `API error: ${error.message}`;
        actionLog.push(`[${totalActions}] ${errMsg}`);
        onChunk?.(`\n❌ ${errMsg}\n`);
        break;
      }

      if (steps.length === 0) {
        actionLog.push(`[${totalActions}] Empty response from Computer Use API`);
        onChunk?.('\n⚠️ No actions returned from API\n');
        break;
      }

      let hasAction = false;
      const assistantContent: any[] = [];

      for (const step of steps) {
        if (step.type === 'done') {
          onStatus?.('✅ Zadanie ukończone');
          actionLog.push(`[${totalActions}] Zadanie ukończone`);
          if (assistantContent.length > 0) {
            messages.push({ role: 'assistant', content: assistantContent });
          }
          return actionLog.join('\n');
        }

        if (step.type === 'text') {
          onChunk?.(`\n💭 ${step.text}\n`);
          actionLog.push(`[${totalActions}] AI: ${step.text?.slice(0, 200)}`);
          assistantContent.push({ type: 'text', text: step.text });
        }

        if (step.type === 'action' && step.action && step.toolUseId) {
          hasAction = true;
          totalActions++;

          assistantContent.push({
            type: 'tool_use',
            id: step.toolUseId,
            name: 'computer',
            input: step.action,
          });

          const actionStr = `${step.action.action}${step.action.coordinate ? ` (${step.action.coordinate.join(',')})` : ''}${step.action.text ? ` "${step.action.text.slice(0, 50)}"` : ''}`;
          onChunk?.(`\n⚙️ [${totalActions}/${maxActions}] ${actionStr}\n`);

          let actionError: string | undefined;
          try {
            await this.executeComputerUseAction(step.action, latestCapture);
          } catch (error: any) {
            actionError = error.message;
            onChunk?.(`❌ ${actionError}\n`);
          }

          await new Promise((r) => setTimeout(r, step.action?.action === 'screenshot' ? 100 : 800));

          const capture = await this.screenCapture!.captureForComputerUse();
          if (!capture) {
            actionLog.push(`[${totalActions}] Screenshot failed after action`);
            break;
          }
          latestCapture = capture;

          messages.push({ role: 'assistant', content: assistantContent.splice(0) });
          messages.push({
            role: 'user',
            content: [
              this.ai.buildComputerUseToolResult(step.toolUseId, capture.base64, actionError),
            ],
          });

          const resultStr = actionError || 'OK';
          actionLog.push(`[${totalActions}] ${actionStr} → ${resultStr}`);
          onChunk?.(`${actionError ? '❌' : '✅'} ${resultStr}\n`);
        }
      }

      if (!hasAction) {
        if (assistantContent.length > 0) {
          messages.push({ role: 'assistant', content: assistantContent });
        }
        break;
      }
    }

    if (this.isAborted) {
      onStatus?.('⛔ Przerwano przez użytkownika');
      actionLog.push('Przerwano przez użytkownika');
    } else if (totalActions >= maxActions) {
      onStatus?.('⚠️ Osiągnięto limit akcji');
      actionLog.push('Osiągnięto limit akcji');
    }

    return actionLog.join('\n');
  }

  // ─── Computer Use Action Executor ───

  /**
   * Execute a Computer Use action via AutomationService.
   * Maps AI coordinates from scaled space back to native screen coordinates.
   */
  private async executeComputerUseAction(
    action: ComputerUseAction,
    capture: ComputerUseScreenshot
  ): Promise<void> {
    const scaleCoord = (coord: [number, number]): [number, number] => [
      Math.round(coord[0] * capture.scaleX),
      Math.round(coord[1] * capture.scaleY),
    ];

    if (!this.automation) throw new Error('Automation not available');

    switch (action.action) {
      case 'screenshot':
        break;

      case 'mouse_move': {
        if (!action.coordinate) throw new Error('mouse_move requires coordinate');
        const [x, y] = scaleCoord(action.coordinate);
        await this.automation.mouseMove(x, y);
        break;
      }

      case 'left_click':
      case 'right_click':
      case 'middle_click':
      case 'double_click': {
        const button = action.action === 'right_click' ? 'right'
          : action.action === 'middle_click' ? 'middle'
          : 'left';
        if (action.coordinate) {
          const [x, y] = scaleCoord(action.coordinate);
          await this.automation.mouseClick(x, y, button);
          if (action.action === 'double_click') {
            await new Promise((r) => setTimeout(r, 50));
            await this.automation.mouseClick(x, y, button);
          }
        } else {
          await this.automation.mouseClick(undefined, undefined, button);
          if (action.action === 'double_click') {
            await new Promise((r) => setTimeout(r, 50));
            await this.automation.mouseClick(undefined, undefined, button);
          }
        }
        break;
      }

      case 'type': {
        if (!action.text) throw new Error('type requires text');
        await this.automation.keyboardType(action.text);
        break;
      }

      case 'key': {
        if (!action.text) throw new Error('key requires text (key combo)');
        const parts = action.text.split('+').map((k) => k.trim().toLowerCase());
        if (parts.length > 1) {
          await this.automation.keyboardShortcut(parts);
        } else {
          await this.automation.keyboardPress(parts[0]);
        }
        break;
      }

      case 'scroll': {
        const dir = action.scroll_direction || 'down';
        const amount = action.scroll_amount || 3;
        if (action.coordinate) {
          const [x, y] = scaleCoord(action.coordinate);
          await this.automation.mouseMove(x, y);
          await new Promise((r) => setTimeout(r, 100));
        }
        for (let i = 0; i < Math.min(amount, 10); i++) {
          const key = dir === 'down' ? 'down' : dir === 'up' ? 'up' : dir === 'left' ? 'left' : 'right';
          await this.automation.keyboardPress(key);
          await new Promise((r) => setTimeout(r, 50));
        }
        break;
      }

      case 'cursor_position':
        break;

      case 'wait': {
        const duration = Math.min(action.duration || 1, 10);
        await new Promise((r) => setTimeout(r, duration * 1000));
        break;
      }

      default:
        log.warn(`Unknown Computer Use action: ${action.action}`);
    }
  }

  // ─── Vision Fallback (OpenAI) ───

  /**
   * Vision-based fallback for non-Anthropic providers.
   * Uses XGA coordinate scaling, retry logic, and image history limiting.
   */
  private async takeControlVisionFallback(
    task: string,
    onStatus?: (status: string) => void,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const maxActions = 20;
    const maxTextRetries = 3;
    let totalActions = 0;
    let textRetries = 0;
    const actionLog: string[] = [];

    const takeControlSystemCtx = [
      await this.memory.buildSystemContext(),
      '',
      await this.promptService.render('TAKE_CONTROL.md', { maxSteps: String(maxActions) }),
      '',
      `Zadanie: ${task}`,
    ].join('\n');

    onStatus?.('🤖 Przejmuje sterowanie (Vision mode)...');

    while (!this.isAborted && totalActions < maxActions) {
      const capture = await this.screenCapture!.captureForComputerUse();
      if (!capture) {
        actionLog.push(`[${totalActions}] Screenshot failed`);
        onChunk?.('\n❌ Screenshot capture failed\n');
        break;
      }

      const recentLog = actionLog.slice(-5).join('\n') || '(none)';
      const prompt = textRetries > 0
        ? [
            `RESPOND ONLY WITH A \`\`\`tool BLOCK. No text, no explanations.`,
            `Screenshot: ${capture.width}x${capture.height}`,
            `[Step ${totalActions + 1}/${maxActions}] Task: ${task}`,
            `Log:\n${recentLog}`,
          ].join('\n')
        : [
            `[Step ${totalActions + 1}/${maxActions}]`,
            `Screenshot: ${capture.width}x${capture.height}`,
            `Task: ${task}`,
            `Log:\n${recentLog}`,
            `Execute next action or respond "TASK_COMPLETE".`,
          ].join('\n');

      let response: string;
      try {
        response = await this.ai.sendMessageWithVision(prompt, capture.dataUrl, takeControlSystemCtx, 'high');
      } catch (error: any) {
        actionLog.push(`[${totalActions}] API error: ${error.message}`);
        onChunk?.(`\n❌ API error: ${error.message}\n`);
        break;
      }

      if (response.includes('TASK_COMPLETE') || response.includes('Zadanie ukończone')) {
        onStatus?.('✅ Zadanie ukończone');
        actionLog.push(`[${totalActions}] Zadanie ukończone`);
        onChunk?.('\n✅ Zadanie ukończone\n');
        break;
      }

      const toolCall = this.parseToolCall(response);
      if (toolCall) {
        totalActions++;
        textRetries = 0;

        if (toolCall.params.x !== undefined && toolCall.params.y !== undefined) {
          toolCall.params.x = Math.round(toolCall.params.x * capture.scaleX);
          toolCall.params.y = Math.round(toolCall.params.y * capture.scaleY);
        }

        onChunk?.(`\n⚙️ [${totalActions}/${maxActions}] ${toolCall.tool}(${JSON.stringify(toolCall.params)})\n`);

        try {
          const result = await this.tools.execute(toolCall.tool, toolCall.params);
          const resultStr = result.data || result.error || 'OK';
          actionLog.push(`[${totalActions}] ${toolCall.tool}(${JSON.stringify(toolCall.params)}) → ${resultStr}`);
          onChunk?.(`${result.success ? '✅' : '❌'} ${resultStr}\n`);
        } catch (execError: any) {
          const errMsg = execError.message || 'Unknown execution error';
          actionLog.push(`[${totalActions}] ${toolCall.tool} ERROR: ${errMsg}`);
          onChunk?.(`❌ Execution error: ${errMsg}\n`);
        }

        await new Promise((r) => setTimeout(r, 800));
      } else {
        textRetries++;
        actionLog.push(`[text-${textRetries}] AI: ${response.slice(0, 200)}`);
        onChunk?.(`\n💭 ${response.slice(0, 300)}\n`);

        if (textRetries >= maxTextRetries) {
          onChunk?.('\n⚠️ AI nie wykonuje akcji (brak bloków ```tool) — przerywam.\n');
          actionLog.push('Przerwano: AI nie generuje bloków tool');
          break;
        }
      }
    }

    if (this.isAborted) {
      onStatus?.('⛔ Przerwano przez użytkownika');
      actionLog.push('Przerwano przez użytkownika');
    } else if (totalActions >= maxActions) {
      onStatus?.('⚠️ Osiągnięto limit akcji');
      actionLog.push('Osiągnięto limit akcji');
    }

    return actionLog.join('\n');
  }

  // ─── Helpers ───

  /**
   * Parse ```tool block from AI response.
   */
  private parseToolCall(response: string): { tool: string; params: Record<string, any> } | null {
    const match = response.match(/```tool\s*\n([\s\S]*?)\n```/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && typeof parsed.tool === 'string') {
        return { tool: parsed.tool, params: parsed.params || {} };
      }
    } catch { /* invalid JSON */ }
    return null;
  }

  private emitStatus(status: AgentStatus): void {
    this.onAgentStatus?.(status);
  }
}
