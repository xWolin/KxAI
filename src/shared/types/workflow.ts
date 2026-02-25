/**
 * Shared workflow / activity types — used by both main process and renderer.
 */

export interface ActivityEntry {
  timestamp: number;
  hour: number;
  dayOfWeek: number; // 0=Sun, 6=Sat
  action: string;
  context: string;
  category: string;
}

export interface WorkflowPattern {
  id: string;
  description: string;
  timeRange: { startHour: number; endHour: number };
  daysOfWeek: number[];
  frequency: number; // how many times observed
  lastSeen: number;
  suggestedCron?: string;
  acknowledged: boolean;
}

// ─── Workflow Automator (Macro Recorder) — Faza 6.2 ───

/** A single recorded step in a workflow macro */
export interface WorkflowStep {
  /** Sequential index (0-based) */
  index: number;
  /** Tool name as registered in ToolsService */
  toolName: string;
  /** Parameters passed to the tool */
  params: Record<string, any>;
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Tool result data (truncated for storage) */
  resultSummary?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when this step was executed */
  timestamp: number;
}

/** A saved workflow macro (sequence of tool calls) */
export interface WorkflowMacro {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
  /** Who/what created this macro */
  source: 'recording' | 'manual' | 'ai-generated';
  /** Recorded steps */
  steps: WorkflowStep[];
  /** When the macro was created */
  createdAt: number;
  /** When the macro was last run */
  lastRunAt?: number;
  /** How many times it was replayed */
  runCount: number;
  /** Tags for organization */
  tags?: string[];
  /** Parameter placeholders that can be substituted on replay */
  parameters?: WorkflowMacroParam[];
}

/** A parameterizable placeholder in a macro */
export interface WorkflowMacroParam {
  /** Param name (e.g. "filename", "query") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Default value */
  defaultValue?: string;
  /** Which step indices and param keys reference this parameter */
  references: Array<{ stepIndex: number; paramKey: string }>;
}

/** Result of replaying a macro */
export interface WorkflowReplayResult {
  macroId: string;
  macroName: string;
  success: boolean;
  stepsExecuted: number;
  stepsTotal: number;
  /** Per-step results */
  results: Array<{
    stepIndex: number;
    toolName: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
  totalDurationMs: number;
  /** If replay was stopped early, the reason */
  stoppedReason?: string;
}

/** Recording session state */
export interface WorkflowRecordingState {
  isRecording: boolean;
  macroName?: string;
  stepsRecorded: number;
  startedAt?: number;
}
