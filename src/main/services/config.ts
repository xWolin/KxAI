/**
 * ConfigService v2 — Typed, reactive, validated configuration management.
 *
 * Features:
 * - Zod schema validation on load (corrupted JSON → safe defaults)
 * - Typed get<K>/set<K> with full TypeScript inference
 * - setBatch() for multiple key updates in a single save
 * - onChange<K>() reactive subscriptions — services get notified of changes
 * - Debounced save (200ms) — multiple set() calls → single write
 * - Atomic write (temp file + rename) — crash-safe
 * - Config version tracking + ordered migrations
 * - EventEmitter for main process event wiring
 *
 * @module main/services/config
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import { createLogger } from './logger';

import { KxAIConfigSchema, CURRENT_CONFIG_VERSION, CONFIG_MIGRATIONS } from '../../shared/schemas/config-schema';
import type { KxAIConfigParsed, KxAIConfigInput } from '../../shared/schemas/config-schema';

// Re-export from shared types (canonical source)
export type { KxAIConfig } from '../../shared/types/config';

const log = createLogger('Config');

/** Delay before flushing config to disk (ms). Multiple set() calls within this window = single write. */
const SAVE_DELAY_MS = 200;

// ─── Change listener types ───

type ChangeCallback<K extends keyof KxAIConfigParsed> = (
  newVal: KxAIConfigParsed[K],
  oldVal: KxAIConfigParsed[K],
) => void;

type AnyChangeCallback = (changes: Partial<KxAIConfigParsed>) => void;

// ─── ConfigService ───

export class ConfigService extends EventEmitter {
  private configPath: string;
  private config: KxAIConfigParsed;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;

  /** Per-key change listeners */
  private keyListeners = new Map<string, Set<ChangeCallback<any>>>();
  /** Listeners for any config change */
  private anyListeners = new Set<AnyChangeCallback>();

