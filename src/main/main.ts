import { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, globalShortcut, shell } from 'electron';
import * as path from 'path';
import { ScreenCaptureService } from './services/screen-capture';
import { MemoryService } from './services/memory';
import { AIService } from './services/ai-service';
import { ConfigService } from './services/config';
import { SecurityService } from './services/security';
import { CronService } from './services/cron-service';
import { ToolsService } from './services/tools-service';
import { WorkflowService } from './services/workflow-service';
import { AgentLoop } from './services/agent-loop';
import { EmbeddingService } from './services/embedding-service';
import { RAGService } from './services/rag-service';
import { AutomationService } from './services/automation-service';
import { BrowserService } from './services/browser-service';
import { PluginService } from './services/plugin-service';
import { SecurityGuard } from './services/security-guard';
import { SystemMonitor } from './services/system-monitor';
import { TTSService } from './services/tts-service';
import { ScreenMonitorService } from './services/screen-monitor';
import { TranscriptionService } from './services/transcription-service';
import { MeetingCoachService } from './services/meeting-coach';
import { DashboardServer } from './services/dashboard-server';
import { DiagnosticService } from './services/diagnostic-service';
import { setupIPC } from './ipc';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ─── Single Instance Lock ───
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — focus it and quit
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Services
let screenCapture: ScreenCaptureService;
let memoryService: MemoryService;
let aiService: AIService;
let configService: ConfigService;
let securityService: SecurityService;
let cronService: CronService;
let toolsService: ToolsService;
let workflowService: WorkflowService;
let agentLoop: AgentLoop;
let embeddingService: EmbeddingService;
let ragService: RAGService;
let automationService: AutomationService;
let browserService: BrowserService;
let pluginService: PluginService;
let securityGuardService: SecurityGuard;
let systemMonitorService: SystemMonitor;
let ttsService: TTSService;
let screenMonitorService: ScreenMonitorService;
let transcriptionService: TranscriptionService;
let meetingCoachService: MeetingCoachService;
let dashboardServer: DashboardServer;
let diagnosticService: DiagnosticService;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

/**
 * Start the smart companion monitor with all tiered callbacks.
 * Reused for both auto-start and manual proactive:set-mode toggle.
 */
function startCompanionMonitor(win: BrowserWindow): void {
  const safeSend = (channel: string, data?: any) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  };

  screenMonitorService.start(
    // T0: Window change
    (_info) => {
      // Just track — T1/T2 will pick up the actual content
    },
    // T1: Content change (OCR detected significant text change)
    (ctx) => {
      if (ctx.contentChanged && ctx.ocrText.length > 50) {
        safeSend('agent:companion-state', { wantsToSpeak: true });
      }
    },
    // T2: Vision needed — full AI analysis
    async (ctx, screenshotBase64) => {
      try {
        console.log('[Proactive] T2 callback triggered — starting AI analysis...');
        const analysis = await aiService.analyzeScreens([{
          base64: `data:image/png;base64,${screenshotBase64}`,
          width: 1024,
          height: 768,
          displayId: 0,
          displayLabel: 'monitor',
          timestamp: Date.now(),
        }]);
        console.log('[Proactive] AI analysis result:', analysis ? `hasInsight=${analysis.hasInsight}` : 'null');
        if (analysis && analysis.hasInsight) {
          agentLoop.logScreenActivity(analysis.context, analysis.message);

          memoryService.addMessage({
            id: `proactive-${Date.now()}`,
            role: 'assistant',
            content: `💡 **Obserwacja KxAI:**\n${analysis.message}${analysis.context ? `\n\n📋 ${analysis.context}` : ''}`,
            timestamp: Date.now(),
            type: 'proactive',
          });

          safeSend('agent:companion-state', { hasSuggestion: true });
          safeSend('ai:proactive', {
            type: 'screen-analysis',
            message: analysis.message,
            context: analysis.context,
          });
        }
      } catch (err) {
        console.error('[Proactive] Vision analysis error:', err);
      }
    },
    // Idle start — user went AFK
    () => {
      console.log('[Companion] User is now AFK');
      agentLoop.setAfkState(true);
      safeSend('agent:companion-state', { isAfk: true });
    },
    // Idle end — user is back
    () => {
      console.log('[Companion] User is back from AFK');
      agentLoop.setAfkState(false);
      safeSend('agent:companion-state', { isAfk: false });
    }
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
    safeSend('agent:companion-state', { hasSuggestion: true });
    safeSend('ai:proactive', {
      type: 'heartbeat',
      message,
    });
  });
}

