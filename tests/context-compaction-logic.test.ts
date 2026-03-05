import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextBuilder } from '../src/main/services/context-builder';
import { ContextManager } from '../src/main/services/context-manager';

describe('ContextBuilder - Compaction Logic', () => {
  let builder: ContextBuilder;
  let deps: any;

  beforeEach(() => {
    deps = {
      memory: {
        getConversationHistory: vi.fn(),
        compactHistory: vi.fn(),
        isBootstrapPending: vi.fn().mockResolvedValue(false),
        get: vi.fn(),
      },
      workflow: {
        buildTimeContext: vi.fn().mockReturnValue('Time context'),
      },
      config: {
        get: vi.fn().mockReturnValue('gpt-5'),
      },
      cron: {
        getJobs: vi.fn().mockReturnValue([]),
      },
      tools: {
        getToolsPrompt: vi.fn().mockReturnValue(''),
      },
      ai: {
        sendMessage: vi.fn(),
        estimateTokens: vi.fn((text) => Math.ceil(text.length / 3.5)),
      },
      systemMonitor: {
        getWarnings: vi.fn().mockResolvedValue([]),
        getStatusSummary: vi.fn().mockResolvedValue('System status'),
      },
      promptService: {
        load: vi.fn().mockResolvedValue(''),
      },
      subAgentManager: {
        buildSubAgentContext: vi.fn().mockReturnValue(''),
      },
    };

    builder = new ContextBuilder(deps as any);
  });

  it('should use dynamic threshold based on model context limit', async () => {
    // GPT-5 has 400k context, ContextManager.getModelContextLimit returns 400000.
    // ContextBuilder currently has hardcoded 80000.
    // I want it to be dynamic.
    
    // Setup history that exceeds a lower dynamic threshold but is below 80000
    const history = Array(50).fill({ role: 'user', content: 'A'.repeat(1000) });
    deps.memory.getConversationHistory.mockReturnValue(history);
    
    // If I change it to use 20% of context limit for compaction:
    // 400000 * 0.2 = 80000. 
    // Wait, 80000 is already the hardcoded value.
    
    // Let's test with a smaller model like GPT-4o (128k)
    deps.config.get.mockReturnValue('gpt-4o');
    // 128000 * 0.2 = 25600.
    
    // history tokens ~ 50 * (1000 / 3.5) = 14285 tokens.
    // This should NOT trigger compaction if threshold is 25600.
    
    await builder.maybeCompactContext();
    expect(deps.ai.sendMessage).not.toHaveBeenCalled();
    
    // Now make it exceed 25600
    const longHistory = Array(100).fill({ role: 'user', content: 'A'.repeat(1000) });
    deps.memory.getConversationHistory.mockReturnValue(longHistory);
    // history tokens ~ 100 * (1000 / 3.5) = 28571 tokens.
    
    deps.ai.sendMessage.mockResolvedValue('Summary of conversation');
    
    await builder.maybeCompactContext();
    // It should trigger now because 28571 > 25600
    expect(deps.ai.sendMessage).toHaveBeenCalled(); 
  });
});
