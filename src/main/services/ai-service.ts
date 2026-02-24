import { ConfigService } from './config';
import { SecurityService } from './security';
import { MemoryService } from './memory';
import { ScreenshotData } from './screen-capture';
import { ContextManager } from './context-manager';
import { RetryHandler, createAIRetryHandler } from './retry-handler';
import { PromptService } from './prompt-service';
import {
  toOpenAITools,
  toAnthropicTools,
  type NativeToolCall,
  type NativeToolStreamResult,
} from './tool-schema-converter';
import type { ToolDefinition } from '../../shared/types/tools';
import { v4 as uuidv4 } from 'uuid';

export type { NativeToolCall, NativeToolStreamResult } from './tool-schema-converter';

interface AIMessage {
  role: 'system' | 'developer' | 'user' | 'assistant';
  content: string | AIContentPart[];
}

interface AIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

interface ScreenAnalysisResult {
  hasInsight: boolean;
  message: string;
  context: string;
}

/**
 * Anthropic Computer Use tool_use action types.
 */
export interface ComputerUseAction {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  text?: string;
  scroll_direction?: 'up' | 'down' | 'left' | 'right';
  scroll_amount?: number;
  duration?: number;
  key?: string;
}

/**
 * Result of one Computer Use API step.
 */
export interface ComputerUseStep {
  type: 'action' | 'text' | 'done';
  action?: ComputerUseAction;
  toolUseId?: string;
  text?: string;
}

/**
 * Messages for the Computer Use conversation loop.
 */
export interface ComputerUseMessage {
  role: 'user' | 'assistant';
  content: any[];
}

export class AIService {
  private config: ConfigService;
  private security: SecurityService;
  private memoryService?: MemoryService;
  private openaiClient: any = null;
  private anthropicClient: any = null;
  private contextManager: ContextManager;
  private retryHandler: RetryHandler;
  private promptService: PromptService;

  constructor(config: ConfigService, security: SecurityService, memoryService?: MemoryService) {
    this.config = config;
    this.security = security;
    this.memoryService = memoryService;
    this.contextManager = new ContextManager();
    this.retryHandler = createAIRetryHandler();
    this.promptService = new PromptService();

    // Auto-configure context window for the current model
    const model = this.config.get('aiModel') || 'gpt-5';
    this.contextManager.configureForModel(model);
  }

  setMemoryService(memoryService: MemoryService): void {
    this.memoryService = memoryService;
  }

  async reinitialize(): Promise<void> {
    this.openaiClient = null;
    this.anthropicClient = null;
    await this.initializeClient();
    // Reconfigure context window for potentially new model
    const model = this.config.get('aiModel') || 'gpt-5';
    this.contextManager.configureForModel(model);
  }

  private async initializeClient(): Promise<void> {
    const provider = this.config.get('aiProvider') || 'openai';

    if (provider === 'openai') {
      const apiKey = await this.security.getApiKey('openai');
      if (apiKey) {
        const OpenAI = require('openai').default;
        this.openaiClient = new OpenAI({ apiKey });
      }
    } else if (provider === 'anthropic') {
      const apiKey = await this.security.getApiKey('anthropic');
      if (apiKey) {
        const Anthropic = require('@anthropic-ai/sdk').default;
        this.anthropicClient = new Anthropic({ apiKey });
      }
    }
  }

  private async ensureClient(): Promise<void> {
    const provider = this.config.get('aiProvider') || 'openai';
    if (provider === 'openai' && !this.openaiClient) {
      await this.initializeClient();
    }
    if (provider === 'anthropic' && !this.anthropicClient) {
      await this.initializeClient();
    }
  }

  /**
   * Determines if the model uses `developer` role instead of `system`.
   * GPT-5 family and o-series reasoning models use the `developer` role.
   */
  private usesDeveloperRole(model: string): boolean {
    return /^(gpt-5|o[0-9])/.test(model);
  }

