/**
 * CortexEngine — Unified autonomous agent brain.
 *
 * Merges HeartbeatEngine, ProactiveEngine, and ReflectionEngine into a single
 * always-on system with three responsibilities:
 *
 * 1. **Rule Checks** (zero cost): Proactive rules evaluate system/calendar/health context
 *    and fire notifications (meeting reminders, battery warnings, etc.)
 *
 * 2. **AI Think** (API cost): Periodic heartbeat-like AI cycles with screen context,
 *    observation history, HEARTBEAT.md tasks, tool loops.
 *    Suppressed with CORTEX_OK when nothing interesting to say.
 *
 * 3. **Reflection** (API cost): Deep/evening/weekly reflection cycles with full context
 *    gathering, anti-repetition, and memory updates.
 *
 * Architecture:
 * - Single main loop with two timers (think + rule check)
 * - Queue policy: skip think cycle if AgentLoop is processing user message
 * - System event queue: collects events between think cycles
 * - Tier-based intervals (eco/balanced/performance)
 * - Agent controls its own screen monitoring via AI tools
 * - All messages routed through unified CortexMessage format
 *
 * @phase Cortex unification
 */

import type { AIService, NativeToolStreamResult } from './ai-service';
import type { MemoryService } from './memory';
import type { WorkflowService } from './workflow-service';
import type { CronService } from './cron-service';
import type { ToolsService } from './tools-service';
import type { PromptService } from './prompt-service';
import type { ResponseProcessor } from './response-processor';
import type { ConfigService } from './config';
import type { CalendarService } from './calendar-service';
import type { SystemMonitor } from './system-monitor';
import type { KnowledgeGraphService } from './knowledge-graph-service';
import type { McpClientService } from './mcp-client-service';
import type { SecurityGuard } from './security-guard';
import type { CalendarEvent } from '../../shared/types/calendar';
import type { SystemSnapshot } from '../../shared/types/system';
import type { AgentStatus } from '../../shared/types/agent';
import type { ToolDefinition } from '../../shared/types/tools';
import type {
  CortexIntensity,
  CortexTierConfig,
  CortexScreenMode,
  CortexMessage,
  CortexMessageSource,
  CortexMessagePriority,
  CortexStatus,
  CortexRuleStats,
  CortexFeedback,
  CortexSystemEvent,
  CortexProposal,
} from '../../shared/types/cortex';
import type { ActionApprovalRequest, ActionApprovalResponse } from '../../shared/types/security';
import { CORTEX_TIER_PRESETS } from '../../shared/types/cortex';
import { ToolLoopDetector } from './tool-loop-detector';
import { createLogger } from './logger';

const log = createLogger('CortexEngine');

// ─── Types ───

export interface CortexEngineDeps {
  ai: AIService;
  memory: MemoryService;
  workflow: WorkflowService;
  cron: CronService;
  tools: ToolsService;
  promptService: PromptService;
  responseProcessor: ResponseProcessor;
  config: ConfigService;
  securityGuard: SecurityGuard;
}

/** Screen monitor interface (subset of ScreenMonitorService) */
interface ScreenMonitorRef {
  isRunning(): boolean;
  buildMonitorContext(): string;
  getCurrentWindow(): { title: string } | null;
  start(
    onWindowChange?: (info: any) => void,
    onContentChange?: (ctx: any) => void,
    onVisionNeeded?: (ctx: any, screenshots: Array<{ base64: string; label: string }>) => void,
    onIdleStart?: () => void,
    onIdleEnd?: () => void,
  ): void;
  stop(): void;
}

// ─── Proactive Rule types (inherited from ProactiveEngine) ───

interface ProactiveContext {
  now: Date;
  hourOfDay: number;
  dayOfWeek: number;
  timeOfDay: 'night' | 'morning' | 'afternoon' | 'evening';
  upcomingEvents: CalendarEvent[];
  todayEvents: CalendarEvent[];
  calendarConnected: boolean;
  systemSnapshot: SystemSnapshot | null;
  systemWarnings: string[];
  timeContext: string;
  currentSessionMinutes: number;
  screenContext: string;
  currentWindow: string;
  kgSummary: string;
  isAfk: boolean;
  mcpConnectedServers: string[];
}

interface ProactiveRule {
  id: string;
  name: string;
  priority: number;
  cooldownMs: number;
  shouldFire(ctx: ProactiveContext, engine: CortexEngine): boolean;
  generate(
    ctx: ProactiveContext,
    engine: CortexEngine,
  ): { type: string; message: string; context: string } | Promise<{ type: string; message: string; context: string }>;
}

// ─── Observation entry (from HeartbeatEngine) ───

interface Observation {
  timestamp: number;
  windowTitle: string;
  summary: string;
  response: string;
}

// ─── Reflection context ───

interface ReflectionContext {
  type: ReflectionCycleType;
  weeklyPatterns: string;
  dailySummary: string;
  timeContext: string;
  activityLog: any[];
  activityStats24h: import('../../shared/types/workflow').ActivityStats;
  cronSummary: string;
  mcpSummary: string;
  kgSummary: string;
  calendarSummary: string;
  userMd: string;
  memoryMd: string;
  soulMd: string;
  appCategories: Array<{ category: string; count: number }>;
}

type ReflectionCycleType = 'deep' | 'evening' | 'weekly' | 'manual';

// ─── Rule feedback ───

interface RuleFeedbackEntry {
  fired: number;
  accepted: number;
  dismissed: number;
  lastFired: number | null;
}

// ═══════════════════════════════════════════════════════════════════════
// ░░░ CortexEngine ░░░
// ═══════════════════════════════════════════════════════════════════════

export class CortexEngine {
  // ─── Core deps ───
  private ai: AIService;
  private memory: MemoryService;
  private workflow: WorkflowService;
  private cron: CronService;
  private tools: ToolsService;
  private promptService: PromptService;
  private responseProcessor: ResponseProcessor;
  private config: ConfigService;
  private securityGuard: SecurityGuard;

  // ─── Optional deps (set later) ───
  private calendarService?: CalendarService;
  private systemMonitor?: SystemMonitor;
  private knowledgeGraph?: KnowledgeGraphService;
  private mcpClient?: McpClientService;
  private screenMonitor?: ScreenMonitorRef;

  // ─── Configuration ───
  private intensity: CortexIntensity = 'balanced';
  private tierConfig: CortexTierConfig = CORTEX_TIER_PRESETS.balanced;
  private screenMode: CortexScreenMode = 'active';
  private activeHours: { start: number; end: number } | null = null;

  // ─── Timers ───
  private thinkTimer: NodeJS.Timeout | null = null;
  private ruleCheckTimer: NodeJS.Timeout | null = null;
  private reflectionTimer: NodeJS.Timeout | null = null;
  private scheduledCheckTimer: NodeJS.Timeout | null = null; // 15-min check for evening/weekly
  private warmupTimer: NodeJS.Timeout | null = null;
  private approvalTimers = new Map<string, NodeJS.Timeout>();
  private abortController: AbortController | null = null;
  private enabled = false;

  // ─── AFK State ───
  private isAfk = false;
  private afkSince = 0;
  private lastAfkTaskTime = 0;
  private afkTasksDone: Set<string> = new Set();

  // ─── Observation History (from HeartbeatEngine) ───
  private observationHistory: Observation[] = [];
  private readonly MAX_OBSERVATIONS = 10;

  // ─── Proactive Rules State ───
  private rules: ProactiveRule[] = [];
  private cooldowns = new Map<string, number>();
  private feedbackMap = new Map<string, RuleFeedbackEntry>();
  private lastFiredRuleId: string | null = null;
  private notifiedEventUids = new Set<string>();
  private sessionStartTime = Date.now();

  // ─── Reflection State ───
  private lastReflectionAt = 0;
  private lastReflectionType: ReflectionCycleType | null = null;
  private totalReflections = 0;
  private reflectionHistory: string[] = [];
  private lastContextHash = '';
  private cyclesTodayDate = '';
  private cyclesRunToday = new Set<ReflectionCycleType>();
  private reflectionRunning = false;
  private static readonly MAX_REFLECTION_HISTORY = 5;

  // ─── Think State ───
  private lastThinkAt = 0;
  private totalThinkCycles = 0;
  private thinkRunning = false;

  // ─── System Event Queue ───
  private eventQueue: CortexSystemEvent[] = [];
  private static readonly MAX_EVENTS = 20;

  // ─── Action Policy ───
  private pendingActions = new Map<
    string,
    { request: ActionApprovalRequest; resolve: (response: ActionApprovalResponse) => void }
  >();
  private onActionRequest?: (request: ActionApprovalRequest) => void;

  // ─── Callbacks ───
  private isProcessingCheck?: () => boolean;
  private onMessage?: (msg: CortexMessage) => void;
  private onAfkChanged?: (isAfk: boolean) => void;
  private onScreenAnalysis?: (screenshots: Array<{ base64: string; label: string }>) => Promise<void>;
  onAgentStatus?: (status: AgentStatus) => void;

  constructor(deps: CortexEngineDeps) {
    this.ai = deps.ai;
    this.memory = deps.memory;
    this.workflow = deps.workflow;
    this.cron = deps.cron;
    this.tools = deps.tools;
    this.promptService = deps.promptService;
    this.responseProcessor = deps.responseProcessor;
    this.config = deps.config;
    this.securityGuard = deps.securityGuard;

    // Register built-in proactive rules
    this.rules = createBuiltinRules();

    log.info(`Initialized CortexEngine with ${this.rules.length} proactive rules`);
  }

  // ─── Dependency Setters ───

  setCalendarService(cal: CalendarService): void {
    this.calendarService = cal;
  }

  setSystemMonitor(mon: SystemMonitor): void {
    this.systemMonitor = mon;
  }

  setKnowledgeGraphService(kg: KnowledgeGraphService): void {
    this.knowledgeGraph = kg;
  }

  setMcpClient(mcpClient: McpClientService): void {
    this.mcpClient = mcpClient;
  }

  setScreenMonitor(monitor: ScreenMonitorRef): void {
    this.screenMonitor = monitor;
  }

  setProcessingCheck(check: () => boolean): void {
    this.isProcessingCheck = check;
  }

  setMessageCallback(cb: (msg: CortexMessage) => void): void {
    this.onMessage = cb;
  }

  setAfkCallback(cb: (isAfk: boolean) => void): void {
    this.onAfkChanged = cb;
  }

  setScreenAnalysisCallback(cb: (screenshots: Array<{ base64: string; label: string }>) => Promise<void>): void {
    this.onScreenAnalysis = cb;
  }

  setActionRequestCallback(cb: (request: ActionApprovalRequest) => void): void {
    this.onActionRequest = cb;
  }

