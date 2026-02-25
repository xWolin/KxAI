/**
 * ProactiveEngine — Intelligent proactive notification system.
 *
 * Fuses context from multiple sources (calendar, system health, activity patterns,
 * knowledge graph, screen monitor) and generates proactive suggestions using
 * a rule-based engine with AI-powered message generation.
 *
 * Key features:
 * - Rule engine with priority + cooldown management
 * - Context fusion from 6+ data sources
 * - Learning loop — tracks accept/dismiss rate per rule
 * - Active hours enforcement
 * - Per-rule cooldowns to prevent notification spam
 *
 * Architecture:
 * - Runs on a timer (config.proactiveIntervalMs, default 60s)
 * - Each tick: gatherContext() → evaluate rules → pick highest priority → fire
 * - Results pushed via onProactiveMessage callback → Ev.AI_PROACTIVE → renderer
 *
 * @phase 6.4
 */

import { createLogger } from './logger';
import type { CalendarService } from './calendar-service';
import type { SystemMonitor } from './system-monitor';
import type { KnowledgeGraphService } from './knowledge-graph-service';
import type { WorkflowService } from './workflow-service';
import type { MemoryService } from './memory';
import type { ConfigService } from './config';
import type { CalendarEvent } from '../../shared/types/calendar';
import type { SystemSnapshot } from '../../shared/types/system';

const log = createLogger('ProactiveEngine');

// ─── Types ───

export interface ProactiveContext {
  /** Current time info */
  now: Date;
  hourOfDay: number;
  dayOfWeek: number; // 0=Sunday
  timeOfDay: 'night' | 'morning' | 'afternoon' | 'evening';

  /** Calendar */
  upcomingEvents: CalendarEvent[];
  todayEvents: CalendarEvent[];
  calendarConnected: boolean;

  /** System health */
  systemSnapshot: SystemSnapshot | null;
  systemWarnings: string[];

  /** Activity */
  timeContext: string;
  currentSessionMinutes: number;

  /** Screen */
  screenContext: string;
  currentWindow: string;

  /** Knowledge graph */
  kgSummary: string;

  /** AFK state */
  isAfk: boolean;
}

export interface ProactiveRule {
  id: string;
  name: string;
  /** Higher = fires first when multiple rules match */
  priority: number;
  /** Minimum ms between firings of this rule */
  cooldownMs: number;
  /** Check if rule should fire given current context */
  shouldFire(ctx: ProactiveContext, engine: ProactiveEngine): boolean;
  /** Generate the notification message */
  generate(ctx: ProactiveContext, engine: ProactiveEngine): ProactiveNotification;
}

export interface ProactiveNotification {
  type: string;
  message: string;
  context: string;
  /** Optional: rule that generated this */
  ruleId?: string;
}

export interface ProactiveFeedback {
  ruleId: string;
  action: 'accepted' | 'dismissed' | 'replied';
  timestamp: number;
}

export interface ProactiveStats {
  totalFired: number;
  totalAccepted: number;
  totalDismissed: number;
  rulesEnabled: number;
  ruleStats: Array<{
    ruleId: string;
    name: string;
    fired: number;
    accepted: number;
    dismissed: number;
    acceptRate: number;
    lastFired: number | null;
  }>;
}

interface ProactiveEngineDeps {
  workflow: WorkflowService;
  memory: MemoryService;
  config: ConfigService;
}

// ─── Rule Feedback Tracking ───

interface RuleFeedbackEntry {
  fired: number;
  accepted: number;
  dismissed: number;
  lastFired: number | null;
}

// ─── Proactive Engine ───

export class ProactiveEngine {
  private workflow: WorkflowService;
  private memory: MemoryService;
  private config: ConfigService;

  // Optional dependencies (set later)
  private calendarService?: CalendarService;
  private systemMonitor?: SystemMonitor;
  private knowledgeGraph?: KnowledgeGraphService;
  private screenMonitor?: {
    isRunning(): boolean;
    buildMonitorContext(): string;
    getCurrentWindow(): { title: string } | null;
  };

  // State
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private isAfk = false;
  private activeHours: { start: number; end: number } | null = null;
  private cooldowns = new Map<string, number>(); // ruleId → timestamp when cooldown expires
  private feedbackMap = new Map<string, RuleFeedbackEntry>(); // ruleId → stats
  private lastFiredRuleId: string | null = null;
  private notifiedEventUids = new Set<string>(); // prevent duplicate meeting reminders
  private sessionStartTime = Date.now();

