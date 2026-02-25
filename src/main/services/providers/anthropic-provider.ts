/**
 * AnthropicProvider — Anthropic-specific implementation of AIProvider.
 *
 * Handles all Anthropic SDK interactions: chat, streaming, vision, native tool use,
 * prompt caching, and Computer Use API (beta).
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
  ComputerUseConfig,
  ComputerUseStepResult,
  ProviderCostEntry,
} from '../../../shared/types/ai-provider';
import type { ToolDefinition } from '../../../shared/types/tools';
import { toAnthropicTools } from '../tool-schema-converter';
import { createLogger } from '../logger';

const log = createLogger('AnthropicProvider');

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly supportedFeatures = new Set<AIProviderFeature>([
    'function-calling',
    'vision',
    'streaming',
    'computer-use',
    'prompt-caching',
  ]);

  private client: any = null;
  private costLog: ProviderCostEntry[] = [];

  async initialize(apiKey: string): Promise<boolean> {
    try {
      const Anthropic = require('@anthropic-ai/sdk').default;
      this.client = new Anthropic({ apiKey });
      log.info('Anthropic client initialized');
      return true;
    } catch (error) {
      log.error('Failed to initialize Anthropic client:', error);
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
   * Extract system messages from the conversation and return them as a single system string.
   * Anthropic expects system as a separate parameter, not in messages array.
   */
  private extractSystem(messages: ChatMessage[]): {
    systemContent: string;
    conversationMessages: Array<{ role: 'user' | 'assistant'; content: any }>;
  } {
    const systemParts: string[] = [];
    const conversationMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        systemParts.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        conversationMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
      // 'tool' role messages are handled via tool_result blocks in Anthropic
    }

    return {
      systemContent: systemParts.join('\n\n'),
      conversationMessages,
    };
  }

  /**
   * Build system param with optional prompt caching.
   * Caches system prompt if >3500 chars (~1024 tokens) for 90% cheaper reprocessing.
   */
  private buildSystemParam(systemContent: string): any {
    if (systemContent.length > 3500) {
      return [{ type: 'text', text: systemContent, cache_control: { type: 'ephemeral' as const } }];
    }
    return systemContent;
  }

  /**
   * Convert base64 image data for Anthropic format.
   * Extracts raw base64 from data URLs and validates media type.
   */
  private convertImage(
    base64Data: string,
    mediaType?: string,
  ): {
    type: 'image';
    source: { type: 'base64'; media_type: string; data: string };
  } {
    const validMediaTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
    type AnthropicMediaType = (typeof validMediaTypes)[number];

    const rawType = mediaType || 'image/png';
    const resolvedMediaType: AnthropicMediaType = (validMediaTypes as readonly string[]).includes(rawType)
      ? (rawType as AnthropicMediaType)
      : 'image/png';

    // Extract raw base64 from data URL
    let data: string;
    const base64Match = base64Data.match(/^data:image\/(.*?);base64,(.*)$/);
    if (base64Match) {
      data = base64Match[2];
    } else if (base64Data.startsWith('data:')) {
      const commaIdx = base64Data.indexOf(',');
      data = commaIdx >= 0 ? base64Data.slice(commaIdx + 1) : base64Data;
    } else {
      data = base64Data;
    }

    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: resolvedMediaType,
        data,
      },
    };
  }

  private trackCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
    cacheCreation?: number,
    cacheRead?: number,
  ): void {
    // Approximate Anthropic pricing per 1K tokens
    const costs: Record<string, { input: number; output: number }> = {
      'claude-sonnet-4': { input: 0.003, output: 0.015 },
      'claude-opus-4': { input: 0.015, output: 0.075 },
      'claude-haiku-3.5': { input: 0.0008, output: 0.004 },
      'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
    };

    const modelKey = Object.keys(costs).find((k) => model.startsWith(k)) ?? 'claude-sonnet-4';
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
    if (!this.client) throw new Error('Anthropic client not initialized');

    const { systemContent, conversationMessages } = this.extractSystem(messages);
    const systemParam = this.buildSystemParam(systemContent);

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: systemParam,
      messages: conversationMessages,
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const usage = response.usage;

    if (usage) {
      this.trackCost(
        options.model,
        usage.input_tokens ?? 0,
        usage.output_tokens ?? 0,
        usage.cache_creation_input_tokens,
        usage.cache_read_input_tokens,
      );
    }

    return {
      text,
      usage: usage
        ? {
            promptTokens: usage.input_tokens ?? 0,
            completionTokens: usage.output_tokens ?? 0,
            totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
            cacheCreationTokens: usage.cache_creation_input_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
          }
        : undefined,
    };
  }

  async streamChat(
    messages: ChatMessage[],
    options: ChatOptions,
    onChunk: (text: string) => void,
  ): Promise<ChatResponse> {
    if (!this.client) throw new Error('Anthropic client not initialized');

    const { systemContent, conversationMessages } = this.extractSystem(messages);
    const systemParam = this.buildSystemParam(systemContent);

    const stream = this.client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: systemParam,
      messages: conversationMessages,
    });

    let fullText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const text = event.delta.text || '';
        fullText += text;
        onChunk(text);
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
    if (!this.client) throw new Error('Anthropic client not initialized');

    const imageContents = images.map((img) => this.convertImage(img.base64Data, img.mediaType));

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 1024,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: userMessage }, ...imageContents],
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const usage = response.usage;

    if (usage) {
      this.trackCost(options.model, usage.input_tokens ?? 0, usage.output_tokens ?? 0);
    }

    return {
      text,
      usage: usage
        ? {
            promptTokens: usage.input_tokens ?? 0,
            completionTokens: usage.output_tokens ?? 0,
            totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
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
    if (!this.client) throw new Error('Anthropic client not initialized');

    const anthropicTools = toAnthropicTools(tools);
    const { systemContent, conversationMessages } = this.extractSystem(messages);
    const systemParam = this.buildSystemParam(systemContent);

    const stream = this.client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      system: systemParam,
      messages: conversationMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    let text = '';
    const toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'tool_use') {
          currentToolUse = { id: block.id, name: block.name, inputJson: '' };
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') {
          const t = event.delta.text || '';
          text += t;
          onTextChunk?.(t);
        } else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
          currentToolUse.inputJson += event.delta.partial_json || '';
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(currentToolUse.inputJson || '{}');
          } catch {
            log.warn(`Failed to parse Anthropic tool input for ${currentToolUse.name}:`, currentToolUse.inputJson);
          }
          toolCalls.push({ id: currentToolUse.id, name: currentToolUse.name, arguments: args });
          currentToolUse = null;
        }
      }
    }

    // Build assistant message for continuation
    const updatedMessages = [...messages];
    const assistantContent: any[] = [];
    if (text) {
      assistantContent.push({ type: 'text', text });
    }
    for (const tc of toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.arguments,
      });
    }
    if (assistantContent.length > 0) {
      updatedMessages.push({ role: 'assistant', content: assistantContent });
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

    // Anthropic: tool results go in a single user message with tool_result content blocks
    const resultBlocks = toolResults.map((tr) => ({
      type: 'tool_result',
      tool_use_id: tr.callId,
      content: tr.result,
      is_error: tr.isError || false,
    }));
    messages.push({ role: 'user', content: resultBlocks });

    return this.streamWithTools(messages, tools, options, onTextChunk);
  }

  // ─── Computer Use ───

  async computerUseStep(
    systemPrompt: string,
    messages: any[],
    config: ComputerUseConfig,
    model: string,
  ): Promise<ComputerUseStepResult[]> {
    if (!this.client) throw new Error('Anthropic client not initialized');

    const toolVersion = 'computer_20250124';
    const betaFlag = 'computer-use-2025-01-24';

    const response = await this.client.beta.messages.create({
      model,
      max_tokens: 1024,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          type: toolVersion,
          name: 'computer',
          display_width_px: config.displayWidth,
          display_height_px: config.displayHeight,
        },
      ],
      messages,
      betas: [betaFlag, 'prompt-caching-2024-07-31'],
    });

    const steps: ComputerUseStepResult[] = [];

    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'computer') {
        steps.push({
          type: 'action',
          action: block.input as any,
          toolUseId: block.id,
        });
      } else if (block.type === 'text') {
        const text = block.text?.trim();
        if (text) {
          steps.push({ type: 'text', text });
        }
      }
    }

    if (response.stop_reason !== 'tool_use') {
      steps.push({ type: 'done' });
    }

    return steps;
  }

  // ─── Cost ───

  getCostLog(): ProviderCostEntry[] {
    return [...this.costLog];
  }

  resetCostLog(): void {
    this.costLog = [];
  }
}
