/**
 * OpenAIProvider — OpenAI-specific implementation of AIProvider.
 *
 * Handles all OpenAI SDK interactions: chat, streaming, vision, native function calling.
 * Supports GPT-5 family (developer role) and legacy models (system role).
 */

import type {
  AIProvider,
  AIProviderFeature,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  VisionImage,
  ToolCallResult,
  ToolResultEntry,
  ProviderCostEntry,
} from '../../../shared/types/ai-provider';
import type { ToolDefinition } from '../../../shared/types/tools';
import { toOpenAITools } from '../tool-schema-converter';
import { createLogger } from '../logger';

const log = createLogger('OpenAIProvider');

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly supportedFeatures = new Set<AIProviderFeature>([
    'function-calling',
    'vision',
    'streaming',
    'structured-output',
  ]);

  private client: any = null;
  private costLog: ProviderCostEntry[] = [];

  async initialize(apiKey: string): Promise<boolean> {
    try {
      const OpenAI = require('openai').default;
      this.client = new OpenAI({ apiKey });
      log.info('OpenAI client initialized');
      return true;
    } catch (error) {
      log.error('Failed to initialize OpenAI client:', error);
      return false;
    }
  }

  isReady(): boolean {
    return this.client !== null;
  }

  reset(): void {
    this.client = null;
  }

  // ─── Helpers ───

  /**
   * GPT-5 family and o-series use `developer` role instead of `system`.
   */
  private getSystemRole(model: string): 'developer' | 'system' {
    return /^(gpt-5|o[0-9])/.test(model) ? 'developer' : 'system';
  }

  /**
   * OpenAI uses `max_completion_tokens` (not `max_tokens`).
   */
  private tokenParam(limit: number): Record<string, number> {
    return { max_completion_tokens: limit };
  }

  private trackCost(model: string, promptTokens: number, completionTokens: number): void {
    // Approximate cost per 1K tokens (GPT-5 pricing — will need updates)
    const costs: Record<string, { input: number; output: number }> = {
      'gpt-5': { input: 0.01, output: 0.03 },
      'gpt-4.1': { input: 0.002, output: 0.008 },
      'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
      'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },
      o3: { input: 0.01, output: 0.04 },
      'o4-mini': { input: 0.0011, output: 0.0044 },
    };

    // Find the best match for the model name
    const modelKey = Object.keys(costs).find((k) => model.startsWith(k)) ?? 'gpt-5';
    const pricing = costs[modelKey];

    this.costLog.push({
      timestamp: Date.now(),
      model,
      promptTokens,
      completionTokens,
      estimatedCostUSD: (promptTokens / 1000) * pricing.input + (completionTokens / 1000) * pricing.output,
    });
  }

  // ─── Chat ───

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    if (!this.client) throw new Error('OpenAI client not initialized');

    const response = await this.client.chat.completions.create(
      {
        model: options.model,
        messages,
        ...this.tokenParam(options.maxTokens ?? 32768),
        temperature: options.temperature ?? 0.7,
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      },
      { signal: options.signal },
    );

    const usage = response.usage;
    if (usage) {
      this.trackCost(options.model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
    }

    return {
      text: response.choices[0]?.message?.content || '',
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  async streamChat(
    messages: ChatMessage[],
    options: ChatOptions,
    onChunk: (text: string) => void,
  ): Promise<ChatResponse> {
    if (!this.client) throw new Error('OpenAI client not initialized');

    const stream = await this.client.chat.completions.create(
      {
        model: options.model,
        messages,
        ...this.tokenParam(options.maxTokens ?? 32768),
        temperature: options.temperature ?? 0.7,
        stream: true,
      },
      { signal: options.signal },
    );

    let fullText = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullText += content;
        onChunk(content);
      }
    }

    return { text: fullText };
  }

  // ─── Vision ───

  async chatWithVision(
    systemPrompt: string,
    userMessage: string,
    images: VisionImage[],
    options: ChatOptions,
  ): Promise<ChatResponse> {
    if (!this.client) throw new Error('OpenAI client not initialized');

    const systemRole = this.getSystemRole(options.model);

    const imageContents = images.map((img) => ({
      type: 'image_url' as const,
      image_url: {
        url: img.base64Data.startsWith('data:')
          ? img.base64Data
          : `data:${img.mediaType || 'image/png'};base64,${img.base64Data}`,
        detail: img.detail ?? ('low' as const),
      },
    }));

    const response = await this.client.chat.completions.create(
      {
        model: options.model,
        messages: [
          { role: systemRole, content: systemPrompt },
          {
            role: 'user',
            content: [{ type: 'text', text: userMessage }, ...imageContents],
          },
        ],
        ...this.tokenParam(options.maxTokens ?? 16384),
        temperature: options.temperature ?? 0.3,
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      },
      { signal: options.signal },
    );

    const usage = response.usage;
    if (usage) {
      this.trackCost(options.model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
    }

    return {
      text: response.choices[0]?.message?.content || '',
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  // ─── Tool Calling ───

  async streamWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options: ChatOptions,
    onTextChunk?: (text: string) => void,
  ): Promise<ToolCallResult> {
    if (!this.client) throw new Error('OpenAI client not initialized');

    const openaiTools = toOpenAITools(tools);

    const stream = await this.client.chat.completions.create(
      {
        model: options.model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
        parallel_tool_calls: true,
        ...this.tokenParam(options.maxTokens ?? 32768),
        temperature: options.temperature ?? 0.7,
        stream: true,
      },
      { signal: options.signal },
    );

    let text = '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];

    // Accumulate tool call chunks — OpenAI streams them incrementally
    const accumulators: Map<number, { id: string; name: string; argsJson: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        onTextChunk?.(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!accumulators.has(idx)) {
            accumulators.set(idx, { id: '', name: '', argsJson: '' });
          }
          const acc = accumulators.get(idx)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.argsJson += tc.function.arguments;
        }
      }
    }

    // Parse accumulated tool calls
    for (const [, acc] of accumulators) {
      if (acc.id && acc.name) {
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(acc.argsJson || '{}');
        } catch {
          log.warn(`Failed to parse tool call arguments for ${acc.name}:`, acc.argsJson);
        }
        toolCalls.push({ id: acc.id, name: acc.name, arguments: args });
      }
    }

    // Build assistant message for continuation
    const updatedMessages = [...messages];
    if (toolCalls.length > 0) {
      updatedMessages.push({
        role: 'assistant',
        content: text || (null as any),
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else if (text) {
      updatedMessages.push({ role: 'assistant', content: text });
    }

    return { text, toolCalls, _messages: updatedMessages };
  }

  async continueWithToolResults(
    previousMessages: any[],
    toolResults: ToolResultEntry[],
    tools: ToolDefinition[],
    options: ChatOptions,
    onTextChunk?: (text: string) => void,
  ): Promise<ToolCallResult> {
    const messages = [...previousMessages];

    // OpenAI: each tool result is a separate message with role: 'tool'
    for (const tr of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: tr.callId,
        content: tr.result,
      });
    }

    return this.streamWithTools(messages, tools, options, onTextChunk);
  }

  // ─── Cost ───

  getCostLog(): ProviderCostEntry[] {
    return [...this.costLog];
  }

  resetCostLog(): void {
    this.costLog = [];
  }
}