  /**
   * Handle user response to an action approval request.
   * Called via IPC from renderer when user approves/denies.
   */
  handleActionResponse(response: ActionApprovalResponse): void {
    const pending = this.pendingActions.get(response.requestId);
    if (!pending) {
      log.warn(`No pending action for requestId: ${response.requestId}`);
      return;
    }
    this.pendingActions.delete(response.requestId);

    // Clear the approval timeout timer
    const timer = this.approvalTimers.get(response.requestId);
    if (timer) {
      clearTimeout(timer);
      this.approvalTimers.delete(response.requestId);
    }

    // If approved and moderate risk, remember for session
    if (response.approved && pending.request.risk === 'moderate') {
      this.securityGuard.approveModerateToolForSession(pending.request.toolName);
    }

    pending.resolve(response);
    log.info(`Action ${response.requestId}: ${response.approved ? 'approved' : 'denied'} by user`);
  }

  /**
   * Get all pending action approval requests (for UI recovery after reconnect).
   */
  getPendingActions(): ActionApprovalRequest[] {
    return Array.from(this.pendingActions.values()).map((p) => p.request);
  }

  /**
   * Request user approval for a tool call. Returns a Promise that resolves
   * when user responds (or rejects on timeout).
   */
  private requestActionApproval(
    toolName: string,
    params: Record<string, unknown>,
    risk: import('../../shared/types/security').ActionRisk,
    reason: string,
  ): Promise<ActionApprovalResponse> {
    return new Promise<ActionApprovalResponse>((resolve) => {
      const requestId = `ap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const request: ActionApprovalRequest = {
        requestId,
        toolName,
        params,
        risk,
        reason,
        timestamp: Date.now(),
      };

      this.pendingActions.set(requestId, { request, resolve });

      // Emit to renderer via callback
      if (this.onActionRequest) {
        this.onActionRequest(request);
      } else {
        // No UI connected — auto-deny dangerous, auto-approve moderate
        log.warn(`No action request callback — auto-${risk === 'dangerous' ? 'denying' : 'approving'}: ${toolName}`);
        this.pendingActions.delete(requestId);
        resolve({ requestId, approved: risk !== 'dangerous' });
      }

      // Timeout after 60 seconds — auto-deny
      const timer = setTimeout(() => {
        if (this.pendingActions.has(requestId)) {
          this.pendingActions.delete(requestId);
          this.approvalTimers.delete(requestId);
          log.warn(`Action approval timeout (60s): ${toolName} — auto-denied`);
          resolve({ requestId, approved: false });
        }
      }, 60_000);
      this.approvalTimers.set(requestId, timer);
    });
  }

  // ─── Public API ───

  /**
   * Start the CortexEngine with the configured intensity tier.
   */
  start(): void {
    this.stop();
    this.enabled = true;
    this.sessionStartTime = Date.now();
    this.notifiedEventUids.clear();

    // Load config
    this.intensity = (this.config.get('cortexIntensity') as CortexIntensity) || 'balanced';
    this.tierConfig = CORTEX_TIER_PRESETS[this.intensity];
    this.screenMode = this.tierConfig.screenMode;

    // Parse active hours
    this.loadActiveHours();

    log.info(
      `Starting CortexEngine [${this.intensity}] — think: ${this.tierConfig.thinkIntervalMs / 1000}s, rules: ${this.tierConfig.ruleCheckIntervalMs / 1000}s, reflection: ${this.tierConfig.reflectionIntervalMs / 60000}min`,
    );

    // Start screen monitoring if enabled
    this.applyScreenMode(this.screenMode);

    // Initial config load for active hours
    this.loadActiveHours();

    // Listen to config changes
    this.config.on('cortexActiveHoursStart', () => this.loadActiveHours());
    this.config.on('cortexActiveHoursEnd', () => this.loadActiveHours());

    // ── Rule check timer (zero cost) ──
    this.ruleCheckTimer = setInterval(() => {
      if (this.enabled) void this.evaluateRules();
    }, this.tierConfig.ruleCheckIntervalMs);

    // First rule check after 10s warmup
    this.warmupTimer = setTimeout(() => {
      if (this.enabled) void this.evaluateRules();
    }, 10_000);

    // ── AI Think timer ──
    this.thinkTimer = setInterval(() => {
      if (this.enabled) void this.think();
    }, this.tierConfig.thinkIntervalMs);

    // ── Reflection timer ──
    if (this.tierConfig.scheduledReflections) {
      this.reflectionTimer = setInterval(() => {
        if (this.enabled) void this.safeRunReflection('deep');
      }, this.tierConfig.reflectionIntervalMs);

      // 15-min check for scheduled cycles (evening/weekly)
      this.scheduledCheckTimer = setInterval(
        () => {
          if (this.enabled) void this.checkScheduledReflections();
        },
        15 * 60 * 1000,
      );
    }
  }

  /**
   * Stop the CortexEngine.
   */
  stop(): void {
    this.enabled = false;

    if (this.thinkTimer) {
      clearInterval(this.thinkTimer);
      this.thinkTimer = null;
    }
    if (this.ruleCheckTimer) {
      clearInterval(this.ruleCheckTimer);
      this.ruleCheckTimer = null;
    }
    if (this.reflectionTimer) {
      clearInterval(this.reflectionTimer);
      this.reflectionTimer = null;
    }
    if (this.scheduledCheckTimer) {
      clearInterval(this.scheduledCheckTimer);
      this.scheduledCheckTimer = null;
    }
    if (this.warmupTimer) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }

    // Cancel all pending approval timers
    for (const timer of this.approvalTimers.values()) {
      clearTimeout(timer);
    }
    this.approvalTimers.clear();

    // Cancel all pending action approvals
    for (const [id, pending] of this.pendingActions) {
      pending.resolve({ requestId: id, approved: false });
    }
    this.pendingActions.clear();

    this.abortController?.abort();
    this.abortController = null;

    log.info('Stopped CortexEngine');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Change the intensity tier at runtime.
   */
  setIntensity(intensity: CortexIntensity): void {
    if (this.intensity === intensity) return;
    log.info(`Intensity change: ${this.intensity} → ${intensity}`);
    this.intensity = intensity;
    this.tierConfig = CORTEX_TIER_PRESETS[intensity];

    // Restart timers with new intervals
    if (this.enabled) {
      this.stop();
      this.start();
    }
  }

  /**
   * Set the screen monitoring mode (called by AI via tool or by user).
   */
  setScreenMode(mode: CortexScreenMode): void {
    if (this.screenMode === mode) return;
    log.info(`Screen mode: ${this.screenMode} → ${mode}`);
    this.screenMode = mode;
    this.applyScreenMode(mode);
  }

  /**
   * Set AFK state (from ScreenMonitor idle detection).
   */
  setAfkState(isAfk: boolean): void {
    if (isAfk && !this.isAfk) {
      this.afkSince = Date.now();
      this.afkTasksDone.clear();
      log.info('User went AFK');
      this.onAfkChanged?.(true);
    } else if (!isAfk && this.isAfk) {
      const awayMin = Math.round((Date.now() - this.afkSince) / 60000);
      log.info(`User returned from AFK (was away ${awayMin}min)`);
      // Queue welcome-back event
      this.pushEvent('idle', `User returned after ${awayMin} minutes AFK`, 'normal');
      this.onAfkChanged?.(false);
    }
    this.isAfk = isAfk;
  }

  /**
   * Push a system event for the next think cycle.
   */
  pushEvent(source: string, text: string, priority: CortexMessagePriority = 'normal'): void {
    if (this.eventQueue.length >= CortexEngine.MAX_EVENTS) {
      // Drop lowest priority
      this.eventQueue.sort((a, b) => this.priorityValue(b.priority) - this.priorityValue(a.priority));
      this.eventQueue.pop();
    }
    this.eventQueue.push({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      source,
      text,
      timestamp: Date.now(),
      priority,
    });
  }

  /**
   * Record user feedback on a notification (learning loop).
   */
  recordFeedback(feedback: CortexFeedback): void {
    const entry = this.feedbackMap.get(feedback.ruleId) ?? {
      fired: 0,
      accepted: 0,
      dismissed: 0,
      lastFired: null,
    };

    if (feedback.action === 'accepted' || feedback.action === 'replied') {
      entry.accepted++;
    } else if (feedback.action === 'dismissed') {
      entry.dismissed++;
    }

    this.feedbackMap.set(feedback.ruleId, entry);
    log.info(`Feedback for rule "${feedback.ruleId}": ${feedback.action}`);
  }

  /**
   * Manually trigger a reflection cycle.
   */
  async triggerReflection(type: ReflectionCycleType = 'manual'): Promise<void> {
    await this.safeRunReflection(type);
  }

  /**
   * Get full status for IPC/UI.
   */
  getStatus(): CortexStatus {
    const formatTime = (m: number) =>
      `${Math.floor(m / 60)
        .toString()
        .padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`;

    return {
      enabled: this.enabled,
      intensity: this.intensity,
      screenMode: this.screenMode,
      activeHours: this.activeHours
        ? { start: formatTime(this.activeHours.start), end: formatTime(this.activeHours.end) }
        : null,
      isAfk: this.isAfk,
      lastThinkAt: this.lastThinkAt,
      lastReflectionAt: this.lastReflectionAt,
      totalThinkCycles: this.totalThinkCycles,
      totalReflections: this.totalReflections,
      pendingEvents: this.eventQueue.length,
      ruleStats: this.getRuleStats(),
    };
  }

  /** Mark an event UID as already notified (prevents duplicate meeting reminders). */
  markEventNotified(uid: string): void {
    this.notifiedEventUids.add(uid);
  }

  isEventNotified(uid: string): boolean {
    return this.notifiedEventUids.has(uid);
  }

  /** Get accept rate for a proactive rule (0.0–1.0). Returns 0.5 if no data. */
  getAcceptRate(ruleId: string): number {
    const entry = this.feedbackMap.get(ruleId);
    if (!entry || entry.fired === 0) return 0.5;
    const total = entry.accepted + entry.dismissed;
    if (total === 0) return 0.5;
    return entry.accepted / total;
  }

  // ═══════════════════════════════════════════════════════════════
  // ░░░ 1. PROACTIVE RULES (Zero API cost) ░░░
  // ═══════════════════════════════════════════════════════════════

  private async evaluateRules(): Promise<void> {
    if (!this.isWithinActiveHours()) return;
    if (this.isAfk) return; // AI think handles AFK mode

    try {
      const ctx = await this.gatherProactiveContext();

      const candidates = this.rules
        .filter((rule) => {
          // Cooldown check
          const cooldownExpiry = this.cooldowns.get(rule.id);
          if (cooldownExpiry && Date.now() < cooldownExpiry) return false;

          // Learning loop: suppress rules with >85% dismiss rate after 5+ samples
          const acceptRate = this.getAcceptRate(rule.id);
          if (acceptRate < 0.15) {
            const fb = this.feedbackMap.get(rule.id);
            if (fb && fb.fired >= 5) return false;
          }

          try {
            return rule.shouldFire(ctx, this);
          } catch (err) {
            log.warn(`Rule "${rule.id}" shouldFire() error:`, err);
            return false;
          }
        })
        .sort((a, b) => b.priority - a.priority);

      if (candidates.length === 0) return;

      const winner = candidates[0];

      try {
        const notification = await winner.generate(ctx, this);

        // Set cooldown
        this.cooldowns.set(winner.id, Date.now() + winner.cooldownMs);

        // Track firing
        const fb = this.feedbackMap.get(winner.id) ?? { fired: 0, accepted: 0, dismissed: 0, lastFired: null };
        fb.fired++;
        fb.lastFired = Date.now();
        this.feedbackMap.set(winner.id, fb);

        this.lastFiredRuleId = winner.id;

        // Emit as CortexMessage
        this.emitMessage({
          source: 'alert',
          priority: winner.priority >= 8 ? 'critical' : winner.priority >= 5 ? 'normal' : 'low',
          message: notification.message,
          context: notification.context,
          ruleId: winner.id,
        });

        log.info(`Rule "${winner.id}" fired: ${notification.message.substring(0, 80)}...`);
      } catch (err) {
        log.warn(`Rule "${winner.id}" generate() error:`, err);
      }
    } catch (err) {
      log.error('Rule evaluation error:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ░░░ 2. AI THINK CYCLE (Heartbeat replacement) ░░░
  // ═══════════════════════════════════════════════════════════════

  private async think(): Promise<void> {
    // Queue policy: skip if agent is processing user message
    if (this.isProcessingCheck?.()) {
      log.info('Think skipped — agent is processing user message');
      return;
    }

    if (!this.isWithinActiveHours()) {
      log.info('Think skipped — outside active hours');
      return;
    }

    if (this.thinkRunning) {
      log.info('Think skipped — already running');
      return;
    }

    // AFK mode: run autonomous tasks
    if (this.isAfk) {
      await this.afkThink();
      return;
    }

    this.thinkRunning = true;

    try {
      // Read HEARTBEAT.md
      const heartbeatMd = await this.memory.get('HEARTBEAT.md');
      const heartbeatEmpty = !heartbeatMd || this.isContentEmpty(heartbeatMd);

      // Screen context
      const monitorCtx = this.screenMonitor?.isRunning() ? this.screenMonitor.buildMonitorContext() : '';
      const currentWindowTitle = this.screenMonitor?.getCurrentWindow()?.title || '';

      // Skip if no tasks AND no screen context AND no pending events
      if (heartbeatEmpty && !monitorCtx && this.eventQueue.length === 0) return;

      const timeCtx = this.workflow.buildTimeContext();

      // Activity stats — user's recent activity for context
      const activityStats = this.workflow.getActivityStats(1); // last 1 hour
      let activitySection = '';
      if (activityStats.totalSwitches > 0) {
        const topApps = activityStats.topApps
          .slice(0, 5)
          .map((a) => {
            const mins = Math.round(a.totalMs / 60000);
            return `  - ${a.processName}: ${mins > 0 ? mins + ' min' : '<1 min'} (${a.switches} przełączeń)`;
          })
          .join('\n');
        activitySection = `\n## Aktywność użytkownika (ostatnia godzina)\n${topApps}\n- Łącznie przełączeń okien: ${activityStats.totalSwitches}\n`;
      }

      const jobs = this.cron.getJobs();
      const jobsSummary = jobs
        .map((j) => `- ${j.name}: ${j.schedule} (${j.enabled ? 'aktywne' : 'wyłączone'})`)
        .join('\n');

      const heartbeatSection =
        heartbeatMd && !heartbeatEmpty
          ? `\n--- HEARTBEAT.md ---\n${heartbeatMd}\n--- END HEARTBEAT.md ---\n\nWykonaj zadania z HEARTBEAT.md. Nie wymyślaj zadań — rób TYLKO to co jest w pliku.`
          : '';

      const observationCtx = this.buildObservationContext(currentWindowTitle);

      const screenSection = monitorCtx
        ? `\n${monitorCtx}\nUWAGA: Okno "KxAI" to Twój własny interfejs — NIE komentuj go, nie opisuj i nie traktuj jako aktywność użytkownika.`
        : '';

      // System event queue
      const eventsSection = this.buildEventsSection();

      // Nudges
      const memoryNudge = jobsSummary
        ? ''
        : '\n\n⚠️ NIE MASZ ŻADNYCH CRON JOBÓW! Zasugeruj co najmniej 2 przydatne. Użyj bloku ```cron.';

      const memoryContent = (await this.memory.get('MEMORY.md')) || '';
      const memoryEmpty =
        memoryContent.includes('(Uzupełnia się automatycznie') || memoryContent.includes('(Bieżące obserwacje');
      const memoryReminder = memoryEmpty
        ? '\n\n⚠️ MEMORY.md jest PUSTY! Zapisz najważniejsze fakty o użytkowniku. Użyj bloków:\n```update_memory\n{"file":"memory","section":"Obserwacje","content":"treść"}\n```'
        : '';

      // AUTONOMOUS.md — action-first philosophy
      let autonomousPrompt = '';
      try {
        autonomousPrompt = await this.promptService.load('AUTONOMOUS.md');
      } catch {
        /* not critical */
      }

      // Integration awareness — tell the agent what services are available
      const integrationSection = this.buildIntegrationContext();

      const prompt = `[CORTEX — Autonomiczny agent]\n\n${timeCtx}${activitySection}\n\nAktywne cron joby:\n${jobsSummary || '(brak)'}${heartbeatSection}${observationCtx}${screenSection}${eventsSection}${integrationSection}${memoryNudge}${memoryReminder}

${autonomousPrompt ? `\n${autonomousPrompt}\n` : ''}Masz pełny dostęp do narzędzi (podane w API). Jeśli chcesz coś ZROBIĆ — wywołaj narzędzie. Nie mów "mogę to zrobić" — PO PROSTU TO ZRÓB.
Jeśli chcesz ZAPROPONOWAĆ akcję (np. automatyzacja, cron, reorganizacja) zamiast od razu ją wykonać, użyj bloku:
\`\`\`proposal
{"type":"automation|reminder|optimization|pattern","title":"...","description":"...","risk":"safe|moderate|dangerous","toolCalls":[{"name":"tool_name","params":{}}]}
\`\`\`
Jeśli nie masz nic wartościowego do powiedzenia, odpowiedz "CORTEX_OK".

${await this.promptService.load('HEARTBEAT.md')}`;

      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      this.emitStatus({ state: 'heartbeat', detail: 'Cortex myśli...' });

      // Use native function calling — tools are passed via API, not as text in prompt
      const toolDefs = this.tools.selectToolsForMessage(prompt);
      let response = await this.runNativeToolLoop(prompt, toolDefs, 5, signal);

      this.emitStatus({ state: 'idle' });

      // Check for suppression (CORTEX_OK / HEARTBEAT_OK)
      if (this.isSuppressed(response)) {
        this.recordObservation(currentWindowTitle, monitorCtx, '(bez komentarza)');
        return;
      }

      // Record observation for continuity
      this.recordObservation(currentWindowTitle, monitorCtx, response);

      // Post-process: cron suggestions, memory updates (auto-approve safe categories)
      await this.responseProcessor.postProcess(response, undefined, { autoApproveCrons: true });

      // Parse proposals — structured suggestions from AI
      const proposals = this.parseProposals(response);
      for (const proposal of proposals) {
        this.emitMessage({
          source: 'think',
          priority: proposal.risk === 'dangerous' ? 'critical' : 'normal',
          message: `💡 **${proposal.title}**\n${proposal.description}`,
          proposal,
        });
      }

      // Clean and emit (only if no proposals — avoid double notification)
      if (proposals.length === 0) {
        const cleanResponse = this.cleanResponse(response);
        if (cleanResponse) {
          this.emitMessage({
            source: 'think',
            priority: 'normal',
            message: cleanResponse,
          });
        }
      }

      this.lastThinkAt = Date.now();
      this.totalThinkCycles++;
    } catch (err) {
      log.error('Think cycle error:', err);
      this.emitStatus({ state: 'idle' });
    } finally {
      this.thinkRunning = false;
      this.abortController = null;
      // Clear consumed events
      this.eventQueue = [];
    }
  }

  /**
   * AFK think — autonomous tasks when user is away.
   */
  private async afkThink(): Promise<void> {
    const afkMinutes = Math.round((Date.now() - this.afkSince) / 60000);
    const timeSinceLastTask = Date.now() - this.lastAfkTaskTime;

    if (timeSinceLastTask < 10 * 60 * 1000 && this.lastAfkTaskTime > 0) {
      log.info(`AFK rate limited — last task ${Math.round(timeSinceLastTask / 60000)}min ago`);
      return;
    }

    const task = this.getNextAfkTask(afkMinutes);
    if (!task) {
      log.info('All AFK tasks done for this session');
      return;
    }

    log.info(`Running AFK task: ${task.id} (user AFK for ${afkMinutes}min)`);
    this.lastAfkTaskTime = Date.now();
    this.afkTasksDone.add(task.id);

    try {
      this.abortController = new AbortController();
      const signal = this.abortController.signal;
      const timeCtx = this.workflow.buildTimeContext();

      const afkPrompt = `[AFK MODE — Użytkownik jest nieaktywny od ${afkMinutes} minut]\n\n${timeCtx}\n\n${task.prompt}\n\nMasz pełny dostęp do narzędzi (podane w API) — wywołuj je! Odpowiedz zwięźle.\nJeśli nie masz nic wartościowego do zrobienia, odpowiedz "CORTEX_OK".`;

      // Use native function calling for AFK tasks
      const toolDefs = this.tools.selectToolsForMessage(afkPrompt);
      let response = await this.runNativeToolLoop(afkPrompt, toolDefs, 3, signal);

      if (this.isSuppressed(response)) return;

      await this.responseProcessor.postProcess(response, undefined, { autoApproveCrons: true });

      const cleanResponse = this.cleanResponse(response);
      if (cleanResponse) {
        this.emitMessage({
          source: 'afk-task',
          priority: 'low',
          message: cleanResponse,
          context: `afk:${task.id}`,
        });
      }
    } catch (err) {
      log.error('AFK task error:', err);
    } finally {
      this.abortController = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ░░░ 3. REFLECTION CYCLES ░░░
  // ═══════════════════════════════════════════════════════════════

  private async checkScheduledReflections(): Promise<void> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (this.cyclesTodayDate !== today) {
      this.cyclesTodayDate = today;
      this.cyclesRunToday.clear();
    }

    const hour = now.getHours();
    const dayOfWeek = now.getDay();

    // Evening reflection: 17:00–19:00, once per day
    if (hour >= 17 && hour < 19 && !this.cyclesRunToday.has('evening')) {
      await this.safeRunReflection('evening');
      return;
    }

    // Weekly reflection: Sunday 18:00–20:00
    if (dayOfWeek === 0 && hour >= 18 && hour < 20 && !this.cyclesRunToday.has('weekly')) {
      await this.safeRunReflection('weekly');
    }
  }

  private async safeRunReflection(type: ReflectionCycleType): Promise<void> {
    if (this.reflectionRunning) {
      log.info(`Reflection '${type}' skipped — already running`);
      return;
    }

    if (this.isProcessingCheck?.()) {
      log.info(`Reflection '${type}' skipped — agent is processing user message`);
      return;
    }

    // Minimum gap: 30 minutes between reflections
    const timeSinceLast = Date.now() - this.lastReflectionAt;
    if (type !== 'manual' && this.lastReflectionAt > 0 && timeSinceLast < 30 * 60 * 1000) {
      log.info(`Reflection '${type}' skipped — last was ${Math.round(timeSinceLast / 60000)}min ago`);
      return;
    }

    if (type !== 'manual' && !this.isWithinActiveHours()) {
      log.info(`Reflection '${type}' skipped — outside active hours`);
      return;
    }

    this.reflectionRunning = true;

    try {
      const result = await this.runReflection(type);
      if (result) {
        this.lastReflectionAt = Date.now();
        this.lastReflectionType = type;
        this.totalReflections++;
        this.cyclesRunToday.add(type);
        log.info(`Reflection '${type}' completed (${result.insights} insights)`);
      }
    } catch (err) {
      log.error(`Reflection '${type}' failed:`, err);
    } finally {
      this.reflectionRunning = false;
    }
  }

  private async runReflection(type: ReflectionCycleType): Promise<{ insights: number; summary: string } | null> {
    log.info(`Running reflection: ${type}`);
    this.emitStatus({ state: 'heartbeat', detail: `Refleksja (${type})...` });

    // 1. Gather context
    const context = await this.gatherReflectionContext(type);

    // 1b. Change detection — skip if unchanged
    const contextHash = this.computeContextHash(context);
    if (type !== 'manual' && contextHash === this.lastContextHash && this.reflectionHistory.length > 0) {
      log.info(`Reflection '${type}' skipped — context unchanged`);
      this.emitStatus({ state: 'idle' });
      return null;
    }
    this.lastContextHash = contextHash;

    // 2. Load prompt
    let reflectionPrompt: string;
    try {
      reflectionPrompt = await this.promptService.load('REFLECTION.md');
    } catch {
      reflectionPrompt = 'Jesteś agentem refleksji. Analizuj wzorce aktywności i zaproponuj ulepszenia.';
    }

    // 3. Build full prompt
    const prompt = this.buildReflectionPrompt(type, context, reflectionPrompt);

    // 4. Run AI with native tool loop
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    let response: string;
    try {
      const toolDefs = this.tools.selectToolsForMessage(prompt);
      response = await this.runNativeToolLoop(prompt, toolDefs, 5, signal);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        log.info('Reflection aborted');
        return null;
      }
      throw err;
    } finally {
      this.abortController = null;
    }

    this.emitStatus({ state: 'idle' });

    // 5. Post-process
    await this.responseProcessor.postProcess(response, undefined, { autoApproveCrons: true });

    // 6. Parse insights
    const insights = this.parseInsights(response);

    // 6b. Parse workflow patterns from ```pattern blocks
    this.parseAndSavePatterns(response);

    // 7. Emit result
    const cleanSummary = this.cleanReflectionResponse(response);
    if (cleanSummary && cleanSummary.length > 30) {
      this.emitMessage({
        source: 'reflection',
        priority: 'normal',
        message: cleanSummary,
        context: `reflection:${type}`,
      });

      // Save to history (anti-repetition)
      const timestamp = new Date().toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      this.reflectionHistory.push(`[${timestamp}, typ: ${type}] ${cleanSummary.slice(0, 500)}`);
      if (this.reflectionHistory.length > CortexEngine.MAX_REFLECTION_HISTORY) {
        this.reflectionHistory.shift();
      }
    }

    return { insights: insights.length, summary: cleanSummary || '(brak wniosków)' };
  }

  // ═══════════════════════════════════════════════════════════════
  // ░░░ SCREEN MONITORING ░░░
  // ═══════════════════════════════════════════════════════════════

  private applyScreenMode(mode: CortexScreenMode): void {
    if (!this.screenMonitor) return;

    if (mode === 'off') {
      this.screenMonitor.stop();
      return;
    }

    // Start screen monitor with callbacks
    this.screenMonitor.start(
      // onWindowChange (T0) — log every window switch to WorkflowService
      (info: { title: string; processName: string; timestamp?: number }) => {
        this.workflow.logWindowChange(info);
      },
      // onContentChange (T1)
      undefined,
      // onVisionNeeded (T2) — push event + delegate analysis
      async (_ctx: any, screenshots: Array<{ base64: string; label: string }>) => {
        this.pushEvent('screen', 'Significant screen content change detected', 'normal');
        if (this.onScreenAnalysis) {
          try {
            await this.onScreenAnalysis(screenshots);
          } catch (err) {
            log.error('Screen analysis callback failed:', err);
            this.pushEvent('error', 'Screen analysis failed', 'high');
          }
        }
      },
      // onIdleStart
      () => this.setAfkState(true),
      // onIdleEnd
      () => this.setAfkState(false),
    );
  }

  /**
   * Log screen analysis result as workflow activity.
   */
  logScreenActivity(context: string, message: string): void {
    let category = 'general';
    const lower = context.toLowerCase();
    if (lower.includes('kod') || lower.includes('code') || lower.includes('vscode') || lower.includes('ide')) {
      category = 'coding';
    } else if (
      lower.includes('chat') ||
      lower.includes('messenger') ||
      lower.includes('whatsapp') ||
      lower.includes('slack') ||
      lower.includes('teams')
    ) {
      category = 'communication';
    } else if (
      lower.includes('browser') ||
      lower.includes('chrome') ||
      lower.includes('firefox') ||
      lower.includes('edge')
    ) {
      category = 'browsing';
    } else if (
      lower.includes('document') ||
      lower.includes('word') ||
      lower.includes('excel') ||
      lower.includes('pdf')
    ) {
      category = 'documents';
    } else if (lower.includes('terminal') || lower.includes('powershell') || lower.includes('cmd')) {
      category = 'terminal';
    }

    this.workflow.logActivity(message.slice(0, 200), context.slice(0, 200), category);
  }

  // ═══════════════════════════════════════════════════════════════
  // ░░░ CONTEXT GATHERING ░░░
  // ═══════════════════════════════════════════════════════════════

  private async gatherProactiveContext(): Promise<ProactiveContext> {
    const now = new Date();
    const hourOfDay = now.getHours();

    // Calendar
    let upcomingEvents: CalendarEvent[] = [];
    let todayEvents: CalendarEvent[] = [];
    let calendarConnected = false;
    if (this.calendarService) {
      try {
        calendarConnected = this.calendarService.isConnected();
        if (calendarConnected) {
          upcomingEvents = this.calendarService.getUpcomingEvents(20);
          todayEvents = this.calendarService.getTodayEvents();
        }
      } catch (err) {
        log.warn('Calendar context error:', err);
      }
    }

    // System health
    let systemSnapshot: SystemSnapshot | null = null;
    let systemWarnings: string[] = [];
    if (this.systemMonitor) {
      try {
        systemSnapshot = await this.systemMonitor.getSnapshot();
        systemWarnings = await this.systemMonitor.getWarnings();
      } catch (err) {
        log.warn('System monitor context error:', err);
      }
    }

    // Activity
    let timeContext = '';
    try {
      timeContext = this.workflow.buildTimeContext();
    } catch (err) {
      log.warn('Workflow context error:', err);
    }

    // Screen
    let screenContext = '';
    let currentWindow = '';
    if (this.screenMonitor?.isRunning()) {
      try {
        screenContext = this.screenMonitor.buildMonitorContext();
        currentWindow = this.screenMonitor.getCurrentWindow()?.title ?? '';
      } catch (err) {
        log.warn('Screen context error:', err);
      }
    }

    // Knowledge Graph
    let kgSummary = '';
    if (this.knowledgeGraph) {
      try {
        kgSummary = this.knowledgeGraph.getContextSummary(10);
      } catch (err) {
        log.warn('KG context error:', err);
      }
    }

    const currentSessionMinutes = Math.floor((Date.now() - this.sessionStartTime) / 60_000);

    let timeOfDay: ProactiveContext['timeOfDay'];
    if (hourOfDay >= 5 && hourOfDay < 12) timeOfDay = 'morning';
    else if (hourOfDay >= 12 && hourOfDay < 17) timeOfDay = 'afternoon';
    else if (hourOfDay >= 17 && hourOfDay < 22) timeOfDay = 'evening';
    else timeOfDay = 'night';

    // MCP connected servers — use getStatus() which has actual connection state
    let mcpConnectedServers: string[] = [];
    try {
      if (this.mcpClient) {
        const hubStatus = this.mcpClient.getStatus?.();
        if (hubStatus?.servers) {
          mcpConnectedServers = hubStatus.servers
            .filter((s) => s.status === 'connected')
            .map((s) => (s.name || s.id || '').toLowerCase());
        }
      }
    } catch {
      /* ignore */
    }

    return {
      now,
      hourOfDay,
      dayOfWeek: now.getDay(),
      timeOfDay,
      upcomingEvents,
      todayEvents,
      calendarConnected,
      systemSnapshot,
      systemWarnings,
      timeContext,
      currentSessionMinutes,
      screenContext,
      currentWindow,
      kgSummary,
      isAfk: this.isAfk,
      mcpConnectedServers,
    };
  }

  private async gatherReflectionContext(type: ReflectionCycleType): Promise<ReflectionContext> {
    const [userMd, memoryMd, soulMd] = await Promise.all([
      this.memory.get('USER.md').catch(() => ''),
      this.memory.get('MEMORY.md').catch(() => ''),
      this.memory.get('SOUL.md').catch(() => ''),
    ]);

    const weeklyPatterns = this.workflow.getWeeklyPatterns();
    const dailySummary = this.workflow.getDailySummary();
    const timeContext = this.workflow.buildTimeContext();
    const activityLog = this.workflow.getActivityLog(100);
    const activityStats24h = this.workflow.getActivityStats(24); // last 24h stats for reflection

    const cronJobs = this.cron.getJobs();
    const cronSummary =
      cronJobs.length > 0
        ? cronJobs
            .map((j) => `- ${j.name} [${j.schedule}] ${j.enabled ? '✓' : '✗'} (uruchomiono ${j.runCount}x)`)
            .join('\n')
        : '(brak cron jobów)';

    let mcpSummary = '(brak danych MCP)';
    try {
      if (this.mcpClient) {
        const servers = this.mcpClient.listServers?.() ?? [];
        const connected = servers.filter((s: any) => s.connected);
        mcpSummary =
          connected.length > 0
            ? connected.map((s: any) => `- ${s.name || s.id}: ${s.toolCount || 0} narzędzi`).join('\n')
            : '(brak podłączonych serwerów MCP)';
      }
    } catch {
      /* ignore */
    }

    let kgSummary = '';
    try {
      if (this.knowledgeGraph) {
        kgSummary = (await this.knowledgeGraph.getContextSummary?.()) ?? '';
      }
    } catch {
      /* ignore */
    }

    let calendarSummary = '';
    if (type !== 'deep') {
      try {
        if (this.calendarService) {
          const events = this.calendarService.getUpcomingEvents?.(7 * 24 * 60) ?? [];
          if (events.length > 0) {
            calendarSummary = events
              .slice(0, 10)
              .map((e: any) => `- ${e.title || e.summary} (${new Date(e.start).toLocaleDateString('pl-PL')})`)
              .join('\n');
          }
        }
      } catch {
        /* ignore */
      }
    }

    const appCategories = this.analyzeAppUsage(activityLog);

    return {
      type,
      weeklyPatterns,
      dailySummary,
      timeContext,
      activityLog: activityLog.slice(-50),
      activityStats24h,
      cronSummary,
      mcpSummary,
      kgSummary,
      calendarSummary,
      userMd: userMd || '',
      memoryMd: memoryMd || '',
      soulMd: soulMd || '',
      appCategories,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ░░░ PROMPT BUILDING ░░░
  // ═══════════════════════════════════════════════════════════════

  private buildReflectionPrompt(type: ReflectionCycleType, ctx: ReflectionContext, systemPrompt: string): string {
    const typeLabels: Record<ReflectionCycleType, string> = {
      deep: 'GŁĘBOKA REFLEKSJA',
      evening: 'WIECZORNA REFLEKSJA',
      weekly: 'TYGODNIOWA REFLEKSJA',
      manual: 'REFLEKSJA NA ŻĄDANIE',
    };

    const typeInstructions: Record<ReflectionCycleType, string> = {
      deep: `Przeanalizuj wzorce aktywności z ostatnich dni. Oceń czy obecne cron joby are optymalne.
Zaproponuj automatyzacje które zwiększą produktywność użytkownika.
Sprawdź czy używane aplikacje mają odpowiednie integracje MCP.`,
      evening: `Podsumuj dzień. Czego użytkownik dziś dokonał? Jakie wzorce zauważasz?
Zaplanuj co agent może przygotować na jutro.
Zaktualizuj MEMORY.md o ważne obserwacje z dzisiejszego dnia.`,
      weekly: `To jest tygodniowa refleksja. Oceń cały tydzień.
Jakie wzorce powtarzają się co tydzień? Które zadania można zautomatyzować?
Zaproponuj ulepszenia systemu (cron joby, MCP integracje, zmiany w pamięci).
Zaktualizuj USER.md jeśli odkryłeś nowe fakty o użytkowniku.`,
      manual: `Przeprowadź pełną refleksję na żądanie użytkownika.
Przeanalizuj wszystkie dostępne dane i zaproponuj ulepszenia.`,
    };

    const sections: string[] = [];

    sections.push(`[${typeLabels[type]} — Cortex Agent]\n`);
    sections.push(ctx.timeContext);
    if (ctx.weeklyPatterns) sections.push(ctx.weeklyPatterns);
    if (ctx.dailySummary) sections.push(ctx.dailySummary);
    sections.push(`## Aktywne cron joby\n${ctx.cronSummary}`);
    sections.push(`## Podłączone serwery MCP\n${ctx.mcpSummary}`);
    if (ctx.kgSummary) sections.push(`## Graf wiedzy o użytkowniku\n${ctx.kgSummary}`);
    if (ctx.calendarSummary) sections.push(`## Nadchodzące wydarzenia\n${ctx.calendarSummary}`);
    if (ctx.appCategories.length > 0) {
      sections.push(
        `## Najczęściej używane aplikacje\n${ctx.appCategories.map((c) => `- ${c.category}: ${c.count}x`).join('\n')}`,
      );
    }
    // 24h activity statistics for pattern analysis
    if (ctx.activityStats24h && ctx.activityStats24h.totalSwitches > 0) {
      const statsLines = ctx.activityStats24h.topApps.slice(0, 8).map((a) => {
        const mins = Math.round(a.totalMs / 60000);
        return `  - ${a.processName}: ${mins} min (${a.switches} przełączeń)`;
      });
      sections.push(
        `## Statystyki aktywności (24h)\n` +
          `Przełączeń okien: ${ctx.activityStats24h.totalSwitches}\n` +
          `Łączny czas śledzony: ${Math.round(ctx.activityStats24h.totalTrackedMs / 60000)} min\n\n` +
          `Top aplikacje:\n${statsLines.join('\n')}\n\n` +
          `Jeśli widzisz powtarzające się wzorce — zaproponuj automatyzację lub cron job.\n` +
          `Jeśli wykryjesz nowy wzorzec, zapisz go w bloku \`\`\`pattern z JSON: {description, timeRange: {startHour, endHour}, daysOfWeek: [0-6], frequency, suggestedCron}.`,
      );
    }
    if (ctx.userMd && !ctx.userMd.includes('(Uzupełnia się automatycznie')) {
      sections.push(`## Profil użytkownika (USER.md)\n${ctx.userMd.slice(0, 1000)}`);
    }
    if (ctx.memoryMd && !ctx.memoryMd.includes('(Bieżące obserwacje')) {
      sections.push(`## Bieżąca pamięć (MEMORY.md)\n${ctx.memoryMd.slice(0, 1000)}`);
    }
    if (this.reflectionHistory.length > 0) {
      sections.push(
        `## ⚠️ Twoje POPRZEDNIE refleksje (NIE POWTARZAJ SIĘ!)\n` +
          `Jeśli nie masz NOWYCH informacji, odpowiedz CORTEX_OK.\n\n` +
          this.reflectionHistory.join('\n\n---\n\n'),
      );
    }
    sections.push(`\n## Twoje zadania w tej refleksji\n${typeInstructions[type]}`);
    sections.push(`\n## Przewodnik po narzędziach\n${systemPrompt}`);

    sections.push(`\nMasz pełny dostęp do narzędzi (podane w API). Gdy widzisz NOWĄ szansę na ulepszenie — DZIAŁAJ, wywołaj narzędzie.

KRYTYCZNA ZASADA ANTY-POWTÓRZEŃ:
- Jeśli dane NIE zmieniły się — odpowiedz "CORTEX_OK"
- NIE powtarzaj wniosków z poprzednich refleksji
- Nowa refleksja MUSI wnosić NOWĄ wartość
- W razie wątpliwości — lepiej CORTEX_OK niż powtórka`);

    return sections.join('\n\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // ░░░ TOOL LOOP (Native Function Calling) ░░░
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run a native function calling loop for Cortex autonomous cycles.
   *
   * Uses streamMessageWithNativeTools (API-level tool definitions) instead of
   * legacy ```tool blocks. This ensures the AI provider actually sees tools
   * as callable functions rather than text descriptions in the prompt.
   *
   * Falls back to legacy parseToolCall for backward compatibility.
   */
  private async runNativeToolLoop(
    userPrompt: string,
    toolDefs: ToolDefinition[],
    maxIterations: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const detector = new ToolLoopDetector();
    let iterations = 0;

    // Initial call with native tool definitions
    let result: NativeToolStreamResult;
    try {
      result = await this.ai.streamMessageWithNativeTools(
        userPrompt,
        toolDefs,
        undefined,
        undefined, // no streaming chunk callback for cortex
        undefined, // no system context override
        { signal },
      );
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      log.error('Cortex native tool call failed, falling back to sendMessage:', err);
      // Fallback: use plain sendMessage + legacy tool loop
      const response = await this.ai.sendMessage(userPrompt, undefined, undefined, { skipHistory: true, signal });
      return this.runLegacyToolLoop(response, maxIterations, signal);
    }

    // Process any text + tool calls in the response
    let fullText = result.text || '';

    // Post-process text for cron/memory/proposal blocks immediately
    if (fullText) {
      const ppResult = await this.responseProcessor.postProcess(fullText, undefined, { autoApproveCrons: true });
      if (ppResult.memoryUpdatesApplied > 0) {
        log.info(`Cortex initial: ${ppResult.memoryUpdatesApplied} memory update(s) applied`);
      }
      if (ppResult.autoApprovedCron) {
        log.info(`Cortex: auto-approved cron "${ppResult.autoApprovedCron.name}"`);
      }
    }

    // Native tool loop
    while (result.toolCalls.length > 0 && iterations < maxIterations) {
      if (signal?.aborted) {
        log.info('Cortex native tool loop aborted');
        break;
      }

      const toolResults: Array<{ callId: string; name: string; result: string; isError?: boolean }> = [];
      let loopBroken = false;

      for (const tc of result.toolCalls) {
        iterations++;
        log.info(`Cortex tool call #${iterations}: ${tc.name}`);
        this.emitStatus({ state: 'heartbeat', detail: `Cortex: ${tc.name}`, toolName: tc.name });

        // Action Policy check — assess risk for autonomous tool calls
        const policy = this.securityGuard.assessRisk(tc.name, tc.arguments, 'cortex');
        if (policy.requiresApproval) {
          log.info(`Action policy: ${tc.name} → ${policy.risk}, awaiting approval`);
          this.emitStatus({ state: 'heartbeat', detail: `Oczekuje na zatwierdzenie: ${tc.name}` });

          const approval = await this.requestActionApproval(
            tc.name,
            tc.arguments,
            policy.risk,
            policy.reason || `Cortex chce wykonać: ${tc.name}`,
          );

          if (!approval.approved) {
            log.info(`Tool ${tc.name} denied by user`);
            toolResults.push({
              callId: tc.id,
              name: tc.name,
              result: `Użytkownik odrzucił wykonanie tego narzędzia.`,
              isError: true,
            });
            continue;
          }

          if (approval.modifiedParams) {
            Object.assign(tc.arguments, approval.modifiedParams);
          }
        }

        let execResult: { success: boolean; data?: any; error?: string };
        try {
          execResult = await this.tools.execute(tc.name, tc.arguments);
        } catch (err: any) {
          execResult = { success: false, error: `Tool error: ${err.message}` };
        }

        const resultStr = this.sanitizeToolOutput(tc.name, execResult.data || execResult.error);
        toolResults.push({
          callId: tc.id,
          name: tc.name,
          result: resultStr,
          isError: !execResult.success,
        });

        // Loop detection
        const loopCheck = detector.recordAndCheck(tc.name, tc.arguments, execResult.data || execResult.error);
        if (!loopCheck.shouldContinue) {
          log.info(`Cortex tool loop detector triggered for ${tc.name}`);
          loopBroken = true;
          break;
        }
      }

      if (signal?.aborted || loopBroken) break;

      // Continue conversation with tool results
      try {
        result = await this.ai.continueWithToolResults(
          result._messages,
          toolResults,
          toolDefs,
          undefined, // no streaming
          { signal },
        );
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
        log.error('Cortex continueWithToolResults failed:', err);
        break;
      }

      // Accumulate text from the continuation
      if (result.text) {
        fullText = result.text; // Use latest text as the final response
        // Post-process continuation text
        const ppResult = await this.responseProcessor.postProcess(result.text, undefined, { autoApproveCrons: true });
        if (ppResult.memoryUpdatesApplied > 0) {
          log.info(`Cortex continuation: ${ppResult.memoryUpdatesApplied} memory update(s) applied`);
        }
      }
    }

    return fullText;
  }

  /**
   * Legacy tool loop — fallback for when native FC is unavailable.
   * Parses ```tool blocks from AI text responses.
   */
  private async runLegacyToolLoop(
    initialResponse: string,
    maxIterations: number,
    signal?: AbortSignal,
  ): Promise<string> {
    let response = initialResponse;
    const detector = new ToolLoopDetector();
    let iterations = 0;

    while (iterations < maxIterations) {
      if (signal?.aborted) {
        log.info('Tool loop aborted');
        break;
      }

      const toolCall = this.parseToolCall(response);
      if (!toolCall) break;

      // Post-process before consuming — ensure update_memory/cron in same response aren't lost
      const ppResult = await this.responseProcessor.postProcess(response, undefined, { autoApproveCrons: true });
      if (ppResult.memoryUpdatesApplied > 0) {
        log.info(`Cortex intermediate: ${ppResult.memoryUpdatesApplied} memory update(s) applied`);
      }
      if (ppResult.autoApprovedCron) {
        log.info(`Cortex: auto-approved cron "${ppResult.autoApprovedCron.name}"`);
      }

      iterations++;
      log.info(`Legacy tool call #${iterations}: ${toolCall.tool}`);
      this.emitStatus({ state: 'heartbeat', detail: `Cortex: ${toolCall.tool}`, toolName: toolCall.tool });

      // Action Policy check
      const policy = this.securityGuard.assessRisk(toolCall.tool, toolCall.params, 'cortex');
      if (policy.requiresApproval) {
        log.info(`Action policy: ${toolCall.tool} → ${policy.risk}, awaiting approval`);

        const approval = await this.requestActionApproval(
          toolCall.tool,
          toolCall.params,
          policy.risk,
          policy.reason || `Cortex chce wykonać: ${toolCall.tool}`,
        );

        if (!approval.approved) {
          log.info(`Tool ${toolCall.tool} denied by user`);
          response = await this.ai.sendMessage(
            `Użytkownik odrzucił wykonanie narzędzia "${toolCall.tool}".`,
            undefined,
            undefined,
            { skipHistory: true, signal },
          );
          continue;
        }

        if (approval.modifiedParams) {
          Object.assign(toolCall.params, approval.modifiedParams);
        }
      }

      let result: { success: boolean; data?: any; error?: string };
      try {
        result = await this.tools.execute(toolCall.tool, toolCall.params);
      } catch (err: any) {
        result = { success: false, error: `Tool error: ${err.message}` };
      }

      const loopCheck = detector.recordAndCheck(toolCall.tool, toolCall.params, result.data || result.error);
      const feedbackSuffix = loopCheck.shouldContinue
        ? 'Możesz użyć kolejnego narzędzia lub odpowiedzieć.'
        : 'Odpowiedz (zakończ pętlę).';

      response = await this.ai.sendMessage(
        `${this.sanitizeToolOutput(toolCall.tool, result.data || result.error)}\n\n${feedbackSuffix}`,
        undefined,
        undefined,
        { skipHistory: true, signal },
      );

      if (!loopCheck.shouldContinue) break;
    }

    return response;
  }

  // ═══════════════════════════════════════════════════════════════
  // ░░░ HELPERS ░░░
  // ═══════════════════════════════════════════════════════════════

  private loadActiveHours(): void {
    const startStr = this.config.get('cortexActiveHoursStart');
    const endStr = this.config.get('cortexActiveHoursEnd');

    if (typeof startStr === 'string' && typeof endStr === 'string' && startStr.includes(':') && endStr.includes(':')) {
      const [startH, startM] = startStr.split(':').map(Number);
      const [endH, endM] = endStr.split(':').map(Number);
      if (!isNaN(startH) && !isNaN(endH)) {
        this.activeHours = {
          start: startH * 60 + (startM || 0),
          end: endH * 60 + (endM || 0),
        };
        log.info(`Active Hours: ${startStr} - ${endStr} (${this.activeHours.start}m - ${this.activeHours.end}m)`);
      }
    } else {
      this.activeHours = null;
    }
  }

  private isWithinActiveHours(): boolean {
    if (!this.activeHours) return true;
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const { start, end } = this.activeHours;

    if (start <= end) {
      return current >= start && current < end;
    }
    // Wraps midnight (e.g., 22:00 – 06:00)
    return current >= start || current < end;
  }

  /**
   * Generate a short AI text response (for proactive rules).
   * Returns the AI response or null on failure.
   */
  async generateAIText(prompt: string): Promise<string | null> {
    try {
      const response = await this.ai.sendMessage(prompt, undefined, undefined, { skipHistory: true });
      return response?.trim() || null;
    } catch (err) {
      log.warn('generateAIText failed:', err);
      return null;
    }
  }

  private emitMessage(opts: {
    source: CortexMessageSource;
    priority: CortexMessagePriority;
    message: string;
    context?: string;
    ruleId?: string;
    proposal?: import('../../shared/types/cortex').CortexProposal;
  }): void {
    const msg: CortexMessage = {
      id: `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      source: opts.source,
      priority: opts.priority,
      message: opts.message,
      context: opts.context,
      ruleId: opts.ruleId,
      proposal: opts.proposal,
      timestamp: Date.now(),
    };
    this.onMessage?.(msg);
  }

  private emitStatus(status: AgentStatus): void {
    this.onAgentStatus?.(status);
  }

  private getRuleStats(): CortexRuleStats {
    let totalFired = 0;
    let totalAccepted = 0;
    let totalDismissed = 0;

    const ruleDetails = this.rules.map((rule) => {
      const fb = this.feedbackMap.get(rule.id) ?? { fired: 0, accepted: 0, dismissed: 0, lastFired: null };
      totalFired += fb.fired;
      totalAccepted += fb.accepted;
      totalDismissed += fb.dismissed;

      const total = fb.accepted + fb.dismissed;
      return {
        ruleId: rule.id,
        name: rule.name,
        fired: fb.fired,
        accepted: fb.accepted,
        dismissed: fb.dismissed,
        acceptRate: total > 0 ? fb.accepted / total : 0.5,
        lastFired: fb.lastFired,
      };
    });

    return { totalFired, totalAccepted, totalDismissed, rulesEnabled: this.rules.length, ruleDetails };
  }

  private priorityValue(p: CortexMessagePriority): number {
    switch (p) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'normal':
        return 2;
      case 'low':
        return 1;
    }
  }

  // ─── Observation History ───

  private recordObservation(windowTitle: string, screenContext: string, agentResponse: string): void {
    const summary = this.extractObservationSummary(windowTitle, screenContext);
    this.observationHistory.push({
      timestamp: Date.now(),
      windowTitle: windowTitle.slice(0, 100),
      summary,
      response: agentResponse.slice(0, 200),
    });
    if (this.observationHistory.length > this.MAX_OBSERVATIONS) {
      this.observationHistory = this.observationHistory.slice(-this.MAX_OBSERVATIONS);
    }
  }

  private extractObservationSummary(windowTitle: string, screenContext: string): string {
    const parts: string[] = [];
    if (windowTitle) parts.push(windowTitle.slice(0, 80));
    const lines = screenContext.split('\n').filter((l) => l.trim() && !l.startsWith('##'));
    for (const line of lines.slice(0, 3)) {
      parts.push(line.trim().slice(0, 80));
    }
    return parts.join(' | ') || '(brak danych)';
  }

  private buildObservationContext(currentWindowTitle: string): string {
    if (this.observationHistory.length === 0) {
      return '\n## 📋 Historia obserwacji\n(To jest pierwsza obserwacja w tej sesji)\n';
    }

    const lastObs = this.observationHistory[this.observationHistory.length - 1];
    const isSameScene = this.isSimilarScene(currentWindowTitle, lastObs.windowTitle);

    let sameSceneDuration = 0;
    if (isSameScene) {
      for (let i = this.observationHistory.length - 1; i >= 0; i--) {
        if (this.isSimilarScene(currentWindowTitle, this.observationHistory[i].windowTitle)) {
          sameSceneDuration = Math.round((Date.now() - this.observationHistory[i].timestamp) / 60000);
        } else {
          break;
        }
      }
    }

    let ctx = '\n## 📋 Historia obserwacji (PAMIĘTAJ — nie powtarzaj się!)\n';
    const recentObs = this.observationHistory.slice(-5);
    for (const obs of recentObs) {
      const ago = Math.round((Date.now() - obs.timestamp) / 60000);
      ctx += `- ${ago}min temu: [${obs.windowTitle.slice(0, 50)}] → ${obs.response.slice(0, 100)}\n`;
    }

    if (isSameScene && sameSceneDuration > 0) {
      ctx += `\n⚡ CIĄGŁOŚĆ: Użytkownik robi TO SAMO od ~${sameSceneDuration} minut (${currentWindowTitle.slice(0, 50)}).\n`;
      ctx += `→ NIE opisuj ponownie co robi! Odpowiedz CORTEX_OK jeśli nie masz nic nowego.\n`;
    } else if (this.observationHistory.length > 0) {
      ctx += `\n🔄 ZMIANA: Użytkownik zmienił aktywność (wcześniej: "${lastObs.windowTitle.slice(0, 40)}", teraz: "${currentWindowTitle.slice(0, 40)}").\n`;
    }

    return ctx;
  }

  /**
   * Build a context section describing connected integrations.
   * This nudges the think cycle to actually USE available services.
   */
  private buildIntegrationContext(): string {
    const integrations: string[] = [];

    // MCP servers (email, slack, notion, etc.) — use getStatus() for actual connection state
    try {
      if (this.mcpClient) {
        const hubStatus = this.mcpClient.getStatus?.();
        const connected = hubStatus?.servers?.filter((s) => s.status === 'connected') ?? [];
        if (connected.length > 0) {
          for (const s of connected) {
            const name = (s.name || s.id || '').toLowerCase();
            if (name.includes('gmail') || name.includes('outlook') || name.includes('email')) {
              integrations.push(
                `📧 Email (${s.name}): PODŁĄCZONY — sprawdzaj co jakiś czas nieprzeczytane wiadomości!`,
              );
            } else if (name.includes('slack')) {
              integrations.push(`💬 Slack (${s.name}): PODŁĄCZONY — sprawdzaj wiadomości`);
            } else if (name.includes('notion')) {
              integrations.push(`📝 Notion (${s.name}): PODŁĄCZONY`);
            } else if (name.includes('github')) {
              integrations.push(`🐙 GitHub (${s.name}): PODŁĄCZONY`);
            } else {
              integrations.push(`🔌 ${s.name}: PODŁĄCZONY (${s.tools?.length || 0} narzędzi)`);
            }
          }
        }
      }
    } catch {
      /* ignore */
    }

    // Calendar
    try {
      if (this.calendarService?.isConnected()) {
        const upcoming = this.calendarService.getUpcomingEvents(60);
        if (upcoming.length > 0) {
          const next = upcoming[0];
          const mins = Math.round((new Date(next.start).getTime() - Date.now()) / 60000);
          integrations.push(`📅 Kalendarz: PODŁĄCZONY — następne spotkanie za ${mins} min: ${next.summary}`);
        } else {
          integrations.push(`📅 Kalendarz: PODŁĄCZONY — brak nadchodzących spotkań`);
        }
      }
    } catch {
      /* ignore */
    }

    if (integrations.length === 0) return '';

    return `\n## 🔗 Podłączone integracje — KORZYSTAJ Z NICH AKTYWNIE\n${integrations.join('\n')}\n`;
  }

  private buildEventsSection(): string {
    if (this.eventQueue.length === 0) return '';
    const sorted = [...this.eventQueue].sort((a, b) => this.priorityValue(b.priority) - this.priorityValue(a.priority));
    const lines = sorted.map((e) => `- [${e.source}] ${e.text}`);
    return `\n## 📬 Zdarzenia systemowe\n${lines.join('\n')}\n`;
  }

  // ─── Scene detection ───

  private isSimilarScene(titleA: string, titleB: string): boolean {
    if (!titleA || !titleB) return false;
    const a = titleA.toLowerCase().trim();
    const b = titleB.toLowerCase().trim();
    if (a === b) return true;

    const appA = a.split(/\s[-—]\s/).pop() || a;
    const appB = b.split(/\s[-—]\s/).pop() || b;
    if (appA === appB && appA.length > 3) return true;

    const browserPatterns = [
      /youtube/i,
      /google/i,
      /github/i,
      /stackoverflow/i,
      /reddit/i,
      /twitter/i,
      /facebook/i,
      /twitch/i,
    ];
    for (const pattern of browserPatterns) {
      if (pattern.test(a) && pattern.test(b)) return true;
    }

    return false;
  }

  // ─── Content checks ───

  private isContentEmpty(content: string): boolean {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^#+(?:\s|$)/.test(trimmed)) continue;
      if (/^#[^#]/.test(trimmed)) continue;
      if (/^[-*+]\s*(?:\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
      return false;
    }
    return true;
  }

  private isSuppressed(response: string): boolean {
    const trimmed = response.trim();
    return (
      trimmed === 'CORTEX_OK' ||
      trimmed === 'HEARTBEAT_OK' ||
      trimmed === 'REFLECTION_OK' ||
      trimmed === 'NO_REPLY' ||
      trimmed.length < 10
    );
  }

  // ─── AFK Tasks ───

  private getNextAfkTask(afkMinutes: number): { id: string; prompt: string } | null {
    const tasks = [
      {
        id: 'memory-review',
        minAfk: 5,
        prompt: `Przejrzyj swoją pamięć. Czy jest coś nieaktualnego lub do uporządkowania?
Jeśli tak — uporządkuj używając bloków:
\`\`\`update_memory
{"file":"memory","section":"Nazwa sekcji","content":"treść"}
\`\`\`
Dozwolone wartości "file": "soul", "user", "memory".
Jeśli pamięć jest w dobrym stanie, odpowiedz "CORTEX_OK".`,
      },
      {
        id: 'pattern-analysis',
        minAfk: 10,
        prompt: `Przeanalizuj wzorce aktywności użytkownika z ostatniego tygodnia.
Czy mógłbyś zaproponować cron job który automatyzowałby jakąś rutynę?
Jeśli masz pomysł — zaproponuj go blokiem \`\`\`cron.`,
      },
      {
        id: 'welcome-back',
        minAfk: 15,
        prompt: `Użytkownik wróci niedługo. Przygotuj krótkie podsumowanie:
- Co się działo w ostatnich godzinach
- Czy są zaległe zadania z HEARTBEAT.md
- Jakie cron joby się wykonały
Zapisz to podsumowanie do pamięci używając:
\`\`\`update_memory
{"file":"memory","section":"Podsumowanie","content":"treść podsumowania"}
\`\`\``,
      },
      {
        id: 'email-digest',
        minAfk: 15,
        prompt: `Użytkownik jest AFK — sprawdź jego emaile i przygotuj digest.

KROKI:
1. Użyj narzędzia mcp_gmail_search_emails (lub podobnego) żeby znaleźć nieprzeczytane emaile z ostatnich 24h
2. Pogrupuj emaile po nadawcy/temacie
3. Zidentyfikuj te wymagające odpowiedzi
4. Przygotuj krótki raport (max 5 najważniejszych emaili)
5. Zapisz digest w pamięci jako "Email Digest [data]" używając \`\`\`update_memory z plikiem "memory"

Jeśli nie masz dostępu do narzędzi email, odpowiedz "CORTEX_OK".
NIE PYTAJ — po prostu zrób to.`,
      },
      {
        id: 'workflow-optimization',
        minAfk: 20,
        prompt: `Przeanalizuj ostatnie aktywności użytkownika i znajdź możliwości optymalizacji.

KROKI:
1. Sprawdź listę cron jobów (cron_list) — czy wszystkie są aktualne? Czy jakiś jest zbędny?
2. Sprawdź workflow patterns — czy widzisz powtarzalne sekwencje które można zamienić na makro?
3. Sprawdź Knowledge Graph — czy są braki w profilu użytkownika?

Jeśli znajdziesz coś do poprawy:
- Zaktualizuj/usuń nieaktualne cron joby
- Zaproponuj nowe cron joby blokiem \`\`\`cron
- Uzupełnij Knowledge Graph (kg_add_entity, kg_add_relation)

NIE PYTAJ — działaj. Jeśli nie masz nic do zrobienia, odpowiedz "CORTEX_OK".`,
      },
    ];

    for (const task of tasks) {
      if (afkMinutes >= task.minAfk && !this.afkTasksDone.has(task.id)) {
        return task;
      }
    }
    return null;
  }

  // ─── Tool Call Parsing ───

  private parseProposals(response: string): CortexProposal[] {
    const matches = response.matchAll(/```proposal\s*\n([\s\S]*?)\n```/g);
    const proposals: CortexProposal[] = [];
    for (const match of matches) {
      try {
        const parsed = JSON.parse(match[1]);
        // Ensure id exists
        if (!parsed.id) {
          parsed.id = `prop_${Date.now()}_${proposals.length}`;
        }
        proposals.push(parsed);
      } catch {
        log.warn('Failed to parse proposal block from response');
      }
    }
    return proposals;
  }

  private parseToolCall(response: string): { tool: string; params: Record<string, any> } | null {
    const match = response.match(/```tool\s*\n([\s\S]*?)\n```/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.tool && typeof parsed.tool === 'string') {
          return { tool: parsed.tool, params: parsed.params || {} };
        }
      } catch {
        log.warn('parseToolCall: Failed to parse ```tool block JSON');
      }
    }

    const jsonMatch = response.match(/```(?:json)?\s*\n(\{[\s\S]*?"tool"\s*:[\s\S]*?\})\n```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.tool && typeof parsed.tool === 'string') {
          return { tool: parsed.tool, params: parsed.params || {} };
        }
      } catch {
        /* not valid tool JSON */
      }
    }

    return null;
  }

  private sanitizeToolOutput(toolName: string, data: any): string {
    let raw = JSON.stringify(data, null, 2);
    if (raw.length > 15000) raw = raw.slice(0, 15000) + '\n... (output truncated)';
    raw = raw.replace(/```/g, '` ` `').replace(/\n(#+\s)/g, '\n\\$1');
    return `[CORTEX TOOL RESULT — tool: ${toolName}]\n${raw}\n[/CORTEX TOOL RESULT]`;
  }

  private cleanResponse(response: string): string | null {
    const clean = response
      .replace(/```tool\s*\n[\s\S]*?```/g, '')
      .replace(/```update_memory\s*\n[\s\S]*?```/g, '')
      .replace(/```cron\s*\n[\s\S]*?```/g, '')
      .replace(/```take_control\s*\n[\s\S]*?```/g, '')
      .replace(/\[TOOL OUTPUT[^\]]*\][\s\S]*?\[END TOOL OUTPUT\]/g, '')
      .replace(/⚙️ Wykonuję:.*?\n/g, '')
      .replace(/[✅❌] [^:]+:.*?\n/g, '')
      .trim();

    if (!clean || this.isSuppressed(clean)) return null;
    return clean;
  }

  private analyzeAppUsage(log: any[]): Array<{ category: string; count: number }> {
    const categories = new Map<string, number>();
    for (const entry of log) {
      const cat = entry.category || 'general';
      categories.set(cat, (categories.get(cat) || 0) + 1);
    }
    return Array.from(categories.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  private parseInsights(response: string): string[] {
    const insights: string[] = [];
    const lines = response.split('\n');
    for (const line of lines) {
      if (line.includes('INSIGHT:') || line.includes('WNIOSKI:')) {
        insights.push(line.split(':')[1].trim());
      }
    }
    return insights;
  }

  private cleanReflectionResponse(response: string): string | null {
    return this.cleanResponse(response);
  }

  private parseAndSavePatterns(response: string): void {
    const matches = response.matchAll(/```pattern\s*\n([\s\S]*?)\n```/g);
    let saved = 0;

    for (const match of matches) {
      try {
        const raw = JSON.parse(match[1]);
        const pattern = {
          id: `pat_${Date.now()}_${saved}`,
          description: raw.description,
          timeRange: {
            startHour: Number(raw.timeRange.startHour) || 0,
            endHour: Number(raw.timeRange.endHour) || 23,
          },
          daysOfWeek: raw.daysOfWeek.map(Number).filter((n: number) => n >= 0 && n <= 6),
          frequency: Number(raw.frequency) || 1,
          lastSeen: Date.now(),
          suggestedCron: raw.suggestedCron || undefined,
          acknowledged: false,
        };

        this.workflow.addPattern(pattern);
        saved++;
      } catch {
        log.warn('Failed to parse pattern block from reflection');
      }
    }

    if (saved > 0) {
      log.info(`Saved ${saved} workflow pattern(s) from reflection`);
    }
  }

  private computeContextHash(ctx: ReflectionContext): string {
    const key = [
      ctx.dailySummary,
      ctx.cronSummary,
      ctx.activityLog.length.toString(),
      ctx.activityLog
        .slice(-10)
        .map((a: any) => `${a.timestamp || ''}:${a.category || ''}`)
        .join(','),
      ctx.userMd.slice(0, 300),
      ctx.memoryMd.slice(0, 300),
      ctx.kgSummary.slice(0, 200),
    ].join('|');

    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash + key.charCodeAt(i)) & 0xffffffff;
    }
    return hash.toString(36);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ░░░ BUILT-IN PROACTIVE RULES ░░░
// ═══════════════════════════════════════════════════════════════════════

function createBuiltinRules(): ProactiveRule[] {
  return [
    // ── 1. Meeting Reminder (highest priority) ──
    {
      id: 'meeting-reminder',
      name: 'Przypomnienie o spotkaniu',
      priority: 10,
      cooldownMs: 5 * 60_000,

      shouldFire(ctx: ProactiveContext, engine: CortexEngine): boolean {
        if (!ctx.calendarConnected || ctx.upcomingEvents.length === 0) return false;
        const now = Date.now();
        return ctx.upcomingEvents.some((event) => {
          const minutesUntil = (new Date(event.start).getTime() - now) / 60_000;
          return minutesUntil > 0 && minutesUntil <= 15 && !engine.isEventNotified(event.uid);
        });
      },

      generate(ctx: ProactiveContext, engine: CortexEngine) {
        const now = Date.now();
        const calEvent = ctx.upcomingEvents.find((e) => {
          const minutesUntil = (new Date(e.start).getTime() - now) / 60_000;
          return minutesUntil > 0 && minutesUntil <= 15 && !engine.isEventNotified(e.uid);
        })!;

        const minutesUntil = Math.round((new Date(calEvent.start).getTime() - now) / 60_000);
        engine.markEventNotified(calEvent.uid);

        const parts = [`📅 Za ${minutesUntil} min masz spotkanie: **${calEvent.summary}**`];
        if (calEvent.location) parts.push(`📍 ${calEvent.location}`);
        if (calEvent.attendees && calEvent.attendees.length > 0) {
          const names = calEvent.attendees.slice(0, 3).join(', ');
          const more = calEvent.attendees.length > 3 ? ` (+${calEvent.attendees.length - 3})` : '';
          parts.push(`👥 ${names}${more}`);
        }

        return { type: 'proactive', message: parts.join('\n'), context: `meeting-reminder:${calEvent.uid}` };
      },
    },

    // ── 2. Low Battery ──
    {
      id: 'low-battery',
      name: 'Niski poziom baterii',
      priority: 9,
      cooldownMs: 30 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        if (!ctx.systemSnapshot?.battery) return false;
        return ctx.systemSnapshot.battery.percent < 15 && !ctx.systemSnapshot.battery.charging;
      },

      generate(ctx: ProactiveContext) {
        return {
          type: 'alert',
          message: `🪫 Niski poziom baterii: **${ctx.systemSnapshot?.battery?.percent}%**. Podłącz zasilacz.`,
          context: 'system-battery',
        };
      },
    },

    // ── 3. High CPU / Memory ──
    {
      id: 'system-pressure',
      name: 'Wysokie obciążenie systemu',
      priority: 7,
      cooldownMs: 15 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        if (!ctx.systemSnapshot) return false;
        return ctx.systemSnapshot.cpu.usagePercent > 90 || ctx.systemSnapshot.memory.usagePercent > 90;
      },

      generate(ctx: ProactiveContext) {
        const cpu = ctx.systemSnapshot?.cpu.usagePercent || 0;
        const mem = ctx.systemSnapshot?.memory.usagePercent || 0;
        const reason = cpu > 90 ? `CPU (${cpu.toFixed(0)}%)` : `pamięci (${mem.toFixed(0)}%)`;
        return {
          type: 'alert',
          message: `⚠️ Wykryłem wysokie zużycie ${reason}. System może działać wolniej.`,
          context: 'system-pressure',
        };
      },
    },

    // ── 4. Workflow Pattern: Long Session ──
    {
      id: 'long-session',
      name: 'Długa sesja pracy',
      priority: 5,
      cooldownMs: 60 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        return ctx.currentSessionMinutes >= 120 && ctx.currentSessionMinutes % 60 < 5;
      },

      generate(ctx: ProactiveContext) {
        const hours = Math.floor(ctx.currentSessionMinutes / 60);
        return {
          type: 'health',
          message: `🕒 Pracujesz już od ${hours} godzin. Może czas na krótką przerwę? ☕`,
          context: 'health-break',
        };
      },
    },

    // ── 5. End of Day Reflection ──
    {
      id: 'end-of-day',
      name: 'Podsumowanie dnia',
      priority: 6,
      cooldownMs: 12 * 60 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        return ctx.hourOfDay >= 18 && ctx.hourOfDay <= 20;
      },

      async generate(ctx: ProactiveContext, engine: CortexEngine) {
        const prompt = `Podsumuj krótko dzisiejszy dzień dla użytkownika.
Statystyki: ${ctx.timeContext}
Zdarzenia: ${ctx.todayEvents.map((e) => e.summary).join(', ') || 'brak spotkań'}
Wnioski z KG: ${ctx.kgSummary.slice(0, 200)}
Odpowiedz w 1-2 zdaniach, przyjacielsko i zwięźle.`;
        const text = await engine.generateAIText(prompt);
        return {
          type: 'reflection',
          message:
            text || '🌙 Kończysz już dzień? Chcesz abym przygotował krótkie podsumowanie Twoich dzisiejszych dokonań?',
          context: 'reflection-trigger',
        };
      },
    },

