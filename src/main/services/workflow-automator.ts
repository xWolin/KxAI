/**
 * WorkflowAutomator — Macro Recorder & Replay Engine.
 *
 * Records sequences of tool calls executed by the AI agent, saves them as
 * replayable workflow macros, and replays them with parameter substitution.
 *
 * Key features:
 * - Record tool calls via ToolsService callback hook
 * - Save/load macros from disk (JSON files)
 * - Replay macros deterministically (direct tool execution)
 * - AI-guided replay with parameter substitution
 * - Parameterization: detect common values across steps, expose as placeholders
 * - 5 AI tools: macro_start, macro_stop, macro_list, macro_replay, macro_delete
 *
 * Architecture:
 * - Hooks into ToolsService.execute() via onToolExecuted callback
 * - Recording captures tool name, params, result, duration per step
 * - Macros stored as JSON in userData/workspace/workflow/macros/
 * - Replay executes steps sequentially via ToolsService.execute()
 * - Excluded tools: macro_* (prevent recursive recording), screenshot, sub-agent ops
 *
 * @phase 6.2
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from './logger';
import type { ToolResult } from '../../shared/types/tools';
import type {
  WorkflowStep,
  WorkflowMacro,
  WorkflowMacroParam,
  WorkflowReplayResult,
  WorkflowRecordingState,
} from '../../shared/types/workflow';

const log = createLogger('WorkflowAutomator');

/** Tools that should never be recorded (meta-tools, internal) */
const EXCLUDED_TOOLS = new Set([
  'macro_start',
  'macro_stop',
  'macro_list',
  'macro_replay',
  'macro_delete',
  'macro_get',
  'screenshot',
  'take_screenshot',
  'spawn_subagent',
  'kill_subagent',
  'steer_subagent',
  'self_test',
]);

/** Max steps per macro to prevent runaway recording */
const MAX_STEPS = 100;

/** Max result data length to store per step */
const MAX_RESULT_LENGTH = 500;

export class WorkflowAutomator {
  private macros: Map<string, WorkflowMacro> = new Map();
  private macroDir: string;

  // Recording state
  private recording = false;
  private recordingName = '';
  private recordingSteps: WorkflowStep[] = [];
  private recordingStartedAt = 0;

  // Tool execution callback (for ToolsService hook)
  private toolExecuteCallback: ((name: string, params: any, result: ToolResult, durationMs: number) => void) | null =
    null;

