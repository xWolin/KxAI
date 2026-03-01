import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  screen,
  nativeImage,
  globalShortcut,
  shell,
  session,
  desktopCapturer,
} from 'electron';
import * as path from 'path';
import { Ev } from '../shared/ipc-schema';
import { ServiceContainer } from './services/service-container';
import { setupIPC } from './ipc';
import { createLogger } from './services/logger';

const log = createLogger('Main');

// ─── E2E Test Support: custom userData directory ───
if (process.env.KXAI_USER_DATA) {
  app.setPath('userData', process.env.KXAI_USER_DATA);
}

// ─── Global error handlers ───
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled promise rejection:', { reason, promise });
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
  // Don't exit — try to keep running for user experience
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const container = new ServiceContainer();

// ─── Single Instance Lock ───
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — focus it and quit immediately
  log.warn('Single instance lock failed — another instance is running. Exiting.');
  app.quit();
  // CRITICAL: prevent further initialization (app.quit() is async, code below would still run)
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

  const screenMonitorService = container.get('screenMonitor');
  const aiService = container.get('ai');
  const agentLoop = container.get('agentLoop');
  const memoryService = container.get('memory');
  const proactiveEngine = container.get('proactiveEngine');
  const reflectionEngine = container.get('reflectionEngine');

  screenMonitorService.start(
    // T0: Window change
    (_info) => {
      // Just track — T1/T2 will pick up the actual content
    },
    // T1: Content change (OCR detected significant text change)
    (ctx) => {
      if (ctx.contentChanged && ctx.ocrText.length > 50) {
        safeSend(Ev.AGENT_COMPANION_STATE, { wantsToSpeak: true });
      }
    },
    // T2: Vision needed — full AI analysis
    async (ctx, screenshots) => {
      try {
        log.info('T2 callback triggered — starting AI analysis...');
        const screenshotData = screenshots.map((s) => ({
          base64: s.base64.startsWith('data:') ? s.base64 : `data:image/png;base64,${s.base64}`,
          width: 1024,
          height: 768,
          displayId: 0,
          displayLabel: s.label || 'monitor',
          timestamp: Date.now(),
        }));
        const analysis = await aiService.analyzeScreens(screenshotData);
        log.info('AI analysis result:', analysis ? `hasInsight=${analysis.hasInsight}` : 'null');
        if (analysis && analysis.hasInsight) {
          agentLoop.logScreenActivity(analysis.context, analysis.message);

          // Screen observations are routed to the dashboard and used as context
          // by the heartbeat/autonomous engine — they do NOT go into chat history.
          // The autonomous agent will proactively comment when relevant.
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
      log.info('User is now AFK');
      agentLoop.setAfkState(true);
      safeSend(Ev.AGENT_COMPANION_STATE, { isAfk: true });
    },
    // Idle end — user is back
    () => {
      log.info('User is back from AFK');
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

  // Start Proactive Intelligence Engine — rule-based notifications
  proactiveEngine.setResultCallback((notification) => {
    memoryService.addMessage({
      id: `proactive-rule-${Date.now()}`,
      role: 'assistant',
      content: `🔔 **KxAI (proaktywny):**\n${notification.message}${notification.context ? `\n\n📋 ${notification.context}` : ''}`,
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

  // Start Reflection Engine — AI-driven periodic reflection and learning
  reflectionEngine.setProcessingCheck(() => agentLoop.isCurrentlyProcessing?.() ?? false);
  reflectionEngine.setResultCallback((message) => {
    memoryService.addMessage({
      id: `reflection-${Date.now()}`,
      role: 'assistant',
      content: `🪞 **KxAI (refleksja):**\n${message}`,
      timestamp: Date.now(),
      type: 'proactive',
    });
    safeSend(Ev.AGENT_COMPANION_STATE, { hasSuggestion: true });
    safeSend(Ev.AI_PROACTIVE, {
      type: 'reflection',
      message,
    });
  });
  reflectionEngine.onAgentStatus = (status) => safeSend(Ev.AGENT_STATUS, status);
  reflectionEngine.start();
}

function createMainWindow(): BrowserWindow {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 420,
    height: 600,
    x: screenWidth - 440,
    y: 20,
    title: '',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    show: false, // Don't show until ready-to-show (prevents invisible transparent window)
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for desktopCapturer and native module compatibility
    },
  });

  // Show window only after renderer content is painted (prevents flash/invisible window)
  win.once('ready-to-show', () => {
    win.show();
    // Ensure floating widget is visible on all macOS desktops/spaces
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  });

  // macOS: hide instead of close — app stays in tray, window is reusable
  // Without this, closing the window destroys it but the process stays alive
  // (window-all-closed doesn't quit on darwin), leaving a zombie with no UI.
  if (process.platform === 'darwin') {
    win.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        win.hide();
      }
    });
  }

  // Clean up reference when window is actually destroyed
  win.on('closed', () => {
    mainWindow = null;
  });

  // Load the renderer
  if (isDev) {
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // ─── Content Security Policy ───
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws://localhost:* http://localhost:* https://*.openai.com https://*.anthropic.com; img-src 'self' data: blob:; media-src 'self' blob: mediastream:;"
            : "default-src 'self' 'unsafe-inline'; connect-src 'self' https://*.openai.com https://*.anthropic.com wss://*.deepgram.com; img-src 'self' data: blob:; media-src 'self' blob: mediastream:;",
        ],
      },
    });
  });

  // ─── Auto-grant media permissions (mic, screen, desktop audio) ───
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'display-capture', 'audioCapture'];
    callback(allowed.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    const allowed = ['media', 'mediaKeySystem', 'display-capture', 'audioCapture'];
    return allowed.includes(permission);
  });

  // ─── Display media request handler for system audio ───
  // When renderer calls getDisplayMedia(), this handler auto-selects the primary screen
  // and enables system audio capture without showing a picker dialog
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length > 0) {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          log.warn('No display sources found for getDisplayMedia');
          // @ts-expect-error — Electron types don't reflect null but it correctly rejects the request
          callback(null);
        }
      })
      .catch((err) => {
        log.error('desktopCapturer.getSources failed:', err);
        // @ts-expect-error — Electron types don't reflect null but it correctly rejects the request
        callback(null);
      });
  });

  // ─── Renderer crash recovery ───
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error(`Renderer crashed: ${details.reason} (exit code: ${details.exitCode})`);
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        log.info('Reloading renderer after crash...');
        if (isDev) {
          win.loadURL('http://localhost:5173');
        } else {
          win.loadFile(path.join(__dirname, '../renderer/index.html'));
        }
      }
    }, 1000);
  });

  // Make window click-through when collapsed (just the floating icon)
  win.setIgnoreMouseEvents(false);

  // ─── External link handling ───
  // Intercept navigation — open external URLs in system browser instead of navigating the Electron window
  const appOrigins = ['http://localhost:5173', `file://${path.join(__dirname, '..').replace(/\\/g, '/')}`];

  win.webContents.on('will-navigate', (event, url) => {
    const isInternal = appOrigins.some((origin) => url.startsWith(origin));
    if (!isInternal) {
      event.preventDefault();
      // Only allow http/https protocols — block file://, smb://, custom protocols
      if (url.startsWith('https://') || url.startsWith('http://')) {
        shell.openExternal(url);
      } else {
        log.warn(`Blocked shell.openExternal for unsafe protocol: ${url}`);
      }
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow http/https protocols
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    } else {
      log.warn(`Blocked setWindowOpenHandler for unsafe protocol: ${url}`);
    }
    return { action: 'deny' };
  });

  return win;
}

