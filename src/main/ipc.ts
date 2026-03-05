import { ipcMain, BrowserWindow, desktopCapturer, screen, dialog, IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Ch, ChSend, Ev } from '../shared/ipc-schema';
import { validateIpcParams } from '../shared/schemas/ipc-params';
import { createLogger } from './services/logger';
import { ScreenCaptureService, ScreenshotData } from './services/screen-capture';
import { MemoryService } from './services/memory';
import { AIService } from './services/ai-service';
import { ConfigService } from './services/config';
import { SecurityService } from './services/security';
import { CronService } from './services/cron-service';
import { ToolsService } from './services/tools-service';
import { WorkflowService } from './services/workflow-service';
import { AgentLoop } from './services/agent-loop';
import { RAGService } from './services/rag-service';
import { AutomationService } from './services/automation-service';
import { BrowserService } from './services/browser-service';
import { PluginService } from './services/plugin-service';
import { SecurityGuard } from './services/security-guard';
import { SystemMonitor } from './services/system-monitor';
import { TTSService } from './services/tts-service';
import { ScreenMonitorService } from './services/screen-monitor';
import { MeetingCoachService } from './services/meeting-coach';
import { DashboardServer } from './services/dashboard-server';
import { UpdaterService } from './services/updater-service';
import { McpClientService } from './services/mcp-client-service';
import { CalendarService } from './services/calendar-service';
import { PrivacyService } from './services/privacy-service';
import { ClipboardService } from './services/clipboard-service';
import { KnowledgeGraphService } from './services/knowledge-graph-service';
import { ProactiveEngine } from './services/proactive-engine';
import { WorkflowAutomator } from './services/workflow-automator';
import { CortexEngine } from './services/cortex-engine';

const log = createLogger('IPC');

interface Services {
  configService: ConfigService;
  securityService: SecurityService;
  memoryService: MemoryService;
  aiService: AIService;
  screenCapture: ScreenCaptureService;
  cronService: CronService;
  toolsService: ToolsService;
  workflowService: WorkflowService;
  agentLoop: AgentLoop;
  ragService: RAGService;
  automationService: AutomationService;
  browserService: BrowserService;
  pluginService: PluginService;
  securityGuardService: SecurityGuard;
  systemMonitorService: SystemMonitor;
  ttsService: TTSService;
  screenMonitorService: ScreenMonitorService;
  meetingCoachService?: MeetingCoachService;
  dashboardServer?: DashboardServer;
  updaterService: UpdaterService;
  mcpClientService: McpClientService;
  calendarService: CalendarService;
  privacyService: PrivacyService;
  clipboardService: ClipboardService;
  knowledgeGraphService: KnowledgeGraphService;
  proactiveEngine: ProactiveEngine;
  workflowAutomator: WorkflowAutomator;
  reflectionEngine: import('./services/reflection-engine').ReflectionEngine;
  embeddingService: import('./services/embedding-service').EmbeddingService;
  cortexEngine: CortexEngine;
}

