/**
 * Zod schemas for IPC channel parameter validation.
 *
 * Provides runtime validation of parameters passed through IPC channels
 * between renderer and main process. Prevents type mismatches and ensures
 * data integrity at the process boundary.
 *
 * Only channels that accept user-controlled parameters are validated.
 * No-param channels (e.g. SCREEN_CAPTURE, CONFIG_GET) are skipped.
 *
 * @module shared/schemas/ipc-params
 */

import { z } from 'zod';
import { Ch, ChSend } from '../ipc-schema';

// ─── Reusable primitives ───

const nonEmptyString = z.string().min(1);
const optionalString = z.string().optional();
const positiveInt = z.number().int().positive();
const optionalPositiveInt = z.number().int().positive().optional();
const booleanVal = z.boolean();

// ─── AI & Chat ───

const AiSendMessageParams = z.tuple([nonEmptyString, optionalString]);

const AiStreamMessageParams = z.tuple([nonEmptyString, optionalString]);

const AiStreamWithScreenParams = z.tuple([nonEmptyString]);

// ─── Agent ───

const AgentSetActiveHoursParams = z.tuple([
  z.number().int().min(0).max(23).nullable(),
  z.number().int().min(0).max(23).nullable(),
]);

// ─── Screen ───

const ScreenStartWatchParams = z.tuple([positiveInt]);

// ─── Memory ───

const MemoryGetParams = z.tuple([nonEmptyString]);

const MemorySetParams = z.tuple([nonEmptyString, z.string()]);

// ─── Config ───

const ConfigSetParams = z.tuple([nonEmptyString, z.any()]);

const ConfigSetBatchParams = z.tuple([z.record(z.string(), z.any())]);

const ConfigCompleteOnboardingParams = z.tuple([
  z.object({
    userName: z.string().min(1).max(100),
    userRole: z.string().min(1).max(200),
    userDescription: z.string().max(2000),
    agentName: z.string().max(50).optional(),
    agentEmoji: z.string().max(10).optional(),
    aiProvider: z.enum(['openai', 'anthropic']),
    aiModel: z.string().min(1).max(100),
  }),
]);

// ─── Security ───

const SecuritySetApiKeyParams = z.tuple([z.enum(['openai', 'anthropic', 'elevenlabs', 'deepgram']), nonEmptyString]);

const SecurityHasApiKeyParams = z.tuple([z.enum(['openai', 'anthropic', 'elevenlabs', 'deepgram'])]);

const SecurityDeleteApiKeyParams = z.tuple([z.enum(['openai', 'anthropic', 'elevenlabs', 'deepgram'])]);

const SecurityAuditLogParams = z.tuple([optionalPositiveInt]);

// ─── Window ───

const WindowSetPositionParams = z.tuple([z.number().int(), z.number().int()]);

const WindowSetSizeParams = z.tuple([z.number().int().min(100).max(10000), z.number().int().min(100).max(10000)]);

const WindowSetClickthroughParams = z.tuple([booleanVal]);

// ─── Voice ───

const VoiceTranscribeParams = z.tuple([nonEmptyString]);

// ─── Files ───

const FilesOrganizeParams = z.tuple([nonEmptyString, z.any().optional()]);

const FilesListParams = z.tuple([nonEmptyString]);

// ─── Proactive ───

const ProactiveSetModeParams = z.tuple([booleanVal]);
const ProactiveFeedbackParams = z.tuple([
  z.object({
    ruleId: z.string(),
    action: z.enum(['accepted', 'dismissed', 'replied']),
  }),
]);

// ─── Cron ───

const CronAddJobParams = z.tuple([
  z.object({
    name: z.string().min(1).max(200),
    schedule: z.string().min(5),
    action: z.string().min(1).max(2000),
    category: z.enum(['routine', 'workflow', 'reminder', 'cleanup', 'health-check', 'custom']).optional(),
    enabled: z.boolean().optional(),
    oneShot: z.boolean().optional(),
    runAt: z.string().optional(),
  }),
]);

const CronUpdateJobParams = z.tuple([
  nonEmptyString, // id
  z.record(z.string(), z.any()), // partial updates
]);

const CronRemoveJobParams = z.tuple([nonEmptyString]);

const CronGetHistoryParams = z.tuple([optionalString]);

// ─── Tools ───

const ToolsExecuteParams = z.tuple([nonEmptyString, z.record(z.string(), z.any())]);

// ─── Workflow ───

const WorkflowGetActivityParams = z.tuple([optionalPositiveInt]);

// ─── RAG ───

const RagSearchParams = z.tuple([nonEmptyString, optionalPositiveInt]);

const RagAddFolderParams = z.tuple([nonEmptyString]);

const RagRemoveFolderParams = z.tuple([nonEmptyString]);

// ─── Automation ───

const AutomationTakeControlParams = z.tuple([nonEmptyString]);

