import { ConversationMessage } from './memory';

/**
 * ContextManager — inteligentne zarządzanie oknem kontekstowym.
 *
 * Zamiast naiwnego "weź ostatnie 20 wiadomości", Context Manager:
 * 1. Szacuje tokeny każdej wiadomości
 * 2. Ocenia ważność (tool results, decyzje, vs. small talk)
 * 3. Kompresuje stare wiadomości do podsumowań
 * 4. Dynamicznie dopasowuje okno do limitu tokenów modelu
 * 5. Zachowuje "pinned" wiadomości (krytyczne decyzje)
 */

interface ScoredMessage {
  message: ConversationMessage;
  tokens: number;
  importance: number; // 0.0 — 1.0
  pinned: boolean;
}

interface ContextWindow {
  messages: ConversationMessage[];
  summary: string | null;
  totalTokens: number;
  droppedCount: number;
}

interface ContextManagerConfig {
  maxContextTokens: number;       // Max tokenów na kontekst (default: 12000)
  reserveForResponse: number;     // Tokeny zarezerwowane na odpowiedź AI (default: 4096)
  summaryThreshold: number;       // Powyżej ilu wiadomości summaryzować (default: 30)
  importanceDecayRate: number;    // Jak szybko maleje ważność starych wiadomości (0-1)
  minMessagesToKeep: number;      // Minimum wiadomości do zachowania (default: 4)
}

