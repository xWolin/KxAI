/**
 * Central IPC channel definitions — single source of truth.
 *
 * All IPC channel names are defined here as constants.
 * Both main process (ipc.ts) and preload (preload.ts) import from this file.
 * This prevents typos and ensures channel names stay in sync.
 *
 * Convention: Channels use `namespace:action` format.
 * - Handle channels → ipcMain.handle / ipcRenderer.invoke (request-response)
 * - Event channels  → webContents.send / ipcRenderer.on   (main → renderer push)
 * - Send channels   → ipcRenderer.send / ipcMain.on       (renderer → main fire-and-forget)
 */

// ─── Handle Channels (request-response) ───

export const Ch = {
  // AI & Chat
  AI_SEND_MESSAGE: 'ai:send-message',
  AI_STREAM_MESSAGE: 'ai:stream-message',
  AI_STREAM_WITH_SCREEN: 'ai:stream-with-screen',

  // Agent
  AGENT_STOP: 'agent:stop',
  AGENT_SET_ACTIVE_HOURS: 'agent:set-active-hours',

  // Screen
  SCREEN_CAPTURE: 'screen:capture',
  SCREEN_GET_DESKTOP_SOURCES: 'screen:get-desktop-sources',
  SCREEN_START_WATCH: 'screen:start-watch',
  SCREEN_STOP_WATCH: 'screen:stop-watch',

  // Memory
  MEMORY_GET: 'memory:get',
  MEMORY_SET: 'memory:set',
  MEMORY_GET_HISTORY: 'memory:get-history',
  MEMORY_CLEAR_HISTORY: 'memory:clear-history',

  // Config
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_IS_ONBOARDED: 'config:is-onboarded',
  CONFIG_COMPLETE_ONBOARDING: 'config:complete-onboarding',

  // Security
  SECURITY_SET_API_KEY: 'security:set-api-key',
  SECURITY_HAS_API_KEY: 'security:has-api-key',
  SECURITY_DELETE_API_KEY: 'security:delete-api-key',
  SECURITY_AUDIT_LOG: 'security:audit-log',
  SECURITY_STATS: 'security:stats',

  // Window
  WINDOW_HIDE: 'window:hide',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_SET_POSITION: 'window:set-position',
  WINDOW_GET_POSITION: 'window:get-position',
  WINDOW_SET_SIZE: 'window:set-size',
  WINDOW_SET_CLICKTHROUGH: 'window:set-clickthrough',

  // Voice
  VOICE_TRANSCRIBE: 'voice:transcribe',

  // Files
  FILES_ORGANIZE: 'files:organize',
  FILES_LIST: 'files:list',

  // Proactive
  PROACTIVE_SET_MODE: 'proactive:set-mode',
  PROACTIVE_GET_MODE: 'proactive:get-mode',

  // Cron
  CRON_GET_JOBS: 'cron:get-jobs',
  CRON_ADD_JOB: 'cron:add-job',
  CRON_UPDATE_JOB: 'cron:update-job',
  CRON_REMOVE_JOB: 'cron:remove-job',
  CRON_GET_HISTORY: 'cron:get-history',

  // Tools
  TOOLS_LIST: 'tools:list',
  TOOLS_EXECUTE: 'tools:execute',

  // Workflow
  WORKFLOW_GET_ACTIVITY: 'workflow:get-activity',
  WORKFLOW_GET_PATTERNS: 'workflow:get-patterns',
  WORKFLOW_GET_TIME_CONTEXT: 'workflow:get-time-context',

  // RAG
  RAG_SEARCH: 'rag:search',
  RAG_REINDEX: 'rag:reindex',
  RAG_STATS: 'rag:stats',
  RAG_ADD_FOLDER: 'rag:add-folder',
  RAG_PICK_FOLDER: 'rag:pick-folder',
  RAG_REMOVE_FOLDER: 'rag:remove-folder',
  RAG_GET_FOLDERS: 'rag:get-folders',
  RAG_FOLDER_STATS: 'rag:folder-stats',

  // Automation
  AUTOMATION_ENABLE: 'automation:enable',
  AUTOMATION_DISABLE: 'automation:disable',
  AUTOMATION_UNLOCK_SAFETY: 'automation:unlock-safety',
  AUTOMATION_STATUS: 'automation:status',
  AUTOMATION_TAKE_CONTROL: 'automation:take-control',
  AUTOMATION_STOP_CONTROL: 'automation:stop-control',

  // Browser
  BROWSER_STATUS: 'browser:status',
  BROWSER_CLOSE_ALL: 'browser:close-all',

  // Plugins
  PLUGINS_LIST: 'plugins:list',
  PLUGINS_RELOAD: 'plugins:reload',
  PLUGINS_GET_DIR: 'plugins:get-dir',

  // System
  SYSTEM_SNAPSHOT: 'system:snapshot',
  SYSTEM_STATUS: 'system:status',
  SYSTEM_WARNINGS: 'system:warnings',

  // TTS
  TTS_SPEAK: 'tts:speak',
  TTS_STOP: 'tts:stop',
  TTS_GET_CONFIG: 'tts:get-config',
  TTS_SET_CONFIG: 'tts:set-config',

  // Bootstrap
  BOOTSTRAP_IS_PENDING: 'bootstrap:is-pending',
  BOOTSTRAP_COMPLETE: 'bootstrap:complete',

  // Heartbeat
  HEARTBEAT_GET_CONFIG: 'heartbeat:get-config',
  HEARTBEAT_SET_CONFIG: 'heartbeat:set-config',

  // Meeting
  MEETING_START: 'meeting:start',
  MEETING_STOP: 'meeting:stop',
  MEETING_GET_STATE: 'meeting:get-state',
  MEETING_GET_CONFIG: 'meeting:get-config',
  MEETING_SET_CONFIG: 'meeting:set-config',
  MEETING_GET_SUMMARIES: 'meeting:get-summaries',
  MEETING_GET_SUMMARY: 'meeting:get-summary',
  MEETING_GET_DASHBOARD_URL: 'meeting:get-dashboard-url',
  MEETING_SET_BRIEFING: 'meeting:set-briefing',
  MEETING_GET_BRIEFING: 'meeting:get-briefing',
  MEETING_CLEAR_BRIEFING: 'meeting:clear-briefing',

  // Sub-agents
  SUBAGENT_SPAWN: 'subagent:spawn',
  SUBAGENT_KILL: 'subagent:kill',
  SUBAGENT_STEER: 'subagent:steer',
  SUBAGENT_LIST: 'subagent:list',
  SUBAGENT_RESULTS: 'subagent:results',

  // Background
  BACKGROUND_EXEC: 'background:exec',
  BACKGROUND_LIST: 'background:list',

  // Dashboard
  DASHBOARD_GET_URL: 'dashboard:get-url',
} as const;