function createTray(): void {
  // Create a simple tray icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAKDSURBVFhH7ZZLaxRBEMf/PbO7WXeNiYlRE0VFEBQPHrx48eRn8OBX8KJ+BI8e/AIe1IMgCIIgnhQSMRqNMZvsy+7OdJf/6p2ZnZ2dTbIQBAv+dFdXV1dVd08PZ8z/HFxelv6S4K8kIJIkd44cHrtzaGp61LI5g0o1rG3bWd8oFBff38xk6N6gXIKQAIuEaS2qnQZ/wBYXQukxHlvRn59+PTpOeWxQ5MTh7gG6mHIA3YRV4JqcIFq4bnR0dG+YqkUlKt+vtHKXGiGvSoSOqc4YUGYrVT8wJNvXS9qe2k9n/8SinD+uB6hd3AAOB8e3WlOhPojyJwBfGBcQCG3LAsm+O+RzPZjH/x6NEXr1++xMrKKh3zQ0oIciCAAmGiS1xD7BBSSmGzPnx/R/I0xOTMITx78RL9/AY4eOgjLFi6FQD3L16ohCsoCLLjQDPHBBCCxI5fEGlhYWIIrL7D05AmcvXgB27duiTXyI6ym8h2hEDHxNc6dEcDSVWQrFfWFl+98NDoywqGpKarOIZfzSCsFpFMmn79cwR6O5g+W7qs8PnQHgd3ELq7ukhrcE2q4wkNBgD0wO2Nxfv5DYj+hIr7rAXSVmTHMy29ceBFXACVw4nw+0xMH9GvM6z/QhZD0B5IxqbhkWjwJagGH9S7VUzfRLlYhGU6uGdXH9Mj6c6UqlsMqtLgJ9IpqUAIAX2a0fYz6LB2jlAH49p0H8g0O5wFq0JHq+K9WS0kpgZWU1cjUc4EcAJFJLawTQw+UY3NKQCdSqC6JUQp5qlRd0W/6KcLuEYM7VV5T3tgS+3/7E/xwCdrbcP+r/LcJGHPxBGT//gOQhKTPBx/+qQAAAABJRU5ErkJggg==',
  );

  // macOS: mark as template image for proper menu bar rendering (light/dark theme)
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);

  /** Ensure mainWindow exists and is visible; recreate if destroyed */
  const ensureWindow = (): BrowserWindow => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      return mainWindow;
    }
    // Window was destroyed — recreate
    mainWindow = createMainWindow();
    setupIPC(mainWindow, container.getIPCServices());
    container.get('updater').initialize(mainWindow);
    container.get('mcpClient').setDependencies({ mainWindow });
    return mainWindow;
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Pokaż KxAI',
      click: () => ensureWindow(),
    },
    {
      label: 'Ustawienia',
      click: () => {
        const win = ensureWindow();
        win.webContents.send(Ev.NAVIGATE, 'settings');
      },
    },
    { type: 'separator' },
    {
      label: 'Zamknij',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('KxAI — Personal AI Agent');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      ensureWindow();
    }
  });
}

