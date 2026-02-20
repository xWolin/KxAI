import { ConfigService } from './config';
import { SecurityService } from './security';
import { MemoryService } from './memory';
import { ScreenshotData } from './screen-capture';
import { ContextManager } from './context-manager';
import { RetryHandler, createAIRetryHandler } from './retry-handler';
import { v4 as uuidv4 } from 'uuid';

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

export class AIService {
  private config: ConfigService;
  private security: SecurityService;
  private memoryService?: MemoryService;
  private openaiClient: any = null;
  private anthropicClient: any = null;
  private contextManager: ContextManager;
  private retryHandler: RetryHandler;

  constructor(config: ConfigService, security: SecurityService, memoryService?: MemoryService) {
    this.config = config;
    this.security = security;
    this.memoryService = memoryService;
    this.contextManager = new ContextManager();
    this.retryHandler = createAIRetryHandler();

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
   */
  async sendMessageWithVision(userMessage: string, screenshotBase64: string): Promise<string> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';
    const systemRole = this.getSystemRole(model);
    const systemContext = this.memoryService
      ? await this.memoryService.buildSystemContext()
      : 'You are KxAI, a helpful personal AI assistant.';

    if (provider === 'openai' && this.openaiClient) {
      const response = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          { role: systemRole, content: systemContext },
          {
            role: 'user',
            content: [
              { type: 'text', text: userMessage },
              { type: 'image_url', image_url: { url: screenshotBase64, detail: 'low' } },
            ],
          },
        ],
        ...this.openaiTokenParam(2048),
        temperature: 0.5,
      });
      return response.choices[0]?.message?.content || '';
    } else if (provider === 'anthropic' && this.anthropicClient) {
      // Extract base64 data from data URL
      const base64Match = screenshotBase64.match(/^data:image\/(.*?);base64,(.*)$/);
      const mediaType = base64Match?.[1] || 'png';
      const data = base64Match?.[2] || screenshotBase64;

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

  async sendMessage(userMessage: string, extraContext?: string): Promise<string> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';

    // Build system context from memory
    const systemContext = this.memoryService
      ? await this.memoryService.buildSystemContext()
      : 'You are KxAI, a helpful personal AI assistant.';

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

    // Store message in history
    if (this.memoryService) {
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

    // Store response in history
    if (this.memoryService) {
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

  async streamMessage(
    userMessage: string,
    extraContext?: string,
    onChunk?: (chunk: string) => void
  ): Promise<void> {
    await this.ensureClient();
    const provider = this.config.get('aiProvider') || 'openai';
    const model = this.config.get('aiModel') || 'gpt-5';

    const systemContext = this.memoryService
      ? await this.memoryService.buildSystemContext()
      : 'You are KxAI, a helpful personal AI assistant.';

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

    if (this.memoryService) {
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

    if (this.memoryService && fullResponse) {
      this.memoryService.addMessage({
        id: uuidv4(),
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
        type: 'chat',
      });
    }
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

    const analysisPrompt = `Jesteś KxAI — osobistym asystentem AI użytkownika. Analizujesz zrzut(y) ekranu użytkownika.

${systemContext}

Twoje zadanie:
1. Przeanalizuj co użytkownik aktualnie robi na ekranie
2. Jeśli widzisz konwersację (WhatsApp, Messenger, Slack, etc.) — przeanalizuj o czym rozmawiają
3. Jeśli widzisz kod — przeanalizuj co koduje, czy są błędy, co można poprawić
4. Jeśli widzisz coś interesującego co wymaga komentarza lub porady — zgłoś to

Odpowiedz w formacie JSON:
{
  "hasInsight": true/false,
  "message": "Twoja obserwacja/porada/analiza",
  "context": "krótki opis co widzisz na ekranie",
  "importance": "low/medium/high"
}

Odpowiadaj TYLKO jeśli masz coś wartościowego do powiedzenia. Nie komentuj trywialnych rzeczy.
hasInsight=false jeśli nie masz nic istotnego.`;

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
}