    // ── 6. Tool Loop Anomaly ──
    {
      id: 'loop-anomaly',
      name: 'Anomalia pętli narzędzi',
      priority: 8,
      cooldownMs: 10 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        return ctx.systemWarnings.some((w) => w.includes('loop') || w.includes('iteration'));
      },

      generate() {
        return {
          type: 'alert',
          message: '🔄 Wykryłem zapętlenie w moich procesach autonomicznych. Zrestartowałem pętlę narzędzi.',
          context: 'engine-loop-fix',
        };
      },
    },

    // ── 7. Knowledge Gap ──
    {
      id: 'knowledge-gap',
      name: 'Brak wiedzy o projekcie',
      priority: 4,
      cooldownMs: 24 * 60 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        return ctx.kgSummary.length < 50 && ctx.currentSessionMinutes > 30;
      },

      generate() {
        return {
          type: 'memory',
          message: '🧠 Moja baza wiedzy o Twoich projektach jest pusta. Chcesz abym zaindeksował Twój folder roboczy?',
          context: 'onboarding-kg',
        };
      },
    },

    // ── 8. Morning Briefing ──
    {
      id: 'morning-brief',
      name: 'Poranny briefing',
      priority: 6,
      cooldownMs: 12 * 60 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        return ctx.hourOfDay >= 8 && ctx.hourOfDay <= 10;
      },

      async generate(ctx: ProactiveContext, engine: CortexEngine) {
        const prompt = `Przygotuj bardzo krótki (1-2 zdania) poranny briefing.
Dziś w kalendarzu: ${ctx.todayEvents.map((e) => e.summary).join(', ') || 'brak zaplanowanych spotkań'}
Czas: ${ctx.timeContext}
Bądź motywujący i konkretny.`;
        const text = await engine.generateAIText(prompt);
        return {
          type: 'briefing',
          message: text || '☀️ Dzień dobry! Masz chwilę na szybki przegląd dzisiejszego kalendarza i zadań?',
          context: 'briefing-trigger',
        };
      },
    },

    // ── 9. Context Pressure ──
    {
      id: 'context-pressure',
      name: 'Przepełnienie kontekstu',
      priority: 7,
      cooldownMs: 30 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        return ctx.systemWarnings.some((w) => w.includes('context') && w.includes('limit'));
      },

      generate() {
        return {
          type: 'alert',
          message: '💾 Nasza rozmowa stała się bardzo długa. Chcesz abym skompresował historię, by zachować płynność?',
          context: 'context-compaction-trigger',
        };
      },
    },

    // ── 10. Email Check Nudge ──
    {
      id: 'email-check',
      name: 'Sprawdzenie poczty',
      priority: 5,
      cooldownMs: 2 * 60 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        const hasEmail = ctx.mcpConnectedServers.some(
          (s) => s.includes('gmail') || s.includes('outlook') || s.includes('email'),
        );
        return hasEmail && ctx.timeOfDay !== 'night' && !ctx.isAfk;
      },

      generate() {
        return {
          type: 'proactive',
          message: '📧 Masz podłączoną pocztę — chcesz żebym sprawdził nieprzeczytane wiadomości?',
          context: 'email-check-nudge',
        };
      },
    },

    // ── 11. Night Mode ──
    {
      id: 'night-mode',
      name: 'Tryb nocny',
      priority: 3,
      cooldownMs: 8 * 60 * 60_000,

      shouldFire(ctx: ProactiveContext): boolean {
        return ctx.hourOfDay >= 23 || ctx.hourOfDay < 5;
      },

      generate() {
        return {
          type: 'health',
          message: '🌙 Jest już późno. Może warto odpocząć? Przełączam się w tryb energooszczędny.',
          context: 'health-night',
        };
      },
    },
  ];
}