export function setupIPC(mainWindow: BrowserWindow, services: Services): void {
  const {
    configService,
    securityService,
    memoryService,
    aiService,
    screenCapture,
    cronService,
    toolsService,
    workflowService,
    agentLoop,
    ragService,
    automationService,
    browserService,
    pluginService,
    securityGuardService,
    systemMonitorService,
    ttsService,
    screenMonitorService,
  } = services;

  // ─── Validated IPC handler wrapper ───
  // Validates parameters with zod schemas before invoking the handler.
  // Channels without a schema in IpcParamSchemas bypass validation.
  function validatedHandle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
    ipcMain.handle(channel, (event, ...args) => {
      const error = validateIpcParams(channel, args);
      if (error) {
        const issues = error.issues
          .map((i) => ('path' in i ? `${(i as any).path?.join('.')}: ${i.message}` : i.message))
          .join('; ');
        log.warn(`Validation failed on ${channel}: ${issues}`);
        return { success: false, error: `Nieprawidłowe parametry: ${issues}` };
      }
      return handler(event, ...args);
    });
  }

  // Helper to safely send events to renderer
  const safeSend = (channel: string, data?: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  // ─── Agent status → renderer + dashboard ───
  const dashboardSrv = services.dashboardServer;
  agentLoop.onAgentStatus = (status) => {
    safeSend(Ev.AGENT_STATUS, status);
    dashboardSrv?.pushAgentStatus(status);
  };

  // ─── Push conversation updates to renderer ───
  // Debounced: multiple rapid addMessage() calls coalesce into one event.
  let conversationUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  memoryService.onMessageAdded = () => {
    if (conversationUpdateTimer) clearTimeout(conversationUpdateTimer);
    conversationUpdateTimer = setTimeout(() => {
      safeSend(Ev.CONVERSATION_UPDATED);
      conversationUpdateTimer = null;
    }, 150);
  };

  // Wire dashboard sub-agent accessors
  dashboardSrv?.setSubAgentAccessors(
    () => agentLoop.getSubAgentManager().listActive(),
    () => agentLoop.getSubAgentManager().peekResults(),
  );

  // Dashboard URL handler
  ipcMain.handle(Ch.DASHBOARD_GET_URL, () => {
    return dashboardSrv?.getUrl() || 'http://localhost:5678';
  });

  // ──────────────── AI Messages ────────────────

  // Stop agent processing (cancel tool loop, heartbeat, take-control)
  ipcMain.handle(Ch.AGENT_STOP, async () => {
    agentLoop.stopProcessing();
    // Don't send done: true here — the AI_STREAM_MESSAGE handler will send it
    // when streamWithTools() resolves after the AbortSignal terminates the stream.
    return { success: true };
  });

  validatedHandle(Ch.AI_SEND_MESSAGE, async (_event, message: string, context?: string) => {
    try {
      const response = await aiService.sendMessage(message, context);
      return { success: true, data: response };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  validatedHandle(Ch.AI_STREAM_MESSAGE, async (_event, message: string, context?: string) => {
    try {
      await agentLoop.streamWithTools(message, context, (chunk: string) => {
        safeSend(Ev.AI_STREAM, { chunk });
      });
      safeSend(Ev.AI_STREAM, { done: true });

      // Check if AI requested take-control mode
      const pendingTask = agentLoop.consumePendingTakeControl();
      if (pendingTask) {
        // Show confirmation dialog
        const confirm = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['Przejmij sterowanie', 'Anuluj'],
          defaultId: 1,
          cancelId: 1,
          title: 'Przejęcie sterowania',
          message: 'Agent chce przejąć sterowanie pulpitem',
          detail: `Zadanie: ${pendingTask}\n\nAgent będzie autonomicznie sterował myszką i klawiaturą. Rusz myszką lub naciśnij ESC aby przerwać.`,
        });
        if (confirm.response === 0) {
          securityGuardService.logAudit({
            action: 'automation:take-control',
            params: { task: pendingTask.slice(0, 200) },
            source: 'automation',
            result: 'allowed',
          });
          // Run take-control in background (don't block the IPC response)
          safeSend(Ev.AGENT_CONTROL_STATE, { active: true });
          // Open a new stream in the UI so chunks are visible
          safeSend(Ev.AI_STREAM, { takeControlStart: true, chunk: '🎮 Przejmuję sterowanie...\n' });
          agentLoop
            .startTakeControl(
              pendingTask,
              (status) => safeSend(Ev.AUTOMATION_STATUS_UPDATE, status),
              (chunk) => safeSend(Ev.AI_STREAM, { chunk }),
              true,
            )
            .then(() => {
              safeSend(Ev.AI_STREAM, { done: true });
              safeSend(Ev.AGENT_CONTROL_STATE, { active: false });
            })
            .catch((err) => {
              log.error('Take-control error:', err);
              safeSend(Ev.AI_STREAM, { chunk: `\n❌ Błąd: ${err.message}\n` });
              safeSend(Ev.AI_STREAM, { done: true });
              safeSend(Ev.AGENT_CONTROL_STATE, { active: false });
            });
        }
      }

      return { success: true };
    } catch (error: any) {
      log.error('ai:stream-message error:', error);
      safeSend(Ev.AI_STREAM, { chunk: `\n❌ Błąd: ${error.message}\n` });
      safeSend(Ev.AI_STREAM, { done: true });
      return { success: false, error: error.message };
    }
  });

  validatedHandle(Ch.AI_STREAM_WITH_SCREEN, async (_event, message: string) => {
    try {
      // Capture screenshots first
      const screenshots = await screenCapture.captureAllScreens();
      if (!screenshots.length) {
        // Don't send done here — let renderer handle the error from invoke result
        return { success: false, error: 'Nie udało się przechwycić ekranu' };
      }

      // Build vision message with screenshots
      await aiService.streamMessageWithScreenshots(message, screenshots, (chunk: string) => {
        safeSend(Ev.AI_STREAM, { chunk });
      });
      safeSend(Ev.AI_STREAM, { done: true });
      return { success: true };
    } catch (error: any) {
      log.error('ai:stream-with-screen error:', error);
      safeSend(Ev.AI_STREAM, { done: true });
      return { success: false, error: error.message };
    }
  });

  // ──────────────── Screen Capture ────────────────
  ipcMain.handle(Ch.SCREEN_CAPTURE, async () => {
    try {
      const screenshot = await screenCapture.captureAllScreens();
      return { success: true, data: screenshot };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Desktop sources for system audio capture — returns source IDs needed by getUserMedia
  ipcMain.handle(Ch.SCREEN_GET_DESKTOP_SOURCES, async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return { success: true, data: sources.map((s) => ({ id: s.id, name: s.name })) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  validatedHandle(Ch.SCREEN_START_WATCH, async (_event, intervalMs: number) => {
    screenCapture.startWatching(intervalMs, async (screenshots: ScreenshotData[]) => {
      // Send to AI for analysis
      const analysis = await aiService.analyzeScreens(screenshots);
      if (analysis && analysis.hasInsight) {
        safeSend(Ev.AI_PROACTIVE, {
          type: 'screen-analysis',
          message: analysis.message,
          context: analysis.context,
        });
      }
    });
    return { success: true };
  });

  ipcMain.handle(Ch.SCREEN_STOP_WATCH, async () => {
    screenCapture.stopWatching();
    return { success: true };
  });

  // ──────────────── Memory ────────────────
  validatedHandle(Ch.MEMORY_GET, async (_event, key: string) => {
    return memoryService.get(key);
  });

  validatedHandle(Ch.MEMORY_SET, async (_event, key: string, value: string) => {
    await memoryService.set(key, value);
    return { success: true };
  });

  ipcMain.handle(Ch.MEMORY_GET_HISTORY, async () => {
    return memoryService.getConversationHistory();
  });

  ipcMain.handle(Ch.MEMORY_CLEAR_HISTORY, async () => {
    memoryService.clearConversationHistory();
    agentLoop.resetSessionState();
    return { success: true };
  });

  // ──────────────── Config ────────────────
  ipcMain.handle(Ch.CONFIG_GET, async () => {
    return configService.getAll();
  });

  validatedHandle(Ch.CONFIG_SET, async (_event, key: string, value: any) => {
    configService.set(key as keyof import('../shared/types/config').KxAIConfig, value);
    return { success: true };
  });

  validatedHandle(Ch.CONFIG_SET_BATCH, async (_event, updates: Record<string, any>) => {
    configService.setBatch(updates);
    // Re-init embedding service when embedding model changes
    if ('embeddingModel' in updates) {
      await services.embeddingService.reinitialize();
    }
    return { success: true };
  });

  ipcMain.handle(Ch.CONFIG_IS_ONBOARDED, async () => {
    return configService.isOnboarded();
  });

  validatedHandle(Ch.CONFIG_COMPLETE_ONBOARDING, async (_event, data: any) => {
    await configService.completeOnboarding(data);
    // Reinitialize AI service with new config
    await aiService.reinitialize();
    return { success: true };
  });

  // ──────────────── Security ────────────────
  validatedHandle(Ch.SECURITY_SET_API_KEY, async (_event, provider: string, key: string) => {
    await securityService.setApiKey(provider, key);
    await aiService.reinitialize();
    // Re-init embedding service when OpenAI key changes (it uses 'openai' as fallback)
    if (provider === 'openai' || provider === 'openai-embeddings') {
      await services.embeddingService.reinitialize();
    }
    return { success: true };
  });

  validatedHandle(Ch.SECURITY_HAS_API_KEY, async (_event, provider: string) => {
    return securityService.hasApiKey(provider);
  });

  validatedHandle(Ch.SECURITY_DELETE_API_KEY, async (_event, provider: string) => {
    await securityService.deleteApiKey(provider);
    return { success: true };
  });

  // ──────────────── Window Control ────────────────
  ipcMain.handle(Ch.WINDOW_HIDE, async () => {
    mainWindow.hide();
  });

  ipcMain.handle(Ch.WINDOW_MINIMIZE, async () => {
    mainWindow.minimize();
  });

  validatedHandle(Ch.WINDOW_SET_POSITION, async (_event, x: number, y: number) => {
    mainWindow.setPosition(x, y);
  });

  ipcMain.handle(Ch.WINDOW_GET_POSITION, async () => {
    return mainWindow.getPosition();
  });

  // Saved widget position — restored when shrinking back to widget size
  let savedWidgetPos: { x: number; y: number } | null = null;

  validatedHandle(Ch.WINDOW_SET_SIZE, async (_event, width: number, height: number) => {
    const currentBounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(currentBounds);
    const { x: waX, y: waY, width: waW, height: waH } = display.workArea;

    const isWidget = width <= 80 && height <= 80;
    const wasWidget = currentBounds.width <= 80 && currentBounds.height <= 80;

    if (wasWidget && !isWidget) {
      // Expanding from widget — save position, expand anchored near widget
      savedWidgetPos = { x: currentBounds.x, y: currentBounds.y };
      // Expand to the left of the widget's right edge
      let newX = currentBounds.x + currentBounds.width - width;
      let newY = currentBounds.y;
      // Clamp to work area
      newX = Math.max(waX, Math.min(newX, waX + waW - width));
      newY = Math.max(waY, Math.min(newY, waY + waH - height));
      mainWindow.setBounds({ x: newX, y: newY, width, height });
    } else if (isWidget && savedWidgetPos) {
      // Shrinking to widget — restore saved position
      const x = Math.max(waX, Math.min(savedWidgetPos.x, waX + waW - width));
      const y = Math.max(waY, Math.min(savedWidgetPos.y, waY + waH - height));
      mainWindow.setBounds({ x, y, width, height });
    } else if (isWidget) {
      // Widget but no saved position (first startup) — position at top-right
      const margin = 20;
      mainWindow.setBounds({
        x: waX + waW - width - margin,
        y: waY + margin,
        width,
        height,
      });
    } else {
      // Non-widget resize (e.g. chat→dashboard) — keep current position, clamp
      const x = Math.max(waX, Math.min(currentBounds.x, waX + waW - width));
      const y = Math.max(waY, Math.min(currentBounds.y, waY + waH - height));
      mainWindow.setBounds({ x, y, width, height });
    }
  });

  validatedHandle(Ch.WINDOW_SET_CLICKTHROUGH, async (_event, enabled: boolean) => {
    mainWindow.setIgnoreMouseEvents(enabled, { forward: true });
  });

  // ──────────────── Voice Transcription (Whisper) ────────────────
  validatedHandle(Ch.VOICE_TRANSCRIBE, async (_event, audioBase64: string) => {
    try {
      const OpenAI = require('openai').default;
      const { toFile } = require('openai');
      const apiKey = await securityService.getApiKey('openai');
      if (!apiKey) {
        return { success: false, error: 'Brak klucza OpenAI — ustaw go w ustawieniach' };
      }
      const client = new OpenAI({ apiKey });

      // Decode base64 to buffer
      const audioBuffer = Buffer.from(audioBase64, 'base64');

      // Whisper API limit: 25 MB
      const MAX_WHISPER_SIZE = 25 * 1024 * 1024;
      if (audioBuffer.length > MAX_WHISPER_SIZE) {
        return {
          success: false,
          error: `Plik audio przekracza limit 25 MB (${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB)`,
        };
      }

      // Create a Node-compatible file object via OpenAI SDK helper
      const file = await toFile(audioBuffer, 'voice.webm', { type: 'audio/webm' });

      const transcription = await client.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        language: 'pl',
      });

      return { success: true, text: transcription.text };
    } catch (error: any) {
      log.error('Whisper transcription failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // ──────────────── File Operations ────────────────
  validatedHandle(Ch.FILES_ORGANIZE, async (_event, directory: string, rules?: any) => {
    try {
      const result = await aiService.organizeFiles(directory, rules);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  validatedHandle(Ch.FILES_LIST, async (_event, directory: string) => {
    try {
      // Validate and sanitize directory path
      const resolved = path.resolve(directory);
      const allowedBase = path.join(app.getPath('userData'), 'workspace');
      const userHome = app.getPath('home');

      // Restrict to workspace or user home directory
      if (!resolved.startsWith(allowedBase) && !resolved.startsWith(userHome)) {
        return [];
      }

      try {
        await fs.promises.access(resolved);
      } catch {
        return [];
      }
      const stat = await fs.promises.stat(resolved);
      if (!stat.isDirectory()) return [];

      const items = await fs.promises.readdir(resolved, { withFileTypes: true });
      return items.map((item: any) => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        path: path.join(resolved, item.name),
      }));
    } catch {
      return [];
    }
  });

  // ──────────────── Proactive Engine ────────────────
  validatedHandle(Ch.PROACTIVE_SET_MODE, async (_event, enabled: boolean) => {
    configService.set('proactiveMode', enabled);
    if (enabled) {
      // Start smart companion monitoring (tiered: T0 free/2s, T1 OCR free/12s, T2 vision periodic/3min)
      screenMonitorService.start(
        // T0: Window change
        (_info) => {
          /* tracked internally by monitor */
        },
        // T1: Content change
        (ctx) => {
          if (ctx.contentChanged && ctx.ocrText.length > 50) {
            safeSend(Ev.AGENT_COMPANION_STATE, { wantsToSpeak: true });
          }
        },
        // T2: Vision needed — full AI analysis on significant changes or periodic
        // Receives ALL monitors for multi-screen awareness
        async (ctx, screenshots) => {
          try {
            const screenshotData = screenshots
              .filter((s) => {
                // Validate base64 data — filter out empty/corrupt screenshots
                if (!s.base64 || s.base64.length < 100) {
                  log.warn(`Pominięto pusty screenshot: ${s.label}`);
                  return false;
                }
                return true;
              })
              .map((s, i) => ({
                base64: `data:image/png;base64,${s.base64}`,
                width: 1024,
                height: 768,
                displayId: i,
                displayLabel: s.label || `Monitor ${i + 1}`,
                timestamp: Date.now(),
              }));

            if (screenshotData.length === 0) {
              log.warn('Brak prawidłowych screenshotów do analizy');
              return;
            }

            log.info(
              `[Proactive] T2 callback triggered — starting AI analysis (${screenshotData.length} screen(s))...`,
            );
            const analysis = await aiService.analyzeScreens(screenshotData);
            if (analysis && analysis.hasInsight) {
              agentLoop.logScreenActivity(analysis.context, analysis.message);

              memoryService.addMessage({
                id: `proactive-${Date.now()}`,
                role: 'assistant',
                content: `💡 **Obserwacja KxAI:**\n${analysis.message}${analysis.context ? `\n\n📋 ${analysis.context}` : ''}`,
                timestamp: Date.now(),
                type: 'proactive',
              });

              safeSend(Ev.AGENT_COMPANION_STATE, { hasSuggestion: true });
              safeSend(Ev.AI_PROACTIVE, {
                type: 'screen-analysis',
                message: analysis.message,
                context: analysis.context,
              });
            }
          } catch (err) {
            log.error('Vision analysis error:', err);
          }
        },
        // Idle start — user went AFK
        () => {
          agentLoop.setAfkState(true);
          safeSend(Ev.AGENT_COMPANION_STATE, { isAfk: true });
        },
        // Idle end — user is back
        () => {
          agentLoop.setAfkState(false);
          safeSend(Ev.AGENT_COMPANION_STATE, { isAfk: false });
        },
      );

      // Set heartbeat callback to deliver results to UI
      agentLoop.setHeartbeatCallback((message) => {
        memoryService.addMessage({
          id: `heartbeat-${Date.now()}`,
          role: 'assistant',
          content: `🤖 **KxAI (autonomiczny):**\n${message}`,
          timestamp: Date.now(),
          type: 'proactive',
        });
        safeSend(Ev.AGENT_COMPANION_STATE, { hasSuggestion: true });
        safeSend(Ev.AI_PROACTIVE, {
          type: 'heartbeat',
          message,
        });
      });

      // Start heartbeat for autonomous operations
      agentLoop.startHeartbeat(5 * 60 * 1000); // 5 min

      // Start Proactive Intelligence Engine — rule-based notifications
      const { proactiveEngine } = services;
      proactiveEngine.setResultCallback((notification) => {
        memoryService.addMessage({
          id: `proactive-rule-${Date.now()}`,
          role: 'assistant',
          content: `🔔 **KxAI (proaktywny):**\n${notification.message}`,
          timestamp: Date.now(),
          type: 'proactive',
        });
        safeSend(Ev.AGENT_COMPANION_STATE, { hasSuggestion: true });
        safeSend(Ev.AI_PROACTIVE, {
          type: notification.type,
          message: notification.message,
          context: notification.context,
          ruleId: notification.ruleId,
        });
      });
      proactiveEngine.start();
    } else {
      screenMonitorService.stop();
      agentLoop.stopHeartbeat();
      services.proactiveEngine.stop();
    }
    return { success: true };
  });

  ipcMain.handle(Ch.PROACTIVE_GET_MODE, async () => {
    return configService.get('proactiveMode') || false;
  });

  // Proactive feedback (learning loop)
  validatedHandle(
    Ch.PROACTIVE_FEEDBACK,
    async (_event, data: { ruleId: string; action: 'accepted' | 'dismissed' | 'replied' }) => {
      services.proactiveEngine.recordFeedback({
        ruleId: data.ruleId,
        action: data.action,
        timestamp: Date.now(),
      });
      return { success: true };
    },
  );

  ipcMain.handle(Ch.PROACTIVE_GET_STATS, async () => {
    return services.proactiveEngine.getStats();
  });

  // ──────────────── Reflection Engine ────────────────
  ipcMain.handle(Ch.REFLECTION_TRIGGER, async (_event, type?: string) => {
    try {
      const result = await services.reflectionEngine.triggerNow((type as any) || 'manual');
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(Ch.REFLECTION_GET_STATUS, () => {
    return services.reflectionEngine.getStatus();
  });

  ipcMain.handle(Ch.REFLECTION_SET_INTERVAL, (_event, ms: number) => {
    services.reflectionEngine.setIntervalMs(ms);
    return { success: true };
  });

  // ──────────────── Cortex Engine (unified autonomous brain) ────────────────
  validatedHandle(Ch.CORTEX_SET_ENABLED, async (_event, enabled: boolean) => {
    const { cortexEngine } = services;
    configService.set('cortexEnabled', enabled);

    if (enabled) {
      // Wire message callback before starting
      cortexEngine.setMessageCallback((msg) => {
        memoryService.addMessage({
          id: `cortex-${Date.now()}`,
          role: 'assistant',
          content: `🧠 **KxAI (${msg.source}):**\n${msg.message}`,
          timestamp: Date.now(),
          type: 'proactive',
        });
        safeSend(Ev.AGENT_COMPANION_STATE, { hasSuggestion: true });
        safeSend(Ev.CORTEX_MESSAGE, msg);
      });

      // Set processing check — prevents think() during active chat
      cortexEngine.setProcessingCheck(() => agentLoop.isCurrentlyProcessing());

      // Wire screen T2 callback — AI vision analysis
      cortexEngine.setScreenAnalysisCallback(async (screenshots) => {
        try {
          const screenshotData = screenshots
            .filter((s: any) => s.base64 && s.base64.length >= 100)
            .map((s: any, i: number) => ({
              base64: `data:image/png;base64,${s.base64}`,
              width: 1024,
              height: 768,
              displayId: i,
              displayLabel: s.label || `Monitor ${i + 1}`,
              timestamp: Date.now(),
            }));

          if (screenshotData.length === 0) return;

          const analysis = await aiService.analyzeScreens(screenshotData);
          if (analysis && analysis.hasInsight) {
            agentLoop.logScreenActivity(analysis.context, analysis.message);
          }
        } catch (err) {
          log.error('Cortex vision analysis error:', err);
        }
      });

      // Wire AFK callback
      cortexEngine.setAfkCallback((isAfk) => {
        agentLoop.setAfkState(isAfk);
        safeSend(Ev.AGENT_COMPANION_STATE, { isAfk });
      });

      cortexEngine.start();
    } else {
      cortexEngine.stop();
    }
    return { success: true };
  });

  ipcMain.handle(Ch.CORTEX_GET_STATUS, () => {
    return services.cortexEngine.getStatus();
  });

  validatedHandle(Ch.CORTEX_SET_INTENSITY, async (_event, intensity: string) => {
    services.cortexEngine.setIntensity(intensity as any);
    configService.set('cortexIntensity', intensity as any);
    return { success: true };
  });

  validatedHandle(Ch.CORTEX_SET_SCREEN_MODE, async (_event, mode: string) => {
    services.cortexEngine.setScreenMode(mode as any);
    return { success: true };
  });

  validatedHandle(
    Ch.CORTEX_FEEDBACK,
    async (_event, data: { ruleId: string; action: 'accepted' | 'dismissed' | 'replied' }) => {
      services.cortexEngine.recordFeedback({
        ruleId: data.ruleId,
        action: data.action,
        timestamp: Date.now(),
      });
      return { success: true };
    },
  );

  ipcMain.handle(Ch.CORTEX_TRIGGER_REFLECTION, async (_event, type?: string) => {
    try {
      await services.cortexEngine.triggerReflection((type as any) || 'manual');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  validatedHandle(Ch.CORTEX_ACTION_RESPOND, async (_event, response: any) => {
    try {
      services.cortexEngine.handleActionResponse(response);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(Ch.CORTEX_GET_PENDING_ACTIONS, async () => {
    return services.cortexEngine.getPendingActions();
  });

  // ──────────────── Cron Jobs ────────────────
  ipcMain.handle(Ch.CRON_GET_JOBS, async () => {
    return cronService.getJobs();
  });

  validatedHandle(Ch.CRON_ADD_JOB, async (_event, job: any) => {
    try {
      const newJob = cronService.addJob(job);
      return { success: true, data: newJob };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  validatedHandle(Ch.CRON_UPDATE_JOB, async (_event, id: string, updates: any) => {
    const updated = cronService.updateJob(id, updates);
    return updated ? { success: true, data: updated } : { success: false, error: 'Job nie znaleziony' };
  });

  validatedHandle(Ch.CRON_REMOVE_JOB, async (_event, id: string) => {
    const removed = cronService.removeJob(id);
    return { success: true, data: removed };
  });

  validatedHandle(Ch.CRON_GET_HISTORY, async (_event, jobId?: string) => {
    return cronService.getHistory(jobId);
  });

  // ──────────────── Tools ────────────────
  ipcMain.handle(Ch.TOOLS_LIST, async () => {
    return toolsService.getDefinitions();
  });

  validatedHandle(Ch.TOOLS_EXECUTE, async (_event, name: string, params: any) => {
    try {
      const result = await toolsService.execute(name, params);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ──────────────── Workflow ────────────────
  validatedHandle(Ch.WORKFLOW_GET_ACTIVITY, async (_event, limit?: number) => {
    return workflowService.getActivityLog(limit || 50);
  });

  ipcMain.handle(Ch.WORKFLOW_GET_PATTERNS, async () => {
    return workflowService.getPatterns();
  });

  ipcMain.handle(Ch.WORKFLOW_GET_TIME_CONTEXT, async () => {
    return workflowService.buildTimeContext();
  });

  // ──────────────── Workflow Automator (Macros) ────────────────
  const { workflowAutomator } = services;

  ipcMain.handle(Ch.MACRO_LIST, async () => {
    return workflowAutomator.listMacros();
  });

  validatedHandle(Ch.MACRO_GET, async (_event, macroId: string) => {
    return workflowAutomator.getMacro(macroId);
  });

  validatedHandle(Ch.MACRO_DELETE, async (_event, macroId: string) => {
    return workflowAutomator.deleteMacro(macroId);
  });

  validatedHandle(Ch.MACRO_RENAME, async (_event, macroId: string, newName: string) => {
    return workflowAutomator.renameMacro(macroId, newName);
  });

  ipcMain.handle(Ch.MACRO_RECORDING_STATE, async () => {
    return workflowAutomator.getRecordingState();
  });

  validatedHandle(Ch.MACRO_START_RECORDING, async (_event, name: string) => {
    return workflowAutomator.startRecording(name);
  });

  validatedHandle(Ch.MACRO_STOP_RECORDING, async (_event, description?: string) => {
    return workflowAutomator.stopRecording(description);
  });

  validatedHandle(Ch.MACRO_REPLAY, async (_event, macroId: string, params?: string, stopOnError?: boolean) => {
    let overrides: Record<string, string> | undefined;
    if (params) {
      try {
        overrides = typeof params === 'string' ? JSON.parse(params) : params;
      } catch {
        return { success: false, error: 'Nieprawidłowy JSON w parametrze "params"' };
      }
    }
    return workflowAutomator.replay(macroId, overrides, stopOnError !== false);
  });

  // ──────────────── RAG ────────────────
  validatedHandle(Ch.RAG_SEARCH, async (_event, query: string, topK?: number) => {
    try {
      const results = await ragService.search(query, topK || 5);
      return {
        success: true,
        data: results.map((r) => ({
          fileName: r.chunk.fileName,
          section: r.chunk.section,
          content: r.chunk.content,
          score: r.score,
        })),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(Ch.RAG_REINDEX, async () => {
    try {
      // Wire progress reporting to renderer
      ragService.onProgress = (progress) => {
        safeSend(Ev.RAG_INDEXING_PROGRESS, progress);
      };
      await ragService.reindex();
      ragService.onProgress = undefined;
      return { success: true, data: ragService.getStats() };
    } catch (error: any) {
      ragService.onProgress = undefined;
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(Ch.RAG_STATS, async () => {
    return ragService.getStats();
  });

  validatedHandle(Ch.RAG_ADD_FOLDER, async (_event, folderPath: string) => {
    try {
      const result = await ragService.addFolder(folderPath);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(Ch.RAG_PICK_FOLDER, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Wybierz folder do zaindeksowania',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'cancelled' };
    }
    const folderPath = result.filePaths[0];
    try {
      const addResult = await ragService.addFolder(folderPath);
      return addResult;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  validatedHandle(Ch.RAG_REMOVE_FOLDER, async (_event, folderPath: string) => {
    try {
      ragService.removeFolder(folderPath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(Ch.RAG_GET_FOLDERS, async () => {
    return ragService.getIndexedFolders();
  });

  ipcMain.handle(Ch.RAG_FOLDER_STATS, async () => {
    return ragService.getFolderStats();
  });

  // ──────────────── Automation ────────────────
  ipcMain.handle(Ch.AUTOMATION_ENABLE, async () => {
    automationService.enable();
    return { success: true };
  });

  ipcMain.handle(Ch.AUTOMATION_DISABLE, async () => {
    automationService.disable();
    return { success: true };
  });

  ipcMain.handle(Ch.AUTOMATION_UNLOCK_SAFETY, async () => {
    // Require explicit user confirmation via dialog
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Odblokuj', 'Anuluj'],
      defaultId: 1,
      cancelId: 1,
      title: 'Odblokowanie sterowania',
      message: 'Czy na pewno chcesz odblokować safety lock?',
      detail: 'Agent AI będzie mógł sterować klawiaturą i myszką Twojego komputera. Możesz przerwać w każdej chwili.',
    });
    if (result.response !== 0) {
      return { success: false, error: 'Użytkownik anulował odblokowanie' };
    }
    automationService.unlockSafety();
    securityGuardService.logAudit({
      action: 'automation:unlock-safety',
      params: {},
      source: 'automation',
      result: 'allowed',
    });
    return { success: true };
  });

  ipcMain.handle(Ch.AUTOMATION_STATUS, async () => {
    return {
      enabled: automationService.isEnabled(),
      safetyLocked: automationService.isSafetyLocked(),
      takeControlActive: agentLoop.isTakeControlActive(),
    };
  });

  let lastTakeControlTime = 0;
  validatedHandle(Ch.AUTOMATION_TAKE_CONTROL, async (_event, task: string) => {
    // Rate limiting: minimum 30s between take-control requests
    const now = Date.now();
    if (now - lastTakeControlTime < 30000) {
      return { success: false, error: 'Zbyt częste próby przejęcia sterowania. Poczekaj 30 sekund.' };
    }

    // Require user confirmation
    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Przejmij sterowanie', 'Anuluj'],
      defaultId: 1,
      cancelId: 1,
      title: 'Przejęcie sterowania',
      message: 'Agent chce przejąć sterowanie pulpitem',
      detail: `Zadanie: ${task}\n\nAgent będzie autonomicznie sterował myszką i klawiaturą. Rusz myszką lub naciśnij ESC aby przerwać.`,
    });
    if (confirm.response !== 0) {
      return { success: false, error: 'Użytkownik odrzucił przejęcie sterowania' };
    }

    lastTakeControlTime = now;
    securityGuardService.logAudit({
      action: 'automation:take-control',
      params: { task: task.slice(0, 200) },
      source: 'automation',
      result: 'allowed',
    });

    try {
      safeSend(Ev.AI_STREAM, { takeControlStart: true, chunk: '🎮 Przejmuję sterowanie...\n' });
      const result = await agentLoop.startTakeControl(
        task,
        (status) => safeSend(Ev.AUTOMATION_STATUS_UPDATE, status),
        (chunk) => safeSend(Ev.AI_STREAM, { chunk }),
        true, // confirmed via dialog above
      );
      safeSend(Ev.AI_STREAM, { done: true });
      return { success: true, data: result };
    } catch (error: any) {
      safeSend(Ev.AI_STREAM, { chunk: `\n❌ Błąd: ${error.message}\n` });
      safeSend(Ev.AI_STREAM, { done: true });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(Ch.AUTOMATION_STOP_CONTROL, async () => {
    agentLoop.stopTakeControl();
    return { success: true };
  });

  // ──────────────── Browser ────────────────
  ipcMain.handle(Ch.BROWSER_STATUS, async () => {
    return { running: browserService.isRunning() };
  });

  ipcMain.handle(Ch.BROWSER_CLOSE_ALL, async () => {
    browserService.closeAll();
    return { success: true };
  });

  // ──────────────── Plugins ────────────────
  ipcMain.handle(Ch.PLUGINS_LIST, async () => {
    return pluginService.listPlugins();
  });

  ipcMain.handle(Ch.PLUGINS_RELOAD, async () => {
    await pluginService.reload();
    // Re-register plugin tools
    toolsService.setServices({
      automation: automationService,
      browser: browserService,
      rag: ragService,
      plugins: pluginService,
    });
    return { success: true, data: pluginService.listPlugins() };
  });

  ipcMain.handle(Ch.PLUGINS_GET_DIR, async () => {
    return pluginService.getPluginsDir();
  });

  // ──────────────── Security & Audit ────────────────
  validatedHandle(Ch.SECURITY_AUDIT_LOG, async (_event, limit?: number) => {
    return securityGuardService.getAuditLog(limit || 50);
  });

  ipcMain.handle(Ch.SECURITY_STATS, async () => {
    return securityGuardService.getSecurityStats();
  });

  // ──────────────── System Monitor ────────────────
  ipcMain.handle(Ch.SYSTEM_SNAPSHOT, async () => {
    try {
      return { success: true, data: await systemMonitorService.getSnapshot() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(Ch.SYSTEM_STATUS, async () => {
    return systemMonitorService.getStatusSummary();
  });

  ipcMain.handle(Ch.SYSTEM_WARNINGS, async () => {
    return systemMonitorService.getWarnings();
  });

  // ──────────────── TTS (ElevenLabs / OpenAI / Web Speech fallback) ────────────────
  validatedHandle(Ch.TTS_SPEAK, async (_event, text: string) => {
    try {
      const audioPath = await ttsService.speak(text);
      if (!audioPath) {
        // ElevenLabs + OpenAI both failed or disabled — renderer should use Web Speech API fallback
        return { success: false, fallback: true };
      }
      // Read audio file and return as base64 data URL (file:// protocol blocked by Electron security)
      const fs = await import('fs');
      const audioBuffer = await fs.promises.readFile(audioPath);
      const base64 = audioBuffer.toString('base64');
      const dataUrl = `data:audio/mpeg;base64,${base64}`;
      // Clean up temp file
      try {
        await fs.promises.unlink(audioPath);
      } catch {
        /* non-critical */
      }
      return { success: true, audioData: dataUrl };
    } catch (error: any) {
      log.error('TTS speak error:', error.message);
      return { success: false, fallback: true, error: error.message };
    }
  });

  ipcMain.handle(Ch.TTS_STOP, async () => {
    ttsService.stop();
    return { success: true };
  });

  ipcMain.handle(Ch.TTS_GET_CONFIG, async () => {
    return ttsService.getConfig();
  });

  validatedHandle(Ch.TTS_SET_CONFIG, async (_event, updates: Record<string, any>) => {
    ttsService.setConfig(updates);
    return { success: true };
  });

  // ──────────────── Bootstrap ────────────────
  ipcMain.handle(Ch.BOOTSTRAP_IS_PENDING, async () => {
    return memoryService.isBootstrapPending();
  });

  ipcMain.handle(Ch.BOOTSTRAP_COMPLETE, async () => {
    await memoryService.completeBootstrap();
    return { success: true };
  });

  // ──────────────── HEARTBEAT.md ────────────────
  ipcMain.handle(Ch.HEARTBEAT_GET_CONFIG, async () => {
    const content = await memoryService.get('HEARTBEAT.md');
    return { content: content || '' };
  });

  validatedHandle(Ch.HEARTBEAT_SET_CONFIG, async (_event, content: string) => {
    await memoryService.set('HEARTBEAT.md', content);
    return { success: true };
  });

  // ──────────────── Meeting Coach ────────────────
  if (services.meetingCoachService) {
    const meetingCoach = services.meetingCoachService;
    const meetingDashboard = services.dashboardServer;

    // Forward meeting events to renderer
    const meetingEvents = [
      Ev.MEETING_STATE,
      Ev.MEETING_TRANSCRIPT,
      Ev.MEETING_COACHING,
      Ev.MEETING_COACHING_CHUNK,
      Ev.MEETING_COACHING_DONE,
      Ev.MEETING_ERROR,
      Ev.MEETING_STOP_CAPTURE,
      Ev.MEETING_DETECTED,
      Ev.MEETING_BRIEFING_UPDATED,
    ];
    for (const event of meetingEvents) {
      meetingCoach.on(event, (data: any) => {
        safeSend(event, data);
      });
    }

    validatedHandle(Ch.MEETING_START, async (_event, title?: string) => {
      try {
        const id = await meetingCoach.startMeeting(title);
        return { success: true, data: { id } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(Ch.MEETING_STOP, async () => {
      try {
        const summary = await meetingCoach.stopMeeting();
        if (summary) {
          return {
            success: true,
            data: {
              id: summary.id,
              title: summary.title,
              startTime: summary.startTime,
              duration: summary.duration,
              participants: summary.participants,
            },
          };
        }
        return { success: true, data: null };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(Ch.MEETING_GET_STATE, async () => {
      return meetingCoach.getState();
    });

    ipcMain.handle(Ch.MEETING_GET_CONFIG, async () => {
      return meetingCoach.getConfig();
    });

    validatedHandle(Ch.MEETING_SET_CONFIG, async (_event, updates: Record<string, any>) => {
      meetingCoach.setConfig(updates);
      return { success: true };
    });

    ipcMain.handle(Ch.MEETING_GET_SUMMARIES, async () => {
      return meetingCoach.getSummaries();
    });

    validatedHandle(Ch.MEETING_GET_SUMMARY, async (_event, id: string) => {
      return meetingCoach.getSummary(id);
    });

    ipcMain.handle(Ch.MEETING_GET_DASHBOARD_URL, async () => {
      return meetingDashboard?.getUrl() || `http://localhost:5678`;
    });

    // Audio chunk from renderer (non-invoke, fire-and-forget)
    let ipcAudioChunkCount = 0;
    let lastIpcAudioLog = 0;
    ipcMain.on(ChSend.MEETING_AUDIO_CHUNK, (_event, source: string, chunk: Uint8Array | Buffer) => {
      ipcAudioChunkCount++;
      const now = Date.now();
      if (now - lastIpcAudioLog > 10000) {
        lastIpcAudioLog = now;
        log.info(
          `[IPC] meeting:audio-chunk: ${ipcAudioChunkCount} chunks received (source=${source}, size=${chunk.byteLength}bytes)`,
        );
      }
      // Renderer sends Uint8Array (safe across context isolation), convert to Buffer for service
      meetingCoach.sendAudioChunk(source as 'mic' | 'system', Buffer.from(chunk));
    });

    // Speaker mapping (non-invoke, fire-and-forget)
    ipcMain.on(ChSend.MEETING_MAP_SPEAKER, (_event, speakerId: string, name: string) => {
      meetingCoach.mapSpeaker(speakerId, name);
    });

    // Briefing
    validatedHandle(Ch.MEETING_SET_BRIEFING, async (_event, briefing: any) => {
      try {
        await meetingCoach.setBriefing(briefing);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(Ch.MEETING_GET_BRIEFING, async () => {
      return meetingCoach.getBriefing();
    });

    ipcMain.handle(Ch.MEETING_CLEAR_BRIEFING, async () => {
      meetingCoach.clearBriefing();
      return { success: true };
    });
  }

  // ─── Sub-agents ───

  validatedHandle(Ch.SUBAGENT_SPAWN, async (_event, task: string, allowedTools?: string[]) => {
    try {
      const id = await agentLoop.getSubAgentManager().spawn({
        task,
        allowedTools: allowedTools || undefined,
        onProgress: (msg) => safeSend(Ev.SUBAGENT_PROGRESS, { msg }),
      });
      return { success: true, data: { id } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  validatedHandle(Ch.SUBAGENT_KILL, async (_event, agentId: string) => {
    const killed = agentLoop.getSubAgentManager().kill(agentId);
    return { success: killed };
  });

  validatedHandle(Ch.SUBAGENT_STEER, async (_event, agentId: string, instruction: string) => {
    const steered = await agentLoop.getSubAgentManager().steer(agentId, instruction);
    return { success: steered };
  });

  ipcMain.handle(Ch.SUBAGENT_LIST, async () => {
    return agentLoop.getSubAgentManager().listActive();
  });

  ipcMain.handle(Ch.SUBAGENT_RESULTS, async () => {
    return agentLoop.getSubAgentManager().consumeCompletedResults();
  });

  // ─── Background Exec ───

  validatedHandle(Ch.BACKGROUND_EXEC, async (_event, task: string) => {
    try {
      const id = await agentLoop.executeInBackground(task);
      return { success: true, data: { id } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(Ch.BACKGROUND_LIST, async () => {
    return agentLoop.getBackgroundTasks();
  });

  // ─── Active Hours ───

  validatedHandle(Ch.AGENT_SET_ACTIVE_HOURS, async (_event, start: number | null, end: number | null) => {
    agentLoop.setActiveHours(start, end);
    return { success: true };
  });

  // ─── Updates ───

  const updaterService = services.updaterService;

  ipcMain.handle(Ch.UPDATE_CHECK, async () => {
    return updaterService.checkForUpdates();
  });

  ipcMain.handle(Ch.UPDATE_DOWNLOAD, async () => {
    await updaterService.downloadUpdate();
    return { success: true };
  });

  ipcMain.handle(Ch.UPDATE_INSTALL, () => {
    updaterService.installUpdate();
    return { success: true };
  });

  ipcMain.handle(Ch.UPDATE_GET_STATE, () => {
    return updaterService.getState();
  });

  // ─── MCP Hub ───

  const mcpClient = services.mcpClientService;

  // Set mainWindow for status push
  mcpClient.setDependencies({ mainWindow });

  ipcMain.handle(Ch.MCP_LIST_SERVERS, () => {
    return mcpClient.listServers();
  });

  validatedHandle(Ch.MCP_ADD_SERVER, async (_event, config: any) => {
    return mcpClient.addServer(config);
  });

  validatedHandle(Ch.MCP_REMOVE_SERVER, async (_event, id: string) => {
    await mcpClient.removeServer(id);
    return { success: true };
  });

  validatedHandle(Ch.MCP_CONNECT, async (_event, id: string) => {
    await mcpClient.connect(id);
    return { success: true };
  });

  validatedHandle(Ch.MCP_DISCONNECT, async (_event, id: string) => {
    await mcpClient.disconnect(id);
    return { success: true };
  });

  validatedHandle(Ch.MCP_RECONNECT, async (_event, id: string) => {
    await mcpClient.reconnect(id);
    return { success: true };
  });

  ipcMain.handle(Ch.MCP_GET_STATUS, () => {
    return mcpClient.getStatus();
  });

  ipcMain.handle(Ch.MCP_GET_REGISTRY, () => {
    return mcpClient.getRegistry();
  });

  ipcMain.handle(Ch.MCP_SEARCH_REGISTRY, (_event, query?: string, category?: string) => {
    return mcpClient.searchRegistry(query, category as any);
  });

  ipcMain.handle(Ch.MCP_GET_CATEGORIES, () => {
    return mcpClient.getRegistryCategories();
  });

  validatedHandle(Ch.MCP_CALL_TOOL, async (_event, serverId: string, toolName: string, args: any) => {
    return mcpClient.callTool(serverId, toolName, args);
  });

  validatedHandle(Ch.MCP_RUN_OAUTH_SETUP, async (_event, id: string) => {
    return mcpClient.runOAuthSetup(id);
  });

  // ─── Calendar (CalDAV) ───

  const calendar = services.calendarService;

  // Push calendar status changes to renderer
  calendar.onStatusChange((status) => {
    safeSend(Ev.CALENDAR_STATUS, status);
  });

  ipcMain.handle(Ch.CALENDAR_GET_CONNECTIONS, () => {
    return calendar.getStatus();
  });

  ipcMain.handle(Ch.CALENDAR_GET_STATUS, () => {
    return calendar.getStatus();
  });

  validatedHandle(Ch.CALENDAR_ADD_CONNECTION, async (_event, config: any) => {
    return calendar.addConnection(config);
  });

  validatedHandle(Ch.CALENDAR_REMOVE_CONNECTION, async (_event, id: string) => {
    calendar.removeConnection(id);
    return { success: true };
  });

  validatedHandle(Ch.CALENDAR_CONNECT, async (_event, id: string) => {
    await calendar.connect(id);
    return { success: true };
  });

  validatedHandle(Ch.CALENDAR_DISCONNECT, async (_event, id: string) => {
    calendar.disconnect(id);
    return { success: true };
  });

  validatedHandle(Ch.CALENDAR_GET_CALENDARS, async (_event, connectionId: string) => {
    return calendar.getCalendars(connectionId);
  });

  validatedHandle(Ch.CALENDAR_STORE_CREDENTIAL, async (_event, connectionId: string, password: string) => {
    calendar.storeCredential(connectionId, password);
    return { success: true };
  });

  // ─── Privacy & GDPR ───

  const privacyService = services.privacyService;

  ipcMain.handle(Ch.PRIVACY_GET_SUMMARY, async () => {
    return privacyService.getDataSummary();
  });

  validatedHandle(Ch.PRIVACY_EXPORT_DATA, async (_event, options?: any) => {
    // Show confirmation dialog before export
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Eksport danych',
      message: 'Eksportuj wszystkie swoje dane?',
      detail: 'Zostanie utworzony folder z kopią Twoich danych w formacie JSON/MD. Klucze API nie będą eksportowane.',
      buttons: ['Eksportuj', 'Anuluj'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 1) {
      return { success: false, error: 'Anulowano przez użytkownika', categories: [] };
    }

    return privacyService.exportData(options);
  });

  validatedHandle(Ch.PRIVACY_DELETE_DATA, async (_event, options?: any) => {
    // Show strong confirmation dialog before deletion
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '⚠️ Usuwanie danych',
      message: 'Czy na pewno chcesz usunąć swoje dane?',
      detail:
        'Ta operacja jest NIEODWRACALNA. Wszystkie wybrane dane zostaną trwale usunięte. Zalecamy wcześniejszy eksport danych.',
      buttons: ['Usuń dane', 'Anuluj'],
      defaultId: 1,
      cancelId: 1,
    });

    if (result.response === 1) {
      return { success: false, deletedCategories: [], failedCategories: [], requiresRestart: false };
    }

    return privacyService.deleteData(options);
  });

  // ─── Clipboard ───

  const clipboardService = services.clipboardService;

  ipcMain.handle(Ch.CLIPBOARD_GET_STATUS, async () => {
    return clipboardService.getStatus();
  });

  ipcMain.handle(Ch.CLIPBOARD_START_MONITORING, async () => {
    clipboardService.startMonitoring();
    return { success: true };
  });

  ipcMain.handle(Ch.CLIPBOARD_STOP_MONITORING, async () => {
    clipboardService.stopMonitoring();
    return { success: true };
  });

  ipcMain.handle(Ch.CLIPBOARD_GET_HISTORY, async (_event, limit?: number) => {
    return clipboardService.getHistory(limit ?? 50);
  });

  validatedHandle(Ch.CLIPBOARD_SEARCH, async (_event, options: any) => {
    return clipboardService.search(options ?? {});
  });

  ipcMain.handle(Ch.CLIPBOARD_TOGGLE_PIN, async (_event, entryId: string) => {
    return clipboardService.togglePin(entryId);
  });

  ipcMain.handle(Ch.CLIPBOARD_DELETE_ENTRY, async (_event, entryId: string) => {
    return clipboardService.deleteEntry(entryId);
  });

  ipcMain.handle(Ch.CLIPBOARD_CLEAR_HISTORY, async () => {
    return clipboardService.clearHistory();
  });

  // ─── Knowledge Graph ───

  const knowledgeGraphService = services.knowledgeGraphService;

  validatedHandle(Ch.KG_SEARCH, async (_event, options: any) => {
    return knowledgeGraphService.search(options ?? {});
  });

  validatedHandle(Ch.KG_ADD_ENTITY, async (_event, data: any) => {
    return knowledgeGraphService.addEntity(data);
  });

  validatedHandle(Ch.KG_UPDATE_ENTITY, async (_event, id: string, updates: any) => {
    return knowledgeGraphService.updateEntity(id, updates);
  });

  ipcMain.handle(Ch.KG_DELETE_ENTITY, async (_event, id: string) => {
    return knowledgeGraphService.deleteEntity(id);
  });

  validatedHandle(Ch.KG_ADD_RELATION, async (_event, data: any) => {
    return knowledgeGraphService.addRelation(data);
  });

  ipcMain.handle(Ch.KG_DELETE_RELATION, async (_event, id: string) => {
    return knowledgeGraphService.deleteRelation(id);
  });

  ipcMain.handle(Ch.KG_GET_GRAPH, async (_event, entityId?: string, depth?: number) => {
    return knowledgeGraphService.getGraph(entityId, depth);
  });

  ipcMain.handle(Ch.KG_GET_STATS, async () => {
    return knowledgeGraphService.getStats();
  });
}
