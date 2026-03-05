/**
 * Zod schema for KxAI configuration.
 *
 * Single source of truth for config shape, defaults, and validation.
 * The KxAIConfig type is derived from this schema via z.infer<>.
 *
 * @module shared/schemas/config-schema
 */

import { z } from 'zod';

// ─── Sub-schemas ───

const WidgetPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const McpServerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  transport: z.enum(['streamable-http', 'sse', 'stdio']),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  autoConnect: z.boolean().default(false),
  enabled: z.boolean().default(true),
  icon: z.string().optional(),
  category: z.string().optional(),
  timeout: z.number().optional(),
});

const CalendarConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.enum(['google', 'icloud', 'nextcloud', 'caldav', 'ics']),
  serverUrl: z.string(),
  authMethod: z.enum(['Basic', 'OAuth', 'Bearer']).default('Basic'),
  username: z.string(),
  enabled: z.boolean().default(true),
  selectedCalendars: z.array(z.string()).optional(),
  lastSync: z.number().optional(),
  googleClientId: z.string().optional(),
  googleClientSecret: z.string().optional(),
});

// ─── Main config schema ───

export const KxAIConfigSchema = z
  .object({
    /** Schema version for migrations */
    _version: z.number().default(1),

    // ── User profile ──
    userName: z.string().optional(),
    userRole: z.string().optional(),
    userDescription: z.string().optional(),
    userLanguage: z.string().default('pl'),

    // ── AI settings ──
    aiProvider: z.enum(['openai', 'anthropic']).default('openai'),
    aiModel: z.string().default('gpt-5'),
    embeddingModel: z.string().optional(),

    // ── Cortex (unified autonomous engine) ──
    cortexEnabled: z.boolean().default(true),
    cortexIntensity: z.enum(['eco', 'balanced', 'performance']).default('balanced'),
    cortexActiveHoursStart: z.string().default('07:00'),
    cortexActiveHoursEnd: z.string().default('23:00'),

    // ── Legacy (kept for migration compat, ignored at runtime) ──
    proactiveMode: z.boolean().optional(),
    proactiveIntervalMs: z.number().optional(),

    // ── UI ──
    widgetPosition: WidgetPositionSchema.optional(),
    theme: z.enum(['dark', 'light']).default('dark'),

    // ── Onboarding ──
    onboarded: z.boolean().default(false),

    // ── Agent persona ──
    agentName: z.string().default('KxAI'),
    agentEmoji: z.string().default('🤖'),

    // ── Screen watching ──
    screenWatchEnabled: z.boolean().default(false),
    monitorIndexes: z.array(z.number()).optional(),

    // ── Knowledge indexing ──
    indexedFolders: z.array(z.string()).optional(),
    indexedExtensions: z.array(z.string()).optional(),

    // ── Feature flags ──
    useNativeFunctionCalling: z.boolean().default(true),

    // ── MCP servers ──
    mcpServers: z.array(McpServerConfigSchema).optional(),

    // ── Meeting coach (opaque sub-object, persisted by MeetingCoachService) ──
    meetingCoach: z.record(z.string(), z.unknown()).optional(),

    // ── Calendar connections ──
    calendarConnections: z.array(CalendarConnectionSchema).optional(),

    // ── Telegram Bot ──
    telegramAutoStart: z.boolean().default(false),
    telegramAllowedChatIds: z.array(z.number()).default([]),
    telegramAllowedUsernames: z.array(z.string()).default([]),
    telegramDenyByDefault: z.boolean().default(true),
  })
  .passthrough(); // Allow unknown keys for forward-compat

// ─── Derived types ───

/** Full config after parsing (defaults applied, all fields present) */
export type KxAIConfigParsed = z.infer<typeof KxAIConfigSchema>;

/** Config input (all fields optional — for file data or partial updates) */
export type KxAIConfigInput = z.input<typeof KxAIConfigSchema>;

// ─── Migration system ───

export const CURRENT_CONFIG_VERSION = 2;

export type ConfigMigration = (config: Record<string, unknown>) => Record<string, unknown>;

/**
 * Ordered migrations: key = source version, value = transform to next version.
 * Example: `0: (cfg) => ({ ...cfg, newField: 'default' })` migrates v0 → v1.
 */
export const CONFIG_MIGRATIONS: Record<number, ConfigMigration> = {
  // v0 → v1: add _version field (initial migration for configs without version)
  0: (cfg) => ({ ...cfg, _version: 1 }),

  // v1 → v2: proactiveMode → cortexEnabled, remove proactiveIntervalMs
  1: (cfg) => {
    const c = cfg as Record<string, any>;
    const migrated: Record<string, any> = { ...c, _version: 2 };
    // Migrate proactiveMode → cortexEnabled (if user had it on, keep it on; default to true)
    if (typeof c.proactiveMode === 'boolean') {
      migrated.cortexEnabled = c.proactiveMode;
    } else {
      migrated.cortexEnabled = true;
    }
    migrated.cortexIntensity = 'balanced';
    migrated.cortexActiveHoursStart = '07:00';
    migrated.cortexActiveHoursEnd = '23:00';
    // Clean up legacy fields
    delete migrated.proactiveMode;
    delete migrated.proactiveIntervalMs;
    return migrated;
  },
};
