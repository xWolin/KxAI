/**
 * Tests for ContextBuilder — context assembly for AI system prompts.
 * Covers: resolveModules, simpleHash, selectRelevantMemory,
 * addTokens/getTokenUsage/resetSessionState, invalidateCache,
 * buildCronContext, buildRagStatsContext, setters, buildMemoryContext.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('@main/services/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Minimal mocks for heavy deps
vi.mock('@main/services/memory', () => ({ MemoryService: vi.fn() }));
vi.mock('@main/services/workflow-service', () => ({ WorkflowService: vi.fn() }));
vi.mock('@main/services/config', () => ({ ConfigService: vi.fn() }));
vi.mock('@main/services/cron-service', () => ({ CronService: vi.fn() }));
vi.mock('@main/services/rag-service', () => ({ RAGService: vi.fn() }));
vi.mock('@main/services/tools-service', () => ({ ToolsService: vi.fn() }));
vi.mock('@main/services/ai-service', () => ({ AIService: vi.fn() }));
vi.mock('@main/services/system-monitor', () => ({ SystemMonitor: vi.fn() }));
vi.mock('@main/services/prompt-service', () => ({ PromptService: vi.fn() }));
vi.mock('@main/services/sub-agent', () => ({ SubAgentManager: vi.fn() }));
vi.mock('@main/services/context-manager', () => ({
  ContextManager: class {
    estimateTokens(text: string) {
      return Math.ceil(text.length / 4);
    }
    static getModelContextLimit() {
      return 128000;
    }
  },
}));
vi.mock('@main/services/knowledge-graph-service', () => ({
  KnowledgeGraphService: vi.fn(),
}));

import { ContextBuilder, type ContextBuildDeps, type ContextHint } from '@main/services/context-builder';

// ─── Helpers ───

function makeDeps(overrides?: Partial<ContextBuildDeps>): ContextBuildDeps {
  return {
    memory: {
      buildSystemContext: vi.fn().mockResolvedValue('# System'),
      getConversationHistory: vi.fn().mockReturnValue([]),
      get: vi.fn().mockResolvedValue(''),
      isBootstrapPending: vi.fn().mockResolvedValue(false),
    } as any,
    workflow: {
      getTimeContext: vi.fn().mockReturnValue('Time: Monday'),
      buildTimeContext: vi.fn().mockReturnValue('## Time\nMonday'),
    } as any,
    config: {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'aiModel') return 'gpt-5';
        if (key === 'useNativeFunctionCalling') return true;
        if (key === 'persona') return 'default';
        return undefined;
      }),
    } as any,
    cron: {
      getJobs: vi.fn().mockReturnValue([]),
    } as any,
    tools: {
      getToolDefinitions: vi.fn().mockReturnValue([]),
      formatToolsForAI: vi.fn().mockReturnValue(''),
    } as any,
    ai: {
      sendMessage: vi.fn().mockResolvedValue('NO_REPLY'),
      getProviderName: vi.fn().mockReturnValue('openai'),
    } as any,
    systemMonitor: {
      getWarnings: vi.fn().mockResolvedValue([]),
      getStatusSummary: vi.fn().mockResolvedValue('CPU: 10%'),
    } as any,
    promptService: {
      render: vi.fn().mockResolvedValue('prompt content'),
      load: vi.fn().mockResolvedValue('loaded prompt'),
    } as any,
    subAgentManager: {
      getActiveSubAgents: vi.fn().mockReturnValue([]),
      buildSubAgentContext: vi.fn().mockReturnValue(''),
    } as any,
    rag: {
      getStats: vi.fn().mockReturnValue(null),
    } as any,
    ...overrides,
  };
}

// ─── Tests ───

describe('ContextBuilder', () => {
  let builder: ContextBuilder;
  let deps: ContextBuildDeps;

  beforeEach(() => {
    deps = makeDeps();
    builder = new ContextBuilder(deps);
  });

  // ─── resolveModules ───

  describe('resolveModules', () => {
    const resolve = (hint?: ContextHint) => (builder as any).resolveModules(hint);

    it('chat mode loads everything (default)', () => {
      const m = resolve({ mode: 'chat' });
      expect(m.loadAgents).toBe(true);
      expect(m.loadReasoning).toBe(true);
      expect(m.loadGuardrails).toBe(true);
      expect(m.loadResourceful).toBe(true);
      expect(m.loadToolsInstructions).toBe(true);
      expect(m.loadBootstrap).toBe(true);
      expect(m.loadAutomation).toBe(true);
      expect(m.loadScreenMonitor).toBe(true);
      expect(m.loadSystemHealth).toBe(true);
      expect(m.loadCronContext).toBe(true);
      expect(m.loadMemoryNudge).toBe(true);
      expect(m.loadActiveHours).toBe(false); // NOT loaded in chat
      expect(m.loadBackgroundTasks).toBe(true);
      expect(m.loadSubAgents).toBe(true);
      expect(m.loadRagStats).toBe(true);
    });

    it('no hint defaults to chat mode', () => {
      const m = resolve();
      expect(m.loadAgents).toBe(true);
      expect(m.loadBootstrap).toBe(true);
    });

    it('heartbeat mode disables heavy modules', () => {
      const m = resolve({ mode: 'heartbeat' });
      expect(m.loadAgents).toBe(false);
      expect(m.loadToolsInstructions).toBe(false);
      expect(m.loadBootstrap).toBe(false);
      expect(m.loadMemoryNudge).toBe(false);
      expect(m.loadActiveHours).toBe(true); // enabled in heartbeat
      // Still loaded:
      expect(m.loadReasoning).toBe(true);
      expect(m.loadGuardrails).toBe(true);
      expect(m.loadSystemHealth).toBe(true);
    });

    it('cron mode disables screen and memory nudge', () => {
      const m = resolve({ mode: 'cron' });
      expect(m.loadAgents).toBe(false);
      expect(m.loadBootstrap).toBe(false);
      expect(m.loadScreenMonitor).toBe(false);
      expect(m.loadMemoryNudge).toBe(false);
      expect(m.loadActiveHours).toBe(false);
      // Tools still loaded for cron execution:
      expect(m.loadToolsInstructions).toBe(true);
    });

    it('sub_agent mode is minimal context', () => {
      const m = resolve({ mode: 'sub_agent' });
      expect(m.loadBootstrap).toBe(false);
      expect(m.loadScreenMonitor).toBe(false);
      expect(m.loadMemoryNudge).toBe(false);
      expect(m.loadActiveHours).toBe(false);
      expect(m.loadSystemHealth).toBe(false);
      // Still loaded:
      expect(m.loadAgents).toBe(true);
    });

    it('vision mode disables agents and bootstrap', () => {
      const m = resolve({ mode: 'vision' });
      expect(m.loadAgents).toBe(false);
      expect(m.loadBootstrap).toBe(false);
      expect(m.loadActiveHours).toBe(false);
      // Screen still loaded:
      expect(m.loadScreenMonitor).toBe(true);
    });

    it('take_control mode disables bootstrap only', () => {
      const m = resolve({ mode: 'take_control' });
      expect(m.loadBootstrap).toBe(false);
      expect(m.loadActiveHours).toBe(false);
      // Everything else loaded:
      expect(m.loadAgents).toBe(true);
      expect(m.loadToolsInstructions).toBe(true);
      expect(m.loadAutomation).toBe(true);
    });
  });

  // ─── simpleHash ───

  describe('simpleHash', () => {
    const hash = (str: string) => (builder as any).simpleHash(str);

    it('returns a number', () => {
      expect(typeof hash('test')).toBe('number');
    });

    it('same input → same hash (deterministic)', () => {
      expect(hash('hello world')).toBe(hash('hello world'));
    });

    it('different inputs → different hashes', () => {
      expect(hash('aaa')).not.toBe(hash('bbb'));
    });

    it('empty string returns seed (5381)', () => {
      expect(hash('')).toBe(5381);
    });

    it('only hashes first 1000 chars', () => {
      const longA = 'a'.repeat(2000);
      const longB = 'a'.repeat(1000) + 'b'.repeat(1000);
      // First 1000 chars are the same, so hash should be the same
      expect(hash(longA)).toBe(hash(longB));
    });
  });

  // ─── selectRelevantMemory ───

  describe('selectRelevantMemory', () => {
    const select = (memory: string, msg: string) =>
      (builder as any).selectRelevantMemory(memory, msg);

    it('returns full memory if no sections', () => {
      const mem = 'Simple text without headers';
      expect(select(mem, 'anything')).toBe(mem);
    });

    it('scores sections by keyword match', () => {
      const mem = [
        '## Projekty',
        'Użytkownik pracuje nad projektem KxAI',
        '## Muzyka',
        'Lubi jazz i rock',
      ].join('\n');

      const result = select(mem, 'Jaki jest mój projekt?');
      // "projekt" should match "Projekty" section, boosting its score
      expect(result).toContain('Projekty');
      expect(result).toContain('KxAI');
    });

    it('boosts header matches with +5 score', () => {
      const mem = [
        '## Hobby',
        'Czyta książki o kodowaniu i grach',
        '## Kodowanie',
        'Używa TypeScript i React',
      ].join('\n');

      const result = select(mem, 'Powiedz o kodowaniu');
      // "Kodowanie" header should score higher
      expect(result).toContain('Kodowanie');
    });

    it('respects 14000 char budget', () => {
      // Create many large sections
      const sections: string[] = [];
      for (let i = 0; i < 20; i++) {
        sections.push(`## Section ${i}\n${'x'.repeat(2000)}`);
      }
      const mem = sections.join('\n');

      const result = select(mem, 'query');
      // Should be truncated — some sections skipped
      expect(result).toContain('pominięto');
      expect(result.length).toBeLessThanOrEqual(16000); // budget + skip note
    });

    it('recent dates get score boost', () => {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const oldDate = '2020-01-01';

      const mem = [
        `## Notatki z ${oldDate}`,
        'Stara notatka o projekcie',
        `## Notatki z ${today}`,
        'Dzisiejsze spotkanie dotyczące projektu',
      ].join('\n');

      const result = select(mem, 'spotkanie');
      // Today's section should rank higher
      const todayIdx = result.indexOf(today);
      const oldIdx = result.indexOf(oldDate);
      // Recent section should appear before old section (or old could be skipped)
      if (todayIdx !== -1 && oldIdx !== -1) {
        expect(todayIdx).toBeLessThan(oldIdx);
      }
    });

    it('handles empty userMessage gracefully', () => {
      const mem = '## Section\nContent';
      expect(() => select(mem, '')).not.toThrow();
    });
  });

  // ─── Token usage tracking ───

  describe('session state & token tracking', () => {
    it('addTokens increments counter', () => {
      builder.addTokens(100);
      builder.addTokens(200);
      expect(builder.getTokenUsage()).toBe(300);
    });

    it('resetSessionState clears token count', () => {
      builder.addTokens(500);
      builder.resetSessionState();
      expect(builder.getTokenUsage()).toBe(0);
    });

    it('resetSessionState clears memoryFlushDone', () => {
      (builder as any).memoryFlushDone = true;
      builder.resetSessionState();
      expect((builder as any).memoryFlushDone).toBe(false);
    });

    it('resetSessionState clears stable context cache', () => {
      (builder as any).stableContextCache = { content: 'x', hash: 1, timestamp: 0 };
      builder.resetSessionState();
      expect((builder as any).stableContextCache).toBeNull();
    });
  });

  // ─── invalidateCache ───

  describe('invalidateCache', () => {
    it('clears stable context cache', () => {
      (builder as any).stableContextCache = { content: 'cached', hash: 42, timestamp: Date.now() };
      builder.invalidateCache();
      expect((builder as any).stableContextCache).toBeNull();
    });
  });

  // ─── buildCronContext ───

  describe('buildCronContext', () => {
    const buildCron = () => (builder as any).buildCronContext();

    it('returns empty string when no cron jobs', () => {
      expect(buildCron()).toBe('');
    });

    it('lists cron jobs with status markers', () => {
      (deps.cron.getJobs as any).mockReturnValue([
        { name: 'Morning briefing', schedule: '0 8 * * *', action: 'Send daily briefing', enabled: true },
        { name: 'Backup', schedule: '0 0 * * *', action: 'Run backup', enabled: false },
      ]);
      const result = buildCron();
      expect(result).toContain('## Cron Jobs');
      expect(result).toContain('[✓] "Morning briefing"');
      expect(result).toContain('[✗] "Backup"');
      expect(result).toContain('0 8 * * *');
    });

    it('truncates long action text to 80 chars', () => {
      (deps.cron.getJobs as any).mockReturnValue([
        { name: 'Long', schedule: '* * * * *', action: 'x'.repeat(200), enabled: true },
      ]);
      const result = buildCron();
      // Action is .slice(0, 80), so full 200-char action shouldn't appear
      expect(result).not.toContain('x'.repeat(200));
      expect(result).toContain('x'.repeat(80));
    });
  });

  // ─── buildRagStatsContext ───

  describe('buildRagStatsContext', () => {
    const buildRag = () => (builder as any).buildRagStatsContext();

    it('returns empty string when RAG has no stats', () => {
      expect(buildRag()).toBe('');
    });

    it('returns empty string when no RAG service', () => {
      (builder as any).rag = undefined;
      expect(buildRag()).toBe('');
    });

    it('formats OpenAI embedding stats', () => {
      ((builder as any).rag as any).getStats.mockReturnValue({
        totalChunks: 150,
        totalFiles: 12,
        embeddingType: 'openai',
      });
      const result = buildRag();
      expect(result).toContain('## RAG Status');
      expect(result).toContain('150 chunków');
      expect(result).toContain('12 plików');
      expect(result).toContain('OpenAI');
    });

    it('formats TF-IDF fallback stats', () => {
      ((builder as any).rag as any).getStats.mockReturnValue({
        totalChunks: 50,
        totalFiles: 3,
        embeddingType: 'tfidf',
      });
      const result = buildRag();
      expect(result).toContain('TF-IDF fallback');
    });
  });

  // ─── Setters ───

  describe('setters', () => {
    it('setKnowledgeGraphService sets the KG reference', () => {
      const kg = { getContextSummary: vi.fn() } as any;
      builder.setKnowledgeGraphService(kg);
      expect((builder as any).knowledgeGraph).toBe(kg);
    });

    it('setRAGService updates rag reference', () => {
      const rag = { getStats: vi.fn() } as any;
      builder.setRAGService(rag);
      expect((builder as any).rag).toBe(rag);
    });

    it('setAutomationEnabled sets flag', () => {
      builder.setAutomationEnabled(true);
      expect((builder as any).automationEnabled).toBe(true);
      builder.setAutomationEnabled(false);
      expect((builder as any).automationEnabled).toBe(false);
    });

    it('setScreenMonitor sets reference', () => {
      const sm = { isRunning: vi.fn(), buildMonitorContext: vi.fn() } as any;
      builder.setScreenMonitor(sm);
      expect((builder as any).screenMonitor).toBe(sm);
    });

    it('setActiveHours sets hours', () => {
      builder.setActiveHours({ start: 8, end: 22 });
      expect((builder as any).activeHours).toEqual({ start: 8, end: 22 });
    });

    it('setBackgroundTasksProvider sets provider', () => {
      const provider = () => [];
      builder.setBackgroundTasksProvider(provider);
      expect((builder as any).backgroundTasksProvider).toBe(provider);
    });
  });

  // ─── buildStructuredContext ───

  describe('buildStructuredContext', () => {
    it('returns StructuredContext with stable, dynamic, full, estimatedTokens', async () => {
      const result = await builder.buildStructuredContext();
      expect(result).toHaveProperty('stable');
      expect(result).toHaveProperty('dynamic');
      expect(result).toHaveProperty('full');
      expect(result).toHaveProperty('estimatedTokens');
      expect(typeof result.stable).toBe('string');
      expect(typeof result.dynamic).toBe('string');
      expect(typeof result.estimatedTokens).toBe('number');
      expect(result.full).toContain(result.stable);
    });

    it('full = stable + dynamic', async () => {
      const result = await builder.buildStructuredContext();
      expect(result.full).toBe(result.stable + '\n' + result.dynamic);
    });
  });

  // ─── buildEnhancedContext (legacy) ───

  describe('buildEnhancedContext', () => {
    it('returns string (delegates to buildStructuredContext)', async () => {
      const result = await builder.buildEnhancedContext();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─── maybeRunMemoryFlush ───

  describe('maybeRunMemoryFlush', () => {
    it('does nothing if already flushed', async () => {
      (builder as any).memoryFlushDone = true;
      const callback = vi.fn();
      await builder.maybeRunMemoryFlush(callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('does nothing if history is too short', async () => {
      (deps.memory as any).getConversationHistory.mockReturnValue(
        Array(10).fill({ content: 'short' }),
      );
      const callback = vi.fn();
      await builder.maybeRunMemoryFlush(callback);
      expect(callback).not.toHaveBeenCalled();
    });

    it('flushes when history exceeds threshold', async () => {
      // Generate history that exceeds 50000 tokens (~175000 chars / 3.5)
      const bigMsg = { content: 'x'.repeat(10000) };
      const history = Array(25).fill(bigMsg); // 25 * ~2857 tokens ≈ 71000 tokens
      (deps.memory as any).getConversationHistory.mockReturnValue(history);
      (deps.ai as any).sendMessage.mockResolvedValue('```update_memory\nsome update\n```');

      const callback = vi.fn();
      await builder.maybeRunMemoryFlush(callback);

      expect((builder as any).memoryFlushDone).toBe(true);
      expect(deps.ai.sendMessage).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith('```update_memory\nsome update\n```');
    });

    it('skips callback if AI responds NO_REPLY', async () => {
      const bigMsg = { content: 'x'.repeat(10000) };
      const history = Array(25).fill(bigMsg);
      (deps.memory as any).getConversationHistory.mockReturnValue(history);
      (deps.ai as any).sendMessage.mockResolvedValue('NO_REPLY');

      const callback = vi.fn();
      await builder.maybeRunMemoryFlush(callback);

      expect(callback).not.toHaveBeenCalled();
      expect((builder as any).memoryFlushDone).toBe(true);
    });

    it('resets memoryFlushDone on error for retry', async () => {
      const bigMsg = { content: 'x'.repeat(10000) };
      const history = Array(25).fill(bigMsg);
      (deps.memory as any).getConversationHistory.mockReturnValue(history);
      (deps.ai as any).sendMessage.mockRejectedValue(new Error('API error'));

      const callback = vi.fn();
      await builder.maybeRunMemoryFlush(callback);

      expect((builder as any).memoryFlushDone).toBe(false); // retry next cycle
    });
  });

  // ─── maybeCompactContext ───

  describe('maybeCompactContext', () => {
    it('does nothing if history is below threshold', async () => {
      (deps.memory as any).getConversationHistory.mockReturnValue([{ content: 'hi' }]);
      await builder.maybeCompactContext();
      // No error, no AI call for summarization
      expect(deps.ai.sendMessage).not.toHaveBeenCalled();
    });
  });

  // ─── buildMemoryNudge ───

  describe('buildMemoryNudge (private)', () => {
    const buildNudge = () => (builder as any).buildMemoryNudge();

    it('nudges when MEMORY.md is empty', async () => {
      (deps.memory as any).get.mockResolvedValue('(Uzupełnia się automatycznie po rozmowach)');
      (deps.cron as any).getJobs.mockReturnValue([{ name: 'test' }]);
      const result = await buildNudge();
      expect(result).toContain('MEMORY.md jest PUSTY');
    });

    it('nudges when no cron jobs', async () => {
      (deps.memory as any).get.mockResolvedValue('Lots of real content here that is longer than 200 chars. '.repeat(5));
      (deps.cron as any).getJobs.mockReturnValue([]);
      const result = await buildNudge();
      expect(result).toContain('żadnych cron jobów');
    });

    it('returns empty when memory is full and crons exist', async () => {
      (deps.memory as any).get.mockResolvedValue('Lots of real content here that is longer than 200 chars. '.repeat(5));
      (deps.cron as any).getJobs.mockReturnValue([{ name: 'job' }]);
      const result = await buildNudge();
      expect(result).toBe('');
    });
  });

  // ─── buildBootstrapContext ───

  describe('buildBootstrapContext (private)', () => {
    const buildBoot = () => (builder as any).buildBootstrapContext();

    it('returns empty when bootstrap not pending', async () => {
      (deps.memory as any).isBootstrapPending.mockResolvedValue(false);
      expect(await buildBoot()).toBe('');
    });

    it('returns empty when no BOOTSTRAP.md', async () => {
      (deps.memory as any).isBootstrapPending.mockResolvedValue(true);
      (deps.memory as any).get.mockResolvedValue('');
      expect(await buildBoot()).toBe('');
    });

    it('returns bootstrap context when pending', async () => {
      (deps.memory as any).isBootstrapPending.mockResolvedValue(true);
      (deps.memory as any).get.mockResolvedValue('Welcome! Setup steps...');
      const result = await buildBoot();
      expect(result).toContain('BOOTSTRAP');
      expect(result).toContain('Welcome! Setup steps...');
      expect(result).toContain('BOOTSTRAP_COMPLETE');
    });
  });
});