  /**
   * Returns the correct system role name for the given model.
   */
  private getSystemRole(model: string): 'developer' | 'system' {
    return this.usesDeveloperRole(model) ? 'developer' : 'system';
  }

  /**
   * Builds the token limit parameter for OpenAI.
   * `max_tokens` is deprecated in favor of `max_completion_tokens`.
   * o-series models are NOT compatible with `max_tokens`.
   */
  private openaiTokenParam(limit: number): Record<string, number> {
    return { max_completion_tokens: limit };
  }

  /**
   * Send a message with a screenshot for vision analysis (non-streaming).
   * Used by take-control mode for real-time screen awareness.
   * @param detail - OpenAI image detail level: 'low' (faster/cheaper), 'high' (better coords), 'auto'
   */
  async sendMessageWithVision(
    userMessage: string,
    screenshotBase64: string,
    systemContextOverride?: string,
    detail: 'low' | 'high' | 'auto' = 'auto'
  ): Promise<string> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';
    const systemRole = this.getSystemRole(model);
    const systemContext = systemContextOverride
      ?? (this.memoryService
        ? await this.memoryService.buildSystemContext()
        : 'You are KxAI, a helpful personal AI assistant.');

    if (provider === 'openai' && this.openaiClient) {
      const response = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          { role: systemRole, content: systemContext },
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
              { type: 'image_url', image_url: { url: screenshotBase64, detail } },
            ],
          },
        ],
        ...this.openaiTokenParam(2048),
        temperature: 0.5,
      });
      return response.choices[0]?.message?.content || '';
    } else if (provider === 'anthropic' && this.anthropicClient) {
      // Extract base64 data from data URL
      let mediaType = 'png';
      let data: string;
      const base64Match = screenshotBase64.match(/^data:image\/(.*?);base64,(.*)$/);
      if (base64Match) {
        mediaType = base64Match[1];
        data = base64Match[2];
      } else if (screenshotBase64.startsWith('data:')) {
        // Non-standard data URL — strip prefix up to first comma
        const commaIdx = screenshotBase64.indexOf(',');
        data = commaIdx >= 0 ? screenshotBase64.slice(commaIdx + 1) : screenshotBase64;
      } else {
        // Raw base64 string
        data = screenshotBase64;
      }

      // Validate base64 payload
      try {
        const buf = Buffer.from(data, 'base64');
        if (buf.length === 0) throw new Error('Empty base64 payload');
      } catch (e) {
        throw new Error(`Invalid screenshot base64 data: ${e instanceof Error ? e.message : e}`);
      }

      const response = await this.anthropicClient.messages.create({
        model,
        max_tokens: 2048,
        system: systemContext,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: userMessage },
            { type: 'image', source: { type: 'base64', media_type: `image/${mediaType}`, data } },
          ],
        }],
      });
      return response.content[0]?.type === 'text' ? response.content[0].text : '';
    }
    throw new Error('No AI client configured');
  }

  async sendMessage(
    userMessage: string,
    extraContext?: string,
    systemContextOverride?: string,
    options?: { skipHistory?: boolean }
  ): Promise<string> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';
    const skipHistory = options?.skipHistory ?? false;

    // Build system context from memory (or use override from agent-loop)
    const systemContext = systemContextOverride
      ?? (this.memoryService
        ? await this.memoryService.buildSystemContext()
        : 'You are KxAI, a helpful personal AI assistant.');

    // Build optimized conversation history via ContextManager
    const fullHistory = this.memoryService
      ? this.memoryService.getRecentContext(100)
      : [];
    const systemTokens = this.contextManager.estimateTokens(systemContext);
    const contextWindow = this.contextManager.buildContextWindow(fullHistory, systemTokens);

    const systemRole = this.getSystemRole(model);
    const messages: AIMessage[] = [
      { role: systemRole, content: systemContext },
    ];

    // Inject context summary if messages were dropped
    if (contextWindow.summary) {
      messages.push({ role: systemRole, content: contextWindow.summary });
    }

    // Add optimized conversation history
    for (const msg of contextWindow.messages) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    // Add current message with optional context
    const fullMessage = extraContext
      ? `${userMessage}\n\n--- Kontekst ---\n${extraContext}`
      : userMessage;

    messages.push({ role: 'user', content: fullMessage });

    // Store message in history (skip for internal heartbeat/background calls)
    if (this.memoryService && !skipHistory) {
      this.memoryService.addMessage({
        id: uuidv4(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        type: 'chat',
      });
    }

    let responseText = '';

    if (provider === 'openai' && this.openaiClient) {
      responseText = await this.retryHandler.execute('openai-chat', async () => {
        const response = await this.openaiClient.chat.completions.create({
          model,
          messages,
          ...this.openaiTokenParam(4096),
          temperature: 0.7,
        });
        return response.choices[0]?.message?.content || '';
      });
    } else if (provider === 'anthropic' && this.anthropicClient) {
      const anthropicMessages = messages
        .filter((m) => m.role !== 'system' && m.role !== 'developer')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      responseText = await this.retryHandler.execute('anthropic-chat', async () => {
        const response = await this.anthropicClient.messages.create({
          model,
          max_tokens: 4096,
          system: systemContext,
          messages: anthropicMessages,
        });
        return response.content[0]?.type === 'text' ? response.content[0].text : '';
      });
    } else {
      throw new Error(
        'Brak skonfigurowanego klucza API. Przejdź do Ustawień i dodaj klucz API.'
      );
    }

    // Store response in history (skip for internal heartbeat/background calls)
    if (this.memoryService && !skipHistory) {
      this.memoryService.addMessage({
        id: uuidv4(),
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        type: 'chat',
      });
    }

    return responseText;
  }

  /**
   * Send a message with image attachments (vision).
   * Supports both OpenAI and Anthropic image formats.
   * Used for screen-based speaker identification, etc.
   */
  async sendVisionMessage(
    userMessage: string,
    images: Array<{ base64Data: string; mediaType?: string }>,
    systemPrompt?: string,
  ): Promise<string> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';

    const system = systemPrompt || 'You are KxAI, a helpful AI assistant with vision capabilities.';

    if (provider === 'openai' && this.openaiClient) {
      const content: any[] = [
        { type: 'text', text: userMessage },
        ...images.map(img => ({
          type: 'image_url',
          image_url: {
            url: img.base64Data.startsWith('data:')
              ? img.base64Data
              : `data:${img.mediaType || 'image/png'};base64,${img.base64Data}`,
            detail: 'low' as const,
          },
        })),
      ];

      const systemRole = this.getSystemRole(model);
      const response = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          { role: systemRole, content: system },
          { role: 'user', content },
        ],
        ...this.openaiTokenParam(1024),
        temperature: 0.3,
      });
      return response.choices[0]?.message?.content || '';

    } else if (provider === 'anthropic' && this.anthropicClient) {
      const content: any[] = [
        { type: 'text', text: userMessage },
        ...images.map(img => {
          const validMediaTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
          type AnthropicMediaType = typeof validMediaTypes[number];
          const rawType = img.mediaType || 'image/png';
          const mediaType: AnthropicMediaType = validMediaTypes.includes(rawType as AnthropicMediaType)
            ? (rawType as AnthropicMediaType)
            : 'image/png';
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: mediaType,
              data: img.base64Data.replace(/^data:image\/\w+;base64,/, ''),
            },
          };
        }),
      ];

      const response = await this.anthropicClient.messages.create({
        model,
        max_tokens: 1024,
        system,
        messages: [{ role: 'user', content }],
      });
      return response.content[0]?.type === 'text' ? response.content[0].text : '';

    } else {
      throw new Error('Brak klucza API dla vision.');
    }
  }

  async streamMessage(
    userMessage: string,
    extraContext?: string,
    onChunk?: (chunk: string) => void,
    systemContextOverride?: string,
    options?: { skipHistory?: boolean }
  ): Promise<void> {
    const skipHistory = options?.skipHistory ?? false;
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';

    const systemContext = systemContextOverride
      ?? (this.memoryService
        ? await this.memoryService.buildSystemContext()
        : 'You are KxAI, a helpful personal AI assistant.');

    // Build optimized history via ContextManager
    const fullHistory = this.memoryService
      ? this.memoryService.getRecentContext(100)
      : [];
    const systemTokens = this.contextManager.estimateTokens(systemContext);
    const contextWindow = this.contextManager.buildContextWindow(fullHistory, systemTokens);

    const systemRole = this.getSystemRole(model);
    const messages: AIMessage[] = [{ role: systemRole, content: systemContext }];

    if (contextWindow.summary) {
      messages.push({ role: systemRole, content: contextWindow.summary });
    }

    for (const msg of contextWindow.messages) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    const fullMessage = extraContext
      ? `${userMessage}\n\n--- Kontekst ---\n${extraContext}`
      : userMessage;

    messages.push({ role: 'user', content: fullMessage });

    if (this.memoryService && !skipHistory) {
      this.memoryService.addMessage({
        id: uuidv4(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        type: 'chat',
      });
    }

    let fullResponse = '';

    if (provider === 'openai' && this.openaiClient) {
      const stream = await this.openaiClient.chat.completions.create({
        model,
        messages,
        ...this.openaiTokenParam(4096),
        temperature: 0.7,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          onChunk?.(content);
        }
      }
    } else if (provider === 'anthropic' && this.anthropicClient) {
      const anthropicMessages = messages
        .filter((m) => m.role !== 'system' && m.role !== 'developer')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const stream = this.anthropicClient.messages.stream({
        model,
        max_tokens: 4096,
        system: systemContext,
        messages: anthropicMessages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text || '';
          fullResponse += text;
          onChunk?.(text);
        }
      }
    } else {
      throw new Error(`Klient AI nie jest zainicjalizowany (provider: ${provider}). Sprawdź klucz API w ustawieniach.`);
    }

    if (this.memoryService && fullResponse && !skipHistory) {
      this.memoryService.addMessage({
        id: uuidv4(),
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
        type: 'chat',
      });
    }
  }

  // ─── Native Function Calling ───

  /**
   * Stream a message with native tool calling support (OpenAI function calling / Anthropic tool_use).
   *
   * Instead of the legacy ```tool code block approach, this passes tool definitions
   * directly to the API and receives structured tool_calls in the response.
   *
   * Returns text content, any tool calls, and an internal messages array for continuation.
   * If toolCalls is non-empty, execute the tools and call continueWithToolResults().
   */
  async streamMessageWithNativeTools(
    userMessage: string,
    tools: ToolDefinition[],
    extraContext?: string,
    onTextChunk?: (chunk: string) => void,
    systemContextOverride?: string,
  ): Promise<NativeToolStreamResult> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';

    const systemContext = systemContextOverride
      ?? (this.memoryService
        ? await this.memoryService.buildSystemContext()
        : 'You are KxAI, a helpful personal AI assistant.');

    // Build optimized history via ContextManager
    const fullHistory = this.memoryService
      ? this.memoryService.getRecentContext(100)
      : [];
    const systemTokens = this.contextManager.estimateTokens(systemContext);
    const contextWindow = this.contextManager.buildContextWindow(fullHistory, systemTokens);

    const systemRole = this.getSystemRole(model);
    const messages: any[] = [{ role: systemRole, content: systemContext }];

    if (contextWindow.summary) {
      messages.push({ role: systemRole, content: contextWindow.summary });
    }

    for (const msg of contextWindow.messages) {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    const fullMessage = extraContext
      ? `${userMessage}\n\n--- Kontekst ---\n${extraContext}`
      : userMessage;

    messages.push({ role: 'user', content: fullMessage });

    return this._callWithNativeTools(messages, tools, provider, model, onTextChunk);
  }

  /**
   * Continue a native tool calling conversation after executing tool calls.
   *
   * Takes the _messages from the previous NativeToolStreamResult,
   * appends the tool results, and calls the API again.
   *
   * @param previousMessages - The _messages array from the previous result
   * @param toolResults - Results from executing the tool calls
   * @param tools - Same tool definitions (for the next turn)
   * @param onTextChunk - Callback for streaming text chunks
   */
  async continueWithToolResults(
    previousMessages: any[],
    toolResults: Array<{ callId: string; name: string; result: string; isError?: boolean }>,
    tools: ToolDefinition[],
    onTextChunk?: (chunk: string) => void,
  ): Promise<NativeToolStreamResult> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';

    const messages = [...previousMessages];

    if (provider === 'openai') {
      // OpenAI: each tool result is a separate message with role: 'tool'
      for (const tr of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: tr.callId,
          content: tr.result,
        });
      }
    } else if (provider === 'anthropic') {
      // Anthropic: tool results go in a single user message with tool_result content blocks
      const resultBlocks = toolResults.map((tr) => ({
        type: 'tool_result',
        tool_use_id: tr.callId,
        content: tr.result,
        is_error: tr.isError || false,
      }));
      messages.push({ role: 'user', content: resultBlocks });
    }

    return this._callWithNativeTools(messages, tools, provider, model, onTextChunk);
  }

  /**
   * Internal: call the AI API with native tool definitions and parse the response.
   * Works for both initial calls and continuations.
   */
  private async _callWithNativeTools(
    messages: any[],
    tools: ToolDefinition[],
    provider: string,
    model: string,
    onTextChunk?: (chunk: string) => void,
  ): Promise<NativeToolStreamResult> {
    let text = '';
    const toolCalls: NativeToolCall[] = [];

    if (provider === 'openai' && this.openaiClient) {
      const openaiTools = toOpenAITools(tools);

      const stream = await this.openaiClient.chat.completions.create({
        model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
        parallel_tool_calls: true,
        ...this.openaiTokenParam(4096),
        temperature: 0.7,
        stream: true,
      });

      // Accumulate tool call chunks — OpenAI streams them incrementally
      const toolCallAccumulators: Map<number, { id: string; name: string; argsJson: string }> = new Map();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // Text content
        if (delta.content) {
          text += delta.content;
          onTextChunk?.(delta.content);
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, { id: '', name: '', argsJson: '' });
            }
            const acc = toolCallAccumulators.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.argsJson += tc.function.arguments;
          }
        }
      }

      // Parse accumulated tool calls
      for (const [, acc] of toolCallAccumulators) {
        if (acc.id && acc.name) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(acc.argsJson || '{}');
          } catch {
            console.warn(`[AIService] Failed to parse tool call arguments for ${acc.name}:`, acc.argsJson);
          }
          toolCalls.push({ id: acc.id, name: acc.name, arguments: args });
        }
      }

      // Build the assistant message to append to messages for continuation
      if (toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: text || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else if (text) {
        messages.push({ role: 'assistant', content: text });
      }

    } else if (provider === 'anthropic' && this.anthropicClient) {
      const anthropicTools = toAnthropicTools(tools);

      // Filter out system messages for Anthropic (system goes as separate param)
      const systemContent = messages
        .filter((m: any) => m.role === 'system' || m.role === 'developer')
        .map((m: any) => m.content)
        .join('\n\n');
      const anthropicMessages = messages
        .filter((m: any) => m.role !== 'system' && m.role !== 'developer')
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const stream = this.anthropicClient.messages.stream({
        model,
        max_tokens: 4096,
        system: systemContent,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      });

      // Anthropic streams content blocks — text blocks and tool_use blocks
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
              console.warn(`[AIService] Failed to parse Anthropic tool input for ${currentToolUse.name}:`, currentToolUse.inputJson);
            }
            toolCalls.push({ id: currentToolUse.id, name: currentToolUse.name, arguments: args });
            currentToolUse = null;
          }
        }
      }

      // Build assistant message for continuation
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
        messages.push({ role: 'assistant', content: assistantContent });
      }

    } else {
      throw new Error(`Klient AI nie jest zainicjalizowany (provider: ${provider}). Sprawdź klucz API w ustawieniach.`);
    }

    return { text, toolCalls, _messages: messages };
  }

  async streamMessageWithScreenshots(
    userMessage: string,
    screenshots: ScreenshotData[],
    onChunk?: (chunk: string) => void
  ): Promise<void> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';

    const systemContext = this.memoryService
      ? await this.memoryService.buildSystemContext()
      : 'You are KxAI, a helpful personal AI assistant.';

    // Store user message
    if (this.memoryService) {
      this.memoryService.addMessage({
        id: uuidv4(),
        role: 'user',
        content: `📸 ${userMessage}`,
        timestamp: Date.now(),
        type: 'analysis',
      });
    }

    let fullResponse = '';
    const systemRole = this.getSystemRole(model);

    if (provider === 'openai' && this.openaiClient) {
      const imageContents: AIContentPart[] = screenshots.map((s) => ({
        type: 'image_url' as const,
        image_url: { url: s.base64, detail: 'low' as const },
      }));

      const stream = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          { role: systemRole, content: systemContext },
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
              ...imageContents,
            ],
          },
        ],
        ...this.openaiTokenParam(4096),
        temperature: 0.7,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          fullResponse += content;
          onChunk?.(content);
        }
      }
    } else if (provider === 'anthropic' && this.anthropicClient) {
      const imageContents = screenshots.map((s) => {
        const base64Data = s.base64.replace(/^data:image\/\w+;base64,/, '');
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: 'image/png' as const,
            data: base64Data,
          },
        };
      });

      const stream = this.anthropicClient.messages.stream({
        model,
        max_tokens: 4096,
        system: systemContext,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
              ...imageContents,
            ],
          },
        ],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text || '';
          fullResponse += text;
          onChunk?.(text);
        }
      }
    } else {
      throw new Error(`Klient AI nie jest zainicjalizowany (provider: ${provider}). Sprawdź klucz API w ustawieniach.`);
    }

    if (this.memoryService && fullResponse) {
      this.memoryService.addMessage({
        id: uuidv4(),
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
        type: 'analysis',
      });
    }
  }

  async analyzeScreens(screenshots: ScreenshotData[]): Promise<ScreenAnalysisResult | null> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';

    if (!this.config.get('proactiveMode')) return null;

    const systemContext = this.memoryService
      ? await this.memoryService.buildSystemContext()
      : '';

    const analysisPrompt = `${this.promptService.load('SCREEN_ANALYSIS.md')}\n\n${systemContext}`;

    try {
      if (provider === 'openai' && this.openaiClient) {
        const imageContents: AIContentPart[] = screenshots.map((s) => ({
          type: 'image_url' as const,
          image_url: { url: s.base64, detail: 'low' as const },
        }));

        const systemRole = this.getSystemRole(model);
        const response = await this.openaiClient.chat.completions.create({
          model,
          messages: [
            { role: systemRole, content: analysisPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Przeanalizuj bieżące zrzuty ekranu:' },
                ...imageContents,
              ],
            },
          ],
          ...this.openaiTokenParam(1024),
          temperature: 0.5,
          response_format: { type: 'json_object' },
        });

        const text = response.choices[0]?.message?.content || '{}';
        const result = JSON.parse(text);
        return result as ScreenAnalysisResult;
      } else if (provider === 'anthropic' && this.anthropicClient) {
        const imageContents = screenshots.map((s) => {
          // Extract base64 data from data URL
          const base64Data = s.base64.replace(/^data:image\/\w+;base64,/, '');
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/png' as const,
              data: base64Data,
            },
          };
        });

        const response = await this.anthropicClient.messages.create({
          model,
          max_tokens: 1024,
          system: analysisPrompt,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Przeanalizuj bieżące zrzuty ekranu:' },
                ...imageContents,
              ],
            },
          ],
        });

        const text =
          response.content[0]?.type === 'text' ? response.content[0].text : '{}';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const result = JSON.parse(jsonMatch?.[0] || '{}');
        return result as ScreenAnalysisResult;
      }
    } catch (error) {
      console.error('Screen analysis failed:', error);
    }

    return null;
  }

  async organizeFiles(
    directory: string,
    rules?: any
  ): Promise<{ moved: string[]; summary: string }> {
    // Basic file organization (can be enhanced)
    const fs = require('fs');
    const p = require('path');
    const moved: string[] = [];

    try {
      const items = fs.readdirSync(directory, { withFileTypes: true });
      const extensionMap: Record<string, string> = {
        // Documents
        '.pdf': 'Dokumenty',
        '.doc': 'Dokumenty',
        '.docx': 'Dokumenty',
        '.txt': 'Dokumenty',
        '.xlsx': 'Dokumenty',
        '.csv': 'Dokumenty',
        // Images
        '.png': 'Obrazy',
        '.jpg': 'Obrazy',
        '.jpeg': 'Obrazy',
        '.gif': 'Obrazy',
        '.svg': 'Obrazy',
        '.webp': 'Obrazy',
        // Code
        '.ts': 'Kod',
        '.js': 'Kod',
        '.py': 'Kod',
        '.html': 'Kod',
        '.css': 'Kod',
        '.json': 'Kod',
        // Archives
        '.zip': 'Archiwa',
        '.rar': 'Archiwa',
        '.7z': 'Archiwa',
        '.tar': 'Archiwa',
        // Videos
        '.mp4': 'Wideo',
        '.mkv': 'Wideo',
        '.avi': 'Wideo',
      };

      for (const item of items) {
        if (item.isFile()) {
          const ext = p.extname(item.name).toLowerCase();
          const folder = extensionMap[ext];
          if (folder) {
            const destDir = p.join(directory, folder);
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(destDir, { recursive: true });
            }
            const src = p.join(directory, item.name);
            const dest = p.join(destDir, item.name);
            fs.renameSync(src, dest);
            moved.push(`${item.name} → ${folder}/`);
          }
        }
      }
    } catch (error: any) {
      return { moved, summary: `Błąd: ${error.message}` };
    }

    return {
      moved,
      summary: moved.length > 0
        ? `Uporządkowano ${moved.length} plików.`
        : 'Brak plików do uporządkowania.',
    };
  }

  // ─── Native Computer Use API (Anthropic) ───

  /**
   * Check if the current provider supports native Computer Use API.
   * Anthropic models with computer_20250124 tool type.
   */
  supportsNativeComputerUse(): boolean {
    const provider = this.config.get('aiProvider') || 'openai';
    return provider === 'anthropic';
  }

  /**
   * Get the Computer Use tool version.
   * All Claude 4 models use computer_20250124.
   */
  private getComputerUseToolVersion(): string {
    return 'computer_20250124';
  }

  /**
   * Get the beta flag for the Computer Use API version.
   */
  private getComputerUseBetaFlag(): string {
    return 'computer-use-2025-01-24';
  }

  /**
   * Send a Computer Use API request and parse the response into structured steps.
   * Uses Anthropic's native beta.messages API with computer tool.
   * 
   * @param systemPrompt - System context for the agent
   * @param messages - Conversation history (user/assistant turns)
   * @param displayWidth - Screenshot width in pixels (should be ≤1024)
   * @param displayHeight - Screenshot height in pixels (should be ≤768)
   * @returns Array of steps (actions to execute or text responses)
   */
  async computerUseStep(
    systemPrompt: string,
    messages: ComputerUseMessage[],
    displayWidth: number,
    displayHeight: number
  ): Promise<ComputerUseStep[]> {
    await this.ensureClient();
    if (!this.anthropicClient) {
      throw new Error('Computer Use wymaga Anthropic API. Ustaw provider na "anthropic".');
    }

    const model = this.config.get('aiModel') || 'claude-sonnet-4-20250514';
    const toolVersion = this.getComputerUseToolVersion();
    const betaFlag = this.getComputerUseBetaFlag();

    const response = await this.anthropicClient.beta.messages.create({
      model,
      max_tokens: 1024,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [
        {
          type: toolVersion,
          name: 'computer',
          display_width_px: displayWidth,
          display_height_px: displayHeight,
        },
      ],
      messages,
      betas: [betaFlag, 'prompt-caching-2024-07-31'],
    });

    const steps: ComputerUseStep[] = [];

    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'computer') {
        steps.push({
          type: 'action',
          action: block.input as ComputerUseAction,
          toolUseId: block.id,
        });
      } else if (block.type === 'text') {
        const text = block.text?.trim();
        if (text) {
          steps.push({ type: 'text', text });
        }
      }
    }

    // If no tool_use blocks, the model is done
    if (response.stop_reason !== 'tool_use') {
      steps.push({ type: 'done' });
    }

    return steps;
  }

  /**
   * Build a tool_result message to send back after executing a Computer Use action.
   * Includes screenshot as base64 image.
   */
  buildComputerUseToolResult(toolUseId: string, screenshotBase64: string, error?: string): any {
    const content: any[] = [];

    if (error) {
      content.push({ type: 'text', text: error });
    }

    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: screenshotBase64,
      },
    });

    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content,
      is_error: !!error,
    };
  }

  /**
   * Limit the number of images in Computer Use conversation history.
   * Keeps only the N most recent images to control costs.
   * Replaces older images with [Screenshot removed] placeholder.
   */
  pruneComputerUseImages(messages: ComputerUseMessage[], keepImages: number = 3): void {
    // Collect all image locations (newest first)
    const imageLocations: Array<{ msgIdx: number; contentIdx: number }> = [];

    for (let m = messages.length - 1; m >= 0; m--) {
      const msg = messages[m];
      if (!Array.isArray(msg.content)) continue;

      for (let c = msg.content.length - 1; c >= 0; c--) {
        const item = msg.content[c];
        // tool_result with image inside, or direct image block
        if (item.type === 'image') {
          imageLocations.push({ msgIdx: m, contentIdx: c });
        } else if (item.type === 'tool_result' && Array.isArray(item.content)) {
          for (let i = item.content.length - 1; i >= 0; i--) {
            if (item.content[i].type === 'image') {
              imageLocations.push({ msgIdx: m, contentIdx: c });
              break; // One image per tool_result is enough to track
            }
          }
        }
      }
    }

    // Remove images beyond the keep limit (oldest first)
    if (imageLocations.length > keepImages) {
      const toRemove = imageLocations.slice(keepImages); // These are the oldest
      for (const loc of toRemove) {
        const content = messages[loc.msgIdx].content[loc.contentIdx];
        if (content.type === 'image') {
          // Replace image with placeholder text
          messages[loc.msgIdx].content[loc.contentIdx] = {
            type: 'text',
            text: '[Screenshot removed to save context]',
          };
        } else if (content.type === 'tool_result' && Array.isArray(content.content)) {
          // Replace images inside tool_result
          content.content = content.content.map((c: any) =>
            c.type === 'image' ? { type: 'text', text: '[Screenshot removed]' } : c
          );
        }
      }
    }
  }
}