// Keyword patterns that indicate high-importance messages
const HIGH_IMPORTANCE_PATTERNS = [
  /(?:zapamięta|remember|important|ważne|kluczow|decyz|ustal)/i,
  /(?:nie rób|don't|never|nigdy|zawsze|always)/i,
  /(?:error|błąd|bug|crash|fix|napraw)/i,
  /(?:hasło|password|klucz|api.?key|secret|token)/i,
  /(?:termin|deadline|do kiedy|until|before)/i,
  /(?:architektur|design|pattern|wzorzec|konwencj)/i,
];

const TOOL_RESULT_PATTERN = /^Wynik narzędzia ".*":/;
const CRON_PATTERN = /```cron\n/;
const TOOL_CALL_PATTERN = /```tool\n/;

export class ContextManager {
  private config: ContextManagerConfig;
  private conversationSummaries: Map<string, string> = new Map(); // dateKey → summary
  private pinnedMessageIds: Set<string> = new Set();

  constructor(config?: Partial<ContextManagerConfig>) {
    this.config = {
      maxContextTokens: config?.maxContextTokens ?? 12000,
      reserveForResponse: config?.reserveForResponse ?? 4096,
      summaryThreshold: config?.summaryThreshold ?? 30,
      importanceDecayRate: config?.importanceDecayRate ?? 0.02,
      minMessagesToKeep: config?.minMessagesToKeep ?? 4,
    };
  }

  /**
   * Pin a message (will always be included in context).
   */
  pinMessage(messageId: string): void {
    this.pinnedMessageIds.add(messageId);
  }

  unpinMessage(messageId: string): void {
    this.pinnedMessageIds.delete(messageId);
  }

  /**
   * Store a summary for a conversation chunk.
   */
  addSummary(dateKey: string, summary: string): void {
    this.conversationSummaries.set(dateKey, summary);
  }

  /**
   * Build an optimized context window from conversation history.
   * Returns the best set of messages that fits within the token budget.
   */
  buildContextWindow(
    history: ConversationMessage[],
    systemPromptTokens: number = 0,
  ): ContextWindow {
    const availableTokens = this.config.maxContextTokens - this.config.reserveForResponse - systemPromptTokens;

    if (history.length === 0) {
      return { messages: [], summary: null, totalTokens: 0, droppedCount: 0 };
    }

    // Score all messages
    const scored = history.map((msg, idx) =>
      this.scoreMessage(msg, idx, history.length)
    );

    // Always keep the last N messages regardless of score
    const guaranteedCount = Math.min(this.config.minMessagesToKeep, scored.length);
    const guaranteed = scored.slice(-guaranteedCount);
    const candidates = scored.slice(0, -guaranteedCount);

    // Sort candidates by importance (highest first)
    candidates.sort((a, b) => b.importance - a.importance);

    // Greedily fill the context window
    let usedTokens = guaranteed.reduce((sum, s) => sum + s.tokens, 0);
    const selectedCandidates: ScoredMessage[] = [];

    for (const candidate of candidates) {
      if (usedTokens + candidate.tokens <= availableTokens) {
        selectedCandidates.push(candidate);
        usedTokens += candidate.tokens;
      }
    }

    // Re-sort selected candidates by timestamp (chronological order)
    selectedCandidates.sort(
      (a, b) => a.message.timestamp - b.message.timestamp
    );

    // Build summary from dropped messages if any were dropped
    const droppedCount = history.length - selectedCandidates.length - guaranteedCount;
    let summary: string | null = null;

    if (droppedCount > 0 && history.length > this.config.summaryThreshold) {
      summary = this.buildInlineSummary(
        candidates
          .filter((c) => !selectedCandidates.includes(c))
          .map((c) => c.message)
      );
    }

    // Combine: summary context + selected older messages + guaranteed recent
    const finalMessages = [
      ...selectedCandidates.map((s) => s.message),
      ...guaranteed.map((s) => s.message),
    ];

    return {
      messages: finalMessages,
      summary,
      totalTokens: usedTokens,
      droppedCount,
    };
  }

  /**
   * Score a message for importance.
   */
  private scoreMessage(
    msg: ConversationMessage,
    index: number,
    totalMessages: number,
  ): ScoredMessage {
    const tokens = this.estimateTokens(msg.content);
    let importance = 0.5; // base

    // Recency bonus: newest messages are more important
    const recencyScore = index / totalMessages;
    importance += recencyScore * 0.3;

    // Decay for very old messages
    const age = totalMessages - index;
    importance -= age * this.config.importanceDecayRate;

    // Pinned messages always max importance
    const pinned = this.pinnedMessageIds.has(msg.id);
    if (pinned) {
      importance = 1.0;
    }

    // Content-based importance boosters
    const content = msg.content;

    // Tool results are important (agent actually did something)
    if (TOOL_RESULT_PATTERN.test(content)) {
      importance += 0.2;
    }

    // Tool calls show intent
    if (TOOL_CALL_PATTERN.test(content)) {
      importance += 0.15;
    }

    // Cron suggestions are decisions
    if (CRON_PATTERN.test(content)) {
      importance += 0.2;
    }

    // High-importance keyword patterns
    for (const pattern of HIGH_IMPORTANCE_PATTERNS) {
      if (pattern.test(content)) {
        importance += 0.1;
        break; // Only one keyword bonus
      }
    }

    // Longer messages tend to be more substantive
    if (tokens > 200) importance += 0.1;
    if (tokens > 500) importance += 0.1;

    // Very short messages are likely less important
    if (tokens < 10) importance -= 0.15;

    // User messages with questions are important
    if (msg.role === 'user' && /\?/.test(content)) {
      importance += 0.05;
    }

    // Analysis type messages are high-value
    if (msg.type === 'analysis') {
      importance += 0.15;
    }

    // Clamp to [0, 1]
    importance = Math.max(0, Math.min(1, importance));

    return { message: msg, tokens, importance, pinned };
  }

  /**
   * Fast token estimation (~4 chars per token for mixed PL/EN text).
   * This is approximate — accurate enough for context window management.
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    // Polish text averages ~3.5 chars/token, English ~4, code ~3
    // Use 3.5 as a safe middle ground
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Build a compressed inline summary of dropped messages.
   * This is a fast heuristic (no AI call) — extracts key points.
   */
  private buildInlineSummary(messages: ConversationMessage[]): string {
    if (messages.length === 0) return '';

    const points: string[] = [];

    for (const msg of messages) {
      // Extract questions asked
      const questions = msg.content.match(/[^.!?\n]*\?/g);
      if (questions && msg.role === 'user') {
        points.push(`Pytanie: ${questions[0].trim().slice(0, 100)}`);
      }

      // Extract tool usage
      const toolMatch = msg.content.match(/Wynik narzędzia "([^"]+)":/);
      if (toolMatch) {
        points.push(`Użyto: ${toolMatch[1]}`);
      }

      // Extract decisions/instructions
      for (const pattern of HIGH_IMPORTANCE_PATTERNS) {
        const match = msg.content.match(pattern);
        if (match) {
          // Get the sentence containing the match
          const sentenceMatch = msg.content.match(
            new RegExp(`[^.!?\\n]*${match[0]}[^.!?\\n]*[.!?]?`)
          );
          if (sentenceMatch) {
            points.push(sentenceMatch[0].trim().slice(0, 150));
          }
          break;
        }
      }
    }

    // Deduplicate and limit
    const unique = [...new Set(points)].slice(0, 10);

    if (unique.length === 0) {
      return `[Wcześniejsza rozmowa: ${messages.length} wiadomości pominięto ze względu na limit kontekstu]`;
    }

    return `[Podsumowanie wcześniejszej rozmowy (${messages.length} wiadomości):\n${unique.map((p) => `• ${p}`).join('\n')}\n]`;
  }

  /**
   * Determine the optimal token limit for a given model.
   */
  static getModelContextLimit(model: string): number {
    // GPT-5 family
    if (/^gpt-5/.test(model)) return 128000;
    if (/^gpt-4o/.test(model)) return 128000;
    if (/^gpt-4-turbo/.test(model)) return 128000;
    if (/^gpt-4/.test(model)) return 8192;

    // O-series reasoning
    if (/^o[0-9]/.test(model)) return 200000;

    // Claude family
    if (/claude-opus-4/.test(model)) return 200000;
    if (/claude-sonnet-4/.test(model)) return 200000;
    if (/claude-3/.test(model)) return 200000;

    // Default conservative
    return 16000;
  }

  /**
   * Auto-configure context limits based on model.
   */
  configureForModel(model: string): void {
    const limit = ContextManager.getModelContextLimit(model);
    // Use 30% of model's context window for conversation history
    // (rest is for system prompt, RAG, tool results, response)
    this.config.maxContextTokens = Math.floor(limit * 0.3);
    this.config.reserveForResponse = Math.min(4096, Math.floor(limit * 0.05));
  }
}
