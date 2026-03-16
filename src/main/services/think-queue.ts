/**
 * ThinkQueue — Priority queue for CortexEngine think-cycle triggers.
 *
 * Replaces the "skip on busy" policy with a bounded, priority-ordered queue:
 * - When CortexEngine would skip a think (agent processing user message OR think already running),
 *   the trigger is enqueued instead of dropped.
 * - Backpressure: when queue is full, the lowest-priority item is evicted (not the incoming).
 * - Starvation guard: items that wait too long are promoted to higher priority.
 * - Retry/backoff: failed think cycles can re-enqueue with exponential backoff.
 * - Drop summary: evicted items are summarised and injected into the next think as a system event.
 */

import { v4 as uuid } from 'uuid';
import { createLogger } from './logger';

const log = createLogger('ThinkQueue');

// ─── Public Types ─────────────────────────────────────────────────────────────

export type ThinkTriggerReason = 'timer' | 'cron_event' | 'user_return' | 'manual' | 'rule_check';
export type ThinkTriggerPriority = 'high' | 'normal' | 'low';

export interface ThinkTrigger {
  id: string;
  reason: ThinkTriggerReason;
  priority: ThinkTriggerPriority;
  enqueuedAt: number;
  /** Context hint injected into next think's event section */
  payload?: string;
  /** Retry tracking */
  retryCount?: number;
  /** Earliest timestamp at which this retry may be dequeued */
  nextRetryAt?: number;
}

export interface ThinkQueueMetrics {
  queueDepth: number;
  /** Total triggers enqueued since creation */
  totalEnqueued: number;
  /** Total triggers dropped (backpressure or max retries) */
  totalDropped: number;
  /** Drop reason counts: key = "<reason>:<triggerType>" */
  dropReasonCounts: Record<string, number>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_QUEUE_SIZE = 5;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;
/** After this many ms waiting, 'low' → 'normal' and 'normal' → 'high' */
const STARVATION_PROMOTE_MS = 5 * 60_000;
const MAX_DROP_HISTORY = 10;

const PRIORITY_ORDER: Record<ThinkTriggerPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

// ─── ThinkQueue ───────────────────────────────────────────────────────────────

export class ThinkQueue {
  private queue: ThinkTrigger[] = [];
  private dropReasonCounts: Record<string, number> = {};
  private recentDrops: Pick<ThinkTrigger, 'reason' | 'priority' | 'payload'>[] = [];
  private totalEnqueued = 0;
  private totalDropped = 0;

  // ── Enqueue ──────────────────────────────────────────────────────────────

  /**
   * Add a trigger to the queue.
   * If the queue is at capacity, the lowest-priority item is evicted to make room.
   * If the new trigger is the lowest priority and no room exists, it is dropped instead.
   */
  enqueue(trigger: ThinkTrigger): void {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      const lowestExisting = this.findLowestPriorityItem();
      if (lowestExisting && PRIORITY_ORDER[lowestExisting.priority] >= PRIORITY_ORDER[trigger.priority]) {
        // Evict the existing low-priority item
        this.queue = this.queue.filter((q) => q.id !== lowestExisting.id);
        this.recordDrop(lowestExisting, 'backpressure:evicted');
        log.debug(
          `ThinkQueue evicted [${lowestExisting.priority}] ${lowestExisting.reason} for incoming [${trigger.priority}] ${trigger.reason}`,
        );
      } else {
        // Incoming is lowest priority — drop it
        this.recordDrop(trigger, 'backpressure:dropped');
        log.debug(`ThinkQueue dropped [${trigger.priority}] ${trigger.reason} — queue full with higher-priority items`);
        return;
      }
    }

    this.queue.push(trigger);
    this.totalEnqueued++;
    log.debug(`ThinkQueue enqueued [${trigger.priority}] ${trigger.reason} — depth: ${this.queue.length}`);
  }

  // ── Dequeue ──────────────────────────────────────────────────────────────

