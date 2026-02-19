import { ipcMain, BrowserWindow, desktopCapturer, screen } from 'electron';
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
}

export function setupIPC(mainWindow: BrowserWindow, services: Services): void {
  const { configService, securityService, memoryService, aiService, screenCapture, cronService, toolsService, workflowService, agentLoop, ragService, automationService, browserService, pluginService, securityGuardService, systemMonitorService } = services;

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
        mainWindow.webContents.send('ai:stream', { done: true });
        return { success: false, error: 'Nie udało się przechwycić ekranu' };
      }

      // Build vision message with screenshots
      await aiService.streamMessageWithScreenshots(message, screenshots, (chunk: string) => {
        mainWindow.webContents.send('ai:stream', { chunk });
      });
      mainWindow.webContents.send('ai:stream', { done: true });
      return { success: true };
    } catch (error: any) {
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
    const fs = require('fs');
    const p = require('path');
    try {
      const items = fs.readdirSync(directory, { withFileTypes: true });
      return items.map((item: any) => ({
        name: item.name,
        isDirectory: item.isDirectory(),
        path: p.join(directory, item.name),
      }));
    } catch (error: any) {
      return [];
    }
  });

  // ──────────────── Proactive Engine ────────────────
  ipcMain.handle('proactive:set-mode', async (_event, enabled: boolean) => {
    configService.set('proactiveMode', enabled);
    if (enabled) {
      screenCapture.startWatching(
        configService.get('proactiveIntervalMs') || 30000,
        async (screenshots: ScreenshotData[]) => {
          const analysis = await aiService.analyzeScreens(screenshots);
          if (analysis && analysis.hasInsight) {
            // Log to workflow service
            agentLoop.logScreenActivity(analysis.context, analysis.message);

            mainWindow.webContents.send('ai:proactive', {
              type: 'screen-analysis',
              message: analysis.message,
              context: analysis.context,
            });
          }
        }
      );

      // Start heartbeat for autonomous operations
      agentLoop.startHeartbeat(15 * 60 * 1000); // 15 min
    } else {
      screenCapture.stopWatching();
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
      await ragService.reindex();
      return { success: true, data: ragService.getStats() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('rag:stats', async () => {
    return ragService.getStats();
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
    automationService.unlockSafety();
    return { success: true };
  });

  ipcMain.handle('automation:status', async () => {
    return {
      enabled: automationService.isEnabled(),
      safetyLocked: automationService.isSafetyLocked(),
      takeControlActive: agentLoop.isTakeControlActive(),
    };
  });

  ipcMain.handle('automation:take-control', async (_event, task: string) => {
    try {
      const result = await agentLoop.startTakeControl(
        task,
        (status) => mainWindow.webContents.send('automation:status-update', status),
        (chunk) => mainWindow.webContents.send('ai:stream', { chunk })
      );
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('automation:stop-control', async () => {
    agentLoop.stopTakeControl();
    return { success: true };
  });

  // ──────────────── Browser ────────────────
  ipcMain.handle('browser:list-sessions', async () => {
    return browserService.listSessions();
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
}
