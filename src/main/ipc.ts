import { ipcMain, BrowserWindow, desktopCapturer, screen, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
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
}

export function setupIPC(mainWindow: BrowserWindow, services: Services): void {
  const { configService, securityService, memoryService, aiService, screenCapture, cronService, toolsService, workflowService, agentLoop, ragService, automationService, browserService, pluginService, securityGuardService, systemMonitorService, ttsService, screenMonitorService } = services;

  // Helper to safely send events to renderer
  const safeSend = (channel: string, data?: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  // ─── Agent status → renderer + dashboard ───
  const dashboardSrv = services.dashboardServer;
  agentLoop.onAgentStatus = (status) => {
    safeSend('agent:status', status);
    dashboardSrv?.pushAgentStatus(status);
  };

  // Wire dashboard sub-agent accessors
  dashboardSrv?.setSubAgentAccessors(
    () => agentLoop.getSubAgentManager().listActive(),
    () => agentLoop.getSubAgentManager().peekResults()
  );

  // Dashboard URL handler
  ipcMain.handle('dashboard:get-url', () => {
    return dashboardSrv?.getUrl() || 'http://localhost:5678';
  });

  // ──────────────── AI Messages ────────────────
  ipcMain.handle('ai:send-message', async (_event, message: string, context?: string) => {
    try {
      const response = await aiService.sendMessage(message, context);
      return { success: true, data: response };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ai:stream-message', async (_event, message: string, context?: string) => {
    try {
      await agentLoop.streamWithTools(message, context, (chunk: string) => {
        mainWindow.webContents.send('ai:stream', { chunk });
      });
      mainWindow.webContents.send('ai:stream', { done: true });

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
          mainWindow.webContents.send('agent:control-state', { active: true });
          // Open a new stream in the UI so chunks are visible
          mainWindow.webContents.send('ai:stream', { takeControlStart: true, chunk: '🎮 Przejmuję sterowanie...\n' });
          agentLoop.startTakeControl(
            pendingTask,
            (status) => mainWindow.webContents.send('automation:status-update', status),
            (chunk) => mainWindow.webContents.send('ai:stream', { chunk }),
            true
          ).then(() => {
            mainWindow.webContents.send('ai:stream', { done: true });
            mainWindow.webContents.send('agent:control-state', { active: false });
          }).catch((err) => {
            console.error('Take-control error:', err);
            mainWindow.webContents.send('ai:stream', { chunk: `\n❌ Błąd: ${err.message}\n` });
            mainWindow.webContents.send('ai:stream', { done: true });
            mainWindow.webContents.send('agent:control-state', { active: false });
          });
        }
      }

      return { success: true };
    } catch (error: any) {
      mainWindow.webContents.send('ai:stream', { done: true });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('ai:stream-with-screen', async (_event, message: string) => {
    try {
      // Capture screenshots first
      const screenshots = await screenCapture.captureAllScreens();
      if (!screenshots.length) {
        // Don't send done here — let renderer handle the error from invoke result
        return { success: false, error: 'Nie udało się przechwycić ekranu' };
      }

      // Build vision message with screenshots
      await aiService.streamMessageWithScreenshots(message, screenshots, (chunk: string) => {
        mainWindow.webContents.send('ai:stream', { chunk });
      });
      mainWindow.webContents.send('ai:stream', { done: true });
      return { success: true };
    } catch (error: any) {
      console.error('ai:stream-with-screen error:', error);
      mainWindow.webContents.send('ai:stream', { done: true });
      return { success: false, error: error.message };
    }
  });

  // ──────────────── Screen Capture ────────────────
  ipcMain.handle('screen:capture', async () => {
    try {
      const screenshot = await screenCapture.captureAllScreens();
      return { success: true, data: screenshot };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Desktop sources for system audio capture — returns source IDs needed by getUserMedia
  ipcMain.handle('screen:get-desktop-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      return { success: true, data: sources.map(s => ({ id: s.id, name: s.name })) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('screen:start-watch', async (_event, intervalMs: number) => {
    screenCapture.startWatching(intervalMs, async (screenshots: ScreenshotData[]) => {
      // Send to AI for analysis
      const analysis = await aiService.analyzeScreens(screenshots);
      if (analysis && analysis.hasInsight) {
        mainWindow.webContents.send('ai:proactive', {
          type: 'screen-analysis',
          message: analysis.message,
          context: analysis.context,
        });
      }
    });
    return { success: true };
  });

  ipcMain.handle('screen:stop-watch', async () => {
    screenCapture.stopWatching();
    return { success: true };
  });

  // ──────────────── Memory ────────────────
  ipcMain.handle('memory:get', async (_event, key: string) => {
    return memoryService.get(key);
  });

  ipcMain.handle('memory:set', async (_event, key: string, value: string) => {
    await memoryService.set(key, value);
    return { success: true };
  });

  ipcMain.handle('memory:get-history', async () => {
    return memoryService.getConversationHistory();
  });

  ipcMain.handle('memory:clear-history', async () => {
    memoryService.clearConversationHistory();
    agentLoop.resetSessionState();
    return { success: true };
  });

  // ──────────────── Config ────────────────
  ipcMain.handle('config:get', async () => {
    return configService.getAll();
  });

  ipcMain.handle('config:set', async (_event, key: string, value: any) => {
    configService.set(key, value);
    return { success: true };
  });

  ipcMain.handle('config:is-onboarded', async () => {
    return configService.isOnboarded();
  });

  ipcMain.handle('config:complete-onboarding', async (_event, data: any) => {
    await configService.completeOnboarding(data);
    // Reinitialize AI service with new config
    await aiService.reinitialize();
    return { success: true };
  });

  // ──────────────── Security ────────────────
  ipcMain.handle('security:set-api-key', async (_event, provider: string, key: string) => {
    await securityService.setApiKey(provider, key);
    await aiService.reinitialize();
    return { success: true };
  });

  ipcMain.handle('security:has-api-key', async (_event, provider: string) => {
    return securityService.hasApiKey(provider);
  });

  ipcMain.handle('security:delete-api-key', async (_event, provider: string) => {
    await securityService.deleteApiKey(provider);
    return { success: true };
  });

  // ──────────────── Window Control ────────────────
  ipcMain.handle('window:hide', async () => {
    mainWindow.hide();
  });

  ipcMain.handle('window:minimize', async () => {
    mainWindow.minimize();
  });

  ipcMain.handle('window:set-position', async (_event, x: number, y: number) => {
    mainWindow.setPosition(x, y);
  });

  ipcMain.handle('window:get-position', async () => {
    return mainWindow.getPosition();
  });

  ipcMain.handle('window:set-size', async (_event, width: number, height: number) => {
    mainWindow.setSize(width, height);
  });

  // ──────────────── File Operations ────────────────
  ipcMain.handle('files:organize', async (_event, directory: string, rules?: any) => {
    try {
      const result = await aiService.organizeFiles(directory, rules);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('files:list', async (_event, directory: string) => {
    try {
      // Validate and sanitize directory path
      const resolved = path.resolve(directory);
      const allowedBase = path.join(app.getPath('userData'), 'workspace');
      const userHome = app.getPath('home');

      // Restrict to workspace or user home directory
      if (!resolved.startsWith(allowedBase) && !resolved.startsWith(userHome)) {
        return [];
      }

      if (!fs.existsSync(resolved)) return [];
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) return [];

      const items = fs.readdirSync(resolved, { withFileTypes: true });
      return items.map((item: any) => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        path: path.join(resolved, item.name),
      }));
    } catch (error: any) {
      return [];
    }
  });

  // ──────────────── Proactive Engine ────────────────
  ipcMain.handle('proactive:set-mode', async (_event, enabled: boolean) => {
    configService.set('proactiveMode', enabled);
    if (enabled) {
      // Start smart companion monitoring (tiered: T0 free/2s, T1 OCR free/12s, T2 vision periodic/3min)
      screenMonitorService.start(
        // T0: Window change
        (_info) => { /* tracked internally by monitor */ },
        // T1: Content change
        (ctx) => {
          if (ctx.contentChanged && ctx.ocrText.length > 50) {
            mainWindow.webContents.send('agent:companion-state', { wantsToSpeak: true });
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
                  console.warn(`[Proactive] Pominięto pusty screenshot: ${s.label}`);
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
              console.warn('[Proactive] Brak prawidłowych screenshotów do analizy');
              return;
            }

            console.log(`[Proactive] T2 callback triggered — starting AI analysis (${screenshotData.length} screen(s))...`);
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

              mainWindow.webContents.send('agent:companion-state', { hasSuggestion: true });
              mainWindow.webContents.send('ai:proactive', {
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
          agentLoop.setAfkState(true);
          mainWindow.webContents.send('agent:companion-state', { isAfk: true });
        },
        // Idle end — user is back
        () => {
          agentLoop.setAfkState(false);
          mainWindow.webContents.send('agent:companion-state', { isAfk: false });
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
        mainWindow.webContents.send('agent:companion-state', { hasSuggestion: true });
        mainWindow.webContents.send('ai:proactive', {
          type: 'heartbeat',
          message,
        });
      });

      // Start heartbeat for autonomous operations
      agentLoop.startHeartbeat(5 * 60 * 1000); // 5 min
    } else {
      screenMonitorService.stop();
      agentLoop.stopHeartbeat();
    }
    return { success: true };
  });

  ipcMain.handle('proactive:get-mode', async () => {
    return configService.get('proactiveMode') || false;
  });

  // ──────────────── Cron Jobs ────────────────
  ipcMain.handle('cron:get-jobs', async () => {
    return cronService.getJobs();
  });

  ipcMain.handle('cron:add-job', async (_event, job: any) => {
    try {
      const newJob = cronService.addJob(job);
      return { success: true, data: newJob };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cron:update-job', async (_event, id: string, updates: any) => {
    const updated = cronService.updateJob(id, updates);
    return updated
      ? { success: true, data: updated }
      : { success: false, error: 'Job nie znaleziony' };
  });

  ipcMain.handle('cron:remove-job', async (_event, id: string) => {
    const removed = cronService.removeJob(id);
    return { success: true, data: removed };
  });

  ipcMain.handle('cron:get-history', async (_event, jobId?: string) => {
    return cronService.getHistory(jobId);
  });

  // ──────────────── Tools ────────────────
  ipcMain.handle('tools:list', async () => {
    return toolsService.getDefinitions();
  });

  ipcMain.handle('tools:execute', async (_event, name: string, params: any) => {
    try {
      const result = await toolsService.execute(name, params);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // ──────────────── Workflow ────────────────
  ipcMain.handle('workflow:get-activity', async (_event, limit?: number) => {
    return workflowService.getActivityLog(limit || 50);
  });

  ipcMain.handle('workflow:get-patterns', async () => {
    return workflowService.getPatterns();
  });

  ipcMain.handle('workflow:get-time-context', async () => {
    return workflowService.buildTimeContext();
  });

  // ──────────────── RAG ────────────────
  ipcMain.handle('rag:search', async (_event, query: string, topK?: number) => {
    try {
      const results = await ragService.search(query, topK || 5);
      return { success: true, data: results.map((r) => ({ fileName: r.chunk.fileName, section: r.chunk.section, content: r.chunk.content, score: r.score })) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rag:reindex', async () => {
    try {
      // Wire progress reporting to renderer
      ragService.onProgress = (progress) => {
        mainWindow.webContents.send('rag:indexing-progress', progress);
      };
      await ragService.reindex();
      ragService.onProgress = undefined;
      return { success: true, data: ragService.getStats() };
    } catch (error: any) {
      ragService.onProgress = undefined;
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rag:stats', async () => {
    return ragService.getStats();
  });

  ipcMain.handle('rag:add-folder', async (_event, folderPath: string) => {
    try {
      const result = await ragService.addFolder(folderPath);
      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rag:pick-folder', async () => {
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

  ipcMain.handle('rag:remove-folder', async (_event, folderPath: string) => {
    try {
      ragService.removeFolder(folderPath);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rag:get-folders', async () => {
    return ragService.getIndexedFolders();
  });

  ipcMain.handle('rag:folder-stats', async () => {
    return ragService.getFolderStats();
  });

  // ──────────────── Automation ────────────────
  ipcMain.handle('automation:enable', async () => {
    automationService.enable();
    return { success: true };
  });

  ipcMain.handle('automation:disable', async () => {
    automationService.disable();
    return { success: true };
  });

  ipcMain.handle('automation:unlock-safety', async () => {
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

  ipcMain.handle('automation:status', async () => {
    return {
      enabled: automationService.isEnabled(),
      safetyLocked: automationService.isSafetyLocked(),
      takeControlActive: agentLoop.isTakeControlActive(),
    };
  });

  let lastTakeControlTime = 0;
  ipcMain.handle('automation:take-control', async (_event, task: string) => {
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
      mainWindow.webContents.send('ai:stream', { takeControlStart: true, chunk: '🎮 Przejmuję sterowanie...\n' });
      const result = await agentLoop.startTakeControl(
        task,
        (status) => mainWindow.webContents.send('automation:status-update', status),
        (chunk) => mainWindow.webContents.send('ai:stream', { chunk }),
        true // confirmed via dialog above
      );
      mainWindow.webContents.send('ai:stream', { done: true });
      return { success: true, data: result };
    } catch (error: any) {
      mainWindow.webContents.send('ai:stream', { chunk: `\n❌ Błąd: ${error.message}\n` });
      mainWindow.webContents.send('ai:stream', { done: true });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('automation:stop-control', async () => {
    agentLoop.stopTakeControl();
    return { success: true };
  });

  // ──────────────── Browser ────────────────
  ipcMain.handle('browser:status', async () => {
    return { running: browserService.isRunning() };
  });

  ipcMain.handle('browser:close-all', async () => {
    browserService.closeAll();
    return { success: true };
  });

  // ──────────────── Plugins ────────────────
  ipcMain.handle('plugins:list', async () => {
    return pluginService.listPlugins();
  });

  ipcMain.handle('plugins:reload', async () => {
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

  ipcMain.handle('plugins:get-dir', async () => {
    return pluginService.getPluginsDir();
  });

  // ──────────────── Security & Audit ────────────────
  ipcMain.handle('security:audit-log', async (_event, limit?: number) => {
    return securityGuardService.getAuditLog(limit || 50);
  });

  ipcMain.handle('security:stats', async () => {
    return securityGuardService.getSecurityStats();
  });

  // ──────────────── System Monitor ────────────────
  ipcMain.handle('system:snapshot', async () => {
    try {
      return { success: true, data: await systemMonitorService.getSnapshot() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('system:status', async () => {
    return systemMonitorService.getStatusSummary();
  });

  ipcMain.handle('system:warnings', async () => {
    return systemMonitorService.getWarnings();
  });

  // ──────────────── TTS (ElevenLabs / OpenAI / Web Speech fallback) ────────────────
  ipcMain.handle('tts:speak', async (_event, text: string) => {
    try {
      const audioPath = await ttsService.speak(text);
      if (!audioPath) {
        // ElevenLabs + OpenAI both failed or disabled — renderer should use Web Speech API fallback
        return { success: false, fallback: true };
      }
      // Read audio file and return as base64 data URL (file:// protocol blocked by Electron security)
      const fs = await import('fs');
      const audioBuffer = fs.readFileSync(audioPath);
      const base64 = audioBuffer.toString('base64');
      const dataUrl = `data:audio/mpeg;base64,${base64}`;
      // Clean up temp file
      try { fs.unlinkSync(audioPath); } catch { /* non-critical */ }
      return { success: true, audioData: dataUrl };
    } catch (error: any) {
      console.error('[TTS] IPC speak error:', error.message);
      return { success: false, fallback: true, error: error.message };
    }
  });

  ipcMain.handle('tts:stop', async () => {
    ttsService.stop();
    return { success: true };
  });

  ipcMain.handle('tts:get-config', async () => {
    return ttsService.getConfig();
  });

  ipcMain.handle('tts:set-config', async (_event, updates: Record<string, any>) => {
    ttsService.setConfig(updates);
    return { success: true };
  });

  // ──────────────── Bootstrap ────────────────
  ipcMain.handle('bootstrap:is-pending', async () => {
    return memoryService.isBootstrapPending();
  });

  ipcMain.handle('bootstrap:complete', async () => {
    await memoryService.completeBootstrap();
    return { success: true };
  });

  // ──────────────── HEARTBEAT.md ────────────────
  ipcMain.handle('heartbeat:get-config', async () => {
    const content = await memoryService.get('HEARTBEAT.md');
    return { content: content || '' };
  });

  ipcMain.handle('heartbeat:set-config', async (_event, content: string) => {
    await memoryService.set('HEARTBEAT.md', content);
    return { success: true };
  });

  // ──────────────── Meeting Coach ────────────────
  if (services.meetingCoachService) {
    const meetingCoach = services.meetingCoachService;
    const meetingDashboard = services.dashboardServer;

    // Forward meeting events to renderer
    const meetingEvents = ['meeting:state', 'meeting:transcript', 'meeting:coaching', 'meeting:coaching-chunk', 'meeting:coaching-done', 'meeting:error', 'meeting:stop-capture', 'meeting:detected', 'meeting:briefing-updated'];
    for (const event of meetingEvents) {
      meetingCoach.on(event, (data: any) => {
        safeSend(event, data);
      });
    }

    ipcMain.handle('meeting:start', async (_event, title?: string) => {
      try {
        const id = await meetingCoach.startMeeting(title);
        return { success: true, data: { id } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('meeting:stop', async () => {
      try {
        const summary = await meetingCoach.stopMeeting();
        if (summary) {
          return { success: true, data: { id: summary.id, title: summary.title, startTime: summary.startTime, duration: summary.duration, participants: summary.participants } };
        }
        return { success: true, data: null };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('meeting:get-state', async () => {
      return meetingCoach.getState();
    });

    ipcMain.handle('meeting:get-config', async () => {
      return meetingCoach.getConfig();
    });

    ipcMain.handle('meeting:set-config', async (_event, updates: Record<string, any>) => {
      meetingCoach.setConfig(updates);
      return { success: true };
    });

    ipcMain.handle('meeting:get-summaries', async () => {
      return meetingCoach.getSummaries();
    });

    ipcMain.handle('meeting:get-summary', async (_event, id: string) => {
      return meetingCoach.getSummary(id);
    });

    ipcMain.handle('meeting:get-dashboard-url', async () => {
      return meetingDashboard?.getUrl() || `http://localhost:5678`;
    });

    // Audio chunk from renderer (non-invoke, fire-and-forget)
    ipcMain.on('meeting:audio-chunk', (_event, source: string, chunk: Uint8Array | Buffer) => {
      // Renderer sends Uint8Array (safe across context isolation), convert to Buffer for service
      meetingCoach.sendAudioChunk(source as 'mic' | 'system', Buffer.from(chunk));
    });

    // Speaker mapping (non-invoke, fire-and-forget)
    ipcMain.on('meeting:map-speaker', (_event, speakerId: string, name: string) => {
      meetingCoach.mapSpeaker(speakerId, name);
    });

    // Briefing
    ipcMain.handle('meeting:set-briefing', async (_event, briefing: any) => {
      try {
        await meetingCoach.setBriefing(briefing);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle('meeting:get-briefing', async () => {
      return meetingCoach.getBriefing();
    });

    ipcMain.handle('meeting:clear-briefing', async () => {
      meetingCoach.clearBriefing();
      return { success: true };
    });
  }

  // ─── Sub-agents ───

  ipcMain.handle('subagent:spawn', async (_event, task: string, allowedTools?: string[]) => {
    try {
      const id = await agentLoop.getSubAgentManager().spawn({
        task,
        allowedTools: allowedTools || undefined,
        onProgress: (msg) => safeSend('subagent:progress', { msg }),
      });
      return { success: true, data: { id } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('subagent:kill', async (_event, agentId: string) => {
    const killed = agentLoop.getSubAgentManager().kill(agentId);
    return { success: killed };
  });

  ipcMain.handle('subagent:steer', async (_event, agentId: string, instruction: string) => {
    const steered = await agentLoop.getSubAgentManager().steer(agentId, instruction);
    return { success: steered };
  });

  ipcMain.handle('subagent:list', async () => {
    return agentLoop.getSubAgentManager().listActive();
  });

  ipcMain.handle('subagent:results', async () => {
    return agentLoop.getSubAgentManager().consumeCompletedResults();
  });

  // ─── Background Exec ───

  ipcMain.handle('background:exec', async (_event, task: string) => {
    try {
      const id = await agentLoop.executeInBackground(task);
      return { success: true, data: { id } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('background:list', async () => {
    return agentLoop.getBackgroundTasks();
  });

  // ─── Active Hours ───

  ipcMain.handle('agent:set-active-hours', async (_event, start: number | null, end: number | null) => {
    agentLoop.setActiveHours(start, end);
    return { success: true };
  });
}