  // Rules
  private rules: ProactiveRule[] = [];

  // Callbacks
  private onProactiveMessage?: (notification: ProactiveNotification) => void;

  constructor(deps: ProactiveEngineDeps) {
    this.workflow = deps.workflow;
    this.memory = deps.memory;
    this.config = deps.config;

    // Register built-in rules
    this.rules = createBuiltinRules();

    log.info(`Initialized with ${this.rules.length} rules`);
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

  setScreenMonitor(monitor: ProactiveEngine['screenMonitor']): void {
    this.screenMonitor = monitor;
  }

  setResultCallback(cb: (notification: ProactiveNotification) => void): void {
    this.onProactiveMessage = cb;
  }

  setAfkState(isAfk: boolean): void {
    this.isAfk = isAfk;
  }

  setActiveHours(start: number | null, end: number | null): void {
    this.activeHours = start !== null && end !== null ? { start, end } : null;
  }

  // ─── Start / Stop ───

  start(intervalMs?: number): void {
    this.stop();
    const interval = intervalMs ?? this.config.get('proactiveIntervalMs') ?? 60_000;
    this.running = true;
    this.sessionStartTime = Date.now();

    // Clear stale event notifications on start
    this.notifiedEventUids.clear();

    log.info(`Started proactive engine (interval: ${Math.round(interval / 1000)}s)`);

    // First check after a short delay (let services warm up)
    setTimeout(() => {
      if (this.running) void this.evaluate();
    }, 10_000);

    this.timer = setInterval(() => {
      if (this.running) void this.evaluate();
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    log.info('Stopped proactive engine');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── Feedback (Learning Loop) ───

  recordFeedback(feedback: ProactiveFeedback): void {
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

  getLastFiredRuleId(): string | null {
    return this.lastFiredRuleId;
  }

  /** Get accept rate for a rule (0.0–1.0). Returns 0.5 if no data. */
  getAcceptRate(ruleId: string): number {
    const entry = this.feedbackMap.get(ruleId);
    if (!entry || entry.fired === 0) return 0.5; // neutral — no data
    const total = entry.accepted + entry.dismissed;
    if (total === 0) return 0.5;
    return entry.accepted / total;
  }

  getStats(): ProactiveStats {
    let totalFired = 0;
    let totalAccepted = 0;
    let totalDismissed = 0;

    const ruleStats = this.rules.map((rule) => {
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

    return {
      totalFired,
      totalAccepted,
      totalDismissed,
      rulesEnabled: this.rules.length,
      ruleStats,
    };
  }

  // ─── Core Evaluation Loop ───

  async evaluate(): Promise<ProactiveNotification | null> {
    if (!this.isWithinActiveHours()) {
      return null;
    }

    // Skip during AFK (heartbeat handles AFK mode separately)
    if (this.isAfk) {
      return null;
    }

    try {
      const ctx = await this.gatherContext();

      // Find all rules that should fire and aren't on cooldown
      const candidates = this.rules
        .filter((rule) => {
          // Check cooldown
          const cooldownExpiry = this.cooldowns.get(rule.id);
          if (cooldownExpiry && Date.now() < cooldownExpiry) return false;

          // Check learning loop — suppress rules user consistently dismisses
          const acceptRate = this.getAcceptRate(rule.id);
          if (acceptRate < 0.15) {
            // User dismisses >85% of the time — suppress
            const fb = this.feedbackMap.get(rule.id);
            if (fb && fb.fired >= 5) return false; // only suppress after 5+ samples
          }

          try {
            return rule.shouldFire(ctx, this);
          } catch (err) {
            log.warn(`Rule "${rule.id}" shouldFire() error:`, err);
            return false;
          }
        })
        .sort((a, b) => b.priority - a.priority);

      if (candidates.length === 0) return null;

      // Pick highest priority rule
      const winner = candidates[0];

      try {
        const notification = winner.generate(ctx, this);
        notification.ruleId = winner.id;

        // Set cooldown
        this.cooldowns.set(winner.id, Date.now() + winner.cooldownMs);

        // Track firing
        const fb = this.feedbackMap.get(winner.id) ?? {
          fired: 0,
          accepted: 0,
          dismissed: 0,
          lastFired: null,
        };
        fb.fired++;
        fb.lastFired = Date.now();
        this.feedbackMap.set(winner.id, fb);

        this.lastFiredRuleId = winner.id;

        // Deliver
        if (this.onProactiveMessage) {
          this.onProactiveMessage(notification);
        }

        log.info(`Rule "${winner.id}" fired: ${notification.message.substring(0, 80)}...`);
        return notification;
      } catch (err) {
        log.warn(`Rule "${winner.id}" generate() error:`, err);
        return null;
      }
    } catch (err) {
      log.error('Proactive evaluation error:', err);
      return null;
    }
  }

  // ─── Context Gathering ───

  private async gatherContext(): Promise<ProactiveContext> {
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

    // Session duration
    const currentSessionMinutes = Math.floor((Date.now() - this.sessionStartTime) / 60_000);

    // Time of day
    let timeOfDay: ProactiveContext['timeOfDay'];
    if (hourOfDay >= 5 && hourOfDay < 12) timeOfDay = 'morning';
    else if (hourOfDay >= 12 && hourOfDay < 17) timeOfDay = 'afternoon';
    else if (hourOfDay >= 17 && hourOfDay < 22) timeOfDay = 'evening';
    else timeOfDay = 'night';

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
    };
  }

  // ─── Helpers ───

  private isWithinActiveHours(): boolean {
    if (!this.activeHours) return true; // no restriction
    const hour = new Date().getHours();
    const { start, end } = this.activeHours;

    if (start <= end) {
      return hour >= start && hour < end;
    }
    // Wraps midnight (e.g., 22:00 – 06:00)
    return hour >= start || hour < end;
  }

  /** Mark an event UID as already notified (prevents duplicate meeting reminders) */
  markEventNotified(uid: string): void {
    this.notifiedEventUids.add(uid);
  }

  isEventNotified(uid: string): boolean {
    return this.notifiedEventUids.has(uid);
  }
}

// ─── Built-in Rules ───

function createBuiltinRules(): ProactiveRule[] {
  return [
    // ── 1. Meeting Reminder (highest priority) ──
    {
      id: 'meeting-reminder',
      name: 'Przypomnienie o spotkaniu',
      priority: 10,
      cooldownMs: 5 * 60_000, // 5 min per-rule (but per-event check in shouldFire)

      shouldFire(ctx: ProactiveContext, engine: ProactiveEngine): boolean {
        if (!ctx.calendarConnected || ctx.upcomingEvents.length === 0) return false;

        // Find events in next 15 minutes that haven't been notified yet
        const now = Date.now();
        return ctx.upcomingEvents.some((event) => {
          const minutesUntil = (new Date(event.start).getTime() - now) / 60_000;
          return minutesUntil > 0 && minutesUntil <= 15 && !engine.isEventNotified(event.uid);
        });
      },

      generate(ctx: ProactiveContext, engine: ProactiveEngine): ProactiveNotification {
        const now = Date.now();
        const event = ctx.upcomingEvents.find((e) => {
          const minutesUntil = (new Date(e.start).getTime() - now) / 60_000;
          return minutesUntil > 0 && minutesUntil <= 15 && !engine.isEventNotified(e.uid);
        })!;

        const minutesUntil = Math.round((new Date(event.start).getTime() - now) / 60_000);
        engine.markEventNotified(event.uid);

        const parts = [`📅 Za ${minutesUntil} min masz spotkanie: **${event.summary}**`];
        if (event.location) parts.push(`📍 ${event.location}`);
        if (event.attendees && event.attendees.length > 0) {
          const names = event.attendees.slice(0, 3).join(', ');
          const more = event.attendees.length > 3 ? ` (+${event.attendees.length - 3})` : '';
          parts.push(`👥 ${names}${more}`);
        }

        return {
          type: 'proactive',
          message: parts.join('\n'),
          context: `meeting-reminder:${event.uid}`,
        };
      },
    },

    // ── 2. Low Battery Warning ──
    {
      id: 'low-battery',
      name: 'Niski poziom baterii',
      priority: 9,
      cooldownMs: 30 * 60_000, // 30 min

      shouldFire(ctx: ProactiveContext): boolean {
        if (!ctx.systemSnapshot?.battery) return false;
        return ctx.systemSnapshot.battery.percent < 15 && !ctx.systemSnapshot.battery.charging;
      },

      generate(ctx: ProactiveContext): ProactiveNotification {
        const pct = ctx.systemSnapshot!.battery!.percent;
        const remaining = ctx.systemSnapshot!.battery!.timeRemaining;
        const timeStr = remaining && remaining !== 'unknown' ? ` (~${remaining})` : '';

        return {
          type: 'proactive',
          message: `🔋 Bateria na ${pct}%${timeStr}. Podłącz ładowarkę!`,
          context: `battery:${pct}`,
        };
      },
    },

    // ── 3. Disk Space Warning ──
    {
      id: 'disk-full',
      name: 'Mało miejsca na dysku',
      priority: 8,
      cooldownMs: 60 * 60_000, // 1h

      shouldFire(ctx: ProactiveContext): boolean {
        if (!ctx.systemSnapshot?.disk) return false;
        return ctx.systemSnapshot.disk.some((d) => d.usagePercent > 90);
      },

      generate(ctx: ProactiveContext): ProactiveNotification {
        const critical = ctx.systemSnapshot!.disk.filter((d) => d.usagePercent > 90);
        const diskList = critical
          .map((d) => `${d.mount}: ${d.freeGB.toFixed(1)} GB wolne (${Math.round(d.usagePercent)}% zajęte)`)
          .join(', ');

        return {
          type: 'proactive',
          message: `💾 Mało miejsca na dysku! ${diskList}. Czy mam pomóc posprzątać pliki tymczasowe?`,
          context: `disk:${critical.map((d) => d.mount).join(',')}`,
        };
      },
    },

    // ── 4. High CPU Warning ──
    {
      id: 'high-cpu',
      name: 'Wysokie obciążenie CPU',
      priority: 7,
      cooldownMs: 30 * 60_000, // 30 min

      shouldFire(ctx: ProactiveContext): boolean {
        if (!ctx.systemSnapshot?.cpu) return false;
        return ctx.systemSnapshot.cpu.usagePercent > 90;
      },

      generate(ctx: ProactiveContext): ProactiveNotification {
        const cpu = ctx.systemSnapshot!.cpu;
        const topProcs = ctx
          .systemSnapshot!.topProcesses.filter((p) => p.cpuPercent > 20)
          .slice(0, 3)
          .map((p) => `${p.name} (${Math.round(p.cpuPercent)}%)`)
          .join(', ');

        return {
          type: 'proactive',
          message: `⚡ CPU obciążony na ${Math.round(cpu.usagePercent)}%.${topProcs ? ` Najcięższe procesy: ${topProcs}` : ''}`,
          context: `cpu:${Math.round(cpu.usagePercent)}`,
        };
      },
    },

    // ── 5. Network Disconnected ──
    {
      id: 'no-network',
      name: 'Brak połączenia sieciowego',
      priority: 7,
      cooldownMs: 15 * 60_000, // 15 min

      shouldFire(ctx: ProactiveContext): boolean {
        return ctx.systemSnapshot?.network?.connected === false;
      },

      generate(): ProactiveNotification {
        return {
          type: 'proactive',
          message: '🌐 Brak połączenia z internetem. Niektóre funkcje (AI, kalendarz, MCP) mogą nie działać.',
          context: 'network:disconnected',
        };
      },
    },

    // ── 6. Focus Break Suggestion ──
    {
      id: 'focus-break',
      name: 'Sugestia przerwy',
      priority: 5,
      cooldownMs: 90 * 60_000, // 90 min

      shouldFire(ctx: ProactiveContext): boolean {
        // Suggest a break after 90+ min of continuous activity
        return ctx.currentSessionMinutes >= 90 && !ctx.isAfk;
      },

      generate(ctx: ProactiveContext): ProactiveNotification {
        const hours = Math.floor(ctx.currentSessionMinutes / 60);
        const mins = ctx.currentSessionMinutes % 60;
        const duration = hours > 0 ? `${hours}h ${mins}min` : `${mins} min`;

        return {
          type: 'proactive',
          message: `☕ Pracujesz już ${duration} bez przerwy. Może czas na kawę? 5 minut przerwy poprawi Twoją koncentrację.`,
          context: `focus:${ctx.currentSessionMinutes}`,
        };
      },
    },

    // ── 7. Morning Briefing ──
    {
      id: 'daily-briefing',
      name: 'Poranny briefing',
      priority: 6,
      cooldownMs: 22 * 60 * 60_000, // 22h (essentially once per day)

      shouldFire(ctx: ProactiveContext): boolean {
        // Fire between 7-10 AM
        return ctx.hourOfDay >= 7 && ctx.hourOfDay <= 10 && ctx.timeOfDay === 'morning';
      },

      generate(ctx: ProactiveContext): ProactiveNotification {
        const parts = ['🌅 Dzień dobry! Oto Twój poranny briefing:'];

        // Today's calendar
        if (ctx.todayEvents.length > 0) {
          const eventList = ctx.todayEvents
            .slice(0, 5)
            .map((e) => {
              const time = new Date(e.start).toLocaleTimeString('pl-PL', {
                hour: '2-digit',
                minute: '2-digit',
              });
              return `• ${time} — ${e.summary}`;
            })
            .join('\n');
          parts.push(`\n📅 **Spotkania dzisiaj (${ctx.todayEvents.length}):**\n${eventList}`);
        } else if (ctx.calendarConnected) {
          parts.push('\n📅 Brak zaplanowanych spotkań na dzisiaj.');
        }

        // System warnings
        if (ctx.systemWarnings.length > 0) {
          parts.push(`\n⚠️ ${ctx.systemWarnings.join(', ')}`);
        }

        return {
          type: 'proactive',
          message: parts.join('\n'),
          context: 'briefing:morning',
        };
      },
    },

    // ── 8. Evening Summary ──
    {
      id: 'evening-summary',
      name: 'Wieczorne podsumowanie',
      priority: 4,
      cooldownMs: 22 * 60 * 60_000, // 22h

      shouldFire(ctx: ProactiveContext): boolean {
        // Fire between 17-19 PM
        return ctx.hourOfDay >= 17 && ctx.hourOfDay <= 19 && ctx.timeOfDay === 'evening';
      },

      generate(ctx: ProactiveContext): ProactiveNotification {
        const parts = ['🌆 Wieczorne podsumowanie:'];

        // Tomorrow's events
        if (ctx.calendarConnected) {
          const tomorrow = new Date(ctx.now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowEvents = ctx.todayEvents.filter(() => false); // placeholder — would need getTomorrowEvents
          if (tomorrowEvents.length > 0) {
            parts.push(`\n📅 Jutro masz ${tomorrowEvents.length} spotkań.`);
          }
        }

        // Session summary
        if (ctx.currentSessionMinutes > 30) {
          const hours = Math.floor(ctx.currentSessionMinutes / 60);
          const mins = ctx.currentSessionMinutes % 60;
          parts.push(`\n⏱️ Dzisiejsza sesja: ${hours}h ${mins}min.`);
        }

        // System health
        if (ctx.systemWarnings.length > 0) {
          parts.push(`\n⚠️ ${ctx.systemWarnings.join(', ')}`);
        }

        parts.push('\nDobra robota! 🎉');

        return {
          type: 'proactive',
          message: parts.join('\n'),
          context: 'summary:evening',
        };
      },
    },

    // ── 9. High Memory Usage ──
    {
      id: 'high-memory',
      name: 'Wysokie zużycie pamięci',
      priority: 6,
      cooldownMs: 45 * 60_000, // 45 min

      shouldFire(ctx: ProactiveContext): boolean {
        if (!ctx.systemSnapshot?.memory) return false;
        return ctx.systemSnapshot.memory.usagePercent > 85;
      },

      generate(ctx: ProactiveContext): ProactiveNotification {
        const mem = ctx.systemSnapshot!.memory;
        const topMemProcs = ctx
          .systemSnapshot!.topProcesses.filter((p) => p.memoryMB > 500)
          .slice(0, 3)
          .map((p) => `${p.name} (${Math.round(p.memoryMB)} MB)`)
          .join(', ');

        return {
          type: 'proactive',
          message: `🧠 RAM na ${Math.round(mem.usagePercent)}% (${mem.freeGB.toFixed(1)} GB wolne z ${mem.totalGB.toFixed(0)} GB).${topMemProcs ? ` Najcięższe: ${topMemProcs}` : ''} Może zamknij niepotrzebne aplikacje?`,
          context: `memory:${Math.round(mem.usagePercent)}`,
        };
      },
    },

    // ── 10. Weekend Reminder ──
    {
      id: 'weekend-chill',
      name: 'Weekend — odpoczywaj',
      priority: 2,
      cooldownMs: 4 * 60 * 60_000, // 4h

      shouldFire(ctx: ProactiveContext): boolean {
        // Saturday or Sunday, working past 6 PM
        return (ctx.dayOfWeek === 0 || ctx.dayOfWeek === 6) && ctx.hourOfDay >= 18 && ctx.currentSessionMinutes >= 120;
      },

      generate(ctx: ProactiveContext): ProactiveNotification {
        return {
          type: 'proactive',
          message:
            '🎮 Weekend wieczór, a Ty wciąż przy komputerze! Może czas na odpoczynek? Twoje zdrowie jest ważniejsze niż kolejny commit. 😉',
          context: 'wellness:weekend',
        };
      },
    },
  ];
}