// ─── Send Channels (renderer → main, fire-and-forget) ───

export const ChSend = {
  MEETING_AUDIO_CHUNK: 'meeting:audio-chunk',
  MEETING_MAP_SPEAKER: 'meeting:map-speaker',
} as const;

// ─── Event Channels (main → renderer push) ───

export const Ev = {
  AI_STREAM: 'ai:stream',
  AI_RESPONSE: 'ai:response',
  AI_PROACTIVE: 'ai:proactive',
  AGENT_STATUS: 'agent:status',
  AGENT_CONTROL_STATE: 'agent:control-state',
  AGENT_COMPANION_STATE: 'agent:companion-state',
  RAG_INDEXING_PROGRESS: 'rag:indexing-progress',
  AUTOMATION_STATUS_UPDATE: 'automation:status-update',
  MEETING_STATE: 'meeting:state',
  MEETING_TRANSCRIPT: 'meeting:transcript',
  MEETING_COACHING: 'meeting:coaching',
  MEETING_COACHING_CHUNK: 'meeting:coaching-chunk',
  MEETING_COACHING_DONE: 'meeting:coaching-done',
  MEETING_ERROR: 'meeting:error',
  MEETING_STOP_CAPTURE: 'meeting:stop-capture',
  MEETING_DETECTED: 'meeting:detected',
  MEETING_BRIEFING_UPDATED: 'meeting:briefing-updated',
  SUBAGENT_PROGRESS: 'subagent:progress',
  NAVIGATE: 'navigate',
} as const;

// ─── Type helpers ───

/** All handle channel names */
export type HandleChannel = typeof Ch[keyof typeof Ch];
/** All send channel names */
export type SendChannel = typeof ChSend[keyof typeof ChSend];
/** All event channel names */
export type EventChannel = typeof Ev[keyof typeof Ev];
/** All channel names */
export type AnyChannel = HandleChannel | SendChannel | EventChannel;
