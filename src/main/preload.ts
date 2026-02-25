import { contextBridge, ipcRenderer } from 'electron';
import { Ch, ChSend, Ev } from '../shared/ipc-schema';

// Expose protected APIs to the renderer process
contextBridge.exposeInMainWorld('kxai', {
  // Chat & AI
  sendMessage: (message: string, context?: string) => ipcRenderer.invoke(Ch.AI_SEND_MESSAGE, message, context),
  streamMessage: (message: string, context?: string) => ipcRenderer.invoke(Ch.AI_STREAM_MESSAGE, message, context),
  streamWithScreen: (message: string) => ipcRenderer.invoke(Ch.AI_STREAM_WITH_SCREEN, message),
  onAIResponse: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.AI_RESPONSE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.AI_RESPONSE, handler);
    };
  },
  onAIStream: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.AI_STREAM, handler);
    return () => {
      ipcRenderer.removeListener(Ev.AI_STREAM, handler);
    };
  },
  onProactiveMessage: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.AI_PROACTIVE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.AI_PROACTIVE, handler);
    };
  },

  // Screen capture
  captureScreen: () => ipcRenderer.invoke(Ch.SCREEN_CAPTURE),
  getDesktopSources: () => ipcRenderer.invoke(Ch.SCREEN_GET_DESKTOP_SOURCES),
  startScreenWatch: (intervalMs: number) => ipcRenderer.invoke(Ch.SCREEN_START_WATCH, intervalMs),
  stopScreenWatch: () => ipcRenderer.invoke(Ch.SCREEN_STOP_WATCH),

  // Memory
  getMemory: (key: string) => ipcRenderer.invoke(Ch.MEMORY_GET, key),
  setMemory: (key: string, value: string) => ipcRenderer.invoke(Ch.MEMORY_SET, key, value),
  getConversationHistory: () => ipcRenderer.invoke(Ch.MEMORY_GET_HISTORY),
  clearConversationHistory: () => ipcRenderer.invoke(Ch.MEMORY_CLEAR_HISTORY),

  // Config
  getConfig: () => ipcRenderer.invoke(Ch.CONFIG_GET),
  setConfig: (key: string, value: any) => ipcRenderer.invoke(Ch.CONFIG_SET, key, value),
  setConfigBatch: (updates: Record<string, any>) => ipcRenderer.invoke(Ch.CONFIG_SET_BATCH, updates),
  isOnboarded: () => ipcRenderer.invoke(Ch.CONFIG_IS_ONBOARDED),
  completeOnboarding: (data: any) => ipcRenderer.invoke(Ch.CONFIG_COMPLETE_ONBOARDING, data),

  // Config change events (push from main process)
  onConfigChanged: (callback: (changes: Record<string, any>) => void) => {
    const handler = (_event: any, changes: any) => callback(changes);
    ipcRenderer.on(Ev.CONFIG_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(Ev.CONFIG_CHANGED, handler);
    };
  },

  // Security
  setApiKey: (provider: string, key: string) => ipcRenderer.invoke(Ch.SECURITY_SET_API_KEY, provider, key),
  hasApiKey: (provider: string) => ipcRenderer.invoke(Ch.SECURITY_HAS_API_KEY, provider),
  deleteApiKey: (provider: string) => ipcRenderer.invoke(Ch.SECURITY_DELETE_API_KEY, provider),

  // Window control
  hideWindow: () => ipcRenderer.invoke(Ch.WINDOW_HIDE),
  minimizeWindow: () => ipcRenderer.invoke(Ch.WINDOW_MINIMIZE),
  setWindowPosition: (x: number, y: number) => ipcRenderer.invoke(Ch.WINDOW_SET_POSITION, x, y),
  getWindowPosition: () => ipcRenderer.invoke(Ch.WINDOW_GET_POSITION),
  setWindowSize: (width: number, height: number) => ipcRenderer.invoke(Ch.WINDOW_SET_SIZE, width, height),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke(Ch.WINDOW_SET_CLICKTHROUGH, enabled),

  // Voice transcription (Whisper)
  transcribeAudio: (audioBase64: string) => ipcRenderer.invoke(Ch.VOICE_TRANSCRIBE, audioBase64),

  // Navigation events
  onNavigate: (callback: (view: string) => void) => {
    const handler = (_event: any, view: string) => callback(view);
    ipcRenderer.on(Ev.NAVIGATE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.NAVIGATE, handler);
    };
  },

  // File operations
  organizeFiles: (directory: string, rules?: any) => ipcRenderer.invoke(Ch.FILES_ORGANIZE, directory, rules),
  listFiles: (directory: string) => ipcRenderer.invoke(Ch.FILES_LIST, directory),

  // Proactive engine
  setProactiveMode: (enabled: boolean) => ipcRenderer.invoke(Ch.PROACTIVE_SET_MODE, enabled),
  getProactiveMode: () => ipcRenderer.invoke(Ch.PROACTIVE_GET_MODE),

  // Cron jobs
  getCronJobs: () => ipcRenderer.invoke(Ch.CRON_GET_JOBS),
  addCronJob: (job: any) => ipcRenderer.invoke(Ch.CRON_ADD_JOB, job),
  updateCronJob: (id: string, updates: any) => ipcRenderer.invoke(Ch.CRON_UPDATE_JOB, id, updates),
  removeCronJob: (id: string) => ipcRenderer.invoke(Ch.CRON_REMOVE_JOB, id),
  getCronHistory: (jobId?: string) => ipcRenderer.invoke(Ch.CRON_GET_HISTORY, jobId),

  // Tools
  getTools: () => ipcRenderer.invoke(Ch.TOOLS_LIST),
  executeTool: (name: string, params: any) => ipcRenderer.invoke(Ch.TOOLS_EXECUTE, name, params),

  // Workflow
  getWorkflowActivity: (limit?: number) => ipcRenderer.invoke(Ch.WORKFLOW_GET_ACTIVITY, limit),
  getWorkflowPatterns: () => ipcRenderer.invoke(Ch.WORKFLOW_GET_PATTERNS),
  getTimeContext: () => ipcRenderer.invoke(Ch.WORKFLOW_GET_TIME_CONTEXT),

  // RAG / Semantic Search
  ragSearch: (query: string, topK?: number) => ipcRenderer.invoke(Ch.RAG_SEARCH, query, topK),
  ragReindex: () => ipcRenderer.invoke(Ch.RAG_REINDEX),
  ragStats: () => ipcRenderer.invoke(Ch.RAG_STATS),
  ragAddFolder: (folderPath: string) => ipcRenderer.invoke(Ch.RAG_ADD_FOLDER, folderPath),
  ragPickFolder: () => ipcRenderer.invoke(Ch.RAG_PICK_FOLDER),
  ragRemoveFolder: (folderPath: string) => ipcRenderer.invoke(Ch.RAG_REMOVE_FOLDER, folderPath),
  ragGetFolders: () => ipcRenderer.invoke(Ch.RAG_GET_FOLDERS),
  ragFolderStats: () => ipcRenderer.invoke(Ch.RAG_FOLDER_STATS),

  // Automation
  automationEnable: () => ipcRenderer.invoke(Ch.AUTOMATION_ENABLE),
  automationDisable: () => ipcRenderer.invoke(Ch.AUTOMATION_DISABLE),
  automationUnlockSafety: () => ipcRenderer.invoke(Ch.AUTOMATION_UNLOCK_SAFETY),
  automationStatus: () => ipcRenderer.invoke(Ch.AUTOMATION_STATUS),
  automationTakeControl: (task: string) => ipcRenderer.invoke(Ch.AUTOMATION_TAKE_CONTROL, task),
  automationStopControl: () => ipcRenderer.invoke(Ch.AUTOMATION_STOP_CONTROL),
  onAutomationStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.AUTOMATION_STATUS_UPDATE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.AUTOMATION_STATUS_UPDATE, handler);
    };
  },
  onControlState: (callback: (data: { active: boolean; pending?: boolean }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.AGENT_CONTROL_STATE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.AGENT_CONTROL_STATE, handler);
    };
  },
  onCompanionState: (callback: (data: { hasSuggestion?: boolean; wantsToSpeak?: boolean }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.AGENT_COMPANION_STATE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.AGENT_COMPANION_STATE, handler);
    };
  },

  // Browser
  browserStatus: () => ipcRenderer.invoke(Ch.BROWSER_STATUS),
  browserCloseAll: () => ipcRenderer.invoke(Ch.BROWSER_CLOSE_ALL),

  // Plugins
  pluginsList: () => ipcRenderer.invoke(Ch.PLUGINS_LIST),
  pluginsReload: () => ipcRenderer.invoke(Ch.PLUGINS_RELOAD),
  pluginsGetDir: () => ipcRenderer.invoke(Ch.PLUGINS_GET_DIR),

  // Security & Audit
  securityAuditLog: (limit?: number) => ipcRenderer.invoke(Ch.SECURITY_AUDIT_LOG, limit),
  securityStats: () => ipcRenderer.invoke(Ch.SECURITY_STATS),

  // System Monitor
  systemSnapshot: () => ipcRenderer.invoke(Ch.SYSTEM_SNAPSHOT),
  systemStatus: () => ipcRenderer.invoke(Ch.SYSTEM_STATUS),
  systemWarnings: () => ipcRenderer.invoke(Ch.SYSTEM_WARNINGS),

  // TTS (Edge TTS)
  ttsSpeak: (text: string) => ipcRenderer.invoke(Ch.TTS_SPEAK, text),
  ttsStop: () => ipcRenderer.invoke(Ch.TTS_STOP),
  ttsGetConfig: () => ipcRenderer.invoke(Ch.TTS_GET_CONFIG),
  ttsSetConfig: (updates: Record<string, any>) => ipcRenderer.invoke(Ch.TTS_SET_CONFIG, updates),

  // Bootstrap
  isBootstrapPending: () => ipcRenderer.invoke(Ch.BOOTSTRAP_IS_PENDING),
  completeBootstrap: () => ipcRenderer.invoke(Ch.BOOTSTRAP_COMPLETE),

  // HEARTBEAT.md
  heartbeatGetConfig: () => ipcRenderer.invoke(Ch.HEARTBEAT_GET_CONFIG),
  heartbeatSetConfig: (content: string) => ipcRenderer.invoke(Ch.HEARTBEAT_SET_CONFIG, content),

  // Meeting Coach
  meetingStart: (title?: string) => ipcRenderer.invoke(Ch.MEETING_START, title),
  meetingStop: () => ipcRenderer.invoke(Ch.MEETING_STOP),
  meetingGetState: () => ipcRenderer.invoke(Ch.MEETING_GET_STATE),
  meetingGetConfig: () => ipcRenderer.invoke(Ch.MEETING_GET_CONFIG),
  meetingSetConfig: (updates: Record<string, any>) => ipcRenderer.invoke(Ch.MEETING_SET_CONFIG, updates),
  meetingGetSummaries: () => ipcRenderer.invoke(Ch.MEETING_GET_SUMMARIES),
  meetingGetSummary: (id: string) => ipcRenderer.invoke(Ch.MEETING_GET_SUMMARY, id),
  meetingGetDashboardUrl: () => ipcRenderer.invoke(Ch.MEETING_GET_DASHBOARD_URL),
  meetingSendAudio: (source: string, chunk: ArrayBuffer) => {
    // Send as Uint8Array — Buffer is not safe across context isolation boundary
    ipcRenderer.send(ChSend.MEETING_AUDIO_CHUNK, source, new Uint8Array(chunk));
  },
  meetingMapSpeaker: (speakerId: string, name: string) => {
    ipcRenderer.send(ChSend.MEETING_MAP_SPEAKER, speakerId, name);
  },
  meetingSetBriefing: (briefing: any) => ipcRenderer.invoke(Ch.MEETING_SET_BRIEFING, briefing),
  meetingGetBriefing: () => ipcRenderer.invoke(Ch.MEETING_GET_BRIEFING),
  meetingClearBriefing: () => ipcRenderer.invoke(Ch.MEETING_CLEAR_BRIEFING),
  onMeetingState: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MEETING_STATE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_STATE, handler);
    };
  },
  onMeetingTranscript: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MEETING_TRANSCRIPT, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_TRANSCRIPT, handler);
    };
  },
  onMeetingCoaching: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MEETING_COACHING, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_COACHING, handler);
    };
  },
  onMeetingCoachingChunk: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MEETING_COACHING_CHUNK, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_COACHING_CHUNK, handler);
    };
  },
  onMeetingCoachingDone: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MEETING_COACHING_DONE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_COACHING_DONE, handler);
    };
  },
  onMeetingError: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MEETING_ERROR, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_ERROR, handler);
    };
  },
  onMeetingStopCapture: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(Ev.MEETING_STOP_CAPTURE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_STOP_CAPTURE, handler);
    };
  },
  onMeetingDetected: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MEETING_DETECTED, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_DETECTED, handler);
    };
  },
  onMeetingBriefingUpdated: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MEETING_BRIEFING_UPDATED, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MEETING_BRIEFING_UPDATED, handler);
    };
  },

  // Sub-agents
  subagentSpawn: (task: string, allowedTools?: string[]) => ipcRenderer.invoke(Ch.SUBAGENT_SPAWN, task, allowedTools),
  subagentKill: (agentId: string) => ipcRenderer.invoke(Ch.SUBAGENT_KILL, agentId),
  subagentSteer: (agentId: string, instruction: string) => ipcRenderer.invoke(Ch.SUBAGENT_STEER, agentId, instruction),
  subagentList: () => ipcRenderer.invoke(Ch.SUBAGENT_LIST),
  subagentResults: () => ipcRenderer.invoke(Ch.SUBAGENT_RESULTS),
  onSubagentProgress: (callback: (data: { msg: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.SUBAGENT_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(Ev.SUBAGENT_PROGRESS, handler);
    };
  },

  // Background exec
  backgroundExec: (task: string) => ipcRenderer.invoke(Ch.BACKGROUND_EXEC, task),
  backgroundList: () => ipcRenderer.invoke(Ch.BACKGROUND_LIST),

  // Active hours
  setActiveHours: (start: number | null, end: number | null) =>
    ipcRenderer.invoke(Ch.AGENT_SET_ACTIVE_HOURS, start, end),

  // Agent status updates
  onAgentStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.AGENT_STATUS, handler);
    return () => {
      ipcRenderer.removeListener(Ev.AGENT_STATUS, handler);
    };
  },

  // Stop agent processing
  agentStop: () => ipcRenderer.invoke(Ch.AGENT_STOP),

  // RAG indexing progress
  onRagProgress: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.RAG_INDEXING_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(Ev.RAG_INDEXING_PROGRESS, handler);
    };
  },

  // Dashboard URL
  getDashboardUrl: () => ipcRenderer.invoke(Ch.DASHBOARD_GET_URL),

  // Updates
  updateCheck: () => ipcRenderer.invoke(Ch.UPDATE_CHECK),
  updateDownload: () => ipcRenderer.invoke(Ch.UPDATE_DOWNLOAD),
  updateInstall: () => ipcRenderer.invoke(Ch.UPDATE_INSTALL),
  updateGetState: () => ipcRenderer.invoke(Ch.UPDATE_GET_STATE),
  onUpdateState: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.UPDATE_STATE, handler);
    return () => {
      ipcRenderer.removeListener(Ev.UPDATE_STATE, handler);
    };
  },

  // MCP Hub
  mcpListServers: () => ipcRenderer.invoke(Ch.MCP_LIST_SERVERS),
  mcpAddServer: (config: any) => ipcRenderer.invoke(Ch.MCP_ADD_SERVER, config),
  mcpRemoveServer: (id: string) => ipcRenderer.invoke(Ch.MCP_REMOVE_SERVER, id),
  mcpConnect: (id: string) => ipcRenderer.invoke(Ch.MCP_CONNECT, id),
  mcpDisconnect: (id: string) => ipcRenderer.invoke(Ch.MCP_DISCONNECT, id),
  mcpReconnect: (id: string) => ipcRenderer.invoke(Ch.MCP_RECONNECT, id),
  mcpGetStatus: () => ipcRenderer.invoke(Ch.MCP_GET_STATUS),
  mcpGetRegistry: () => ipcRenderer.invoke(Ch.MCP_GET_REGISTRY),
  mcpSearchRegistry: (query?: string, category?: string) =>
    ipcRenderer.invoke(Ch.MCP_SEARCH_REGISTRY, query, category),
  mcpGetCategories: () => ipcRenderer.invoke(Ch.MCP_GET_CATEGORIES),
  mcpCallTool: (serverId: string, toolName: string, args: any) =>
    ipcRenderer.invoke(Ch.MCP_CALL_TOOL, serverId, toolName, args),
  onMcpStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.MCP_STATUS, handler);
    return () => {
      ipcRenderer.removeListener(Ev.MCP_STATUS, handler);
    };
  },

  // Calendar (CalDAV)
  calendarGetConnections: () => ipcRenderer.invoke(Ch.CALENDAR_GET_CONNECTIONS),
  calendarAddConnection: (config: any) => ipcRenderer.invoke(Ch.CALENDAR_ADD_CONNECTION, config),
  calendarRemoveConnection: (id: string) => ipcRenderer.invoke(Ch.CALENDAR_REMOVE_CONNECTION, id),
  calendarConnect: (id: string) => ipcRenderer.invoke(Ch.CALENDAR_CONNECT, id),
  calendarDisconnect: (id: string) => ipcRenderer.invoke(Ch.CALENDAR_DISCONNECT, id),
  calendarGetCalendars: (connectionId: string) => ipcRenderer.invoke(Ch.CALENDAR_GET_CALENDARS, connectionId),
  calendarGetStatus: () => ipcRenderer.invoke(Ch.CALENDAR_GET_STATUS),
  calendarStoreCredential: (connectionId: string, password: string) =>
    ipcRenderer.invoke(Ch.CALENDAR_STORE_CREDENTIAL, connectionId, password),
  onCalendarStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(Ev.CALENDAR_STATUS, handler);
    return () => {
      ipcRenderer.removeListener(Ev.CALENDAR_STATUS, handler);
    };
  },

  // Privacy & GDPR
  privacyGetSummary: () => ipcRenderer.invoke(Ch.PRIVACY_GET_SUMMARY),
  privacyExportData: (options?: any) => ipcRenderer.invoke(Ch.PRIVACY_EXPORT_DATA, options),
  privacyDeleteData: (options?: any) => ipcRenderer.invoke(Ch.PRIVACY_DELETE_DATA, options),

  // Clipboard
  clipboardGetStatus: () => ipcRenderer.invoke(Ch.CLIPBOARD_GET_STATUS),
  clipboardStartMonitoring: () => ipcRenderer.invoke(Ch.CLIPBOARD_START_MONITORING),
  clipboardStopMonitoring: () => ipcRenderer.invoke(Ch.CLIPBOARD_STOP_MONITORING),
  clipboardGetHistory: (limit?: number) => ipcRenderer.invoke(Ch.CLIPBOARD_GET_HISTORY, limit),
  clipboardSearch: (options: any) => ipcRenderer.invoke(Ch.CLIPBOARD_SEARCH, options),
  clipboardTogglePin: (entryId: string) => ipcRenderer.invoke(Ch.CLIPBOARD_TOGGLE_PIN, entryId),
  clipboardDeleteEntry: (entryId: string) => ipcRenderer.invoke(Ch.CLIPBOARD_DELETE_ENTRY, entryId),
  clipboardClearHistory: () => ipcRenderer.invoke(Ch.CLIPBOARD_CLEAR_HISTORY),
});
