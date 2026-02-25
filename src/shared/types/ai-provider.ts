/**
 * AIProvider — provider-agnostic interface for AI backends.
 *
 * Each provider (OpenAI, Anthropic, future ones) implements this interface.
 * AIService delegates to the active provider, enabling hot-swap and polymorphic dispatch.
 */

import type { ToolDefinition } from './tools';

// ─── Feature Flags ───

export type AIProviderFeature =
  | 'function-calling'
  | 'vision'
  | 'streaming'
  | 'structured-output'
  | 'computer-use'
  | 'prompt-caching';

// ─── Chat Types ───

export interface ChatMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface ChatOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  /** OpenAI response_format for structured output */
  responseFormat?: any;
  /** Whether to skip streaming and return full response */
  stream?: boolean;
}

export interface ChatResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Anthropic prompt caching stats */
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
}

// ─── Vision Types ───

export interface VisionImage {
  base64Data: string;
  mediaType?: string;
  detail?: 'low' | 'high' | 'auto';
}

// ─── Tool Calling Types ───

export interface ToolCallResult {
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, any>;
  }>;
  /** Internal provider-specific messages state for continuation */
  _messages: any[];
}

export interface ToolResultEntry {
  callId: string;
  name: string;
  result: string;
  isError?: boolean;
}

// ─── Computer Use Types (Anthropic-specific, optional) ───

export interface ComputerUseConfig {
  displayWidth: number;
  displayHeight: number;
}

export interface ComputerUseStepResult {
  type: 'action' | 'text' | 'done';
  action?: {
    action: string;
    coordinate?: [number, number];
    start_coordinate?: [number, number];
    text?: string;
    scroll_direction?: 'up' | 'down' | 'left' | 'right';
    scroll_amount?: number;
    duration?: number;
    key?: string;
  };
  toolUseId?: string;
  text?: string;
}

// ─── Cost Tracking ───

export interface ProviderCostEntry {
  timestamp: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUSD: number;
}

// ─── Provider Interface ───

export interface AIProvider {
  /** Provider identifier */
  readonly name: string;

  /** Set of features this provider supports */
  readonly supportedFeatures: Set<AIProviderFeature>;

  /**
   * Initialize the provider with an API key.
   * Returns true if initialization was successful.
   */
  initialize(apiKey: string): Promise<boolean>;

  /** Check if the provider is ready (client initialized) */
  isReady(): boolean;

  /** Reset the client (for reinitialize/key change) */
  reset(): void;

  // ─── Chat ───

  /**
   * Send a chat completion request (non-streaming).
   */
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;

  /**
   * Stream a chat completion request.
   * Calls onChunk for each text delta.
   */
  streamChat(messages: ChatMessage[], options: ChatOptions, onChunk: (text: string) => void): Promise<ChatResponse>;

  // ─── Vision ───

  /**
   * Send a vision request with images.
   * Provider handles image format conversion internally.
   */
  chatWithVision(
    systemPrompt: string,
    userMessage: string,
    images: VisionImage[],
    options: ChatOptions,
  ): Promise<ChatResponse>;

  // ─── Tool Calling ───

  /**
   * Stream a chat with native tool calling.
   * Returns text, tool calls, and internal messages state.
   */
  streamWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options: ChatOptions,
    onTextChunk?: (text: string) => void,
  ): Promise<ToolCallResult>;

  /**
   * Continue a tool calling conversation with tool results.
   * Takes the _messages from the previous ToolCallResult.
   */
  continueWithToolResults(
    previousMessages: any[],
    toolResults: ToolResultEntry[],
    tools: ToolDefinition[],
    options: ChatOptions,
    onTextChunk?: (text: string) => void,
  ): Promise<ToolCallResult>;

  // ─── Computer Use (optional) ───

  /**
   * Send a Computer Use API request (Anthropic-specific).
   * Returns null if not supported by this provider.
   */
  computerUseStep?(
    systemPrompt: string,
    messages: any[],
    config: ComputerUseConfig,
    model: string,
  ): Promise<ComputerUseStepResult[]>;

  // ─── Cost ───

  /** Get accumulated cost entries for this session */
  getCostLog(): ProviderCostEntry[];

  /** Reset cost tracking */
  resetCostLog(): void;
}
