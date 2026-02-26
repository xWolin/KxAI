// Type definitions for the KxAI preload bridge

export interface KxAIBridge {
  // Chat & AI
  sendMessage: (message: string, context?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  streamMessage: (message: string, context?: string) => Promise<{ success: boolean; error?: string }>;
  streamWithScreen: (message: string) => Promise<{ success: boolean; error?: string }>;
  onAIResponse: (callback: (data: any) => void) => () => void;
  onAIStream: (callback: (data: { chunk?: string; done?: boolean; takeControlStart?: boolean }) => void) => () => void;
  onProactiveMessage: (callback: (data: ProactiveMessage) => void) => () => void;

  // Screen capture
  captureScreen: () => Promise<{ success: boolean; data?: any[]; error?: string }>;
  getDesktopSources: () => Promise<{ success: boolean; data?: Array<{ id: string; name: string }>; error?: string }>;
  startScreenWatch: (intervalMs: number) => Promise<{ success: boolean }>;
  stopScreenWatch: () => Promise<{ success: boolean }>;

  // Memory
  getMemory: (key: string) => Promise<string | null>;
  setMemory: (key: string, value: string) => Promise<{ success: boolean }>;
  getConversationHistory: () => Promise<ConversationMessage[]>;
  clearConversationHistory: () => Promise<{ success: boolean }>;

  // Config
  getConfig: () => Promise<KxAIConfig>;
  setConfig: (key: string, value: any) => Promise<{ success: boolean }>;
  setConfigBatch: (updates: Partial<KxAIConfig>) => Promise<{ success: boolean }>;
  isOnboarded: () => Promise<boolean>;
  completeOnboarding: (data: OnboardingData) => Promise<{ success: boolean }>;
  onConfigChanged: (callback: (changes: Partial<KxAIConfig>) => void) => () => void;

  // Security
  setApiKey: (provider: string, key: string) => Promise<{ success: boolean }>;
  hasApiKey: (provider: string) => Promise<boolean>;
  deleteApiKey: (provider: string) => Promise<{ success: boolean }>;

  // Window control
  hideWindow: () => Promise<void>;
  minimizeWindow: () => Promise<void>;
  setWindowPosition: (x: number, y: number) => Promise<void>;
  getWindowPosition: () => Promise<[number, number]>;
  setWindowSize: (width: number, height: number) => Promise<void>;
  setClickThrough: (enabled: boolean) => Promise<void>;

  // Voice transcription (Whisper)
  transcribeAudio: (audioBase64: string) => Promise<{ success: boolean; text?: string; error?: string }>;

  // Navigation
  onNavigate: (callback: (view: string) => void) => () => void;

  // File operations
  organizeFiles: (directory: string, rules?: any) => Promise<{ success: boolean; data?: any }>;
  listFiles: (directory: string) => Promise<any[]>;

  // Proactive
  setProactiveMode: (enabled: boolean) => Promise<{ success: boolean }>;
  getProactiveMode: () => Promise<boolean>;
  sendProactiveFeedback: (
    ruleId: string,
    action: 'accepted' | 'dismissed' | 'replied',
  ) => Promise<{ success: boolean }>;
  getProactiveStats: () => Promise<any>;

  // Cron jobs
  getCronJobs: () => Promise<CronJob[]>;
  addCronJob: (
    job: Omit<CronJob, 'id' | 'createdAt' | 'runCount'>,
  ) => Promise<{ success: boolean; data?: CronJob; error?: string }>;
  updateCronJob: (
    id: string,
    updates: Partial<CronJob>,
  ) => Promise<{ success: boolean; data?: CronJob; error?: string }>;
  removeCronJob: (id: string) => Promise<{ success: boolean }>;
  getCronHistory: (jobId?: string) => Promise<CronExecution[]>;

  // Tools
  getTools: () => Promise<ToolDefinition[]>;
  executeTool: (name: string, params: any) => Promise<{ success: boolean; data?: any; error?: string }>;

  // Workflow
  getWorkflowActivity: (limit?: number) => Promise<ActivityEntry[]>;
  getWorkflowPatterns: () => Promise<WorkflowPattern[]>;
  getTimeContext: () => Promise<string>;

  // Workflow Automator (Macros)
  listMacros: () => Promise<WorkflowMacro[]>;
  getMacro: (macroId: string) => Promise<WorkflowMacro | null>;
  deleteMacro: (macroId: string) => Promise<boolean>;
  renameMacro: (macroId: string, newName: string) => Promise<boolean>;
  getMacroRecordingState: () => Promise<WorkflowRecordingState>;
  startMacroRecording: (name: string) => Promise<{ success: boolean; error?: string }>;
  stopMacroRecording: (description?: string) => Promise<WorkflowMacro | null>;
  replayMacro: (macroId: string, params?: string, stopOnError?: boolean) => Promise<WorkflowReplayResult>;

  // RAG / Semantic Search
  ragSearch: (query: string, topK?: number) => Promise<{ success: boolean; data?: RAGSearchResult[]; error?: string }>;
  ragReindex: () => Promise<{ success: boolean; data?: RAGStats; error?: string }>;
  ragStats: () => Promise<RAGStats>;
  ragAddFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  ragPickFolder: () => Promise<{ success: boolean; error?: string }>;
  ragRemoveFolder: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  ragGetFolders: () => Promise<string[]>;
  ragFolderStats: () => Promise<RAGFolderInfo[]>;

  // Automation
  automationEnable: () => Promise<{ success: boolean }>;
  automationDisable: () => Promise<{ success: boolean }>;
  automationUnlockSafety: () => Promise<{ success: boolean }>;
  automationStatus: () => Promise<AutomationStatus>;
  automationTakeControl: (task: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  automationStopControl: () => Promise<{ success: boolean }>;
  onAutomationStatus: (callback: (data: AutomationStatus) => void) => () => void;
  onControlState: (callback: (data: { active: boolean; pending?: boolean }) => void) => () => void;

  // Companion (smart monitor) states
  onCompanionState: (callback: (data: { hasSuggestion?: boolean; wantsToSpeak?: boolean }) => void) => () => void;

  // Browser
  browserStatus: () => Promise<{ running: boolean }>;
  browserCloseAll: () => Promise<{ success: boolean }>;

  // Plugins
  pluginsList: () => Promise<PluginInfo[]>;
  pluginsReload: () => Promise<{ success: boolean; data?: PluginInfo[] }>;
  pluginsGetDir: () => Promise<string>;

  // Security & Audit
  securityAuditLog: (limit?: number) => Promise<AuditEntry[]>;
  securityStats: () => Promise<SecurityStats>;

  // System Monitor
  systemSnapshot: () => Promise<{ success: boolean; data?: SystemSnapshot; error?: string }>;
  systemStatus: () => Promise<string>;
  systemWarnings: () => Promise<string[]>;

  // TTS (Edge TTS)
  ttsSpeak: (text: string) => Promise<{ success: boolean; audioData?: string; fallback?: boolean; error?: string }>;
  ttsStop: () => Promise<{ success: boolean }>;
  ttsGetConfig: () => Promise<TTSConfig>;
  ttsSetConfig: (updates: Partial<TTSConfig>) => Promise<{ success: boolean }>;

  // Bootstrap
  isBootstrapPending: () => Promise<boolean>;
  completeBootstrap: () => Promise<{ success: boolean }>;

  // HEARTBEAT.md
  heartbeatGetConfig: () => Promise<{ content: string }>;
  heartbeatSetConfig: (content: string) => Promise<{ success: boolean }>;

  // Meeting Coach
  meetingStart: (title?: string) => Promise<{ success: boolean; data?: { id: string }; error?: string }>;
  meetingStop: () => Promise<{ success: boolean; data?: MeetingSummaryMeta; error?: string }>;
  meetingGetState: () => Promise<MeetingStateInfo>;
  meetingGetConfig: () => Promise<MeetingCoachConfig>;
  meetingSetConfig: (updates: Partial<MeetingCoachConfig>) => Promise<{ success: boolean }>;
  meetingGetSummaries: () => Promise<MeetingSummaryMeta[]>;
  meetingGetSummary: (id: string) => Promise<MeetingSummaryFull | null>;
  meetingGetDashboardUrl: () => Promise<string>;
  meetingSendAudio: (source: 'mic' | 'system', chunk: ArrayBuffer) => void;
  meetingMapSpeaker: (speakerId: string, name: string) => void;
  meetingSetBriefing: (briefing: MeetingBriefingInfo) => Promise<{ success: boolean; error?: string }>;
  meetingGetBriefing: () => Promise<MeetingBriefingInfo | null>;
  meetingClearBriefing: () => Promise<{ success: boolean }>;
  onMeetingState: (callback: (state: MeetingStateInfo) => void) => () => void;
  onMeetingTranscript: (callback: (data: any) => void) => () => void;
  onMeetingCoaching: (callback: (tip: MeetingCoachingTip) => void) => () => void;
  onMeetingCoachingChunk: (callback: (data: { id: string; chunk: string; fullText: string }) => void) => () => void;
  onMeetingCoachingDone: (
    callback: (data: { id: string; tip: string; category: string; questionText?: string }) => void,
  ) => () => void;
  onMeetingError: (callback: (data: { error: string }) => void) => () => void;
  onMeetingStopCapture: (callback: () => void) => () => void;
  onMeetingDetected: (callback: (data: { app: string; title: string }) => void) => () => void;
  onMeetingBriefingUpdated: (callback: (briefing: MeetingBriefingInfo | null) => void) => () => void;

  // Sub-agents
  subagentSpawn: (
    task: string,
    allowedTools?: string[],
  ) => Promise<{ success: boolean; data?: { id: string }; error?: string }>;
  subagentKill: (agentId: string) => Promise<{ success: boolean }>;
  subagentSteer: (agentId: string, instruction: string) => Promise<{ success: boolean }>;
  subagentList: () => Promise<SubAgentInfo[]>;
  subagentResults: () => Promise<SubAgentResult[]>;
  onSubagentProgress: (callback: (data: { msg: string }) => void) => () => void;

  // Background exec
  backgroundExec: (task: string) => Promise<{ success: boolean; data?: { id: string }; error?: string }>;
  backgroundList: () => Promise<BackgroundTaskInfo[]>;

  // Active hours
  setActiveHours: (start: number | null, end: number | null) => Promise<{ success: boolean }>;

  // Agent status updates
  onAgentStatus: (callback: (data: AgentStatus) => void) => () => void;

  // Stop agent processing
  agentStop: () => Promise<{ success: boolean }>;

  // RAG indexing progress
  onRagProgress: (callback: (data: IndexProgress) => void) => () => void;

  // Dashboard
  getDashboardUrl: () => Promise<string>;

  // Updates
  updateCheck: () => Promise<UpdateState>;
  updateDownload: () => Promise<{ success: boolean }>;
  updateInstall: () => Promise<{ success: boolean }>;
  updateGetState: () => Promise<UpdateState>;
  onUpdateState: (callback: (state: UpdateState) => void) => () => void;
  appVersion: string;

  // MCP Hub
  mcpListServers: () => Promise<import('@shared/types').McpServerConfig[]>;
  mcpAddServer: (
    config: Omit<import('@shared/types').McpServerConfig, 'id'>,
  ) => Promise<import('@shared/types').McpServerConfig>;
  mcpRemoveServer: (id: string) => Promise<{ success: boolean }>;
  mcpConnect: (id: string) => Promise<{ success: boolean }>;
  mcpDisconnect: (id: string) => Promise<{ success: boolean }>;
  mcpReconnect: (id: string) => Promise<{ success: boolean }>;
  mcpGetStatus: () => Promise<import('@shared/types').McpHubStatus>;
  mcpGetRegistry: () => Promise<import('@shared/types').McpRegistryEntry[]>;
  mcpSearchRegistry: (query?: string, category?: string) => Promise<import('@shared/types').McpRegistryEntry[]>;
  mcpGetCategories: () => Promise<import('@shared/types').McpCategory[]>;
  mcpCallTool: (serverId: string, toolName: string, args: any) => Promise<import('@shared/types').ToolResult>;
  onMcpStatus: (callback: (status: import('@shared/types').McpHubStatus) => void) => () => void;

  // Calendar (CalDAV)
  calendarGetConnections: () => Promise<import('@shared/types').CalendarStatus>;
  calendarAddConnection: (
    config: Omit<import('@shared/types').CalendarConfig, 'id'>,
  ) => Promise<import('@shared/types').CalendarOperationResult>;
  calendarRemoveConnection: (id: string) => Promise<{ success: boolean }>;
  calendarConnect: (id: string) => Promise<{ success: boolean }>;
  calendarDisconnect: (id: string) => Promise<{ success: boolean }>;
  calendarGetCalendars: (connectionId: string) => Promise<import('@shared/types').CalendarInfo[]>;
  calendarGetStatus: () => Promise<import('@shared/types').CalendarStatus>;
  calendarStoreCredential: (connectionId: string, password: string) => Promise<{ success: boolean }>;
  onCalendarStatus: (callback: (status: import('@shared/types').CalendarStatus) => void) => () => void;

  // Privacy & GDPR
  privacyGetSummary: () => Promise<import('@shared/types').PrivacyDataSummary>;
  privacyExportData: (
    options?: import('@shared/types').PrivacyExportOptions,
  ) => Promise<import('@shared/types').PrivacyExportResult>;
  privacyDeleteData: (
    options?: import('@shared/types').PrivacyDeleteOptions,
  ) => Promise<import('@shared/types').PrivacyDeleteResult>;

  // Clipboard
  clipboardGetStatus: () => Promise<import('@shared/types').ClipboardStatus>;
  clipboardStartMonitoring: () => Promise<{ success: boolean }>;
  clipboardStopMonitoring: () => Promise<{ success: boolean }>;
  clipboardGetHistory: (limit?: number) => Promise<import('@shared/types').ClipboardEntry[]>;
  clipboardSearch: (
    options: import('@shared/types').ClipboardSearchOptions,
  ) => Promise<import('@shared/types').ClipboardEntry[]>;
  clipboardTogglePin: (entryId: string) => Promise<boolean>;
  clipboardDeleteEntry: (entryId: string) => Promise<boolean>;
  clipboardClearHistory: () => Promise<number>;

  // Knowledge Graph
  kgSearch: (options: import('@shared/types').KGSearchOptions) => Promise<import('@shared/types').KGSearchResult>;
  kgAddEntity: (data: {
    name: string;
    type: import('@shared/types').KGEntityType;
    properties?: Record<string, any>;
    confidence?: number;
    source?: import('@shared/types').KGSource;
  }) => Promise<import('@shared/types').KGEntity>;
  kgUpdateEntity: (
    id: string,
    updates: {
      name?: string;
      properties?: Record<string, any>;
      confidence?: number;
      active?: boolean;
    },
  ) => Promise<import('@shared/types').KGEntity | null>;
  kgDeleteEntity: (id: string) => Promise<boolean>;
  kgAddRelation: (data: {
    sourceId: string;
    targetId: string;
    relation: import('@shared/types').KGRelationType;
    properties?: Record<string, any>;
    strength?: number;
  }) => Promise<import('@shared/types').KGRelation>;
  kgDeleteRelation: (id: string) => Promise<boolean>;
  kgGetGraph: (entityId?: string, depth?: number) => Promise<import('@shared/types').KGGraphResult>;
  kgGetStats: () => Promise<import('@shared/types').KGStats>;
}

// ──────────────── Updates ────────────────
export interface UpdateState {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  type?: 'chat' | 'proactive' | 'analysis';
}

export interface ProactiveMessage {
  id: string;
  type: string;
  message: string;
  context: string;
  ruleId?: string;
}

export interface KxAIConfig {
  userName?: string;
  userRole?: string;
  userDescription?: string;
  userLanguage?: string;
  aiProvider?: 'openai' | 'anthropic';
  aiModel?: string;
  proactiveMode?: boolean;
  proactiveIntervalMs?: number;
  theme?: 'dark' | 'light';
  onboarded?: boolean;
  agentName?: string;
  agentEmoji?: string;
  screenWatchEnabled?: boolean;
  [key: string]: any;
}

export interface OnboardingData {
  userName: string;
  userRole: string;
  userDescription: string;
  agentName?: string;
  agentEmoji?: string;
  aiProvider: 'openai' | 'anthropic';
  aiModel: string;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  action: string;
  autoCreated: boolean;
  enabled: boolean;
  category: 'routine' | 'workflow' | 'reminder' | 'cleanup' | 'health-check' | 'custom';
  createdAt: number;
  lastRun?: number;
  lastResult?: string;
  runCount: number;
}

export interface CronExecution {
  jobId: string;
  timestamp: number;
  result: string;
  success: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface ActivityEntry {
  timestamp: number;
  hour: number;
  dayOfWeek: number;
  action: string;
  context: string;
  category: string;
}

export interface WorkflowPattern {
  id: string;
  description: string;
  timeRange: { startHour: number; endHour: number };
  daysOfWeek: number[];
  frequency: number;
  lastSeen: number;
  suggestedCron?: string;
  acknowledged: boolean;
}

// ──────────────── RAG ────────────────
export interface RAGSearchResult {
  fileName: string;
  section: string;
  content: string;
  score: number;
}

export interface RAGFolderInfo {
  path: string;
  fileCount: number;
  chunkCount: number;
  lastIndexed: number;
}

export interface RAGStats {
  totalChunks: number;
  totalFiles: number;
  indexed: boolean;
  embeddingType: 'openai' | 'tfidf';
  folders: RAGFolderInfo[];
}

// ──────────────── Agent Status ────────────────
export interface AgentStatus {
  state: 'idle' | 'thinking' | 'tool-calling' | 'streaming' | 'heartbeat' | 'take-control' | 'sub-agent';
  detail?: string;
  toolName?: string;
  subAgentCount?: number;
}

// ──────────────── RAG Indexing Progress ────────────────
export interface IndexProgress {
  phase: 'scanning' | 'chunking' | 'embedding' | 'saving' | 'done' | 'error';
  currentFile?: string;
  filesProcessed: number;
  filesTotal: number;
  chunksCreated: number;
  embeddingPercent: number;
  overallPercent: number;
  error?: string;
}

// ──────────────── Automation ────────────────
export interface AutomationStatus {
  enabled: boolean;
  safetyLocked: boolean;
  takeControlActive: boolean;
}

// ──────────────── Browser ────────────────
export interface BrowserSession {
  running: boolean;
}

// ──────────────── Plugins ────────────────
export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  toolCount: number;
  tools: string[];
}

// ──────────────── Security ────────────────
export interface AuditEntry {
  timestamp: number;
  action: string;
  params: Record<string, unknown>;
  source: 'tool' | 'automation' | 'browser' | 'plugin' | 'cron';
  result: 'allowed' | 'blocked' | 'rate-limited';
  reason?: string;
}

export interface SecurityStats {
  totalActions: number;
  blockedActions: number;
  rateLimitedActions: number;
  last24h: { total: number; blocked: number };
}

// ──────────────── System Monitor ────────────────
// ──────────────── TTS ────────────────
export interface TTSConfig {
  enabled: boolean;
  provider: 'elevenlabs' | 'openai' | 'web';
  elevenLabsVoiceId: string;
  elevenLabsModel: string;
  openaiVoice: string;
  openaiModel: string;
  maxChars: number;
}

// ──────────────── System Monitor ────────────────
export interface SystemSnapshot {
  timestamp: number;
  cpu: { model: string; cores: number; usagePercent: number; loadAvg: number[] };
  memory: { totalGB: number; usedGB: number; freeGB: number; usagePercent: number };
  disk: { mount: string; totalGB: number; usedGB: number; freeGB: number; usagePercent: number }[];
  battery: { percent: number; charging: boolean; timeRemaining: string } | null;
  network: { connected: boolean; interfaces: { name: string; ip: string; mac: string }[] };
  system: {
    hostname: string;
    platform: string;
    arch: string;
    osVersion: string;
    uptimeHours: number;
    nodeVersion: string;
    electronVersion: string;
  };
  topProcesses: { name: string; pid: number; cpuPercent: number; memoryMB: number }[];
}

// ──────────────── Meeting Coach ────────────────
export interface MeetingSpeakerInfo {
  id: string;
  name: string;
  source: 'system';
  utteranceCount: number;
  lastSeen: number;
  isAutoDetected: boolean;
}

export interface MeetingStateInfo {
  active: boolean;
  meetingId: string | null;
  startTime: number | null;
  duration: number;
  transcriptLineCount: number;
  lastCoachingTip: string | null;
  detectedApp: string | null;
  speakers: MeetingSpeakerInfo[];
  isCoaching: boolean;
  hasBriefing: boolean;
}

export interface MeetingCoachConfig {
  enabled: boolean;
  autoDetect: boolean;
  coachingEnabled: boolean;
  language: string;
  dashboardPort: number;
  captureSystemAudio: boolean;
  captureMicrophone: boolean;
  questionDetectionSensitivity: 'low' | 'medium' | 'high';
  useRAG: boolean;
  streamingCoaching: boolean;
}

export interface MeetingSummaryMeta {
  id: string;
  title: string;
  startTime: number;
  duration: number;
  participants: string[];
}

export interface MeetingSummaryFull extends MeetingSummaryMeta {
  endTime: number;
  transcript: Array<{ timestamp: number; speaker: string; text: string; source: 'mic' | 'system' }>;
  coachingTips: MeetingCoachingTip[];
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  detectedApp?: string;
}

export interface MeetingCoachingTip {
  id: string;
  timestamp: number;
  tip: string;
  category: string;
}

// ──────────────── Meeting Briefing ────────────────
export interface MeetingBriefingParticipant {
  name: string;
  role?: string;
  company?: string;
  notes?: string;
  photoBase64?: string;
}

export interface MeetingBriefingInfo {
  topic: string;
  agenda?: string;
  participants: MeetingBriefingParticipant[];
  notes: string;
  urls: string[];
  projectPaths: string[];
  urlContents?: Array<{ url: string; content: string; error?: string }>;
  ragIndexed?: boolean;
}

// ──────────────── Sub-agents ────────────────
export type SubAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed';

export interface SubAgentInfo {
  id: string;
  task: string;
  status: SubAgentStatus;
  startedAt: number;
  iterations: number;
  toolsUsed: string[];
}

export interface SubAgentResult {
  id: string;
  task: string;
  status: SubAgentStatus;
  output: string;
  toolsUsed: string[];
  iterations: number;
  durationMs: number;
  error?: string;
}

// ──────────────── Background Exec ────────────────
export interface BackgroundTaskInfo {
  id: string;
  task: string;
  elapsed: number;
}

// ──────────────── Workflow Automator (Macros) ────────────────
export interface WorkflowStep {
  index: number;
  toolName: string;
  params: Record<string, unknown>;
  success: boolean;
  resultSummary?: string;
  durationMs: number;
  timestamp: string;
}

export interface WorkflowMacroParam {
  name: string;
  description: string;
  defaultValue: string;
  references: Array<{ stepIndex: number; paramKey: string }>;
}

export interface WorkflowMacro {
  id: string;
  name: string;
  description?: string;
  source: 'recording' | 'import' | 'ai-generated';
  steps: WorkflowStep[];
  createdAt: string;
  lastRunAt?: string;
  runCount: number;
  tags: string[];
  parameters: WorkflowMacroParam[];
}

export interface WorkflowReplayResult {
  macroId: string;
  macroName: string;
  success: boolean;
  stepsExecuted: number;
  stepsTotal: number;
  results: Array<{ step: number; toolName: string; success: boolean; result?: string; error?: string }>;
  totalDurationMs: number;
  stoppedReason?: string;
}

export interface WorkflowRecordingState {
  isRecording: boolean;
  macroName?: string;
  stepsRecorded: number;
  startedAt?: string;
}

declare global {
  interface Window {
    kxai: KxAIBridge;
  }
}
