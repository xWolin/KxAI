import { contextBridge, ipcRenderer } from 'electron';

// Expose protected APIs to the renderer process
contextBridge.exposeInMainWorld('kxai', {
  // Chat & AI
  sendMessage: (message: string, context?: string) =>
    ipcRenderer.invoke('ai:send-message', message, context),
  streamMessage: (message: string, context?: string) =>
    ipcRenderer.invoke('ai:stream-message', message, context),
  streamWithScreen: (message: string) =>
    ipcRenderer.invoke('ai:stream-with-screen', message),
  onAIResponse: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:response', handler);
    return () => { ipcRenderer.removeListener('ai:response', handler); };
  },
  onAIStream: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:stream', handler);
    return () => { ipcRenderer.removeListener('ai:stream', handler); };
  },
  onProactiveMessage: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('ai:proactive', handler);
    return () => { ipcRenderer.removeListener('ai:proactive', handler); };
  },

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
  setWindowSize: (width: number, height: number) =>
    ipcRenderer.invoke('window:set-size', width, height),

  // Navigation events
  onNavigate: (callback: (view: string) => void) => {
    const handler = (_event: any, view: string) => callback(view);
    ipcRenderer.on('navigate', handler);
    return () => { ipcRenderer.removeListener('navigate', handler); };
  },

  // File operations
  organizeFiles: (directory: string, rules?: any) =>
    ipcRenderer.invoke('files:organize', directory, rules),
  listFiles: (directory: string) =>
    ipcRenderer.invoke('files:list', directory),

  // Proactive engine
  setProactiveMode: (enabled: boolean) =>
    ipcRenderer.invoke('proactive:set-mode', enabled),
  getProactiveMode: () => ipcRenderer.invoke('proactive:get-mode'),

  // Cron jobs
  getCronJobs: () => ipcRenderer.invoke('cron:get-jobs'),
  addCronJob: (job: any) => ipcRenderer.invoke('cron:add-job', job),
  updateCronJob: (id: string, updates: any) =>
    ipcRenderer.invoke('cron:update-job', id, updates),
  removeCronJob: (id: string) => ipcRenderer.invoke('cron:remove-job', id),
  getCronHistory: (jobId?: string) =>
    ipcRenderer.invoke('cron:get-history', jobId),

  // Tools
  getTools: () => ipcRenderer.invoke('tools:list'),
  executeTool: (name: string, params: any) =>
    ipcRenderer.invoke('tools:execute', name, params),

  // Workflow
  getWorkflowActivity: (limit?: number) =>
    ipcRenderer.invoke('workflow:get-activity', limit),
  getWorkflowPatterns: () => ipcRenderer.invoke('workflow:get-patterns'),
  getTimeContext: () => ipcRenderer.invoke('workflow:get-time-context'),

  // RAG / Semantic Search
  ragSearch: (query: string, topK?: number) =>
    ipcRenderer.invoke('rag:search', query, topK),
  ragReindex: () => ipcRenderer.invoke('rag:reindex'),
  ragStats: () => ipcRenderer.invoke('rag:stats'),

  // Automation
  automationEnable: () => ipcRenderer.invoke('automation:enable'),
  automationDisable: () => ipcRenderer.invoke('automation:disable'),
  automationUnlockSafety: () => ipcRenderer.invoke('automation:unlock-safety'),
  automationStatus: () => ipcRenderer.invoke('automation:status'),
  automationTakeControl: (task: string) =>
    ipcRenderer.invoke('automation:take-control', task),
  automationStopControl: () => ipcRenderer.invoke('automation:stop-control'),
  onAutomationStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('automation:status-update', handler);
    return () => { ipcRenderer.removeListener('automation:status-update', handler); };
  },

  // Browser
  browserListSessions: () => ipcRenderer.invoke('browser:list-sessions'),
  browserCloseAll: () => ipcRenderer.invoke('browser:close-all'),

  // Plugins
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsReload: () => ipcRenderer.invoke('plugins:reload'),
  pluginsGetDir: () => ipcRenderer.invoke('plugins:get-dir'),

  // Security & Audit
  securityAuditLog: (limit?: number) => ipcRenderer.invoke('security:audit-log', limit),
  securityStats: () => ipcRenderer.invoke('security:stats'),

  // System Monitor
  systemSnapshot: () => ipcRenderer.invoke('system:snapshot'),
  systemStatus: () => ipcRenderer.invoke('system:status'),
  systemWarnings: () => ipcRenderer.invoke('system:warnings'),
});
