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
  ragAddFolder: (folderPath: string) =>
    ipcRenderer.invoke('rag:add-folder', folderPath),
  ragPickFolder: () => ipcRenderer.invoke('rag:pick-folder'),
  ragRemoveFolder: (folderPath: string) =>
    ipcRenderer.invoke('rag:remove-folder', folderPath),
  ragGetFolders: () => ipcRenderer.invoke('rag:get-folders'),
  ragFolderStats: () => ipcRenderer.invoke('rag:folder-stats'),

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
  onControlState: (callback: (data: { active: boolean; pending?: boolean }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:control-state', handler);
    return () => { ipcRenderer.removeListener('agent:control-state', handler); };
  },
  onCompanionState: (callback: (data: { hasSuggestion?: boolean; wantsToSpeak?: boolean }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:companion-state', handler);
    return () => { ipcRenderer.removeListener('agent:companion-state', handler); };
  },

  // Browser
  browserStatus: () => ipcRenderer.invoke('browser:status'),
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

  // TTS (Edge TTS)
  ttsSpeak: (text: string) => ipcRenderer.invoke('tts:speak', text),
  ttsStop: () => ipcRenderer.invoke('tts:stop'),
  ttsGetConfig: () => ipcRenderer.invoke('tts:get-config'),
  ttsSetConfig: (updates: Record<string, any>) => ipcRenderer.invoke('tts:set-config', updates),

  // Bootstrap
  isBootstrapPending: () => ipcRenderer.invoke('bootstrap:is-pending'),
  completeBootstrap: () => ipcRenderer.invoke('bootstrap:complete'),

  // HEARTBEAT.md
  heartbeatGetConfig: () => ipcRenderer.invoke('heartbeat:get-config'),
  heartbeatSetConfig: (content: string) => ipcRenderer.invoke('heartbeat:set-config', content),

  // Meeting Coach
  meetingStart: (title?: string) => ipcRenderer.invoke('meeting:start', title),
  meetingStop: () => ipcRenderer.invoke('meeting:stop'),
  meetingGetState: () => ipcRenderer.invoke('meeting:get-state'),
  meetingGetConfig: () => ipcRenderer.invoke('meeting:get-config'),
  meetingSetConfig: (updates: Record<string, any>) => ipcRenderer.invoke('meeting:set-config', updates),
  meetingGetSummaries: () => ipcRenderer.invoke('meeting:get-summaries'),
  meetingGetSummary: (id: string) => ipcRenderer.invoke('meeting:get-summary', id),
  meetingGetDashboardUrl: () => ipcRenderer.invoke('meeting:get-dashboard-url'),
  meetingSendAudio: (source: string, chunk: ArrayBuffer) => {
    ipcRenderer.send('meeting:audio-chunk', source, Buffer.from(chunk));
  },
  meetingMapSpeaker: (speakerId: string, name: string) => {
    ipcRenderer.send('meeting:map-speaker', speakerId, name);
  },
  meetingSetBriefing: (briefing: any) => ipcRenderer.invoke('meeting:set-briefing', briefing),
  meetingGetBriefing: () => ipcRenderer.invoke('meeting:get-briefing'),
  meetingClearBriefing: () => ipcRenderer.invoke('meeting:clear-briefing'),
  onMeetingState: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting:state', handler);
    return () => { ipcRenderer.removeListener('meeting:state', handler); };
  },
  onMeetingTranscript: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting:transcript', handler);
    return () => { ipcRenderer.removeListener('meeting:transcript', handler); };
  },
  onMeetingCoaching: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting:coaching', handler);
    return () => { ipcRenderer.removeListener('meeting:coaching', handler); };
  },
  onMeetingCoachingChunk: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting:coaching-chunk', handler);
    return () => { ipcRenderer.removeListener('meeting:coaching-chunk', handler); };
  },
  onMeetingCoachingDone: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting:coaching-done', handler);
    return () => { ipcRenderer.removeListener('meeting:coaching-done', handler); };
  },
  onMeetingError: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting:error', handler);
    return () => { ipcRenderer.removeListener('meeting:error', handler); };
  },
  onMeetingStopCapture: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('meeting:stop-capture', handler);
    return () => { ipcRenderer.removeListener('meeting:stop-capture', handler); };
  },
  onMeetingDetected: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting:detected', handler);
    return () => { ipcRenderer.removeListener('meeting:detected', handler); };
  },
  onMeetingBriefingUpdated: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('meeting:briefing-updated', handler);
    return () => { ipcRenderer.removeListener('meeting:briefing-updated', handler); };
  },

  // Sub-agents
  subagentSpawn: (task: string, allowedTools?: string[]) =>
    ipcRenderer.invoke('subagent:spawn', task, allowedTools),
  subagentKill: (agentId: string) =>
    ipcRenderer.invoke('subagent:kill', agentId),
  subagentSteer: (agentId: string, instruction: string) =>
    ipcRenderer.invoke('subagent:steer', agentId, instruction),
  subagentList: () =>
    ipcRenderer.invoke('subagent:list'),
  subagentResults: () =>
    ipcRenderer.invoke('subagent:results'),
  onSubagentProgress: (callback: (data: { msg: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('subagent:progress', handler);
    return () => { ipcRenderer.removeListener('subagent:progress', handler); };
  },

  // Background exec
  backgroundExec: (task: string) =>
    ipcRenderer.invoke('background:exec', task),
  backgroundList: () =>
    ipcRenderer.invoke('background:list'),

  // Active hours
  setActiveHours: (start: number | null, end: number | null) =>
    ipcRenderer.invoke('agent:set-active-hours', start, end),

  // Agent status updates
  onAgentStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('agent:status', handler);
    return () => { ipcRenderer.removeListener('agent:status', handler); };
  },

  // RAG indexing progress
  onRagProgress: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('rag:indexing-progress', handler);
    return () => { ipcRenderer.removeListener('rag:indexing-progress', handler); };
  },

  // Dashboard URL
  getDashboardUrl: () => ipcRenderer.invoke('dashboard:get-url'),
});