  /**
   * Remove and return the highest-priority ready trigger.
   * Applies starvation promotion before selecting.
   * Skips items whose nextRetryAt is in the future.
   * Returns null if queue is empty or all items are in backoff.
   */
  dequeue(): ThinkTrigger | null {
    if (this.queue.length === 0) return null;

    this.applyStarvationPromotion();

    const now = Date.now();
    // Sort: priority ASC (high=0), then enqueuedAt ASC (oldest first within same priority)
    const sorted = [...this.queue].sort((a, b) => {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      return pd !== 0 ? pd : a.enqueuedAt - b.enqueuedAt;
    });

    // Find first item that is ready (not in backoff)
    const ready = sorted.find((t) => !t.nextRetryAt || t.nextRetryAt <= now);
    if (!ready) return null;

    this.queue = this.queue.filter((t) => t.id !== ready.id);
    return ready;
  }

  // ── Retry / Backoff ───────────────────────────────────────────────────────

  /**
   * Re-enqueue a failed trigger with exponential backoff.
   * After MAX_RETRIES, the item is dropped permanently.
   */
  requeueWithBackoff(trigger: ThinkTrigger, _error?: Error): void {
    const retryCount = (trigger.retryCount ?? 0) + 1;

    if (retryCount > MAX_RETRIES) {
      this.recordDrop(trigger, 'max_retries');
      log.warn(`ThinkQueue permanently dropped [${trigger.reason}] after ${retryCount - 1} retries`);
      return;
    }

    const backoffMs = Math.min(BACKOFF_BASE_MS * Math.pow(2, retryCount - 1), BACKOFF_MAX_MS);
    const retryTrigger: ThinkTrigger = {
      ...trigger,
      id: uuid(),
      priority: 'low', // demote on retry
      enqueuedAt: Date.now(),
      retryCount,
      nextRetryAt: Date.now() + backoffMs,
    };

    log.info(`ThinkQueue requeue [${trigger.reason}] retry #${retryCount}, backoff ${backoffMs}ms`);
    this.enqueue(retryTrigger);
  }

  // ── Drop Summary ──────────────────────────────────────────────────────────

  /**
   * Returns a formatted summary of recently dropped triggers suitable for
   * injection as a system event in the next think cycle.
   * Clears the drop history after reading (consume-once).
   */
  consumeDropSummary(): string | null {
    if (this.recentDrops.length === 0) return null;

    const bullets = this.recentDrops
      .map((d) => `• [${d.priority}] ${d.reason}${d.payload ? `: ${d.payload.slice(0, 60)}` : ''}`)
      .join('\n');
    this.recentDrops = [];

    return `Pominięte triggery (backpressure/limit):\n${bullets}`;
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  depth(): number {
    return this.queue.length;
  }

  getMetrics(): ThinkQueueMetrics {
    return {
      queueDepth: this.queue.length,
      totalEnqueued: this.totalEnqueued,
      totalDropped: this.totalDropped,
      dropReasonCounts: { ...this.dropReasonCounts },
    };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private applyStarvationPromotion(): void {
    const now = Date.now();
    for (const item of this.queue) {
      const age = now - item.enqueuedAt;
      if (item.priority === 'low' && age > STARVATION_PROMOTE_MS) {
        item.priority = 'normal';
        log.debug(`ThinkQueue starvation promoted ${item.reason} low→normal after ${Math.round(age / 60000)}min`);
      } else if (item.priority === 'normal' && age > STARVATION_PROMOTE_MS * 2) {
        item.priority = 'high';
        log.debug(`ThinkQueue starvation promoted ${item.reason} normal→high after ${Math.round(age / 60000)}min`);
      }
    }
  }

  private findLowestPriorityItem(): ThinkTrigger | null {
    if (this.queue.length === 0) return null;
    return this.queue.reduce((lowest, item) =>
      PRIORITY_ORDER[item.priority] > PRIORITY_ORDER[lowest.priority] ? item : lowest,
    );
  }

  private recordDrop(trigger: ThinkTrigger, dropReason: string): void {
    const key = `${dropReason}:${trigger.reason}`;
    this.dropReasonCounts[key] = (this.dropReasonCounts[key] ?? 0) + 1;
    this.totalDropped++;

    if (this.recentDrops.length >= MAX_DROP_HISTORY) {
      this.recentDrops.shift();
    }
    this.recentDrops.push({
      reason: trigger.reason,
      priority: trigger.priority,
      payload: trigger.payload,
    });
  }
}