// ─── TTS ───

const TtsSpeakParams = z.tuple([nonEmptyString]);

const TtsSetConfigParams = z.tuple([z.record(z.string(), z.any())]);

// ─── Heartbeat ───

const HeartbeatSetConfigParams = z.tuple([z.string()]);

// ─── Meeting ───

const MeetingStartParams = z.tuple([optionalString]);

const MeetingSetConfigParams = z.tuple([z.record(z.string(), z.any())]);

const MeetingGetSummaryParams = z.tuple([nonEmptyString]);

const MeetingSetBriefingParams = z.tuple([z.any()]);

// ─── Sub-agents ───

const SubagentSpawnParams = z.tuple([nonEmptyString, z.array(z.string()).optional()]);

const SubagentKillParams = z.tuple([nonEmptyString]);

const SubagentSteerParams = z.tuple([nonEmptyString, nonEmptyString]);

// ─── Background ───

const BackgroundExecParams = z.tuple([nonEmptyString]);

// ─── MCP ───

const McpAddServerParams = z.tuple([
  z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(200),
    transport: z.enum(['streamable-http', 'sse', 'stdio']),
    url: z.string().url().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    autoConnect: z.boolean().optional(),
    enabled: z.boolean().optional(),
    icon: z.string().max(10).optional(),
    category: z.string().max(50).optional(),
    timeout: z.number().int().positive().optional(),
  }),
]);

const McpRemoveServerParams = z.tuple([nonEmptyString]);

const McpConnectParams = z.tuple([nonEmptyString]);

const McpDisconnectParams = z.tuple([nonEmptyString]);

const McpReconnectParams = z.tuple([nonEmptyString]);

const McpCallToolParams = z.tuple([nonEmptyString, nonEmptyString, z.any()]);

// ─── Calendar ───

const CalendarAddConnectionParams = z.tuple([
  z.object({
    name: z.string().min(1).max(200),
    provider: z.enum(['google', 'icloud', 'nextcloud', 'caldav', 'ics']),
    serverUrl: z.string().min(1),
    authMethod: z.enum(['Basic', 'OAuth', 'Bearer']),
    username: z.string().optional(),
    selectedCalendars: z.array(z.string()).optional(),
    googleClientId: z.string().optional(),
    googleClientSecret: z.string().optional(),
  }),
]);

const CalendarRemoveConnectionParams = z.tuple([nonEmptyString]);

const CalendarConnectParams = z.tuple([nonEmptyString]);

const CalendarDisconnectParams = z.tuple([nonEmptyString]);

const CalendarGetCalendarsParams = z.tuple([nonEmptyString]);

const CalendarStoreCredentialParams = z.tuple([nonEmptyString, nonEmptyString]);

// ─── Send Channels ───

const MeetingAudioChunkParams = z.tuple([
  z.enum(['mic', 'system']),
  z.any(), // Uint8Array/Buffer — can't validate binary with zod
]);

const MeetingMapSpeakerParams = z.tuple([nonEmptyString, nonEmptyString]);

// ─── Schema Registry ───

/**
 * Maps IPC channel names to their parameter validation schemas.
 *
 * Each schema validates the arguments tuple passed to `ipcMain.handle` callbacks
 * (excluding the `_event` parameter which is injected by Electron).
 *
 * Only channels with parameters are included. Parameterless channels
 * (e.g. SCREEN_CAPTURE, CONFIG_GET) don't need validation.
 */
