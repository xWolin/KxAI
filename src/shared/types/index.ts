/**
 * Shared types — single source of truth for main ↔ renderer type definitions.
 *
 * Import from '@shared/types' in both main process and renderer.
 */

// AI & Conversations
export type { ConversationMessage, ProactiveMessage } from './ai';

// AI Provider abstraction
export type {
  AIProvider,
  AIProviderFeature,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  VisionImage,
  ToolCallResult,
  ToolResultEntry,
  ComputerUseConfig,
  ComputerUseStepResult,
  ProviderCostEntry,
} from './ai-provider';

// Configuration
export type { KxAIConfig, OnboardingData } from './config';

// Tools
export type { ToolDefinition, ToolResult, ToolCategory } from './tools';

// Cron
export type { CronJob, CronExecution } from './cron';

// Workflow
export type {
  ActivityEntry,
  WorkflowPattern,
  WorkflowStep,
  WorkflowMacro,
  WorkflowMacroParam,
  WorkflowReplayResult,
  WorkflowRecordingState,
} from './workflow';

// RAG
export type { RAGChunk, RAGSearchResult, RAGSearchResultFlat, RAGFolderInfo, RAGStats, IndexProgress } from './rag';

// Agent
export type { AgentStatus, SubAgentInfo, SubAgentResult, BackgroundTaskInfo } from './agent';
export type { SubAgentStatus } from './agent';

// Security
export type { AuditEntry, SecurityStats } from './security';

// TTS
export type { TTSConfig } from './tts';

// System
export type {
  SystemSnapshot,
  CpuInfo,
  MemoryInfo,
  DiskInfo,
  BatteryInfo,
  NetworkInfo,
  SystemInfo,
  ProcessInfo,
} from './system';

// Meeting
export type {
  MeetingSpeakerInfo,
  MeetingStateInfo,
  MeetingCoachConfig,
  MeetingSummaryMeta,
  MeetingSummaryFull,
  MeetingCoachingTip,
  MeetingBriefingParticipant,
  MeetingBriefingInfo,
} from './meeting';

// Plugins
export type { PluginInfo } from './plugins';

// Automation
export type { AutomationStatus } from './automation';

// MCP
export type {
  McpTransportType,
  McpServerConfig,
  McpConnectionStatus,
  McpToolInfo,
  McpServerStatus,
  McpHubStatus,
  McpRegistryEntry,
  McpCategory,
} from './mcp';

// File Intelligence
export type {
  SupportedFileFormat,
  FileMetadata,
  FileExtractionResult,
  FileSearchMatch,
  FileSearchResult,
  FolderAnalysis,
} from './file-intelligence';

// Calendar (CalDAV)
export type {
  CalendarProvider,
  CalendarAuthMethod,
  CalendarConfig,
  CalendarInfo,
  CalendarEvent,
  CalendarConnectionStatus,
  CalendarStatus,
  FetchEventsOptions,
  CreateEventOptions,
  CalendarOperationResult,
} from './calendar';

// Clipboard
export type {
  ClipboardContentType,
  ClipboardEntry,
  ClipboardSearchOptions,
  ClipboardConfig,
  ClipboardStatus,
} from './clipboard';

// Errors
export { KxAIError, ErrorCode } from './errors';
export type { ErrorSeverity } from './errors';

// Privacy & GDPR
export type {
  PrivacyDataCategory,
  PrivacyDataSummary,
  PrivacyCategorySummary,
  PrivacyExportResult,
  PrivacyDeleteResult,
  PrivacyExportOptions,
  PrivacyDeleteOptions,
} from './privacy';

// Knowledge Graph
export type {
  KGEntityType,
  KGSource,
  KGEntity,
  KGRelationType,
  KGRelation,
  KGSearchOptions,
  KGSearchResult,
  KGGraphResult,
  KGStats,
} from './knowledge-graph';