async function initializeServices(): Promise<void> {
  await container.init();
}

// Only proceed if we hold the single instance lock
if (gotLock) {
  app.whenReady().then(async () => {
    try {
      await initializeServices();

      mainWindow = createMainWindow();
      createTray();

      // Setup IPC handlers
      setupIPC(mainWindow, container.getIPCServices());

      // Wire config change events → push to renderer
      const configService = container.get('config');
      configService.on('change', (changes: Record<string, unknown>) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(Ev.CONFIG_CHANGED, changes);
        }
      });

      // Initialize auto-updater (needs BrowserWindow for push events)
      container.get('updater').initialize(mainWindow);

      // Deferred init — non-critical services (dashboard, diagnostic, MCP)
      // Runs after window is created so user sees UI immediately
      container.initDeferred().catch((err) => {
        log.error('Deferred service initialization failed:', err);
      });

      // Auto-restore proactive mode (smart companion) if it was enabled before restart
      const proactiveSaved = container.get('config').get('proactiveMode');
      if (proactiveSaved) {
        log.info('Proactive mode was enabled — auto-starting screen monitor...');
        startCompanionMonitor(mainWindow);
        container.get('agentLoop').startHeartbeat(5 * 60 * 1000); // 5 min
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

        const agentLoop = container.get('agentLoop');

        if (agentLoop.isTakeControlActive()) {
          // Stop take-control
          agentLoop.stopTakeControl();
          safeSend(Ev.AUTOMATION_STATUS_UPDATE, '⛔ Sterowanie przerwane (Ctrl+Shift+K)');
          safeSend(Ev.AGENT_CONTROL_STATE, { active: false });
        } else {
          // Start take-control — ask AI what to do based on current screen
          safeSend(Ev.AGENT_CONTROL_STATE, { active: true, pending: true });
          safeSend(Ev.AI_STREAM, { takeControlStart: true, chunk: '🎮 Przejmuję sterowanie (Ctrl+Shift+K)...\n' });

          try {
            await agentLoop.startTakeControl(
              'Użytkownik nacisnął Ctrl+Shift+K — przejmujesz sterowanie. Obserwuj ekran i kontynuuj pracę użytkownika. Gdy skończysz lub nie masz co robić, odpowiedz TASK_COMPLETE.',
              (status) => safeSend(Ev.AUTOMATION_STATUS_UPDATE, status),
              (chunk) => safeSend(Ev.AI_STREAM, { chunk }),
              true, // confirmed via keyboard shortcut
            );
            safeSend(Ev.AI_STREAM, { done: true });
            safeSend(Ev.AGENT_CONTROL_STATE, { active: false });
          } catch (err: any) {
            log.error('Take-control shortcut error:', err);
            safeSend(Ev.AI_STREAM, { chunk: `\n❌ Błąd: ${err.message}\n` });
            safeSend(Ev.AI_STREAM, { done: true });
            safeSend(Ev.AGENT_CONTROL_STATE, { active: false });
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

        const agentLoop = container.get('agentLoop');
        const screenMonitorService = container.get('screenMonitor');

        // Show chat and open stream
        safeSend(Ev.AI_STREAM, { takeControlStart: true, chunk: '👁️ Analizuję co widzę na ekranie...\n' });

        try {
          // Force an OCR check to get fresh screen context
          await screenMonitorService.forceOcrCheck();
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
            (chunk: string) => safeSend(Ev.AI_STREAM, { chunk }),
            true, // skip intent detection for this forced interaction
          );
          safeSend(Ev.AI_STREAM, { done: true });

          // Clear companion state
          safeSend(Ev.AGENT_COMPANION_STATE, { hasSuggestion: false, wantsToSpeak: false });
        } catch (err: any) {
          log.error('Ctrl+Shift+P error:', err);
          safeSend(Ev.AI_STREAM, { chunk: `\n❌ Błąd: ${err.message}\n` });
          safeSend(Ev.AI_STREAM, { done: true });
        }
      });
    } catch (err: any) {
      log.error('FATAL: app.whenReady() failed:', err);
      console.error('FATAL: app.whenReady() failed:', err);
      // Allow logs to flush, then release the single-instance lock and exit
      setTimeout(() => app.exit(1), 250);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;

    const SHUTDOWN_TIMEOUT_MS = 5_000;

    const gracefulShutdown = async () => {
      log.info('Graceful shutdown started');
      const t0 = Date.now();

      globalShortcut.unregisterAll();
      await container.shutdown();

      log.info(`Graceful shutdown completed in ${Date.now() - t0}ms`);
    };

    // Race: graceful shutdown vs timeout
    Promise.race([
      gracefulShutdown(),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          log.warn(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
          resolve();
        }, SHUTDOWN_TIMEOUT_MS),
      ),
    ]).finally(() => {
      app.exit();
    });
  });

  app.on('activate', () => {
    // macOS: user clicked dock icon or switched to app — ensure window is visible
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      mainWindow = createMainWindow();
      setupIPC(mainWindow, container.getIPCServices());
      container.get('updater').initialize(mainWindow);
      container.get('mcpClient').setDependencies({ mainWindow });
      // Re-start companion monitor if proactive mode was active
      if (container.get('config').get('proactiveMode')) {
        startCompanionMonitor(mainWindow);
      }
    }
  });
} // end if (gotLock)
