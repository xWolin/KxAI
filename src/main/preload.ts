import { contextBridge, ipcRenderer } from 'electron';

// Expose protected APIs to the renderer process
contextBridge.exposeInMainWorld('kxai', {
  // Chat & AI
  sendMessage: (message: string, context?: string) =>
    ipcRenderer.invoke('ai:send-message', message, context),
  streamMessage: (message: string, context?: string) =>
    ipcRenderer.invoke('ai:stream-message', message, context),
  onAIResponse: (callback: (data: any) => void) =>
    ipcRenderer.on('ai:response', (_event, data) => callback(data)),
  onAIStream: (callback: (data: any) => void) =>
    ipcRenderer.on('ai:stream', (_event, data) => callback(data)),
  onProactiveMessage: (callback: (data: any) => void) =>
    ipcRenderer.on('ai:proactive', (_event, data) => callback(data)),

  // Screen capture
  captureScreen: () => ipcRenderer.invoke('screen:capture'),
  startScreenWatch: (intervalMs: number) =>
    ipcRenderer.invoke('screen:start-watch', intervalMs),
  stopScreenWatch: () => ipcRenderer.invoke('screen:stop-watch'),

  // Memory
  getMemory: (key: string) => ipcRenderer.invoke('memory:get', key),
  setMemory: (key: string, value: string) =>
    ipcRenderer.invoke('memory:set', key, value),
  getConversationHistory: () => ipcRenderer.invoke('memory:get-history'),
  clearConversationHistory: () => ipcRenderer.invoke('memory:clear-history'),

  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key: string, value: any) =>
    ipcRenderer.invoke('config:set', key, value),
  isOnboarded: () => ipcRenderer.invoke('config:is-onboarded'),
  completeOnboarding: (data: any) =>
    ipcRenderer.invoke('config:complete-onboarding', data),

  // Security
  setApiKey: (provider: string, key: string) =>
    ipcRenderer.invoke('security:set-api-key', provider, key),
  hasApiKey: (provider: string) =>
    ipcRenderer.invoke('security:has-api-key', provider),
  deleteApiKey: (provider: string) =>
    ipcRenderer.invoke('security:delete-api-key', provider),

  // Window control
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  setWindowPosition: (x: number, y: number) =>
    ipcRenderer.invoke('window:set-position', x, y),
  getWindowPosition: () => ipcRenderer.invoke('window:get-position'),

  // Navigation events
  onNavigate: (callback: (view: string) => void) =>
    ipcRenderer.on('navigate', (_event, view) => callback(view)),

  // File operations
  organizeFiles: (directory: string, rules?: any) =>
    ipcRenderer.invoke('files:organize', directory, rules),
  listFiles: (directory: string) =>
    ipcRenderer.invoke('files:list', directory),

  // Proactive engine
  setProactiveMode: (enabled: boolean) =>
    ipcRenderer.invoke('proactive:set-mode', enabled),
  getProactiveMode: () => ipcRenderer.invoke('proactive:get-mode'),
});
