import { ipcMain, BrowserWindow, desktopCapturer, screen } from 'electron';
import { ScreenCaptureService } from './services/screen-capture';
import { MemoryService } from './services/memory';
import { AIService } from './services/ai-service';
import { ConfigService } from './services/config';
import { SecurityService } from './services/security';

interface Services {
  configService: ConfigService;
  securityService: SecurityService;
  memoryService: MemoryService;
  aiService: AIService;
  screenCapture: ScreenCaptureService;
}

export function setupIPC(mainWindow: BrowserWindow, services: Services): void {
  const { configService, securityService, memoryService, aiService, screenCapture } = services;

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
      await aiService.streamMessage(message, context, (chunk) => {
        mainWindow.webContents.send('ai:stream', { chunk });
      });
      mainWindow.webContents.send('ai:stream', { done: true });
      return { success: true };
    } catch (error: any) {
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
    screenCapture.startWatching(intervalMs, async (screenshots) => {
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
        async (screenshots) => {
          const analysis = await aiService.analyzeScreens(screenshots);
          if (analysis && analysis.hasInsight) {
            mainWindow.webContents.send('ai:proactive', {
              type: 'screen-analysis',
              message: analysis.message,
              context: analysis.context,
            });
          }
        }
      );
    } else {
      screenCapture.stopWatching();
    }
    return { success: true };
  });

  ipcMain.handle('proactive:get-mode', async () => {
    return configService.get('proactiveMode') || false;
  });
}