  // ToolsService reference for replay
  private toolsExecute?: (name: string, params: any) => Promise<ToolResult>;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.macroDir = path.join(userDataPath, 'workspace', 'workflow', 'macros');
    if (!fs.existsSync(this.macroDir)) {
      fs.mkdirSync(this.macroDir, { recursive: true });
    }
    this.loadMacros();
  }

  // ─── Setup ───

  /**
   * Set the tool execution function for replay.
   * This should be ToolsService.execute.bind(toolsService).
   */
  setToolExecutor(executor: (name: string, params: any) => Promise<ToolResult>): void {
    this.toolsExecute = executor;
  }

  /**
   * Get the callback that should be installed in ToolsService.execute().
   * ToolsService calls this after every tool execution.
   */
  getToolExecutedCallback(): (name: string, params: any, result: ToolResult, durationMs: number) => void {
    if (!this.toolExecuteCallback) {
      this.toolExecuteCallback = (name, params, result, durationMs) => {
        this.onToolExecuted(name, params, result, durationMs);
      };
    }
    return this.toolExecuteCallback;
  }

  // ─── Recording ───

  /**
   * Start recording tool calls into a new macro.
   */
  startRecording(name: string): { success: boolean; error?: string } {
    if (this.recording) {
      return { success: false, error: `Nagrywanie jest już aktywne: "${this.recordingName}"` };
    }
    if (!name || name.trim().length === 0) {
      return { success: false, error: 'Nazwa makra nie może być pusta' };
    }

    this.recording = true;
    this.recordingName = name.trim();
    this.recordingSteps = [];
    this.recordingStartedAt = Date.now();

    log.info(`Recording started: "${this.recordingName}"`);
    return { success: true };
  }

  /**
   * Stop recording and save the macro.
   */
  stopRecording(description?: string): { success: boolean; macro?: WorkflowMacro; error?: string } {
    if (!this.recording) {
      return { success: false, error: 'Nagrywanie nie jest aktywne' };
    }

    if (this.recordingSteps.length === 0) {
      this.recording = false;
      this.recordingName = '';
      this.recordingSteps = [];
      return { success: false, error: 'Brak nagranych kroków — makro nie zostało zapisane' };
    }

    const id = `macro_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const macro: WorkflowMacro = {
      id,
      name: this.recordingName,
      description: description || `Nagrane makro z ${this.recordingSteps.length} krokami`,
      source: 'recording',
      steps: [...this.recordingSteps],
      createdAt: Date.now(),
      runCount: 0,
      parameters: this.detectParameters(this.recordingSteps),
    };

    this.macros.set(id, macro);
    this.saveMacro(macro);

    const result = { success: true, macro };

    // Reset recording state
    this.recording = false;
    this.recordingName = '';
    this.recordingSteps = [];
    this.recordingStartedAt = 0;

    log.info(`Recording stopped: "${macro.name}" — ${macro.steps.length} steps saved as ${id}`);
    return result;
  }

  /**
   * Get current recording state.
   */
  getRecordingState(): WorkflowRecordingState {
    return {
      isRecording: this.recording,
      macroName: this.recording ? this.recordingName : undefined,
      stepsRecorded: this.recordingSteps.length,
      startedAt: this.recording ? this.recordingStartedAt : undefined,
    };
  }

  /**
   * Called by ToolsService after each tool execution.
   * Records the step if recording is active.
   */
  private onToolExecuted(name: string, params: any, result: ToolResult, durationMs: number): void {
    if (!this.recording) return;
    if (EXCLUDED_TOOLS.has(name)) return;
    if (this.recordingSteps.length >= MAX_STEPS) {
      log.warn(`Recording limit reached (${MAX_STEPS} steps) — ignoring further calls`);
      return;
    }

    // Summarize result data for storage (truncate large outputs)
    let resultSummary: string | undefined;
    if (result.data !== undefined) {
      const str = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
      resultSummary = str.length > MAX_RESULT_LENGTH ? str.slice(0, MAX_RESULT_LENGTH) + '...' : str;
    }

    const step: WorkflowStep = {
      index: this.recordingSteps.length,
      toolName: name,
      params: this.sanitizeParams(params),
      success: result.success,
      resultSummary,
      durationMs,
      timestamp: Date.now(),
    };

    this.recordingSteps.push(step);
    log.info(`Recorded step #${step.index}: ${name} (${result.success ? 'OK' : 'FAIL'}, ${durationMs}ms)`);
  }

  // ─── Replay ───

  /**
   * Replay a macro by executing its steps sequentially.
   *
   * @param macroId - ID of the macro to replay
   * @param paramOverrides - Parameter substitutions (param name → new value)
   * @param stopOnError - Whether to stop on first error (default: true)
   */
  async replay(
    macroId: string,
    paramOverrides?: Record<string, string>,
    stopOnError = true,
  ): Promise<WorkflowReplayResult> {
    const macro = this.macros.get(macroId);
    if (!macro) {
      return {
        macroId,
        macroName: 'unknown',
        success: false,
        stepsExecuted: 0,
        stepsTotal: 0,
        results: [],
        totalDurationMs: 0,
        stoppedReason: `Makro "${macroId}" nie istnieje`,
      };
    }

    if (!this.toolsExecute) {
      return {
        macroId,
        macroName: macro.name,
        success: false,
        stepsExecuted: 0,
        stepsTotal: macro.steps.length,
        results: [],
        totalDurationMs: 0,
        stoppedReason: 'ToolsService nie jest podłączony',
      };
    }

    log.info(`Replaying macro "${macro.name}" (${macro.steps.length} steps)...`);

    const results: WorkflowReplayResult['results'] = [];
    let stepsExecuted = 0;
    let overallSuccess = true;
    let stoppedReason: string | undefined;
    const startTime = Date.now();

    for (const step of macro.steps) {
      const stepStart = Date.now();

      // Apply parameter overrides
      const params = this.applyParamOverrides(step.params, macro.parameters, paramOverrides);

      try {
        const result = await this.toolsExecute(step.toolName, params);
        const durationMs = Date.now() - stepStart;
        stepsExecuted++;

        results.push({
          stepIndex: step.index,
          toolName: step.toolName,
          success: result.success,
          error: result.error,
          durationMs,
        });

        if (!result.success) {
          overallSuccess = false;
          if (stopOnError) {
            stoppedReason = `Krok #${step.index} (${step.toolName}) nie powiódł się: ${result.error}`;
            break;
          }
        }

        log.info(`Replay step #${step.index}: ${step.toolName} — ${result.success ? 'OK' : 'FAIL'} (${durationMs}ms)`);
      } catch (err) {
        const durationMs = Date.now() - stepStart;
        stepsExecuted++;
        overallSuccess = false;

        results.push({
          stepIndex: step.index,
          toolName: step.toolName,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs,
        });

        if (stopOnError) {
          stoppedReason = `Krok #${step.index} (${step.toolName}) rzucił wyjątek: ${err instanceof Error ? err.message : String(err)}`;
          break;
        }
      }
    }

    const totalDurationMs = Date.now() - startTime;

    // Update macro stats
    macro.lastRunAt = Date.now();
    macro.runCount++;
    this.saveMacro(macro);

    log.info(
      `Macro "${macro.name}" replay ${overallSuccess ? 'completed' : 'failed'}: ` +
        `${stepsExecuted}/${macro.steps.length} steps in ${totalDurationMs}ms`,
    );

    return {
      macroId,
      macroName: macro.name,
      success: overallSuccess,
      stepsExecuted,
      stepsTotal: macro.steps.length,
      results,
      totalDurationMs,
      stoppedReason,
    };
  }

  // ─── CRUD ───

  /**
   * List all saved macros (summary info only).
   */
  listMacros(): Array<Omit<WorkflowMacro, 'steps'> & { stepCount: number }> {
    return Array.from(this.macros.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        source: m.source,
        stepCount: m.steps.length,
        createdAt: m.createdAt,
        lastRunAt: m.lastRunAt,
        runCount: m.runCount,
        tags: m.tags,
        parameters: m.parameters,
        steps: [], // excluded from list view
      }));
  }

  /**
   * Get a macro by ID (with full steps).
   */
  getMacro(id: string): WorkflowMacro | null {
    return this.macros.get(id) ?? null;
  }

  /**
   * Delete a macro.
   */
  deleteMacro(id: string): boolean {
    const macro = this.macros.get(id);
    if (!macro) return false;

    this.macros.delete(id);
    const filePath = path.join(this.macroDir, `${id}.json`);
    fsp.unlink(filePath).catch(() => {});

    log.info(`Deleted macro "${macro.name}" (${id})`);
    return true;
  }

  /**
   * Rename a macro.
   */
  renameMacro(id: string, newName: string): boolean {
    const macro = this.macros.get(id);
    if (!macro) return false;
    macro.name = newName.trim();
    this.saveMacro(macro);
    return true;
  }

  // ─── AI Tools Registration ───

  /**
   * Register workflow automator tools with ToolsService.
   */
  registerTools(
    register: (
      def: import('../../shared/types/tools').ToolDefinition,
      handler: (params: any) => Promise<ToolResult>,
    ) => void,
  ): void {
    register(
      {
        name: 'macro_start',
        description:
          'Rozpocznij nagrywanie makra. Wszystkie kolejne wywołania narzędzi zostaną nagrane jako kroki makra.',
        category: 'workflow',
        parameters: {
          name: { type: 'string', description: 'Nazwa makra (np. "Generuj raport tygodniowy")', required: true },
        },
      },
      async (params) => {
        const result = this.startRecording(params.name);
        return {
          success: result.success,
          data: result.success
            ? `🔴 Nagrywanie makra "${params.name}" rozpoczęte. Wszystkie narzędzia które wywołam zostaną nagrane. Użyj macro_stop żeby zakończyć.`
            : result.error,
          error: result.error,
        };
      },
    );

    register(
      {
        name: 'macro_stop',
        description: 'Zatrzymaj nagrywanie makra i zapisz je. Opcjonalnie dodaj opis.',
        category: 'workflow',
        parameters: {
          description: { type: 'string', description: 'Opis makra (opcjonalny)' },
        },
      },
      async (params) => {
        const result = this.stopRecording(params.description);
        if (result.success && result.macro) {
          const m = result.macro;
          const steps = m.steps.map((s) => `  ${s.index + 1}. ${s.toolName}${s.success ? ' ✅' : ' ❌'}`).join('\n');
          const paramInfo =
            m.parameters && m.parameters.length > 0
              ? `\n\nWykryte parametry do podmienienia:\n${m.parameters.map((p) => `  - ${p.name}: ${p.description}`).join('\n')}`
              : '';
          return {
            success: true,
            data: `✅ Makro "${m.name}" zapisane (${m.steps.length} kroków):\n${steps}${paramInfo}\n\nID: ${m.id}`,
          };
        }
        return { success: false, error: result.error };
      },
    );

    register(
      {
        name: 'macro_list',
        description: 'Wyświetl listę wszystkich zapisanych makr.',
        category: 'workflow',
        parameters: {},
      },
      async () => {
        const macros = this.listMacros();
        if (macros.length === 0) {
          return { success: true, data: 'Brak zapisanych makr.' };
        }
        const list = macros
          .map((m) => {
            const params =
              m.parameters && m.parameters.length > 0
                ? ` [parametry: ${m.parameters.map((p) => p.name).join(', ')}]`
                : '';
            const lastRun = m.lastRunAt
              ? `, ostatnie uruchomienie: ${new Date(m.lastRunAt).toLocaleString('pl-PL')}`
              : '';
            return `• **${m.name}** (${m.stepCount} kroków, odtworzono ${m.runCount}x${lastRun})${params}\n  ID: ${m.id}`;
          })
          .join('\n');
        return { success: true, data: `Zapisane makra (${macros.length}):\n${list}` };
      },
    );

    register(
      {
        name: 'macro_replay',
        description:
          'Odtwórz zapisane makro — wykonaj wszystkie nagrane kroki po kolei. Możesz podać nowe wartości parametrów.',
        category: 'workflow',
        parameters: {
          macro_id: { type: 'string', description: 'ID makra do odtworzenia', required: true },
          params: {
            type: 'string',
            description: 'JSON z nadpisanymi parametrami (np. {"filename": "report_Q2.xlsx"}). Opcjonalne.',
          },
          stop_on_error: {
            type: 'boolean',
            description: 'Czy zatrzymać odtwarzanie po pierwszym błędzie (domyślnie: true)',
          },
        },
      },
      async (params) => {
        let overrides: Record<string, string> | undefined;
        if (params.params) {
          try {
            overrides = typeof params.params === 'string' ? JSON.parse(params.params) : params.params;
          } catch {
            return { success: false, error: 'Nieprawidłowy JSON w parametrze "params"' };
          }
        }

        const result = await this.replay(params.macro_id, overrides, params.stop_on_error !== false);

        const stepResults = result.results
          .map(
            (r) =>
              `  ${r.stepIndex + 1}. ${r.toolName}: ${r.success ? '✅' : `❌ ${r.error || ''}`} (${r.durationMs}ms)`,
          )
          .join('\n');

        const summary = result.success
          ? `✅ Makro "${result.macroName}" odtworzone pomyślnie (${result.stepsExecuted}/${result.stepsTotal} kroków, ${result.totalDurationMs}ms)`
          : `❌ Makro "${result.macroName}" nie powiodło się: ${result.stoppedReason || 'błąd'}\n` +
            `Wykonano ${result.stepsExecuted}/${result.stepsTotal} kroków`;

        return {
          success: result.success,
          data: `${summary}\n\nKroki:\n${stepResults}`,
          error: result.stoppedReason,
        };
      },
    );

    register(
      {
        name: 'macro_delete',
        description: 'Usuń zapisane makro.',
        category: 'workflow',
        parameters: {
          macro_id: { type: 'string', description: 'ID makra do usunięcia', required: true },
        },
      },
      async (params) => {
        const macro = this.getMacro(params.macro_id);
        if (!macro) {
          return { success: false, error: `Makro "${params.macro_id}" nie istnieje` };
        }
        this.deleteMacro(params.macro_id);
        return { success: true, data: `🗑️ Makro "${macro.name}" usunięte.` };
      },
    );

    log.info('Registered 5 workflow automator tools');
  }

  // ─── Persistence ───

  private loadMacros(): void {
    try {
      if (!fs.existsSync(this.macroDir)) return;
      const files = fs.readdirSync(this.macroDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.macroDir, file), 'utf8');
          const macro: WorkflowMacro = JSON.parse(content);
          if (macro.id && macro.name && Array.isArray(macro.steps)) {
            this.macros.set(macro.id, macro);
          }
        } catch {
          log.warn(`Failed to load macro file: ${file}`);
        }
      }
      log.info(`Loaded ${this.macros.size} macros from disk`);
    } catch {
      log.warn('Failed to load macros directory');
    }
  }

  private saveMacro(macro: WorkflowMacro): void {
    const filePath = path.join(this.macroDir, `${macro.id}.json`);
    fsp.writeFile(filePath, JSON.stringify(macro, null, 2), 'utf8').catch((err) => {
      log.error(`Failed to save macro "${macro.name}":`, err);
    });
  }

  // ─── Parameter Detection ───

  /**
   * Detect parameterizable values in recorded steps.
   * Finds string values that appear in multiple steps (likely candidates for substitution).
   */
  private detectParameters(steps: WorkflowStep[]): WorkflowMacroParam[] {
    if (steps.length < 2) return [];

    // Collect all string param values across steps
    const valueOccurrences: Map<string, Array<{ stepIndex: number; paramKey: string }>> = new Map();

    for (const step of steps) {
      for (const [key, value] of Object.entries(step.params)) {
        if (typeof value !== 'string' || value.length < 3 || value.length > 500) continue;
        // Skip common non-parameterizable values
        if (['true', 'false', 'null', 'undefined'].includes(value)) continue;

        const refs = valueOccurrences.get(value) ?? [];
        refs.push({ stepIndex: step.index, paramKey: key });
        valueOccurrences.set(value, refs);
      }
    }

    // Values appearing in 2+ steps are likely parameters
    const params: WorkflowMacroParam[] = [];
    for (const [value, refs] of valueOccurrences) {
      if (refs.length >= 2) {
        // Generate a meaningful param name from the most common key
        const keyCounts: Record<string, number> = {};
        for (const ref of refs) {
          keyCounts[ref.paramKey] = (keyCounts[ref.paramKey] || 0) + 1;
        }
        const bestKey = Object.entries(keyCounts).sort(([, a], [, b]) => b - a)[0][0];

        params.push({
          name: bestKey,
          description: `Wartość "${value.slice(0, 50)}${value.length > 50 ? '...' : ''}" (użyta w ${refs.length} krokach)`,
          defaultValue: value,
          references: refs,
        });
      }
    }

    // Also detect file paths, URLs as parameterizable even if used once
    for (const step of steps) {
      for (const [key, value] of Object.entries(step.params)) {
        if (typeof value !== 'string') continue;
        // File paths
        if (
          (value.includes('/') || value.includes('\\')) &&
          value.length > 5 &&
          !params.some((p) => p.defaultValue === value)
        ) {
          if (
            ['path', 'file', 'filename', 'filepath', 'dir', 'directory', 'folder'].some((k) =>
              key.toLowerCase().includes(k),
            )
          ) {
            params.push({
              name: key,
              description: `Ścieżka pliku: "${value.slice(0, 80)}${value.length > 80 ? '...' : ''}"`,
              defaultValue: value,
              references: [{ stepIndex: step.index, paramKey: key }],
            });
          }
        }
        // URLs
        if (
          (value.startsWith('http://') || value.startsWith('https://')) &&
          !params.some((p) => p.defaultValue === value)
        ) {
          params.push({
            name: key,
            description: `URL: "${value.slice(0, 80)}${value.length > 80 ? '...' : ''}"`,
            defaultValue: value,
            references: [{ stepIndex: step.index, paramKey: key }],
          });
        }
      }
    }

    return params;
  }

  // ─── Helpers ───

  /**
   * Sanitize params for storage — remove potentially sensitive data, truncate large values.
   */
  private sanitizeParams(params: any): Record<string, any> {
    if (!params || typeof params !== 'object') return {};

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      // Skip sensitive-looking keys
      if (
        ['password', 'token', 'secret', 'api_key', 'apiKey', 'credential'].some((s) => key.toLowerCase().includes(s))
      ) {
        sanitized[key] = '***REDACTED***';
        continue;
      }

      if (typeof value === 'string') {
        sanitized[key] = value.length > 2000 ? value.slice(0, 2000) + '...' : value;
      } else if (typeof value === 'object' && value !== null) {
        const str = JSON.stringify(value);
        sanitized[key] = str.length > 2000 ? JSON.parse(str.slice(0, 2000) + '"}') : value;
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * Apply parameter overrides to step params.
   */
  private applyParamOverrides(
    stepParams: Record<string, any>,
    macroParams: WorkflowMacroParam[] | undefined,
    overrides: Record<string, string> | undefined,
  ): Record<string, any> {
    if (!overrides || !macroParams || macroParams.length === 0) {
      return { ...stepParams };
    }

    const result = { ...stepParams };

    for (const macroParam of macroParams) {
      if (!(macroParam.name in overrides)) continue;
      const newValue = overrides[macroParam.name];
      const oldValue = macroParam.defaultValue;

      // Replace in all matching param keys
      for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'string' && oldValue && value.includes(oldValue)) {
          result[key] = value.replace(oldValue, newValue);
        }
      }
    }

    return result;
  }
}
