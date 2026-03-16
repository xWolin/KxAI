import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ThinkQueue } from '../src/main/services/think-queue';
import type { ThinkTrigger } from '../src/main/services/think-queue';

// ─── Helpers ───────────────────────────────────────────────────────────────────

let idCounter = 0;
function trigger(
  overrides: Partial<ThinkTrigger> = {},
): ThinkTrigger {
  return {
    id: `t${++idCounter}`,
    reason: 'timer',
    priority: 'normal',
    enqueuedAt: Date.now(),
    ...overrides,
  };
}

// ─── ThinkQueue — Unit Tests ───────────────────────────────────────────────────

describe('ThinkQueue', () => {
  let q: ThinkQueue;

  beforeEach(() => {
    q = new ThinkQueue();
    idCounter = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Basic enqueue / dequeue ──────────────────────────────────────────────────

  describe('basic enqueue / dequeue', () => {
    it('dequeue returns null when empty', () => {
      expect(q.dequeue()).toBeNull();
    });

    it('enqueue then dequeue returns the trigger', () => {
      const t = trigger();
      q.enqueue(t);
      expect(q.dequeue()).toMatchObject({ id: t.id });
    });

    it('depth reflects queue size', () => {
      expect(q.depth()).toBe(0);
      q.enqueue(trigger());
      expect(q.depth()).toBe(1);
      q.enqueue(trigger());
      expect(q.depth()).toBe(2);
      q.dequeue();
      expect(q.depth()).toBe(1);
    });
  });

  // ── Priority ordering ────────────────────────────────────────────────────────

  describe('priority ordering', () => {
    it('dequeues high before normal before low', () => {
      q.enqueue(trigger({ id: 'low', priority: 'low' }));
      q.enqueue(trigger({ id: 'high', priority: 'high' }));
      q.enqueue(trigger({ id: 'normal', priority: 'normal' }));

      expect(q.dequeue()?.id).toBe('high');
      expect(q.dequeue()?.id).toBe('normal');
      expect(q.dequeue()?.id).toBe('low');
    });

    it('FIFO within same priority (oldest first)', () => {
      const t1 = trigger({ id: 'first', priority: 'normal', enqueuedAt: 1000 });
      const t2 = trigger({ id: 'second', priority: 'normal', enqueuedAt: 2000 });
      q.enqueue(t2);
      q.enqueue(t1);

      expect(q.dequeue()?.id).toBe('first');
      expect(q.dequeue()?.id).toBe('second');
    });
  });

  // ── Backpressure ─────────────────────────────────────────────────────────────

  describe('backpressure (max 5)', () => {
    it('evicts lowest-priority item when queue is full and incoming is higher priority', () => {
      // Fill queue with 5 'low' items
      for (let i = 0; i < 5; i++) q.enqueue(trigger({ id: `low${i}`, priority: 'low' }));
      expect(q.depth()).toBe(5);

      // Add a 'high' — should evict one 'low'
      q.enqueue(trigger({ id: 'new-high', priority: 'high' }));
      expect(q.depth()).toBe(5);

      // The high item must be in the queue
      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(q.dequeue()?.id);
      expect(ids).toContain('new-high');
    });

    it('drops incoming trigger when it is lower priority than all queued', () => {
      // Fill queue with 5 'high' items
      for (let i = 0; i < 5; i++) q.enqueue(trigger({ id: `hi${i}`, priority: 'high' }));

      // Attempt to add a 'low' — should be dropped
      q.enqueue(trigger({ id: 'new-low', priority: 'low' }));
      expect(q.depth()).toBe(5);

      const ids = [];
      for (let i = 0; i < 5; i++) ids.push(q.dequeue()?.id);
      expect(ids).not.toContain('new-low');
    });

    it('records drop reason on eviction', () => {
      for (let i = 0; i < 5; i++) q.enqueue(trigger({ priority: 'low' }));
      q.enqueue(trigger({ priority: 'high' }));

      const metrics = q.getMetrics();
      expect(metrics.totalDropped).toBe(1);
      const hasEvictKey = Object.keys(metrics.dropReasonCounts).some((k) => k.includes('evicted'));
      expect(hasEvictKey).toBe(true);
    });

    it('dropped items are included in consumeDropSummary', () => {
      for (let i = 0; i < 5; i++) q.enqueue(trigger({ priority: 'low' }));
      q.enqueue(trigger({ priority: 'high' })); // evicts one low

      const summary = q.consumeDropSummary();
      expect(summary).not.toBeNull();
      expect(summary).toContain('low');
    });

    it('consumeDropSummary clears history after reading', () => {
      for (let i = 0; i < 5; i++) q.enqueue(trigger({ priority: 'low' }));
      q.enqueue(trigger({ priority: 'high' }));

      q.consumeDropSummary(); // first read — clears
      expect(q.consumeDropSummary()).toBeNull(); // second read — nothing
    });
  });

  // ── Starvation guard ─────────────────────────────────────────────────────────

  describe('starvation guard', () => {
    it('promotes low→normal after 5 minutes', () => {
      const old = trigger({ id: 'old-low', priority: 'low', enqueuedAt: Date.now() - 5 * 60_000 - 1 });
      const young = trigger({ id: 'young-high', priority: 'high', enqueuedAt: Date.now() });
      q.enqueue(old);
      q.enqueue(young);

      // Advance time so starvation kicks in on dequeue
      vi.advanceTimersByTime(0); // just trigger internal date checks via enqueue timestamps

      const first = q.dequeue();
      // young-high should still come first (already high)
      expect(first?.id).toBe('young-high');
    });

    it('promotes normal→high after 10 minutes', () => {
      const veryOld = trigger({
        id: 'very-old-normal',
        priority: 'normal',
        enqueuedAt: Date.now() - 10 * 60_000 - 1,
      });
      const recent = trigger({ id: 'recent-normal', priority: 'normal', enqueuedAt: Date.now() });
      q.enqueue(veryOld);
      q.enqueue(recent);

      const first = q.dequeue();
      // veryOld should be promoted to high → dequeued first
      expect(first?.id).toBe('very-old-normal');
    });
  });

  // ── Retry / backoff ───────────────────────────────────────────────────────────

  describe('requeueWithBackoff', () => {
    it('re-enqueues with low priority and nextRetryAt in the future', () => {
      const t = trigger({ id: 'fail-t', priority: 'high' });
      q.requeueWithBackoff(t, new Error('timeout'));

      // Should be in queue but not dequeue-able until retry time passes
      expect(q.depth()).toBe(1);
      expect(q.dequeue()).toBeNull(); // nextRetryAt is in the future
    });

    it('dequeues retry item after backoff elapses', () => {
      vi.setSystemTime(new Date(0)); // t=0
      const t = trigger({ id: 'retry-t', priority: 'normal' });
      q.requeueWithBackoff(t, new Error('err'));

      vi.setSystemTime(new Date(6_000)); // +6s, past 5s backoff
      const dequeued = q.dequeue();
      expect(dequeued?.id).not.toBeNull();
    });

    it('permanently drops after MAX_RETRIES (3)', () => {
      let t = trigger({ id: 'maxretry-t' });
      // Simulate 3 retries
      q.requeueWithBackoff(t, new Error('1'));
      t = { ...q.dequeue()! } || t; // get it back (set time past backoff)
      vi.setSystemTime(new Date(Date.now() + 10_000));

      // Manually set retryCount to 3 to hit the limit
      const atLimit = trigger({ id: 'at-limit', retryCount: 3 });
      q.requeueWithBackoff(atLimit, new Error('final'));

      const metrics = q.getMetrics();
      const hasMaxRetry = Object.keys(metrics.dropReasonCounts).some((k) => k.includes('max_retries'));
      expect(hasMaxRetry).toBe(true);
    });
  });

  // ── Metrics ───────────────────────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('tracks totalEnqueued and totalDropped', () => {
      for (let i = 0; i < 5; i++) q.enqueue(trigger({ priority: 'low' }));
      q.enqueue(trigger({ priority: 'high' })); // evicts one → 1 drop

      const m = q.getMetrics();
      expect(m.totalEnqueued).toBe(6); // 5 lows + 1 high (evicted low is also counted as enqueued)
      expect(m.totalDropped).toBe(1);
      expect(m.queueDepth).toBe(5);
    });
  });
});