  constructor() {
    super();
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'kxai-config.json');
    this.config = this.loadConfig();
  }

  // ────────────── Load / Save ──────────────

  private loadConfig(): KxAIConfigParsed {
    let raw: Record<string, unknown> = {};

    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        raw = JSON.parse(data);
      }
    } catch (error) {
      log.error('Failed to read config file, using defaults:', error);
    }

    // Apply migrations
    raw = this.migrateConfig(raw);

    // Validate with Zod — safe parse fills in defaults, strips invalid fields
    const result = KxAIConfigSchema.safeParse(raw);
    if (result.success) {
      return result.data;
    }

    log.warn('Config validation failed, applying defaults. Issues:', result.error.issues);
    // Partial recovery: merge raw data with defaults so valid fields are preserved
    const fallback = KxAIConfigSchema.safeParse({});
    return fallback.success ? { ...fallback.data, ...this.pickValidFields(raw) } : (fallback as any).data;
  }

  /**
   * Pick fields from raw config that individually pass validation.
   * Used for partial recovery when overall validation fails.
   */
  private pickValidFields(raw: Record<string, unknown>): Partial<KxAIConfigParsed> {
    const recovered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      try {
        const partial = KxAIConfigSchema.safeParse({ [key]: value });
        if (partial.success && partial.data[key as keyof KxAIConfigParsed] !== undefined) {
          recovered[key] = value;
        }
      } catch {
        // Skip invalid field
      }
    }
    return recovered as Partial<KxAIConfigParsed>;
  }

  /**
   * Run ordered migrations on raw config data.
   */
  private migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
    let version = typeof raw._version === 'number' ? raw._version : 0;
    let migrated = { ...raw };

    while (version < CURRENT_CONFIG_VERSION) {
      const migration = CONFIG_MIGRATIONS[version];
      if (migration) {
        log.info(`Migrating config v${version} → v${version + 1}`);
        migrated = migration(migrated);
      }
      version++;
    }

    migrated._version = CURRENT_CONFIG_VERSION;
    return migrated;
  }

  /**
   * Schedule a debounced save. Multiple calls within SAVE_DELAY_MS → single write.
   */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, SAVE_DELAY_MS);
  }

  /**
   * Atomic write: write to temp file, then rename.
   * Prevents data loss on crash during write.
   */
  /** Track whether another save was requested while one is in progress */
  private pendingSave = false;

  private async flushSave(): Promise<void> {
    if (this.saving) {
      // Another save is in progress — mark pending so it re-runs after current save
      this.pendingSave = true;
      return;
    }
    this.saving = true;
    try {
      const dir = path.dirname(this.configPath);
      await fsp.mkdir(dir, { recursive: true });
      const tmpPath = this.configPath + '.tmp';
      await fsp.writeFile(tmpPath, JSON.stringify(this.config, null, 2), 'utf8');
      await fsp.rename(tmpPath, this.configPath);
    } catch (error) {
      log.error('Failed to save config:', error);
    } finally {
      this.saving = false;
      // If another save was requested during this save, flush again
      if (this.pendingSave) {
        this.pendingSave = false;
        void this.flushSave();
      }
    }
  }

  /**
   * Force immediate save — use during shutdown.
   */
  async forceSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flushSave();
  }

  // ────────────── Typed accessors ──────────────

  /**
   * Get a single config value by key.
   * Returns the value with its correct TypeScript type.
   */
  get<K extends keyof KxAIConfigParsed>(key: K): KxAIConfigParsed[K] {
    return this.config[key];
  }

  /**
   * Set a single config value. Triggers debounced save and change notifications.
   */
  set<K extends keyof KxAIConfigParsed>(key: K, value: KxAIConfigParsed[K]): void {
    const oldVal = this.config[key];

    // Skip if value hasn't changed (shallow equality)
    if (oldVal === value) return;

    this.config[key] = value;
    this.notifyChange({ [key]: value } as Partial<KxAIConfigParsed>, { [key]: oldVal });
    this.scheduleSave();
  }

  /**
   * Set multiple config values atomically. Single save, single change notification.
   */
  setBatch(updates: Partial<KxAIConfigParsed>): void {
    const changes: Partial<KxAIConfigParsed> = {};
    const oldValues: Record<string, unknown> = {};
    let hasChanges = false;

    for (const [key, value] of Object.entries(updates)) {
      const k = key as keyof KxAIConfigParsed;
      const oldVal = this.config[k];
      if (oldVal !== value) {
        (changes as any)[k] = value;
        oldValues[key] = oldVal;
        (this.config as any)[k] = value;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.notifyChange(changes, oldValues);
      this.scheduleSave();
    }
  }

  /**
   * Get a shallow copy of the full config.
   */
  getAll(): KxAIConfigParsed {
    return { ...this.config };
  }

  // ────────────── Reactive subscriptions ──────────────

  /**
   * Subscribe to changes of a specific config key.
   * Returns an unsubscribe function.
   *
   * @example
   * const unsub = config.onChange('aiProvider', (newVal, oldVal) => {
   *   aiService.reinitialize();
   * });
   */
  onChange<K extends keyof KxAIConfigParsed>(key: K, callback: ChangeCallback<K>): () => void {
    const keyStr = key as string;
    if (!this.keyListeners.has(keyStr)) {
      this.keyListeners.set(keyStr, new Set());
    }
    this.keyListeners.get(keyStr)!.add(callback);
    return () => {
      this.keyListeners.get(keyStr)?.delete(callback);
    };
  }

  /**
   * Subscribe to any config change. Callback receives the changed keys/values.
   * Returns an unsubscribe function.
   */
  onAnyChange(callback: AnyChangeCallback): () => void {
    this.anyListeners.add(callback);
    return () => {
      this.anyListeners.delete(callback);
    };
  }

  /**
   * Notify all relevant listeners about config changes.
   * Also emits 'change' event for main-process wiring (e.g. push to renderer).
   */
  private notifyChange(changes: Partial<KxAIConfigParsed>, oldValues: Record<string, unknown>): void {
    // Per-key listeners
    for (const [key, newVal] of Object.entries(changes)) {
      const listeners = this.keyListeners.get(key);
      if (listeners) {
        for (const cb of listeners) {
          try {
            cb(newVal, oldValues[key]);
          } catch (err) {
            log.error(`Config onChange listener error for key "${key}":`, err);
          }
        }
      }
    }

    // Any-change listeners
    for (const cb of this.anyListeners) {
      try {
        cb(changes);
      } catch (err) {
        log.error('Config onAnyChange listener error:', err);
      }
    }

    // EventEmitter event — used by main.ts to push to renderer via IPC
    this.emit('change', changes);
  }

  // ────────────── Onboarding ──────────────

  isOnboarded(): boolean {
    return this.config.onboarded === true;
  }

  async completeOnboarding(data: {
    userName: string;
    userRole: string;
    userDescription: string;
    agentName?: string;
    agentEmoji?: string;
    aiProvider: 'openai' | 'anthropic';
    aiModel: string;
  }): Promise<void> {
    this.setBatch({
      ...data,
      onboarded: true,
    });
    // Force immediate save for onboarding (critical path)
    await this.forceSave();
  }

  // ────────────── Shutdown ──────────────

  async shutdown(): Promise<void> {
    await this.forceSave();
    this.keyListeners.clear();
    this.anyListeners.clear();
    this.removeAllListeners();
  }
}