export const IpcParamSchemas: Partial<Record<string, z.ZodType>> = {
  // AI
  [Ch.AI_SEND_MESSAGE]: AiSendMessageParams,
  [Ch.AI_STREAM_MESSAGE]: AiStreamMessageParams,
  [Ch.AI_STREAM_WITH_SCREEN]: AiStreamWithScreenParams,

  // Agent
  [Ch.AGENT_SET_ACTIVE_HOURS]: AgentSetActiveHoursParams,

  // Screen
  [Ch.SCREEN_START_WATCH]: ScreenStartWatchParams,

  // Memory
  [Ch.MEMORY_GET]: MemoryGetParams,
  [Ch.MEMORY_SET]: MemorySetParams,

  // Config
  [Ch.CONFIG_SET]: ConfigSetParams,
  [Ch.CONFIG_SET_BATCH]: ConfigSetBatchParams,
  [Ch.CONFIG_COMPLETE_ONBOARDING]: ConfigCompleteOnboardingParams,

  // Security
  [Ch.SECURITY_SET_API_KEY]: SecuritySetApiKeyParams,
  [Ch.SECURITY_HAS_API_KEY]: SecurityHasApiKeyParams,
  [Ch.SECURITY_DELETE_API_KEY]: SecurityDeleteApiKeyParams,
  [Ch.SECURITY_AUDIT_LOG]: SecurityAuditLogParams,

  // Window
  [Ch.WINDOW_SET_POSITION]: WindowSetPositionParams,
  [Ch.WINDOW_SET_SIZE]: WindowSetSizeParams,
  [Ch.WINDOW_SET_CLICKTHROUGH]: WindowSetClickthroughParams,

  // Voice
  [Ch.VOICE_TRANSCRIBE]: VoiceTranscribeParams,

  // Files
  [Ch.FILES_ORGANIZE]: FilesOrganizeParams,
  [Ch.FILES_LIST]: FilesListParams,

  // Proactive
  [Ch.PROACTIVE_SET_MODE]: ProactiveSetModeParams,
  [Ch.PROACTIVE_FEEDBACK]: ProactiveFeedbackParams,

  // Cron
  [Ch.CRON_ADD_JOB]: CronAddJobParams,
  [Ch.CRON_UPDATE_JOB]: CronUpdateJobParams,
  [Ch.CRON_REMOVE_JOB]: CronRemoveJobParams,
  [Ch.CRON_GET_HISTORY]: CronGetHistoryParams,

  // Tools
  [Ch.TOOLS_EXECUTE]: ToolsExecuteParams,

  // Workflow
  [Ch.WORKFLOW_GET_ACTIVITY]: WorkflowGetActivityParams,

  // RAG
  [Ch.RAG_SEARCH]: RagSearchParams,
  [Ch.RAG_ADD_FOLDER]: RagAddFolderParams,
  [Ch.RAG_REMOVE_FOLDER]: RagRemoveFolderParams,

  // Automation
  [Ch.AUTOMATION_TAKE_CONTROL]: AutomationTakeControlParams,

  // TTS
  [Ch.TTS_SPEAK]: TtsSpeakParams,
  [Ch.TTS_SET_CONFIG]: TtsSetConfigParams,

  // Heartbeat
  [Ch.HEARTBEAT_SET_CONFIG]: HeartbeatSetConfigParams,

  // Meeting
  [Ch.MEETING_START]: MeetingStartParams,
  [Ch.MEETING_SET_CONFIG]: MeetingSetConfigParams,
  [Ch.MEETING_GET_SUMMARY]: MeetingGetSummaryParams,
  [Ch.MEETING_SET_BRIEFING]: MeetingSetBriefingParams,

  // Sub-agents
  [Ch.SUBAGENT_SPAWN]: SubagentSpawnParams,
  [Ch.SUBAGENT_KILL]: SubagentKillParams,
  [Ch.SUBAGENT_STEER]: SubagentSteerParams,

  // Background
  [Ch.BACKGROUND_EXEC]: BackgroundExecParams,

  // MCP
  [Ch.MCP_ADD_SERVER]: McpAddServerParams,
  [Ch.MCP_REMOVE_SERVER]: McpRemoveServerParams,
  [Ch.MCP_CONNECT]: McpConnectParams,
  [Ch.MCP_DISCONNECT]: McpDisconnectParams,
  [Ch.MCP_RECONNECT]: McpReconnectParams,
  [Ch.MCP_CALL_TOOL]: McpCallToolParams,

  // Calendar
  [Ch.CALENDAR_ADD_CONNECTION]: CalendarAddConnectionParams,
  [Ch.CALENDAR_REMOVE_CONNECTION]: CalendarRemoveConnectionParams,
  [Ch.CALENDAR_CONNECT]: CalendarConnectParams,
  [Ch.CALENDAR_DISCONNECT]: CalendarDisconnectParams,
  [Ch.CALENDAR_GET_CALENDARS]: CalendarGetCalendarsParams,
  [Ch.CALENDAR_STORE_CREDENTIAL]: CalendarStoreCredentialParams,
};

/**
 * Send channel parameter schemas (fire-and-forget, renderer → main).
 */
export const IpcSendParamSchemas: Partial<Record<string, z.ZodType>> = {
  [ChSend.MEETING_AUDIO_CHUNK]: MeetingAudioChunkParams,
  [ChSend.MEETING_MAP_SPEAKER]: MeetingMapSpeakerParams,
};

// ─── Validation helper ───

export interface IpcValidationError {
  channel: string;
  issues: z.ZodIssue[] | Array<{ message: string }>;
}

/**
 * Validate IPC parameters against the schema for a given channel.
 * Returns `null` if valid or no schema exists, otherwise returns validation error.
 *
 * @param channel - IPC channel name
 * @param args - Arguments tuple (excluding _event)
 */
export function validateIpcParams(channel: string, args: unknown[]): IpcValidationError | null {
  const schema = IpcParamSchemas[channel] ?? IpcSendParamSchemas[channel];
  if (!schema) return null; // No schema = no validation needed

  const result = schema.safeParse(args);
  if (result.success) return null;

  return {
    channel,
    issues: result.error?.issues ?? [{ message: 'Unknown validation error' }],
  };
}
