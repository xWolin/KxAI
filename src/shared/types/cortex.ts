/**
 * Shared Cortex types — unified autonomous agent system.
 *
 * Replaces separate types for HeartbeatEngine, ProactiveEngine, and ReflectionEngine
 * with a single unified CortexEngine type system.
 *
 * @phase Cortex unification
 */

// ─── Cortex Intensity Tiers ───

/** Controls API cost vs responsiveness trade-off */
export type CortexIntensity = 'eco' | 'balanced' | 'performance';

/** Tier configuration — derived from CortexIntensity */
export interface CortexTierConfig {
  /** Interval between AI think cycles (ms) */
  thinkIntervalMs: number;
  /** Interval between proactive rule checks (ms) */
  ruleCheckIntervalMs: number;
  /** Screen monitoring mode */
  screenMode: CortexScreenMode;
  /** Vision analysis interval when screen monitoring is active (ms) */
  visionIntervalMs: number;
  /** How often deep reflection runs (ms) */
  reflectionIntervalMs: number;
  /** Whether to run evening/weekly reflections */
  scheduledReflections: boolean;
}

// ─── Screen Monitoring ───

/** Agent-controlled screen monitoring modes */
export type CortexScreenMode = 'off' | 'passive' | 'active' | 'intensive';

// ─── Cortex Messages ───

/** Source of a Cortex message */
export type CortexMessageSource = 'think' | 'alert' | 'reflection' | 'welcome-back' | 'afk-task';

/** Priority levels for Cortex messages */
export type CortexMessagePriority = 'low' | 'normal' | 'high' | 'critical';

/** A single applied memory update — passed to UI for user-visible confirmation */
export interface CortexMemoryUpdate {
  /** Logical file key: 'soul' | 'user' | 'memory' */
  file: string;
  /** The section heading that was updated */
  section: string;
  /** First 80 characters of the saved content for quick preview */
  contentSnippet: string;
}

/** Unified message from CortexEngine to UI */
export interface CortexMessage {
  /** Unique message ID */
  id: string;
  /** What generated this message */
  source: CortexMessageSource;
  /** How urgently should the user see this */
  priority: CortexMessagePriority;
  /** The actual message content */
  message: string;
  /** Additional context (e.g., rule ID, reflection type) */
  context?: string;
  /** Optional rule ID for feedback tracking */
  ruleId?: string;
  /** Timestamp */
  timestamp: number;
  /** Optional structured proposal attached to this message */
  proposal?: CortexProposal;
  /** Memory updates applied during this think cycle — shown as save confirmation */
  memoryUpdates?: CortexMemoryUpdate[];
}

// ─── Cortex Status ───

/** Overall Cortex engine status */
export interface CortexStatus {
  /** Is the engine running */
  enabled: boolean;
  /** Current intensity tier */
  intensity: CortexIntensity;
  /** Current screen monitoring mode */
  screenMode: CortexScreenMode;
  /** Active hours configuration */
  activeHours: { start: string; end: string } | null;
  /** Is user currently AFK */
  isAfk: boolean;
  /** Last think cycle timestamp */
  lastThinkAt: number;
  /** Last reflection timestamp */
  lastReflectionAt: number;
  /** Total think cycles since start */
  totalThinkCycles: number;
  /** Total reflections since start */
  totalReflections: number;
  /** Pending events in queue */
  pendingEvents: number;
  /** Proactive rule stats */
  ruleStats: CortexRuleStats;
}

/** Proactive rule statistics (from learning loop) */
export interface CortexRuleStats {
  totalFired: number;
  totalAccepted: number;
  totalDismissed: number;
  rulesEnabled: number;
  ruleDetails: Array<{
    ruleId: string;
    name: string;
    fired: number;
    accepted: number;
    dismissed: number;
    acceptRate: number;
    lastFired: number | null;
  }>;
}

/** Feedback from user on a Cortex notification */
export interface CortexFeedback {
  ruleId: string;
  action: 'accepted' | 'dismissed' | 'replied';
  timestamp: number;
}

// ─── System Event Queue ───

/** Events queued for the next Cortex think cycle */
export interface CortexSystemEvent {
  id: string;
  source: string;
  text: string;
  timestamp: number;
  priority: CortexMessagePriority;
}

// ─── Cortex Proposals ───

/** Structured action proposal from CortexEngine */
export interface CortexProposal {
  /** Unique proposal ID */
  id: string;
  /** Type of proposal */
  type: 'automation' | 'reminder' | 'optimization' | 'pattern';
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** Risk level of proposed actions */
  risk: import('./security').ActionRisk;
  /** Optional tool calls to execute if user accepts */
  toolCalls?: Array<{ name: string; params: Record<string, any> }>;
  /** Expiration timestamp */
  expiresAt?: number;
}

// ─── Tier Presets ───

export const CORTEX_TIER_PRESETS: Record<CortexIntensity, CortexTierConfig> = {
  eco: {
    thinkIntervalMs: 15 * 60 * 1000, // 15 min
    ruleCheckIntervalMs: 5 * 60 * 1000, // 5 min
    screenMode: 'passive',
    visionIntervalMs: 5 * 60 * 1000, // 5 min (on-demand only)
    reflectionIntervalMs: 24 * 60 * 60 * 1000, // 1x/day
    scheduledReflections: false,
  },
  balanced: {
    thinkIntervalMs: 5 * 60 * 1000, // 5 min
    ruleCheckIntervalMs: 60 * 1000, // 60s
    screenMode: 'active',
    visionIntervalMs: 2 * 60 * 1000, // 2 min
    reflectionIntervalMs: 4 * 60 * 60 * 1000, // 4h
    scheduledReflections: true,
  },
  performance: {
    thinkIntervalMs: 2 * 60 * 1000, // 2 min
    ruleCheckIntervalMs: 30 * 1000, // 30s
    screenMode: 'active',
    visionIntervalMs: 30 * 1000, // 30s
    reflectionIntervalMs: 60 * 60 * 1000, // 1h
    scheduledReflections: true,
  },
};