function createMainWindow(): BrowserWindow {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 420,
    height: 600,
    x: screenWidth - 440,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for desktopCapturer and native module compatibility
    },
  });

  // Load the renderer
  if (isDev) {
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Make window click-through when collapsed (just the floating icon)
  win.setIgnoreMouseEvents(false);

  // ─── External link handling ───
  // Intercept navigation — open external URLs in system browser instead of navigating the Electron window
  const appOrigins = ['http://localhost:5173', `file://${path.join(__dirname, '..').replace(/\\/g, '/')}`];

  win.webContents.on('will-navigate', (event, url) => {
    const isInternal = appOrigins.some((origin) => url.startsWith(origin));
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

function createTray(): void {
  // Create a simple tray icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAKDSURBVFhH7ZZLaxRBEMf/PbO7WXeNiYlRE0VFEBQPHrx48eRn8OBX8KJ+BI8e/AIe1IMgCIIgnhQSMRqNMZvsy+7OdJf/6p2ZnZ2dTbIQBAv+dFdXV1dVd08PZ8z/HFxelv6S4K8kIJIkd44cHrtzaGp61LI5g0o1rG3bWd8oFBff38xk6N6gXIKQAIuEaS2qnQZ/wBYXQukxHlvRn59+PTpOeWxQ5MTh7gG6mHIA3YRV4JqcIFq4bnR0dG+YqkUlKt+vtHKXGiGvSoSOqc4YUGYrVT8wJNvXS9qe2k9n/8SinD+uB6hd3AAOB8e3WlOhPojyJwBfGBcQCG3LAsm+O+RzPZjH/x6NEXr1++xMrKKh3zQ0oIciCAAmGiS1xD7BBSSmGzPnx/R/I0xOTMITx78RL9/AY4eOgjLFi6FQD3L16ohCsoCLLjQDPHBBCCxI5fEGlhYWIIrL7D05AmcvXgB27duiTXyI6ym8h2hEDHxNc6dEcDSVWQrFfWFl+98NDoywqGpKarOIZfzSCsFpFMmn79cwR6O5g+W7qs8PnQHgd3ELq7ukhrcE2q4wkNBgD0wO2Nxfv5DYj+hIr7rAXSVmTHMy29ceBFXACVw4nw+0xMH9GvM6z/QhZD0B5IxqbhkWjwJagGH9S7VUzfRLlYhGU6uGdXH9Mj6c6UqlsMqtLgJ9IpqUAIAX2a0fYz6LB2jlAH49p0H8g0O5wFq0JHq+K9WS0kpgZWU1cjUc4EcAJFJLawTQw+UY3NKQCdSqC6JUQp5qlRd0W/6KcLuEYM7VV5T3tgS+3/7E/xwCdrbcP+r/LcJGHPxBGT//gOQhKTPBx/+qQAAAABJRU5ErkJggg=='
  );

  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Pokaż KxAI',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Ustawienia',
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send('navigate', 'settings');
      },
    },
    { type: 'separator' },
    {
      label: 'Zamknij',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip('KxAI — Personal AI Agent');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

async function initializeServices(): Promise<void> {
  configService = new ConfigService();
  securityService = new SecurityService();
  memoryService = new MemoryService(configService);
  aiService = new AIService(configService, securityService);
  screenCapture = new ScreenCaptureService();
  cronService = new CronService();
  toolsService = new ToolsService();
  workflowService = new WorkflowService();

  // New services
  embeddingService = new EmbeddingService(securityService, configService);
  automationService = new AutomationService();
  browserService = new BrowserService();
  pluginService = new PluginService();
  securityGuardService = new SecurityGuard();
  systemMonitorService = new SystemMonitor();
  ttsService = new TTSService(securityService);

  await memoryService.initialize();
  await embeddingService.initialize();

  // RAG — semantic search over memory
  ragService = new RAGService(embeddingService, configService);
  await ragService.initialize();

  // Plugin system
  await pluginService.initialize();

  // Wire memory into AI service
  aiService.setMemoryService(memoryService);

  // Wire external services into tools
  toolsService.setServices({
    automation: automationService,
    browser: browserService,
    rag: ragService,
    plugins: pluginService,
  });

  // Create agent loop
  agentLoop = new AgentLoop(
    aiService,
    toolsService,
    cronService,
    workflowService,
    memoryService,
    configService
  );
  agentLoop.setRAGService(ragService);
  agentLoop.setAutomationService(automationService);
  agentLoop.setScreenCaptureService(screenCapture);

  // Screen monitor — tiered smart companion
  screenMonitorService = new ScreenMonitorService();
  screenMonitorService.setScreenCapture(screenCapture);
  agentLoop.setScreenMonitorService(screenMonitorService);

  // Meeting Coach — transcription + AI coaching
  transcriptionService = new TranscriptionService(securityService);
  meetingCoachService = new MeetingCoachService(
    transcriptionService, aiService, configService, securityService
  );

  // Dashboard — localhost server for full agent dashboard
  const meetingConfig = meetingCoachService.getConfig();
  dashboardServer = new DashboardServer(meetingCoachService, meetingConfig.dashboardPort, {
    tools: toolsService,
    cron: cronService,
    rag: ragService,
    workflow: workflowService,
    systemMonitor: systemMonitorService,
  });
  // Start dashboard server in background (non-blocking)
  dashboardServer.start().catch(err => {
    console.error('[KxAI] Dashboard server failed to start:', err);
  });

  // Diagnostic service — self-test tool
  diagnosticService = new DiagnosticService({
    ai: aiService,
    memory: memoryService,
    config: configService,
    cron: cronService,
    workflow: workflowService,
    tools: toolsService,
    systemMonitor: systemMonitorService,
    rag: ragService,
    browser: browserService,
    screenMonitor: screenMonitorService,
    screenCapture: screenCapture,
    tts: ttsService,
  });

  toolsService.register(
    {
      name: 'self_test',
      description: 'Uruchamia pełną diagnostykę agenta — testuje wszystkie podsystemy (AI, pamięć, narzędzia, przeglądarkę, RAG, cron, TTS, screen monitor, zasoby systemowe). Użyj gdy użytkownik prosi o self-test lub "przetestuj się".',
      category: 'system',
      parameters: {},
    },
    async () => {
      const report = await diagnosticService.runFullDiagnostic();
      return {
        success: report.summary.fail === 0,
        data: DiagnosticService.formatReport(report),
      };
    }
  );

  // Start cron jobs
  cronService.startAll();
}

app.whenReady().then(async () => {
  await initializeServices();

  mainWindow = createMainWindow();
  createTray();

  // Setup IPC handlers
  setupIPC(mainWindow, {
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
    meetingCoachService,
    dashboardServer,
  });

  // Auto-restore proactive mode (smart companion) if it was enabled before restart
  const proactiveSaved = configService.get('proactiveMode');
  if (proactiveSaved) {
    console.log('[KxAI] Proactive mode was enabled — auto-starting screen monitor...');
    startCompanionMonitor(mainWindow);
    agentLoop.startHeartbeat(5 * 60 * 1000); // 5 min
  }

  // Global shortcut to toggle window
  globalShortcut.register('Alt+K', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  // Global shortcut to toggle take-control mode
  globalShortcut.register('Ctrl+Shift+K', async () => {
    const windowRef = mainWindow;
    if (!windowRef) return;

    const safeSend = (channel: string, data?: any) => {
      if (windowRef && !windowRef.isDestroyed()) {
        windowRef.webContents.send(channel, data);
      }
    };

    if (agentLoop.isTakeControlActive()) {
      // Stop take-control
      agentLoop.stopTakeControl();
      safeSend('automation:status-update', '⛔ Sterowanie przerwane (Ctrl+Shift+K)');
      safeSend('agent:control-state', { active: false });
    } else {
      // Start take-control — ask AI what to do based on current screen
      safeSend('agent:control-state', { active: true, pending: true });
      safeSend('ai:stream', { takeControlStart: true, chunk: '🎮 Przejmuję sterowanie (Ctrl+Shift+K)...\n' });

      try {
        const result = await agentLoop.startTakeControl(
          'Użytkownik nacisnął Ctrl+Shift+K — przejmujesz sterowanie. Obserwuj ekran i kontynuuj pracę użytkownika. Gdy skończysz lub nie masz co robić, odpowiedz TASK_COMPLETE.',
          (status) => safeSend('automation:status-update', status),
          (chunk) => safeSend('ai:stream', { chunk }),
          true // confirmed via keyboard shortcut
        );
        safeSend('ai:stream', { done: true });
        safeSend('agent:control-state', { active: false });
      } catch (err: any) {
        console.error('Take-control shortcut error:', err);
        safeSend('ai:stream', { chunk: `\n❌ Błąd: ${err.message}\n` });
        safeSend('ai:stream', { done: true });
        safeSend('agent:control-state', { active: false });
      }
    }
  });

  // Global shortcut: Agent speaks — force screen analysis + insight
  globalShortcut.register('Ctrl+Shift+P', async () => {
    const windowRef = mainWindow;
    if (!windowRef || windowRef.isDestroyed()) return;

    const safeSend = (channel: string, data?: any) => {
      if (windowRef && !windowRef.isDestroyed()) {
        windowRef.webContents.send(channel, data);
      }
    };

    // Show chat and open stream
    safeSend('ai:stream', { takeControlStart: true, chunk: '👁️ Analizuję co widzę na ekranie...\n' });

    try {
      // Force an OCR check to get fresh screen context
      const ocrText = await screenMonitorService.forceOcrCheck();
      const ctx = screenMonitorService.buildMonitorContext();

      // Ask AI for insight based on screen context
      const prompt = `Użytkownik nacisnął Ctrl+Shift+P — chce żebyś się odezwał. 
Oto co widzisz na ekranie:

${ctx || '(brak kontekstu ekranu)'}

Powiedz użytkownikowi co widzisz, zaproponuj coś przydatnego, daj wskazówkę lub skomentuj to co robi.
Bądź pomocny, krótki i konkretny. Mów po polsku.`;

      // Stream the response
      await agentLoop.streamWithTools(
        prompt,
        undefined, // no extra context
        (chunk: string) => safeSend('ai:stream', { chunk }),
        true // skip intent detection for this forced interaction
      );
      safeSend('ai:stream', { done: true });
      
      // Clear companion state
      safeSend('agent:companion-state', { hasSuggestion: false, wantsToSpeak: false });
    } catch (err: any) {
      console.error('Ctrl+Shift+P error:', err);
      safeSend('ai:stream', { chunk: `\n❌ Błąd: ${err.message}\n` });
      safeSend('ai:stream', { done: true });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async () => {
  globalShortcut.unregisterAll();
  // Graceful shutdown of browser automation
  if (browserService) {
    await browserService.close().catch((err: any) =>
      console.error('[KxAI] Browser service shutdown error:', err)
    );
  }
  // Graceful shutdown of dashboard server
  if (dashboardServer) {
    await dashboardServer.stop().catch((err: any) =>
      console.error('[KxAI] Dashboard server shutdown error:', err)
    );
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});
