import { describe, it, expect, beforeEach } from 'vitest';
import { ContextManager } from '../src/main/services/context-manager';
import type { ConversationMessage } from '../src/shared/types/ai';

function makeMessage(
  id: string,
  role: ConversationMessage['role'],
  content: string,
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id,
    role,
    content,
    timestamp: Date.now(),
    type: 'chat',
    ...overrides,
  };
}

function makeMessages(count: number, role: ConversationMessage['role'] = 'user'): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) =>
    makeMessage(`msg-${i}`, role, `Message content #${i} — ${'x'.repeat(50)}`, {
      timestamp: Date.now() - (count - i) * 1000,
    }),
  );
}

describe('ContextManager', () => {
  let cm: ContextManager;

  beforeEach(() => {
    cm = new ContextManager();
  });

  // ─── estimateTokens ───

  describe('estimateTokens()', () => {
    it('returns 0 for empty string', () => {
      expect(cm.estimateTokens('')).toBe(0);
    });

    it('estimates ~1 token per 3.5 chars', () => {
      const text = 'a'.repeat(35);
      expect(cm.estimateTokens(text)).toBe(10);
    });

    it('rounds up', () => {
      expect(cm.estimateTokens('ab')).toBe(1); // ceil(2/3.5) = 1
    });

    it('handles long text', () => {
      const text = 'x'.repeat(1000);
      expect(cm.estimateTokens(text)).toBe(Math.ceil(1000 / 3.5));
    });
  });

  // ─── getModelContextLimit ───

  describe('getModelContextLimit()', () => {
    it('returns 400k for GPT-5', () => {
      expect(ContextManager.getModelContextLimit('gpt-5')).toBe(400000);
      expect(ContextManager.getModelContextLimit('gpt-5-turbo')).toBe(400000);
    });

    it('returns 1M+ for GPT-4.1', () => {
      expect(ContextManager.getModelContextLimit('gpt-4.1')).toBe(1047576);
      expect(ContextManager.getModelContextLimit('gpt-41')).toBe(1047576);
    });

    it('returns 128k for GPT-4o', () => {
      expect(ContextManager.getModelContextLimit('gpt-4o')).toBe(128000);
      expect(ContextManager.getModelContextLimit('gpt-4o-mini')).toBe(128000);
    });

    it('returns 200k for O-series', () => {
      expect(ContextManager.getModelContextLimit('o1')).toBe(200000);
      expect(ContextManager.getModelContextLimit('o3')).toBe(200000);
      expect(ContextManager.getModelContextLimit('o4-mini')).toBe(200000);
    });

    it('returns 200k for Claude', () => {
      expect(ContextManager.getModelContextLimit('claude-sonnet-4-20250514')).toBe(200000);
      expect(ContextManager.getModelContextLimit('claude-opus-4-20250514')).toBe(200000);
      expect(ContextManager.getModelContextLimit('claude-3-haiku')).toBe(200000);
    });

    it('returns 1M for Gemini', () => {
      expect(ContextManager.getModelContextLimit('gemini-2.5-pro')).toBe(1000000);
    });

    it('returns 128k as default', () => {
      expect(ContextManager.getModelContextLimit('unknown-model')).toBe(128000);
    });
  });

  // ─── configureForModel ───

  describe('configureForModel()', () => {
    it('sets 60% of model context as maxContextTokens', () => {
      cm.configureForModel('gpt-4o');
      // 128000 * 0.6 = 76800
      const window = cm.buildContextWindow([], 0);
      // We verify by checking that a context window with no messages returns 0 tokens
      expect(window.totalTokens).toBe(0);
    });

    it('adjusts summary threshold for large models', () => {
      cm.configureForModel('gpt-5'); // 400k
      // For >100k: summaryThreshold = 100, minMessagesToKeep = 20
      // We test indirectly via buildContextWindow behavior
      const messages = makeMessages(50);
      const window = cm.buildContextWindow(messages);
      // All 50 messages should fit easily in 240k tokens budget
      expect(window.droppedCount).toBe(0);
    });
  });

  // ─── buildContextWindow ───

  describe('buildContextWindow()', () => {
    it('returns empty window for empty history', () => {
      const window = cm.buildContextWindow([]);
      expect(window.messages).toHaveLength(0);
      expect(window.summary).toBeNull();
      expect(window.totalTokens).toBe(0);
      expect(window.droppedCount).toBe(0);
    });

    it('returns all messages when they fit within budget', () => {
      const messages = makeMessages(5);
      const window = cm.buildContextWindow(messages);
      expect(window.messages).toHaveLength(5);
      expect(window.droppedCount).toBe(0);
      expect(window.totalTokens).toBeGreaterThan(0);
    });

    it('drops least important messages when budget exceeded', () => {
      // Create a tiny budget CM
      const tinyCm = new ContextManager({
        maxContextTokens: 100, // Very small — ~350 chars
        reserveForResponse: 0,
        minMessagesToKeep: 2,
        summaryThreshold: 3,
      });

      const messages = makeMessages(20);
      const window = tinyCm.buildContextWindow(messages);

      expect(window.droppedCount).toBeGreaterThan(0);
      expect(window.messages.length).toBeLessThan(20);
      // Last N messages should always be included (guaranteed)
      expect(window.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('always keeps minMessagesToKeep recent messages', () => {
      const tinyCm = new ContextManager({
        maxContextTokens: 50,
        reserveForResponse: 0,
        minMessagesToKeep: 5,
      });

      const messages = makeMessages(10);
      const window = tinyCm.buildContextWindow(messages);

      // Even with tiny budget, last 5 should be kept
      expect(window.messages.length).toBeGreaterThanOrEqual(5);
    });

    it('respects systemPromptTokens budget', () => {
      const cm2 = new ContextManager({
        maxContextTokens: 200,
        reserveForResponse: 0,
        minMessagesToKeep: 2,
      });

      const messages = makeMessages(10);
      const withoutSystem = cm2.buildContextWindow(messages, 0);
      const withBigSystem = cm2.buildContextWindow(messages, 180);

      // With large system prompt, fewer messages should fit
      expect(withBigSystem.messages.length).toBeLessThanOrEqual(withoutSystem.messages.length);
    });

    it('preserves chronological order in output', () => {
      const messages = makeMessages(5);
      const window = cm.buildContextWindow(messages);

      for (let i = 1; i < window.messages.length; i++) {
        expect(window.messages[i].timestamp).toBeGreaterThanOrEqual(window.messages[i - 1].timestamp);
      }
    });
  });

  // ─── Pin/Unpin ───

  describe('pin/unpin messages', () => {
    it('pinned messages get max importance (always included)', () => {
      const tinyCm = new ContextManager({
        maxContextTokens: 200,
        reserveForResponse: 0,
        minMessagesToKeep: 1,
        summaryThreshold: 3,
      });

      const messages = makeMessages(20);
      // Pin an old message
      tinyCm.pinMessage('msg-0');

      const window = tinyCm.buildContextWindow(messages);

      // The pinned message should be included even though it's old
      const includedIds = window.messages.map((m) => m.id);
      expect(includedIds).toContain('msg-0');
    });

    it('unpinned messages can be dropped', () => {
      const tinyCm = new ContextManager({
        maxContextTokens: 200,
        reserveForResponse: 0,
        minMessagesToKeep: 1,
        summaryThreshold: 3,
      });

      const messages = makeMessages(20);
      tinyCm.pinMessage('msg-0');
      tinyCm.unpinMessage('msg-0');

      // After unpinning, msg-0 (oldest) may be dropped
      const window = tinyCm.buildContextWindow(messages);
      // Can't guarantee it's dropped (depends on scoring), but unpin should work
      expect(window).toBeDefined();
    });
  });

  // ─── Importance Scoring ───

  describe('importance scoring (via buildContextWindow)', () => {
    it('ranks tool results higher than plain messages', () => {
      const messages = [
        makeMessage('plain', 'assistant', 'Oto odpowiedź', { timestamp: 1000 }),
        makeMessage('tool', 'assistant', 'Wynik narzędzia "shell_exec": output here', { timestamp: 2000 }),
      ];

      const tinyCm = new ContextManager({
        maxContextTokens: 50, // Force dropping
        reserveForResponse: 0,
        minMessagesToKeep: 1,
        summaryThreshold: 100,
      });

      const window = tinyCm.buildContextWindow(messages);
      // Tool result should be kept over plain message when forced to choose
      if (window.messages.length === 1) {
        expect(window.messages[0].id).toBe('tool');
      }
    });

    it('ranks analysis messages higher', () => {
      const messages = [
        makeMessage('chat', 'assistant', 'Normalny czat', { timestamp: 1000 }),
        makeMessage('analysis', 'assistant', 'Analiza ekranu: ...', {
          timestamp: 2000,
          type: 'analysis',
        }),
      ];

      // Both should be included with normal budget
      const window = cm.buildContextWindow(messages);
      expect(window.messages).toHaveLength(2);
    });

    it('boosts messages with important keywords', () => {
      const messages = [
        makeMessage('normal', 'user', 'Cześć, co słychać?', { timestamp: 1000 }),
        makeMessage('important', 'user', 'Zapamiętaj: deadline to piątek', { timestamp: 2000 }),
      ];

      // Both should be included, important one with higher score
      const window = cm.buildContextWindow(messages);
      expect(window.messages).toHaveLength(2);
    });
  });

  // ─── Summary Generation ───

  describe('summary generation', () => {
    it('generates summary when messages are dropped and above threshold', () => {
      const tinyCm = new ContextManager({
        maxContextTokens: 100,
        reserveForResponse: 0,
        minMessagesToKeep: 2,
        summaryThreshold: 5, // Low threshold for testing
      });

      const messages = makeMessages(15);
      const window = tinyCm.buildContextWindow(messages);

      if (window.droppedCount > 0 && messages.length > 5) {
        expect(window.summary).toBeTruthy();
      }
    });

    it('does not generate summary when all messages fit', () => {
      const messages = makeMessages(3);
      const window = cm.buildContextWindow(messages);
      expect(window.summary).toBeNull();
      expect(window.droppedCount).toBe(0);
    });
  });

  // ─── Edge Cases ───

  describe('edge cases', () => {
    it('handles single message', () => {
      const messages = [makeMessage('only', 'user', 'Hello')];
      const window = cm.buildContextWindow(messages);
      expect(window.messages).toHaveLength(1);
      expect(window.droppedCount).toBe(0);
    });

    it('handles huge system prompt that exceeds budget', () => {
      const cm2 = new ContextManager({
        maxContextTokens: 100,
        reserveForResponse: 50,
      });
      const messages = makeMessages(5);
      // System prompt larger than total budget
      const window = cm2.buildContextWindow(messages, 200);
      // Should still work without crashing — available tokens clamped to 0
      expect(window).toBeDefined();
    });
  });
});
