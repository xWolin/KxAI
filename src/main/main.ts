import { app, BrowserWindow, ipcMain, Tray, Menu, screen, nativeImage, globalShortcut } from 'electron';
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

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
  embeddingService = new EmbeddingService(securityService);
  automationService = new AutomationService();
  browserService = new BrowserService();
  pluginService = new PluginService();
  securityGuardService = new SecurityGuard();
  systemMonitorService = new SystemMonitor();

  await memoryService.initialize();
  await embeddingService.initialize();

  // RAG — semantic search over memory
  ragService = new RAGService(embeddingService);
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
  });

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
    if (!mainWindow) return;

    if (agentLoop.isTakeControlActive()) {
      // Stop take-control
      agentLoop.stopTakeControl();
      mainWindow.webContents.send('automation:status-update', '⛔ Sterowanie przerwane (Ctrl+Shift+K)');
      mainWindow.webContents.send('agent:control-state', { active: false });
    } else {
      // Start take-control — ask AI what to do based on current screen
      mainWindow.webContents.send('agent:control-state', { active: true, pending: true });

      try {
        const result = await agentLoop.startTakeControl(
          'Użytkownik nacisnął Ctrl+Shift+K — przejmujesz sterowanie. Obserwuj ekran i kontynuuj pracę użytkownika. Gdy skończysz lub nie masz co robić, odpowiedz TASK_COMPLETE.',
          (status) => mainWindow!.webContents.send('automation:status-update', status),
          (chunk) => mainWindow!.webContents.send('ai:stream', { chunk }),
          true // confirmed via keyboard shortcut
        );
        mainWindow.webContents.send('agent:control-state', { active: false });
      } catch (err: any) {
        console.error('Take-control shortcut error:', err);
        mainWindow.webContents.send('agent:control-state', { active: false });
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});
