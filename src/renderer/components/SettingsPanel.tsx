import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { KxAIConfig, RAGFolderInfo, UpdateState } from '../types';
import type { McpServerConfig, McpHubStatus, McpRegistryEntry, McpCategory, McpSetupType } from '@shared/types/mcp';
import type { CalendarStatus, CalendarInfo, CalendarProvider } from '@shared/types/calendar';
import type { TelegramStatus } from '@shared/types/telegram';
import s from './SettingsPanel.module.css';
import { cn } from '../utils/cn';
import { useTranslation } from '../i18n';
import { Toggle } from './ui';

interface SettingsPanelProps {
  config: KxAIConfig;
  onBack: () => void;
  onConfigUpdate: () => void;
}

const MODELS = {
  openai: [
    // GPT-5 family (latest)
    { value: 'gpt-5.2', label: 'GPT-5.2 (Flagship)' },
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
    { value: 'gpt-5-nano', label: 'GPT-5 Nano' },
    // Reasoning models
    { value: 'o3', label: 'o3 (Reasoning)' },
    { value: 'o4-mini', label: 'o4-mini (Reasoning)' },
    // GPT-4 family (legacy)
    { value: 'gpt-4o', label: 'GPT-4o (Legacy)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Legacy)' },
  ],
  anthropic: [
    // Latest models
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    // Previous generation
    { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { value: 'claude-sonnet-4-0', label: 'Claude Sonnet 4' },
  ],
};

type SettingsTabId = 'general' | 'persona' | 'memory' | 'knowledge' | 'mcp' | 'calendar' | 'telegram' | 'privacy';

const DEFAULT_INDEXED_EXTENSIONS =
  '.ts, .tsx, .js, .jsx, .py, .md, .txt, .json, .yaml, .yml, .xml, .csv, .pdf, .docx, .epub';

function formatIndexedExtensions(extensions?: string[]): string {
  if (!extensions || extensions.length === 0) return '';
  return extensions.join(', ');
}

function parseIndexedExtensions(input: string): string[] | undefined {
  const parsed = input
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`));

  if (parsed.length === 0) return undefined;
  return Array.from(new Set(parsed));
}

// ─── Privacy & Clipboard Tab ───
function PrivacyTab() {
  const { t } = useTranslation();
  const [clipboardStatus, setClipboardStatus] = useState<{ monitoring: boolean; totalEntries: number } | null>(null);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState('');

  useEffect(() => {
    loadClipboardStatus();
  }, []);

  async function loadClipboardStatus() {
    try {
      const status = await window.kxai.clipboardGetStatus();
      setClipboardStatus(status);
    } catch {
      /* ignore */
    }
  }

  async function toggleClipboard() {
    if (!clipboardStatus) return;
    try {
      if (clipboardStatus.monitoring) {
        await window.kxai.clipboardStopMonitoring();
      } else {
        await window.kxai.clipboardStartMonitoring();
      }
      await loadClipboardStatus();
    } catch (err) {
      console.error('Clipboard toggle error:', err);
    }
  }

  async function handleExport() {
    setPrivacyLoading(true);
    setPrivacyMessage('');
    try {
      const result = await window.kxai.privacyExportData();
      if (result.success) {
        setPrivacyMessage(t('settings.privacy.exported', { path: result.exportPath || '?' }));
      }
    } catch (err: any) {
      setPrivacyMessage(t('settings.common.error', { message: err.message || 'Export failed' }));
    } finally {
      setPrivacyLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm(t('settings.privacy.deleteConfirm'))) return;
    setPrivacyLoading(true);
    setPrivacyMessage('');
    try {
      await window.kxai.privacyDeleteData();
      setPrivacyMessage(t('settings.privacy.deleted'));
    } catch (err: any) {
      setPrivacyMessage(t('settings.common.error', { message: err.message || 'Delete failed' }));
    } finally {
      setPrivacyLoading(false);
    }
  }

  return (
    <div className="fade-in">
      {/* Clipboard monitoring */}
      <div className={s.section}>
        <h3 className={s.sectionTitle}>{t('settings.privacy.clipboardSection')}</h3>
        <p className={s.hint}>{t('settings.privacy.clipboardDesc')}</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <button
            className={clipboardStatus?.monitoring ? s.mcpBtnSmallAccent : s.mcpBtnPrimary}
            onClick={toggleClipboard}
          >
            {clipboardStatus?.monitoring
              ? '⏹ ' + t('settings.privacy.clipboardEnabled')
              : '▶ ' + t('settings.privacy.clipboardToggle')}
          </button>
          {clipboardStatus && (
            <span className={s.hint}>
              {clipboardStatus.totalEntries} {t('settings.privacy.entries')}
            </span>
          )}
        </div>
      </div>

      {/* Privacy & GDPR */}
      <div className={s.section}>
        <h3 className={s.sectionTitle}>{t('settings.privacy.title')}</h3>
        <p className={s.hint}>{t('settings.privacy.description')}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          <div>
            <button className={s.mcpBtnPrimary} onClick={handleExport} disabled={privacyLoading}>
              {privacyLoading ? t('settings.privacy.exporting') : t('settings.privacy.export')}
            </button>
            <p className={s.hint} style={{ marginTop: 4 }}>
              {t('settings.privacy.exportDesc')}
            </p>
          </div>

          <div>
            <button
              className={s.mcpBtnSmall}
              onClick={handleDelete}
              disabled={privacyLoading}
              style={{ color: 'var(--neon-magenta)' }}
            >
              {privacyLoading ? t('settings.privacy.deleting') : t('settings.privacy.delete')}
            </button>
            <p className={s.hint} style={{ marginTop: 4 }}>
              {t('settings.privacy.deleteDesc')}
            </p>
          </div>
        </div>

        {privacyMessage && (
          <div className={s.hint} style={{ marginTop: 12, color: 'var(--accent)' }}>
            {privacyMessage}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Telegram Bot Tab ───
function TelegramTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState('');
  const [allowedChats, setAllowedChats] = useState('');
  const [allowedUsernames, setAllowedUsernames] = useState('');
  const [autoStartLocal, setAutoStartLocal] = useState(false);
  const [autoStartDirty, setAutoStartDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadStatus();
    const unsub = window.kxai.onTelegramStatus((s) => {
      setStatus(s);
      if (!autoStartDirty) {
        setAutoStartLocal(s.autoStart);
      }
    });
    return unsub;
  }, [autoStartDirty]);

  async function loadStatus() {
    try {
      const s = await window.kxai.telegramGetStatus();
      setStatus(s);
      setAllowedChats(s.allowedChatIds.length > 0 ? s.allowedChatIds.join(', ') : '');
      setAllowedUsernames(s.allowedUsernames.length > 0 ? s.allowedUsernames.join(', ') : '');
      setAutoStartLocal(s.autoStart);
      setAutoStartDirty(false);
    } catch {
      /* ignore */
    }
  }

  async function handleSetToken() {
    if (!token.trim()) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await window.kxai.telegramSetToken(token.trim());
      if (result.success) {
        setMessage(`✅ ${t('settings.telegram.connected')} @${result.botUsername}`);
        setToken('');
        await loadStatus();
      } else {
        setMessage(t('settings.common.error', { message: result.error || 'Unknown error' }));
      }
    } catch (err: any) {
      setMessage(t('settings.common.error', { message: err.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveToken() {
    setLoading(true);
    try {
      await window.kxai.telegramRemoveToken();
      setMessage(t('settings.telegram.tokenRemoved'));
      await loadStatus();
    } catch (err: any) {
      setMessage(t('settings.common.error', { message: err.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleStart() {
    setLoading(true);
    setMessage('');
    try {
      const result = await window.kxai.telegramStart();
      if (result.success) {
        setMessage(`✅ ${t('settings.telegram.pollingStarted')}`);
      } else {
        setMessage(t('settings.common.error', { message: result.error || 'Unknown error' }));
      }
      await loadStatus();
    } catch (err: any) {
      setMessage(t('settings.common.error', { message: err.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    try {
      await window.kxai.telegramStop();
      setMessage(t('settings.telegram.pollingStopped'));
      await loadStatus();
    } catch (err: any) {
      setMessage(t('settings.common.error', { message: err.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveAllowedChats() {
    const chatIds = allowedChats
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n) && n !== 0);
    try {
      await window.kxai.telegramSetAllowedChats(chatIds);
      setMessage(`✅ ${t('settings.telegram.chatsSaved')}`);
      await loadStatus();
    } catch (err: any) {
      setMessage(t('settings.common.error', { message: err.message }));
    }
  }

  async function handleSaveAllowedUsernames() {
    const usernames = allowedUsernames
      .split(',')
      .map((s) => s.trim().replace(/^@/, ''))
      .filter(Boolean);
    try {
      await window.kxai.telegramSetAllowedUsernames(usernames);
      setMessage(`✅ ${t('settings.telegram.usernamesSaved')}`);
      await loadStatus();
    } catch (err: any) {
      setMessage(t('settings.common.error', { message: err.message }));
    }
  }

  async function handleToggleDenyByDefault() {
    const newVal = !(status?.denyByDefault ?? true);
    try {
      await window.kxai.telegramSetDenyByDefault(newVal);
      await loadStatus();
    } catch (err: any) {
      setMessage(t('settings.common.error', { message: err.message }));
    }
  }

  async function handleSaveAutoStart() {
    if (loading) return;
    setLoading(true);
    try {
      await window.kxai.telegramSetAutoStart(autoStartLocal);
      setMessage(t('settings.common.saved'));
      await loadStatus();
    } catch (err: any) {
      setMessage(t('settings.common.error', { message: err.message }));
    } finally {
      setLoading(false);
    }
  }

  const isConnected = status?.status === 'connected';
  const isPolling = status?.polling;
  const hasToken = status?.hasToken;

  return (
    <div className="fade-in">
      <div className={s.section}>
        <h3 className={s.sectionTitle}>{t('settings.telegram.title')}</h3>
        <p className={s.hint}>{t('settings.telegram.description')}</p>

        {/* Status */}
        {status && (
          <div className={s.mcpServerItem} style={{ marginBottom: 12 }}>
            <div className={s.mcpServerHeader}>
              <div className={s.mcpServerInfo}>
                <span className={s.mcpServerIcon}>🤖</span>
                <div>
                  <div className={s.mcpServerName}>
                    {status.botUsername ? `@${status.botUsername}` : 'Telegram Bot'}
                  </div>
                  <div className={s.mcpServerTransport}>
                    {t('settings.telegram.status')}: {t(`settings.telegram.state.${status.status}`)}
                    {isPolling && ` · ${t('settings.telegram.messagesProcessed')}: ${status.messagesProcessed}`}
                  </div>
                  {status.lastError && (
                    <div className={s.mcpServerTransport} style={{ color: 'var(--neon-magenta)' }}>
                      {status.lastError}
                    </div>
                  )}
                </div>
              </div>
              <div className={s.mcpServerActions}>
                <span className={isConnected ? s.mcpBadgeConnected : s.mcpBadgeError}>
                  {isPolling ? `🟢 ${t('settings.telegram.online')}` : `⚪ ${t('settings.telegram.offline')}`}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Bot Token */}
        <div style={{ marginBottom: 16 }}>
          <label className={s.label}>{t('settings.telegram.botToken')}</label>
          <p className={s.hint}>{t('settings.telegram.botTokenHint')}</p>
          {hasToken ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <span style={{ color: 'var(--accent)' }}>✅ {t('settings.telegram.tokenStored')}</span>
              <button className={s.mcpBtnSmall} onClick={handleRemoveToken} disabled={loading}>
                {t('settings.telegram.removeToken')}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="password"
                className={s.input}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:ABCdef..."
                style={{ flex: 1 }}
              />
              <button className={s.mcpBtnPrimary} onClick={handleSetToken} disabled={loading || !token.trim()}>
                {t('settings.telegram.saveToken')}
              </button>
            </div>
          )}
        </div>

        {/* Start/Stop polling */}
        {hasToken && (
          <div style={{ marginBottom: 16 }}>
            <label className={s.label}>{t('settings.telegram.polling')}</label>
            <p className={s.hint}>{t('settings.telegram.pollingHint')}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
              {isPolling ? (
                <button className={s.mcpBtnSmallAccent} onClick={handleStop} disabled={loading}>
                  ⏹ {t('settings.telegram.stop')}
                </button>
              ) : (
                <button className={s.mcpBtnPrimary} onClick={handleStart} disabled={loading}>
                  ▶ {t('settings.telegram.start')}
                </button>
              )}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <input type="checkbox" checked={autoStartLocal} onChange={(e) => setAutoStartLocal(e.target.checked)} />
                {t('settings.telegram.autoStart')}
              </label>
              <button
                className={s.mcpBtnSmallAccent}
                onClick={handleSaveAutoStart}
                disabled={loading || autoStartLocal === status?.autoStart}
              >
                {t('settings.telegram.save')}
              </button>
            </div>
          </div>
        )}

        {/* Allowed Chat IDs */}
        {hasToken && (
          <div style={{ marginBottom: 16 }}>
            <label className={s.label}>{t('settings.telegram.allowedChats')}</label>
            <p className={s.hint}>{t('settings.telegram.allowedChatsHint')}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                className={s.input}
                value={allowedChats}
                onChange={(e) => setAllowedChats(e.target.value)}
                placeholder={t('settings.telegram.allowedChatsPlaceholder')}
                style={{ flex: 1 }}
              />
              <button className={s.mcpBtnSmallAccent} onClick={handleSaveAllowedChats} disabled={loading}>
                {t('settings.telegram.save')}
              </button>
            </div>
          </div>
        )}

        {/* Allowed Usernames */}
        {hasToken && (
          <div style={{ marginBottom: 16 }}>
            <label className={s.label}>{t('settings.telegram.allowedUsernames')}</label>
            <p className={s.hint}>{t('settings.telegram.allowedUsernamesHint')}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                className={s.input}
                value={allowedUsernames}
                onChange={(e) => setAllowedUsernames(e.target.value)}
                placeholder={t('settings.telegram.allowedUsernamesPlaceholder')}
                style={{ flex: 1 }}
              />
              <button className={s.mcpBtnSmallAccent} onClick={handleSaveAllowedUsernames} disabled={loading}>
                {t('settings.telegram.save')}
              </button>
            </div>
          </div>
        )}

        {/* Deny by default */}
        {hasToken && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={status?.denyByDefault ?? true} onChange={handleToggleDenyByDefault} />
              <span className={s.label} style={{ margin: 0 }}>
                {t('settings.telegram.denyByDefault')}
              </span>
            </label>
            <p className={s.hint}>{t('settings.telegram.denyByDefaultHint')}</p>
          </div>
        )}

        {/* Setup guide */}
        {!hasToken && (
          <div
            className={s.section}
            style={{ marginTop: 12, padding: 12, background: 'rgba(0,255,136,0.05)', borderRadius: 8 }}
          >
            <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>📋 {t('settings.telegram.setupGuide')}</h4>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
              <li>{t('settings.telegram.step1')}</li>
              <li>{t('settings.telegram.step2')}</li>
              <li>{t('settings.telegram.step3')}</li>
              <li>{t('settings.telegram.step4')}</li>
            </ol>
          </div>
        )}

        {message && (
          <div className={s.hint} style={{ marginTop: 12, color: 'var(--accent)' }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPanel({ config, onBack, onConfigUpdate }: SettingsPanelProps) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState(config.aiProvider || 'openai');
  const [model, setModel] = useState(config.aiModel || 'gpt-5');
  const [userName, setUserName] = useState(config.userName || '');
  const [userRole, setUserRole] = useState(config.userRole || '');
  const [userDescription, setUserDescription] = useState(config.userDescription || '');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [deepgramKey, setDeepgramKey] = useState('');
  const [hasDeepgramKey, setHasDeepgramKey] = useState(false);
  const [embeddingKey, setEmbeddingKey] = useState('');
  const [hasEmbeddingKey, setHasEmbeddingKey] = useState(false);
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [hasElevenLabsKey, setHasElevenLabsKey] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsProvider, setTtsProvider] = useState<'elevenlabs' | 'openai' | 'web'>('elevenlabs');
  const [ttsElVoiceId, setTtsElVoiceId] = useState('onwK4e9ZLuTAKqWW03F9');
  const [ttsElModel, setTtsElModel] = useState('eleven_multilingual_v2');
  const [ttsOpenaiVoice, setTtsOpenaiVoice] = useState('onyx');
  const [ttsOpenaiModel, setTtsOpenaiModel] = useState('tts-1-hd');
  const [proactiveMode, setProactiveMode] = useState(Boolean(config.proactiveMode));
  const [cortexEnabled, setCortexEnabled] = useState(config.cortexEnabled !== false);
  const [cortexIntensity, setCortexIntensity] = useState(config.cortexIntensity || 'balanced');
  const [cortexActiveHoursStart, setCortexActiveHoursStart] = useState(config.cortexActiveHoursStart || '07:00');
  const [cortexActiveHoursEnd, setCortexActiveHoursEnd] = useState(config.cortexActiveHoursEnd || '23:00');
  const [embeddingModel, setEmbeddingModel] = useState(config.embeddingModel || 'text-embedding-3-small');
  const [useNativeFunctionCalling, setUseNativeFunctionCalling] = useState(config.useNativeFunctionCalling ?? true);
  const [indexedExtensionsInput, setIndexedExtensionsInput] = useState(
    formatIndexedExtensions(config.indexedExtensions),
  );
  const [proactiveInterval, setProactiveInterval] = useState((config.proactiveIntervalMs || 30000) / 1000);
  const [agentName, setAgentName] = useState(config.agentName || 'KxAI');
  const [agentEmoji, setAgentEmoji] = useState(config.agentEmoji || '🤖');
  const [saving, setSaving] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [userContent, setUserContent] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollTabsLeft, setCanScrollTabsLeft] = useState(false);
  const [canScrollTabsRight, setCanScrollTabsRight] = useState(false);
  const [folderStats, setFolderStats] = useState<RAGFolderInfo[]>([]);
  const [ragStats, setRagStats] = useState<{
    totalChunks: number;
    totalFiles: number;
    embeddingType: string;
    embeddingModel?: string;
    embeddingDimension?: number;
  } | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  // MCP state
  const [mcpStatus, setMcpStatus] = useState<McpHubStatus | null>(null);
  const [mcpRegistry, setMcpRegistry] = useState<McpRegistryEntry[]>([]);
  const [mcpAddingServer, setMcpAddingServer] = useState(false);
  const [mcpShowAddForm, setMcpShowAddForm] = useState(false);
  const [mcpNewServer, setMcpNewServer] = useState({
    name: '',
    transport: 'stdio' as 'streamable-http' | 'sse' | 'stdio',
    url: '',
    command: '',
    args: '',
    env: '',
    autoConnect: true,
  });
  const [mcpEnvEditing, setMcpEnvEditing] = useState<string | null>(null);
  const [mcpEnvInput, setMcpEnvInput] = useState('');
  const [mcpEnvRegistryEntry, setMcpEnvRegistryEntry] = useState<McpRegistryEntry | null>(null);
  const [mcpEnvFields, setMcpEnvFields] = useState<Record<string, string>>({});
  const [mcpOAuthRunning, setMcpOAuthRunning] = useState(false);
  const [mcpSearchQuery, setMcpSearchQuery] = useState('');
  const [mcpFilterCategory, setMcpFilterCategory] = useState<McpCategory | ''>('');
  const [mcpCategories, setMcpCategories] = useState<McpCategory[]>([]);

  // Calendar state
  const [calStatus, setCalStatus] = useState<CalendarStatus | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [calShowAddForm, setCalShowAddForm] = useState(false);
  const [calCalendars, setCalCalendars] = useState<Record<string, CalendarInfo[]>>({});
  const [calNewConn, setCalNewConn] = useState({
    name: '',
    provider: 'caldav' as CalendarProvider,
    serverUrl: '',
    username: '',
    password: '',
    googleClientId: '',
    googleClientSecret: '',
  });

  const tabs: Array<{ id: SettingsTabId; label: string }> = [
    { id: 'general', label: t('settings.tabs.general') },
    { id: 'persona', label: t('settings.tabs.persona') },
    { id: 'memory', label: t('settings.tabs.memory') },
    { id: 'knowledge', label: t('settings.tabs.knowledge') },
    { id: 'mcp', label: t('settings.tabs.mcp') },
    { id: 'calendar', label: t('settings.tabs.calendar') },
    { id: 'telegram', label: t('settings.tabs.telegram') },
    { id: 'privacy', label: t('settings.tabs.privacy') },
  ];

  const updateTabsScrollState = useCallback(() => {
    const el = tabsScrollRef.current;
    if (!el) {
      setCanScrollTabsLeft(false);
      setCanScrollTabsRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    setCanScrollTabsLeft(el.scrollLeft > 1);
    setCanScrollTabsRight(el.scrollLeft < maxScrollLeft - 1);
  }, []);

  const scrollTabsBy = useCallback((delta: number) => {
    const el = tabsScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  const handleTabsWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const el = tabsScrollRef.current;
      if (!el) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        el.scrollLeft += event.deltaY;
        updateTabsScrollState();
      }
    },
    [updateTabsScrollState],
  );

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number;
      if (event.key === 'ArrowRight') {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else {
        return;
      }

      event.preventDefault();
      const nextTab = tabs[nextIndex];
      if (!nextTab) return;
      setActiveTab(nextTab.id);

      requestAnimationFrame(() => {
        const nextTabButton = tabsScrollRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${nextTab.id}"]`);
        nextTabButton?.focus();
      });
    },
    [tabs],
  );

  useEffect(() => {
    checkApiKey();
    loadFiles();
    loadKnowledgeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;

    updateTabsScrollState();
    const onScroll = () => updateTabsScrollState();
    const onResize = () => updateTabsScrollState();

    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [updateTabsScrollState]);

  useEffect(() => {
    const activeButton = tabsScrollRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${activeTab}"]`);
    activeButton?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    updateTabsScrollState();
  }, [activeTab, updateTabsScrollState]);

  async function checkApiKey() {
    const has = await window.kxai.hasApiKey(provider);
    setHasKey(has);
    const hasEl = await window.kxai.hasApiKey('deepgram');
    setHasDeepgramKey(hasEl);
    // Check dedicated embedding key OR main OpenAI key (EmbeddingService uses it as fallback)
    const hasEmb = await window.kxai.hasApiKey('openai-embeddings');
    const hasMainOpenAI = await window.kxai.hasApiKey('openai');
    setHasEmbeddingKey(hasEmb || hasMainOpenAI);
    const hasEL = await window.kxai.hasApiKey('elevenlabs');
    setHasElevenLabsKey(hasEL);
    try {
      const tts = await window.kxai.ttsGetConfig();
      setTtsEnabled(tts.enabled);
      setTtsProvider(tts.provider);
      setTtsElVoiceId(tts.elevenLabsVoiceId);
      setTtsElModel(tts.elevenLabsModel);
      setTtsOpenaiVoice(tts.openaiVoice);
      setTtsOpenaiModel(tts.openaiModel);
    } catch {
      // TTS settings may not exist yet — use defaults
    }
  }

  async function loadFiles() {
    const soul = await window.kxai.getMemory('SOUL.md');
    const user = await window.kxai.getMemory('USER.md');
    const memory = await window.kxai.getMemory('MEMORY.md');
    if (soul) setSoulContent(soul);
    if (user) setUserContent(user);
    if (memory) setMemoryContent(memory);
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const normalizedInterval = Math.max(5, Math.min(300, Math.round(Number(proactiveInterval) || 60)));
      setProactiveInterval(normalizedInterval);

      // Save all config changes in a single batch (1 IPC call + 1 write)
      await window.kxai.setConfigBatch({
        userName: userName.trim() || undefined,
        userRole: userRole.trim() || undefined,
        userDescription: userDescription.trim() || undefined,
        aiProvider: provider,
        aiModel: model,
        agentName,
        agentEmoji,
        proactiveMode,
        proactiveIntervalMs: normalizedInterval * 1000,
        cortexEnabled,
        cortexIntensity,
        cortexActiveHoursStart,
        cortexActiveHoursEnd,
        embeddingModel,
        useNativeFunctionCalling,
        indexedExtensions: parseIndexedExtensions(indexedExtensionsInput),
      });

      // Apply Cortex Engine state
      await window.kxai.cortexSetEnabled(cortexEnabled);
      if (cortexEnabled) {
        await window.kxai.cortexSetIntensity(cortexIntensity);
      }

      // Legacy proactive mode (for backward compat)
      await window.kxai.setProactiveMode(proactiveMode);

      // Save API key if provided
      if (apiKey.trim()) {
        await window.kxai.setApiKey(provider, apiKey.trim());
        setApiKey('');
        setHasKey(true);
      }

      // Save Deepgram key if provided
      if (deepgramKey.trim()) {
        await window.kxai.setApiKey('deepgram', deepgramKey.trim());
        setDeepgramKey('');
        setHasDeepgramKey(true);
      }

      // Save embedding API key if provided
      if (embeddingKey.trim()) {
        await window.kxai.setApiKey('openai-embeddings', embeddingKey.trim());
        setEmbeddingKey('');
        setHasEmbeddingKey(true);
      }

      // Save TTS config
      await window.kxai.ttsSetConfig({
        enabled: ttsEnabled,
        provider: ttsProvider,
        elevenLabsVoiceId: ttsElVoiceId,
        elevenLabsModel: ttsElModel,
        openaiVoice: ttsOpenaiVoice,
        openaiModel: ttsOpenaiModel,
      });

      // Save ElevenLabs API key if provided
      if (elevenLabsKey.trim()) {
        await window.kxai.setApiKey('elevenlabs', elevenLabsKey.trim());
        setElevenLabsKey('');
        setHasElevenLabsKey(true);
      }

      onConfigUpdate();
    } catch (error) {
      console.error('Save settings error:', error);
    }
    setSaving(false);
  }

  async function saveSoul() {
    await window.kxai.setMemory('SOUL.md', soulContent);
  }

  async function saveUser() {
    await window.kxai.setMemory('USER.md', userContent);
  }

  async function saveMemory() {
    await window.kxai.setMemory('MEMORY.md', memoryContent);
  }

  async function loadKnowledgeData() {
    try {
      const stats = await window.kxai.ragStats();
      setRagStats(stats);
      const folders = await window.kxai.ragFolderStats();
      setFolderStats(folders);
    } catch (err) {
      console.error('Failed to load knowledge data:', err);
    }
  }

  async function handleAddFolder() {
    const result = await window.kxai.ragPickFolder();
    if (result.success) {
      await loadKnowledgeData();
    } else if (result.error && result.error !== 'cancelled') {
      alert(result.error);
    }
  }

  async function handleRemoveFolder(folderPath: string) {
    if (!confirm(t('settings.knowledge.removeFolderConfirm', { path: folderPath }))) return;
    await window.kxai.ragRemoveFolder(folderPath);
    await loadKnowledgeData();
  }

  async function handleReindex() {
    setReindexing(true);
    try {
      await window.kxai.ragReindex();
      await loadKnowledgeData();
    } catch (err) {
      console.error('Reindex failed:', err);
    } finally {
      setReindexing(false);
    }
  }

  // ─── Auto-update ───
  useEffect(() => {
    window.kxai
      .updateGetState()
      .then(setUpdateState)
      .catch(() => {});
    const unsub = window.kxai.onUpdateState(setUpdateState);
    return unsub;
  }, []);

  async function checkForUpdates() {
    try {
      const state = await window.kxai.updateCheck();
      setUpdateState(state);
    } catch (err) {
      console.error('Update check error:', err);
    }
  }

  async function downloadUpdate() {
    try {
      await window.kxai.updateDownload();
    } catch (err) {
      console.error('Update download error:', err);
    }
  }

  async function installUpdate() {
    try {
      await window.kxai.updateInstall();
    } catch (err) {
      console.error('Update install error:', err);
    }
  }

  async function clearHistory() {
    if (confirm(t('settings.general.clearHistoryConfirm'))) {
      await window.kxai.clearConversationHistory();
    }
  }

  // ── MCP Functions ──
  const loadMcpData = useCallback(async () => {
    try {
      const [status, registry, categories] = await Promise.all([
        window.kxai.mcpGetStatus(),
        window.kxai.mcpGetRegistry(),
        window.kxai.mcpGetCategories(),
      ]);
      setMcpStatus(status);
      setMcpRegistry(registry);
      setMcpCategories(categories);
    } catch (err) {
      console.error('Failed to load MCP data:', err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'mcp') {
      loadMcpData();
      const unsub = window.kxai.onMcpStatus((status: McpHubStatus) => {
        setMcpStatus(status);
      });
      return unsub;
    }
  }, [activeTab, loadMcpData]);

  async function handleMcpConnect(id: string) {
    try {
      await window.kxai.mcpConnect(id);
      await loadMcpData();
    } catch (err) {
      console.error('MCP connect error:', err);
    }
  }

  async function handleMcpDisconnect(id: string) {
    try {
      await window.kxai.mcpDisconnect(id);
      await loadMcpData();
    } catch (err) {
      console.error('MCP disconnect error:', err);
    }
  }

  async function handleMcpRemove(id: string, name: string) {
    if (!confirm(t('settings.mcp.removeConfirm', { name }))) return;
    try {
      await window.kxai.mcpRemoveServer(id);
      await loadMcpData();
    } catch (err) {
      console.error('MCP remove error:', err);
    }
  }

  async function handleMcpAddFromRegistry(entry: McpRegistryEntry) {
    setMcpAddingServer(true);
    try {
      const config: Omit<McpServerConfig, 'id'> = {
        name: entry.name,
        transport: entry.transport,
        url: entry.url,
        command: entry.command,
        args: entry.args,
        env: entry.env,
        autoConnect: true,
        enabled: true,
        icon: entry.icon,
        category: entry.category,
      };
      const added = await window.kxai.mcpAddServer(config);

      if (added && !entry.requiresSetup) {
        // No setup needed — auto-connect immediately
        await window.kxai.mcpConnect(added.id);
      } else if (added && entry.requiresSetup && entry.setupType === 'env' && entry.requiredEnvVars?.length) {
        // Open guided env setup for this server
        setMcpEnvEditing(added.id);
        setMcpEnvRegistryEntry(entry);
        setMcpEnvFields(Object.fromEntries(entry.requiredEnvVars.map((v) => [v, ''])));
      } else if (
        added &&
        entry.requiresSetup &&
        (entry.setupType === 'oauth-google' || entry.setupType === 'oauth-microsoft')
      ) {
        // Open env editor panel which will show OAuth authorize button
        setMcpEnvEditing(added.id);
        setMcpEnvRegistryEntry(entry);
        setMcpEnvFields({});
      }

      await loadMcpData();
    } catch (err) {
      console.error('MCP add from registry error:', err);
    } finally {
      setMcpAddingServer(false);
    }
  }

  async function handleMcpAddCustom() {
    if (!mcpNewServer.name) return;
    setMcpAddingServer(true);
    try {
      const envObj: Record<string, string> = {};
      if (mcpNewServer.env.trim()) {
        for (const line of mcpNewServer.env.split('\n')) {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            envObj[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
          }
        }
      }
      const config: Omit<McpServerConfig, 'id'> = {
        name: mcpNewServer.name,
        transport: mcpNewServer.transport,
        url: mcpNewServer.transport !== 'stdio' ? mcpNewServer.url : undefined,
        command: mcpNewServer.transport === 'stdio' ? mcpNewServer.command : undefined,
        args: mcpNewServer.transport === 'stdio' && mcpNewServer.args ? mcpNewServer.args.split(' ') : undefined,
        env: Object.keys(envObj).length > 0 ? envObj : undefined,
        autoConnect: mcpNewServer.autoConnect,
        enabled: true,
      };
      await window.kxai.mcpAddServer(config);
      setMcpShowAddForm(false);
      setMcpNewServer({ name: '', transport: 'stdio', url: '', command: '', args: '', env: '', autoConnect: true });
      await loadMcpData();
    } catch (err) {
      console.error('MCP add custom error:', err);
    } finally {
      setMcpAddingServer(false);
    }
  }

  async function handleMcpUpdateEnv(serverId: string) {
    try {
      const envObj: Record<string, string> = {};

      // If using guided fields, build env from those
      if (mcpEnvRegistryEntry?.requiredEnvVars?.length && Object.keys(mcpEnvFields).length > 0) {
        for (const [key, value] of Object.entries(mcpEnvFields)) {
          if (value.trim()) envObj[key] = value.trim();
        }
      } else {
        // Legacy: parse textarea KEY=VALUE format
        for (const line of mcpEnvInput.split('\n')) {
          const eqIdx = line.indexOf('=');
          if (eqIdx > 0) {
            envObj[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
          }
        }
      }

      // Remove and re-add with updated env
      const servers = await window.kxai.mcpListServers();
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;
      await window.kxai.mcpRemoveServer(serverId);
      const readded = await window.kxai.mcpAddServer({
        ...server,
        env: Object.keys(envObj).length > 0 ? envObj : undefined,
      });
      setMcpEnvEditing(null);
      setMcpEnvInput('');
      setMcpEnvRegistryEntry(null);
      setMcpEnvFields({});

      // Auto-connect after saving env vars
      if (readded && Object.keys(envObj).length > 0) {
        try {
          await window.kxai.mcpConnect(readded.id);
        } catch {
          // Connection may fail — user can retry manually
        }
      }

      await loadMcpData();
    } catch (err) {
      console.error('MCP update env error:', err);
    }
  }

  async function handleMcpRunOAuth(serverId: string) {
    setMcpOAuthRunning(true);
    try {
      const result = await window.kxai.mcpRunOAuthSetup(serverId);
      if (result.success) {
        // OAuth done — try connecting
        try {
          await window.kxai.mcpConnect(serverId);
        } catch {
          // Connection may fail if more setup needed
        }
        setMcpEnvEditing(null);
        setMcpEnvRegistryEntry(null);
      } else {
        alert(result.error || 'Autoryzacja OAuth nie powiodła się');
      }
      await loadMcpData();
    } catch (err) {
      console.error('MCP OAuth setup error:', err);
    } finally {
      setMcpOAuthRunning(false);
    }
  }

  function findRegistryEntryForServer(serverName: string): McpRegistryEntry | undefined {
    return mcpRegistry.find((e) => e.name.toLowerCase() === serverName.toLowerCase());
  }

  function getMcpStatusBadge(status: string) {
    switch (status) {
      case 'connected':
        return { text: t('settings.mcp.status.connected'), cls: s.mcpBadgeConnected };
      case 'connecting':
        return { text: t('settings.mcp.status.connecting'), cls: s.mcpBadgeConnecting };
      case 'reconnecting':
        return { text: t('settings.mcp.status.reconnecting'), cls: s.mcpBadgeConnecting };
      case 'error':
        return { text: t('settings.mcp.status.error'), cls: s.mcpBadgeError };
      default:
        return { text: t('settings.mcp.status.disconnected'), cls: s.mcpBadgeDisconnected };
    }
  }

  // ─── Calendar handlers ───

  const loadCalendarData = useCallback(async () => {
    try {
      setCalLoading(true);
      const status = await window.kxai.calendarGetStatus();
      setCalStatus(status);
    } catch (err) {
      console.error('Failed to load calendar data:', err);
    } finally {
      setCalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'calendar') {
      loadCalendarData();
      const unsub = window.kxai.onCalendarStatus((status: CalendarStatus) => {
        setCalStatus(status);
      });
      return unsub;
    }
  }, [activeTab, loadCalendarData]);

  async function handleCalendarAdd() {
    if (!calNewConn.name || !calNewConn.serverUrl) return;
    try {
      setCalLoading(true);
      const providerDefaults: Record<string, { serverUrl: string; authMethod: string }> = {
        google: { serverUrl: 'https://apidata.googleusercontent.com/caldav/v2/', authMethod: 'OAuth' },
        icloud: { serverUrl: 'https://caldav.icloud.com/', authMethod: 'Basic' },
        nextcloud: { serverUrl: calNewConn.serverUrl, authMethod: 'Basic' },
        caldav: { serverUrl: calNewConn.serverUrl, authMethod: 'Basic' },
      };
      const defaults = providerDefaults[calNewConn.provider] || providerDefaults.caldav;
      const connectionConfig: Record<string, unknown> = {
        name: calNewConn.name,
        provider: calNewConn.provider,
        serverUrl:
          calNewConn.provider === 'google' || calNewConn.provider === 'icloud'
            ? defaults.serverUrl
            : calNewConn.serverUrl,
        authMethod: defaults.authMethod as 'Basic' | 'OAuth' | 'Bearer',
        username: calNewConn.username || '',
        enabled: true,
      };

      // Pass Google OAuth credentials if provided
      if (calNewConn.provider === 'google') {
        if (calNewConn.googleClientId) connectionConfig.googleClientId = calNewConn.googleClientId;
        if (calNewConn.googleClientSecret) connectionConfig.googleClientSecret = calNewConn.googleClientSecret;
      }

      const result = await window.kxai.calendarAddConnection(connectionConfig as any);
      if (result.success && result.connectionId && calNewConn.password) {
        await window.kxai.calendarStoreCredential(result.connectionId, calNewConn.password);
      }
      setCalShowAddForm(false);
      setCalNewConn({
        name: '',
        provider: 'caldav',
        serverUrl: '',
        username: '',
        password: '',
        googleClientId: '',
        googleClientSecret: '',
      });
      await loadCalendarData();
    } catch (err) {
      console.error('Calendar add error:', err);
    } finally {
      setCalLoading(false);
    }
  }

  async function handleCalendarConnect(id: string) {
    try {
      await window.kxai.calendarConnect(id);
      await loadCalendarData();
    } catch (err) {
      console.error('Calendar connect error:', err);
    }
  }

  async function handleCalendarDisconnect(id: string) {
    try {
      await window.kxai.calendarDisconnect(id);
      await loadCalendarData();
    } catch (err) {
      console.error('Calendar disconnect error:', err);
    }
  }

  async function handleCalendarRemove(id: string, name: string) {
    if (!confirm(t('settings.calendar.removeConfirm', { name }))) return;
    try {
      await window.kxai.calendarRemoveConnection(id);
      await loadCalendarData();
    } catch (err) {
      console.error('Calendar remove error:', err);
    }
  }

  async function handleCalendarLoadCalendars(connectionId: string) {
    try {
      const calendars = await window.kxai.calendarGetCalendars(connectionId);
      setCalCalendars((prev) => ({ ...prev, [connectionId]: calendars }));
    } catch (err) {
      console.error('Calendar load calendars error:', err);
    }
  }

  function getCalStatusBadge(status: string) {
    switch (status) {
      case 'connected':
        return { text: t('settings.mcp.status.connected'), cls: s.mcpBadgeConnected };
      case 'connecting':
        return { text: t('settings.mcp.status.connecting'), cls: s.mcpBadgeConnecting };
      case 'error':
        return { text: t('settings.mcp.status.error'), cls: s.mcpBadgeError };
      default:
        return { text: t('settings.mcp.status.disconnected'), cls: s.mcpBadgeDisconnected };
    }
  }

  return (
    <div className={s.panel}>
      {/* Header */}
      <div className={s.header}>
        <button onClick={onBack} className={s.headerBack} aria-label="Back">
          ←
        </button>
        <span className={s.headerTitle}>{t('settings.title')}</span>
      </div>

      {/* Tabs */}
      <div className={s.tabsWrap}>
        <button
          className={s.tabsScrollBtn}
          onClick={() => scrollTabsBy(-180)}
          disabled={!canScrollTabsLeft}
          aria-label={t('settings.tabs.scrollLeft')}
        >
          ‹
        </button>

        <div className={s.tabsScroller} ref={tabsScrollRef} onWheel={handleTabsWheel} role="tablist">
          <div className={s.tabs}>
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                data-tab-id={tab.id}
                className={activeTab === tab.id ? s.tabActive : s.tab}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                role="tab"
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <button
          className={s.tabsScrollBtn}
          onClick={() => scrollTabsBy(180)}
          disabled={!canScrollTabsRight}
          aria-label={t('settings.tabs.scrollRight')}
        >
          ›
        </button>
      </div>

      {/* Content */}
      <div className={s.content}>
        {activeTab === 'general' && (
          <div className="fade-in">
            {/* User profile */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.userProfile')}</h3>

              <label className={s.label}>{t('settings.general.userName')}</label>
              <input
                className={s.input}
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder={t('settings.general.userName')}
              />

              <label className={s.label}>{t('settings.general.userRole')}</label>
              <input
                className={s.input}
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                placeholder={t('settings.general.userRole')}
              />

              <label className={s.label}>{t('settings.general.userDescription')}</label>
              <textarea
                className={cn(s.textarea, s.textareaCompact)}
                value={userDescription}
                onChange={(e) => setUserDescription(e.target.value)}
                placeholder={t('settings.general.userDescriptionPlaceholder')}
              />
            </div>

            {/* Agent identity */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.agentSection')}</h3>

              <label className={s.label}>{t('settings.general.name')}</label>
              <input
                className={s.input}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                title={t('settings.general.name')}
              />

              <label className={s.label}>{t('settings.general.emoji')}</label>
              <div className={s.emojiGrid}>
                {['🤖', '🧠', '⚡', '🔮', '🦾', '🎯', '💡', '🚀'].map((e) => (
                  <button
                    key={e}
                    onClick={() => setAgentEmoji(e)}
                    className={agentEmoji === e ? s.emojiBtnSelected : s.emojiBtn}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* Cortex Engine */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.cortexSection')}</h3>

              <div className={s.toggleRow}>
                <div className={s.toggleMeta}>
                  <div className={s.toggleTitle}>{t('settings.general.cortexToggle')}</div>
                  <p className={s.hint}>
                    {cortexEnabled ? t('settings.general.cortexEnabledHint') : t('settings.general.cortexDisabledHint')}
                  </p>
                </div>
                <Toggle
                  checked={cortexEnabled}
                  onChange={setCortexEnabled}
                  aria-label={t('settings.general.cortexToggle')}
                />
              </div>

              {cortexEnabled && (
                <>
                  <label className={s.label}>{t('settings.general.cortexIntensity')}</label>
                  <select
                    className={s.select}
                    value={cortexIntensity}
                    onChange={(e) => setCortexIntensity(e.target.value as any)}
                    title={t('settings.general.cortexIntensity')}
                  >
                    <option value="eco">{t('settings.general.cortexEco')}</option>
                    <option value="balanced">{t('settings.general.cortexBalanced')}</option>
                    <option value="performance">{t('settings.general.cortexPerformance')}</option>
                  </select>
                  <p className={s.hint}>{t('settings.general.cortexIntensityHint')}</p>

                  <div className={s.grid2}>
                    <div>
                      <label className={s.label}>{t('settings.general.activeHoursStart')}</label>
                      <input
                        type="time"
                        className={s.input}
                        value={cortexActiveHoursStart}
                        onChange={(e) => setCortexActiveHoursStart(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={s.label}>{t('settings.general.activeHoursEnd')}</label>
                      <input
                        type="time"
                        className={s.input}
                        value={cortexActiveHoursEnd}
                        onChange={(e) => setCortexActiveHoursEnd(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className={s.hint}>{t('settings.general.activeHoursHint')}</p>
                </>
              )}

              <div className={s.toggleRow}>
                <div className={s.toggleMeta}>
                  <div className={s.toggleTitle}>{t('settings.general.nativeFc')}</div>
                  <p className={s.hint}>{t('settings.general.nativeFcHint')}</p>
                </div>
                <Toggle
                  checked={useNativeFunctionCalling}
                  onChange={setUseNativeFunctionCalling}
                  aria-label={t('settings.general.nativeFc')}
                />
              </div>
            </div>

            {/* Language */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.language')}</h3>
              <select
                className={s.select}
                value={config?.userLanguage ?? 'pl'}
                onChange={(e) => window.kxai.setConfigBatch({ userLanguage: e.target.value })}
              >
                <option value="pl">🇵🇱 Polski</option>
                <option value="en">🇬🇧 English</option>
              </select>
              <small className={s.hint}>{t('settings.general.languageHint')}</small>
            </div>

            {/* AI Provider */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.aiProvider')}</h3>

              <label className={s.label}>{t('settings.general.provider')}</label>
              <select
                className={s.select}
                value={provider}
                title={t('settings.general.provider')}
                onChange={(e) => {
                  const p = e.target.value as 'openai' | 'anthropic';
                  setProvider(p);
                  setModel(MODELS[p][0].value);
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>

              <label className={s.label}>{t('settings.general.model')}</label>
              <select
                className={s.select}
                value={model}
                title={t('settings.general.model')}
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS[provider].map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              <label className={s.label}>
                {t('settings.general.apiKey')} {hasKey ? '✅' : '❌'}
              </label>
              <input
                type="password"
                className={s.input}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  hasKey ? t('settings.general.apiKeyChangePlaceholder') : t('settings.general.apiKeyPlaceholder')
                }
              />
            </div>

            {/* Deepgram / Meeting Coach */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.meetingCoach')}</h3>

              <label className={s.label}>
                {t('settings.general.deepgramKey')} {hasDeepgramKey ? '✅' : '❌'}
              </label>
              <input
                type="password"
                className={s.input}
                value={deepgramKey}
                onChange={(e) => setDeepgramKey(e.target.value)}
                placeholder={
                  hasDeepgramKey
                    ? t('settings.general.apiKeyChangePlaceholder')
                    : t('settings.general.deepgramKeyPlaceholder')
                }
              />
              <p className={s.hint}>{t('settings.general.deepgramHint')}</p>
            </div>

            {/* TTS */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.ttsSection')}</h3>

              <div className={s.toggleRow}>
                <div className={s.toggleMeta}>
                  <div className={s.toggleTitle}>{t('settings.general.ttsEnabled')}</div>
                  <p className={s.hint}>{t('settings.general.ttsEnabledHint')}</p>
                </div>
                <Toggle checked={ttsEnabled} onChange={setTtsEnabled} aria-label={t('settings.general.ttsEnabled')} />
              </div>

              {ttsEnabled && (
                <>
                  <label className={s.label}>{t('settings.general.ttsProvider')}</label>
                  <select
                    className={s.select}
                    value={ttsProvider}
                    onChange={(e) => setTtsProvider(e.target.value as 'elevenlabs' | 'openai' | 'web')}
                  >
                    <option value="elevenlabs">ElevenLabs (najlepsza jakość)</option>
                    <option value="openai">OpenAI TTS</option>
                    <option value="web">Web Speech API (wbudowany)</option>
                  </select>
                  <p className={s.hint}>{t('settings.general.ttsProviderHint')}</p>

                  {ttsProvider === 'elevenlabs' && (
                    <>
                      <label className={s.label}>
                        {t('settings.general.ttsElevenLabsKey')} {hasElevenLabsKey ? '✅' : '❌'}
                      </label>
                      <input
                        type="password"
                        className={s.input}
                        value={elevenLabsKey}
                        onChange={(e) => setElevenLabsKey(e.target.value)}
                        placeholder={
                          hasElevenLabsKey
                            ? t('settings.general.apiKeyChangePlaceholder')
                            : t('settings.general.ttsElevenLabsKeyPlaceholder')
                        }
                      />
                      <label className={s.label}>{t('settings.general.ttsVoiceId')}</label>
                      <input
                        className={s.input}
                        value={ttsElVoiceId}
                        onChange={(e) => setTtsElVoiceId(e.target.value)}
                        placeholder="onwK4e9ZLuTAKqWW03F9"
                      />
                      <p className={s.hint}>{t('settings.general.ttsVoiceIdHint')}</p>
                      <label className={s.label}>{t('settings.general.ttsElModel')}</label>
                      <select className={s.select} value={ttsElModel} onChange={(e) => setTtsElModel(e.target.value)}>
                        <option value="eleven_multilingual_v2">eleven_multilingual_v2 (PL/EN)</option>
                        <option value="eleven_flash_v2_5">eleven_flash_v2_5 (szybki, tani)</option>
                        <option value="eleven_turbo_v2_5">eleven_turbo_v2_5 (szybki, dobry)</option>
                        <option value="eleven_monolingual_v1">eleven_monolingual_v1 (EN only)</option>
                      </select>
                    </>
                  )}

                  {ttsProvider === 'openai' && (
                    <>
                      <label className={s.label}>{t('settings.general.ttsOpenaiVoice')}</label>
                      <select
                        className={s.select}
                        value={ttsOpenaiVoice}
                        onChange={(e) => setTtsOpenaiVoice(e.target.value)}
                      >
                        <option value="onyx">onyx (głęboki, męski)</option>
                        <option value="alloy">alloy (neutralny)</option>
                        <option value="echo">echo (męski)</option>
                        <option value="fable">fable (brytyjski)</option>
                        <option value="nova">nova (kobiecy)</option>
                        <option value="shimmer">shimmer (kobiecy, ciepły)</option>
                      </select>
                      <label className={s.label}>{t('settings.general.ttsOpenaiModel')}</label>
                      <select
                        className={s.select}
                        value={ttsOpenaiModel}
                        onChange={(e) => setTtsOpenaiModel(e.target.value)}
                      >
                        <option value="tts-1-hd">tts-1-hd (wysoka jakość)</option>
                        <option value="tts-1">tts-1 (szybszy, tańszy)</option>
                      </select>
                    </>
                  )}

                  {ttsProvider === 'web' && <p className={s.hint}>{t('settings.general.ttsWebHint')}</p>}
                </>
              )}
            </div>

            {/* Embeddings (RAG) */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.embeddingsSection')}</h3>

              <label className={s.label}>
                {t('settings.general.embeddingKey')}{' '}
                {hasEmbeddingKey
                  ? '✅'
                  : hasKey && provider === 'openai'
                    ? t('settings.general.embeddingKeyShared')
                    : '❌'}
              </label>
              <input
                type="password"
                className={s.input}
                value={embeddingKey}
                onChange={(e) => setEmbeddingKey(e.target.value)}
                placeholder={
                  hasEmbeddingKey
                    ? t('settings.general.apiKeyChangePlaceholder')
                    : t('settings.general.embeddingKeyPlaceholder')
                }
              />
              <p className={s.hint}>{t('settings.general.embeddingHint')}</p>

              <label className={s.label}>{t('settings.general.embeddingModel')}</label>
              <select
                className={s.select}
                value={embeddingModel}
                title={t('settings.general.embeddingModel')}
                onChange={(e) => setEmbeddingModel(e.target.value)}
              >
                <option value="text-embedding-3-small">
                  text-embedding-3-small (1536D, {t('settings.general.embeddingModelSmall')})
                </option>
                <option value="text-embedding-3-large">
                  text-embedding-3-large (3072D, {t('settings.general.embeddingModelLarge')})
                </option>
                <option value="text-embedding-ada-002">
                  text-embedding-ada-002 (1536D, {t('settings.general.embeddingModelAda')})
                </option>
              </select>

              <label className={s.label}>{t('settings.general.indexedExtensions')}</label>
              <input
                className={s.input}
                value={indexedExtensionsInput}
                onChange={(e) => setIndexedExtensionsInput(e.target.value)}
                placeholder={DEFAULT_INDEXED_EXTENSIONS}
              />
              <p className={s.hint}>{t('settings.general.indexedExtensionsHint')}</p>

              {embeddingModel !== (config.embeddingModel || 'text-embedding-3-small') && (
                <p className={s.warningHint}>⚠️ {t('settings.general.embeddingModelChangeWarning')}</p>
              )}
              {ragStats && (
                <p className={s.hint}>
                  {t('settings.general.embeddingCurrentInfo', {
                    model: ragStats.embeddingModel || ragStats.embeddingType,
                    dim: String(ragStats.embeddingDimension || '?'),
                    chunks: String(ragStats.totalChunks),
                    files: String(ragStats.totalFiles),
                  })}
                </p>
              )}
            </div>

            {/* Updates */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.general.updatesTitle')}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {t('settings.general.currentVersion', { v: window.kxai.appVersion || '—' })}
                </span>
                {updateState?.status === 'available' && updateState.version && (
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(0,255,136,0.15)',
                      color: 'var(--success)',
                      fontWeight: 600,
                    }}
                  >
                    v{updateState.version} {t('settings.general.updateAvailable')}
                  </span>
                )}
                {updateState?.status === 'downloaded' && (
                  <span
                    style={{
                      fontSize: '11px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(99,179,237,0.15)',
                      color: 'var(--accent)',
                      fontWeight: 600,
                    }}
                  >
                    {t('settings.general.updateReadyInstall')}
                  </span>
                )}
              </div>

              {/* Progress bar when downloading */}
              {updateState?.status === 'downloading' && updateState.progress && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ height: '4px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${updateState.progress.percent}%`,
                        background: 'var(--accent)',
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                  <p className={s.hint} style={{ marginTop: '4px' }}>
                    {t('settings.general.updateDownloading', { pct: Math.round(updateState.progress.percent) })}
                  </p>
                </div>
              )}

              {/* Error */}
              {updateState?.status === 'error' && (
                <p style={{ fontSize: '11px', color: 'var(--error)', marginBottom: '8px' }}>
                  ❌ {updateState.error || t('settings.general.updateError')}
                </p>
              )}

              {/* Release notes */}
              {updateState?.releaseNotes && (
                <details style={{ marginBottom: '8px' }}>
                  <summary style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    {t('settings.general.updateReleaseNotes')}
                  </summary>
                  <pre
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'pre-wrap',
                      marginTop: '4px',
                      maxHeight: '80px',
                      overflow: 'auto',
                    }}
                  >
                    {updateState.releaseNotes}
                  </pre>
                </details>
              )}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  className={s.btnSave}
                  onClick={checkForUpdates}
                  disabled={updateState?.status === 'checking' || updateState?.status === 'downloading'}
                  style={{ flex: 'none' }}
                >
                  {updateState?.status === 'checking'
                    ? t('settings.general.updateChecking')
                    : t('settings.general.updateCheck')}
                </button>

                {updateState?.status === 'available' && (
                  <button className={s.btnSave} onClick={downloadUpdate} style={{ flex: 'none' }}>
                    {updateState.manualOnly
                      ? t('settings.general.updateOpenRelease')
                      : t('settings.general.updateDownload')}
                  </button>
                )}

                {updateState?.status === 'downloaded' && !updateState.manualOnly && (
                  <button
                    onClick={installUpdate}
                    style={{
                      flex: 'none',
                      background: 'var(--accent)',
                      color: '#000',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 16px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '12px',
                    }}
                  >
                    {t('settings.general.updateInstall')}
                  </button>
                )}
              </div>

              {updateState?.status === 'not-available' && (
                <p className={s.hint} style={{ marginTop: '6px' }}>
                  ✅ {t('settings.general.updateNotAvailable')}
                </p>
              )}
            </div>

            {/* Danger zone */}
            <div className={s.section}>
              <h3 className={s.sectionTitleDanger}>{t('settings.general.dangerZone')}</h3>
              <button onClick={clearHistory} className={s.btnDanger}>
                {t('settings.general.clearHistory')}
              </button>
            </div>

            <div className={s.saveWrapper}>
              <button onClick={saveSettings} disabled={saving} className={saving ? s.btnSaveSaving : s.btnSave}>
                {saving ? t('settings.general.saving') : t('settings.general.saveSettings')}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'persona' && (
          <div className="fade-in">
            <p className={s.desc}>{t('settings.persona.description')}</p>
            <textarea
              className={s.textarea}
              value={soulContent}
              onChange={(e) => setSoulContent(e.target.value)}
              title={t('settings.persona.saveSoul')}
            />
            <button onClick={saveSoul} className={s.btnSave}>
              {t('settings.persona.saveSoul')}
            </button>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="fade-in">
            <h3 className={s.sectionTitle}>{t('settings.memory.userTitle')}</h3>
            <p className={s.desc}>{t('settings.memory.userDescription')}</p>
            <textarea
              className={s.textarea}
              value={userContent}
              onChange={(e) => setUserContent(e.target.value)}
              title={t('settings.memory.saveUser')}
            />
            <button onClick={saveUser} className={s.btnSave}>
              {t('settings.memory.saveUser')}
            </button>

            <h3 className={s.sectionTitle} style={{ marginTop: '1.5rem' }}>
              {t('settings.memory.memoryTitle')}
            </h3>
            <p className={s.desc}>{t('settings.memory.description')}</p>
            <textarea
              className={s.textarea}
              value={memoryContent}
              onChange={(e) => setMemoryContent(e.target.value)}
              title={t('settings.memory.saveMemory')}
            />
            <button onClick={saveMemory} className={s.btnSave}>
              {t('settings.memory.saveMemory')}
            </button>
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className="fade-in">
            <p className={s.desc}>{t('settings.knowledge.description')}</p>

            {/* Stats */}
            {ragStats && (
              <div className={s.section}>
                <h3 className={s.sectionTitle}>{t('settings.knowledge.statsTitle')}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{ragStats.totalFiles}</div>
                    <div className={s.statCardLabel}>{t('settings.knowledge.filesLabel')}</div>
                  </div>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{ragStats.totalChunks}</div>
                    <div className={s.statCardLabel}>{t('settings.knowledge.chunksLabel')}</div>
                  </div>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{ragStats.embeddingType === 'openai' ? 'OpenAI' : 'TF-IDF'}</div>
                    <div className={s.statCardLabel}>{t('settings.knowledge.embeddingsLabel')}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Indexed folders */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.knowledge.indexedFolders')}</h3>

              {folderStats.map((folder, idx) => (
                <div key={idx} className={s.folderItem}>
                  <div className={s.folderItemInfo}>
                    <div className={s.folderItemPath} title={folder.path}>
                      {folder.path}
                    </div>
                    <div className={s.folderItemStats}>
                      {folder.fileCount} {t('settings.knowledge.folderFiles')} · {folder.chunkCount}{' '}
                      {t('settings.knowledge.folderChunks')}
                      {folder.lastIndexed > 0 && <> · {new Date(folder.lastIndexed).toLocaleString('pl-PL')}</>}
                    </div>
                  </div>
                  {idx > 0 && (
                    <button
                      className={s.folderItemRemove}
                      onClick={() => handleRemoveFolder(folder.path)}
                      title={t('settings.knowledge.removeFolder')}
                      aria-label={t('settings.knowledge.removeFolder')}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              <button className={s.btnSave} onClick={handleAddFolder} style={{ marginTop: '8px' }}>
                {t('settings.knowledge.addFolder')}
              </button>
            </div>

            {/* Reindex */}
            <div className={s.section}>
              <button className={s.btnSave} onClick={handleReindex} disabled={reindexing} style={{ width: '100%' }}>
                {reindexing ? t('settings.knowledge.reindexing') : t('settings.knowledge.reindexAll')}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'mcp' && (
          <div className="fade-in">
            <p className={s.desc}>{t('settings.mcp.description')}</p>

            {/* Hub Stats */}
            {mcpStatus && (
              <div className={s.section}>
                <h3 className={s.sectionTitle}>{t('settings.mcp.hubStatus')}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{mcpStatus.connectedCount}</div>
                    <div className={s.statCardLabel}>{t('settings.mcp.connectedLabel')}</div>
                  </div>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{mcpStatus.servers.length}</div>
                    <div className={s.statCardLabel}>{t('settings.mcp.serversLabel')}</div>
                  </div>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{mcpStatus.totalTools}</div>
                    <div className={s.statCardLabel}>{t('settings.mcp.toolsLabel')}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Connected Servers */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.mcp.configuredServers')}</h3>

              {mcpStatus && mcpStatus.servers.length === 0 && <p className={s.hint}>{t('settings.mcp.noServers')}</p>}

              {mcpStatus?.servers.map((server) => {
                const badge = getMcpStatusBadge(server.status);
                return (
                  <div key={server.id} className={s.mcpServerItem}>
                    <div className={s.mcpServerHeader}>
                      <div className={s.mcpServerInfo}>
                        <span className={s.mcpServerIcon}>{server.icon || '🔌'}</span>
                        <span className={s.mcpServerName}>{server.name}</span>
                        <span className={badge.cls}>{badge.text}</span>
                      </div>
                      <div className={s.mcpServerActions}>
                        {server.status === 'connected' ? (
                          <button
                            className={s.mcpBtnSmall}
                            onClick={() => handleMcpDisconnect(server.id)}
                            title={t('settings.mcp.disconnect')}
                          >
                            ⏹
                          </button>
                        ) : (
                          <button
                            className={s.mcpBtnSmallAccent}
                            onClick={() => handleMcpConnect(server.id)}
                            title={t('settings.mcp.connect')}
                          >
                            ▶
                          </button>
                        )}
                        <button
                          className={s.mcpBtnSmall}
                          onClick={() => {
                            const regEntry = findRegistryEntryForServer(server.name);
                            setMcpEnvRegistryEntry(regEntry ?? null);

                            // Find server config to prefill env
                            window.kxai.mcpListServers().then((servers) => {
                              const srv = servers.find((ss) => ss.id === server.id);

                              if (regEntry?.requiredEnvVars?.length) {
                                // Guided mode: prefill named fields
                                const fields: Record<string, string> = {};
                                for (const varName of regEntry.requiredEnvVars!) {
                                  fields[varName] = srv?.env?.[varName] ?? '';
                                }
                                setMcpEnvFields(fields);
                              }

                              const envStr = srv?.env
                                ? Object.entries(srv.env)
                                    .map(([k, v]) => `${k}=${v}`)
                                    .join('\n')
                                : '';
                              setMcpEnvEditing(server.id);
                              setMcpEnvInput(envStr);
                            });
                          }}
                          title={t('settings.mcp.editEnv')}
                        >
                          ⚙
                        </button>
                        <button
                          className={s.folderItemRemove}
                          onClick={() => handleMcpRemove(server.id, server.name)}
                          title={t('settings.mcp.remove')}
                          aria-label={t('settings.mcp.remove')}
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Tools list */}
                    {server.status === 'connected' && server.tools.length > 0 && (
                      <div className={s.mcpToolsList}>
                        {server.tools.map((tool) => (
                          <span key={tool.name} className={s.mcpToolBadge} title={tool.description || tool.name}>
                            {tool.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {server.error && <div className={s.mcpServerError}>{server.error}</div>}

                    {/* Env / OAuth setup editor */}
                    {mcpEnvEditing === server.id && (
                      <div className={s.mcpEnvEditor}>
                        {/* Setup instructions */}
                        {mcpEnvRegistryEntry?.setupInstructions && (
                          <p className={s.hint} style={{ marginBottom: '8px' }}>
                            {mcpEnvRegistryEntry.setupInstructions}
                          </p>
                        )}

                        {/* OAuth setup flow */}
                        {mcpEnvRegistryEntry?.setupType === 'oauth-google' ||
                        mcpEnvRegistryEntry?.setupType === 'oauth-microsoft' ? (
                          <div>
                            <p className={s.hint} style={{ marginBottom: '12px' }}>
                              {mcpEnvRegistryEntry.setupType === 'oauth-google'
                                ? 'Kliknij przycisk poniżej aby otworzyć przeglądarkę i autoryzować dostęp do konta Google.'
                                : 'Kliknij przycisk poniżej aby otworzyć przeglądarkę i autoryzować dostęp do konta Microsoft.'}
                            </p>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                className={s.mcpBtnPrimary}
                                onClick={() => handleMcpRunOAuth(server.id)}
                                disabled={mcpOAuthRunning}
                              >
                                {mcpOAuthRunning ? 'Autoryzacja...' : 'Autoryzuj'}
                              </button>
                              <button
                                className={s.mcpBtnSmall}
                                onClick={() => {
                                  setMcpEnvEditing(null);
                                  setMcpEnvRegistryEntry(null);
                                }}
                              >
                                {t('settings.mcp.cancel')}
                              </button>
                            </div>
                            {mcpEnvRegistryEntry.docsUrl && (
                              <a
                                href={mcpEnvRegistryEntry.docsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={s.hint}
                                style={{ display: 'inline-block', marginTop: '8px', textDecoration: 'underline' }}
                              >
                                Dokumentacja
                              </a>
                            )}
                          </div>
                        ) : mcpEnvRegistryEntry?.requiredEnvVars?.length ? (
                          /* Guided env fields */
                          <div>
                            <label className={s.label}>{server.name} — konfiguracja</label>
                            {mcpEnvRegistryEntry.requiredEnvVars.map((varName) => (
                              <div key={varName} style={{ marginBottom: '8px' }}>
                                <label className={s.label} style={{ fontSize: '12px', opacity: 0.8 }}>
                                  {varName}
                                </label>
                                <input
                                  type={
                                    varName.toLowerCase().includes('secret') ||
                                    varName.toLowerCase().includes('password') ||
                                    varName.toLowerCase().includes('token') ||
                                    varName.toLowerCase().includes('key')
                                      ? 'password'
                                      : 'text'
                                  }
                                  className={s.input}
                                  value={mcpEnvFields[varName] ?? ''}
                                  onChange={(e) => setMcpEnvFields((prev) => ({ ...prev, [varName]: e.target.value }))}
                                  placeholder={varName}
                                  autoComplete="off"
                                />
                              </div>
                            ))}
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                              <button className={s.mcpBtnSmallAccent} onClick={() => handleMcpUpdateEnv(server.id)}>
                                {t('settings.mcp.save')}
                              </button>
                              <button
                                className={s.mcpBtnSmall}
                                onClick={() => {
                                  setMcpEnvEditing(null);
                                  setMcpEnvRegistryEntry(null);
                                  setMcpEnvFields({});
                                }}
                              >
                                {t('settings.mcp.cancel')}
                              </button>
                            </div>
                            {mcpEnvRegistryEntry.docsUrl && (
                              <a
                                href={mcpEnvRegistryEntry.docsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={s.hint}
                                style={{ display: 'inline-block', marginTop: '8px', textDecoration: 'underline' }}
                              >
                                Dokumentacja
                              </a>
                            )}
                          </div>
                        ) : (
                          /* Legacy: generic textarea for custom servers */
                          <div>
                            <label className={s.label}>{t('settings.mcp.envLabel')}</label>
                            <textarea
                              className={s.mcpEnvTextarea}
                              value={mcpEnvInput}
                              onChange={(e) => setMcpEnvInput(e.target.value)}
                              placeholder="GITHUB_TOKEN=ghp_xxx&#10;SLACK_TOKEN=xoxb-xxx"
                              rows={4}
                            />
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                              <button className={s.mcpBtnSmallAccent} onClick={() => handleMcpUpdateEnv(server.id)}>
                                {t('settings.mcp.save')}
                              </button>
                              <button
                                className={s.mcpBtnSmall}
                                onClick={() => {
                                  setMcpEnvEditing(null);
                                  setMcpEnvRegistryEntry(null);
                                }}
                              >
                                {t('settings.mcp.cancel')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add Custom Server */}
            <div className={s.section}>
              <button
                className={s.btnSave}
                onClick={() => setMcpShowAddForm(!mcpShowAddForm)}
                style={{ marginBottom: '12px' }}
              >
                {mcpShowAddForm ? t('settings.mcp.addManualCancel') : t('settings.mcp.addManualOpen')}
              </button>

              {mcpShowAddForm && (
                <div className={s.mcpAddForm}>
                  <label className={s.label}>{t('settings.mcp.addName')}</label>
                  <input
                    className={s.input}
                    value={mcpNewServer.name}
                    onChange={(e) => setMcpNewServer((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="np. moj-serwer"
                  />

                  <label className={s.label}>{t('settings.mcp.addTransport')}</label>
                  <select
                    className={s.select}
                    value={mcpNewServer.transport}
                    onChange={(e) =>
                      setMcpNewServer((prev) => ({
                        ...prev,
                        transport: e.target.value as 'streamable-http' | 'sse' | 'stdio',
                      }))
                    }
                  >
                    <option value="stdio">{t('settings.mcp.transportStdio')}</option>
                    <option value="streamable-http">{t('settings.mcp.transportHttp')}</option>
                    <option value="sse">{t('settings.mcp.transportSse')}</option>
                  </select>

                  {mcpNewServer.transport === 'stdio' ? (
                    <>
                      <label className={s.label}>{t('settings.mcp.addCommand')}</label>
                      <input
                        className={s.input}
                        value={mcpNewServer.command}
                        onChange={(e) => setMcpNewServer((prev) => ({ ...prev, command: e.target.value }))}
                        placeholder="npx, node, python..."
                      />
                      <label className={s.label}>{t('settings.mcp.addArgs')}</label>
                      <input
                        className={s.input}
                        value={mcpNewServer.args}
                        onChange={(e) => setMcpNewServer((prev) => ({ ...prev, args: e.target.value }))}
                        placeholder="-y @modelcontextprotocol/server-github"
                      />
                    </>
                  ) : (
                    <>
                      <label className={s.label}>{t('settings.mcp.addUrl')}</label>
                      <input
                        className={s.input}
                        value={mcpNewServer.url}
                        onChange={(e) => setMcpNewServer((prev) => ({ ...prev, url: e.target.value }))}
                        placeholder="http://localhost:3000/mcp"
                      />
                    </>
                  )}

                  <label className={s.label}>{t('settings.mcp.envLabel')}</label>
                  <textarea
                    className={s.mcpEnvTextarea}
                    value={mcpNewServer.env}
                    onChange={(e) => setMcpNewServer((prev) => ({ ...prev, env: e.target.value }))}
                    placeholder="API_KEY=xxx&#10;TOKEN=yyy"
                    rows={3}
                  />

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '8px',
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={mcpNewServer.autoConnect}
                      onChange={(e) => setMcpNewServer((prev) => ({ ...prev, autoConnect: e.target.checked }))}
                    />
                    {t('settings.mcp.autoConnect')}
                  </label>

                  <button
                    className={s.btnSave}
                    onClick={handleMcpAddCustom}
                    disabled={mcpAddingServer || !mcpNewServer.name}
                    style={{ marginTop: '12px' }}
                  >
                    {mcpAddingServer ? t('settings.mcp.addServerAdding') : t('settings.mcp.addServerButton')}
                  </button>
                </div>
              )}
            </div>

            {/* Registry */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.mcp.registry')}</h3>
              <p className={s.hint}>{t('settings.mcp.registryHint')}</p>

              {/* Search + Category Filter */}
              <div className={s.mcpDiscoveryBar}>
                <input
                  type="text"
                  className={s.mcpSearchInput}
                  placeholder={t('settings.mcp.searchPlaceholder')}
                  value={mcpSearchQuery}
                  onChange={(e) => setMcpSearchQuery(e.target.value)}
                  aria-label={t('settings.mcp.searchPlaceholder')}
                />
                <select
                  className={s.mcpCategorySelect}
                  value={mcpFilterCategory}
                  onChange={(e) => setMcpFilterCategory(e.target.value as McpCategory | '')}
                  aria-label={t('settings.mcp.filterCategory')}
                >
                  <option value="">{t('settings.mcp.allCategories')}</option>
                  {mcpCategories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              {(() => {
                // Client-side filter
                const q = mcpSearchQuery.trim().toLowerCase();
                let filtered = mcpRegistry;
                if (mcpFilterCategory) {
                  filtered = filtered.filter((e) => e.category === mcpFilterCategory);
                }
                if (q) {
                  filtered = filtered.filter((e) => {
                    const searchable = [e.name, e.description, e.id, ...(e.tags ?? [])].join(' ').toLowerCase();
                    return searchable.includes(q);
                  });
                }
                // Sort: featured first, then alphabetical
                filtered = [...filtered].sort((a, b) => {
                  if (a.featured && !b.featured) return -1;
                  if (!a.featured && b.featured) return 1;
                  return a.name.localeCompare(b.name);
                });

                if (filtered.length === 0) {
                  return <div className={s.mcpEmptySearch}>{t('settings.mcp.noResults')}</div>;
                }

                return filtered.map((entry) => {
                  const alreadyAdded = mcpStatus?.servers.some(
                    (srv) => srv.name.toLowerCase() === entry.name.toLowerCase(),
                  );
                  return (
                    <div key={entry.id} className={cn(s.mcpRegistryItem, entry.featured && s.mcpFeatured)}>
                      <div className={s.mcpRegistryInfo}>
                        <span className={s.mcpServerIcon}>{entry.icon}</span>
                        <div>
                          <div className={s.mcpRegistryName}>
                            {entry.name}
                            {entry.featured && <span className={s.mcpFeaturedBadge}>⭐</span>}
                            <span className={s.mcpCategoryBadge}>{entry.category}</span>
                          </div>
                          <div className={s.mcpRegistryDesc}>{entry.description}</div>
                          {entry.requiresSetup && (
                            <span className={s.mcpRequiresSetup}>
                              {entry.setupType === 'oauth-google'
                                ? t('settings.mcp.setup.oauthGoogle')
                                : entry.setupType === 'oauth-microsoft'
                                  ? t('settings.mcp.setup.oauthMicrosoft')
                                  : entry.setupType === 'manual'
                                    ? t('settings.mcp.setup.manual')
                                    : entry.setupType === 'env'
                                      ? t('settings.mcp.setup.apiKeyRequired')
                                      : t('settings.mcp.requiresSetup')}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        className={alreadyAdded ? s.mcpBtnSmall : s.mcpBtnSmallAccent}
                        onClick={() => !alreadyAdded && handleMcpAddFromRegistry(entry)}
                        disabled={alreadyAdded || mcpAddingServer}
                        title={alreadyAdded ? t('settings.mcp.alreadyAdded') : t('settings.mcp.addAndConnect')}
                      >
                        {alreadyAdded ? '✓' : '+'}
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="fade-in">
            <div className={s.section}>
              <h3 className={s.sectionTitle}>{t('settings.calendar.title')}</h3>
              <p className={s.hint}>{t('settings.calendar.description')}</p>

              {calLoading && <div className={s.mcpLoading}>{t('settings.calendar.loading')}</div>}

              {/* Connection list */}
              {calStatus?.connections.map((conn) => {
                const badge = getCalStatusBadge(conn.status);
                const connCalendars = calCalendars[conn.id];
                return (
                  <div key={conn.id} className={s.mcpServerItem}>
                    <div className={s.mcpServerHeader}>
                      <div className={s.mcpServerInfo}>
                        <span className={s.mcpServerIcon}>
                          {conn.provider === 'google' ? '📊' : conn.provider === 'icloud' ? '🍎' : '📅'}
                        </span>
                        <div>
                          <div className={s.mcpServerName}>{conn.name}</div>
                          <div className={s.mcpServerTransport}>
                            {conn.provider} · {conn.serverUrl}
                          </div>
                          {conn.lastSync && (
                            <div className={s.mcpServerTransport}>
                              {t('settings.calendar.lastSync')} {new Date(conn.lastSync).toLocaleString('pl-PL')}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className={s.mcpServerActions}>
                        <span className={badge.cls}>{badge.text}</span>
                        {conn.status === 'connected' ? (
                          <button className={s.mcpBtnSmall} onClick={() => handleCalendarDisconnect(conn.id)}>
                            {t('settings.calendar.disconnect')}
                          </button>
                        ) : (
                          <button className={s.mcpBtnSmallAccent} onClick={() => handleCalendarConnect(conn.id)}>
                            {t('settings.calendar.connect')}
                          </button>
                        )}
                        <button className={s.mcpBtnSmall} onClick={() => handleCalendarLoadCalendars(conn.id)}>
                          📋
                        </button>
                        <button className={s.mcpBtnSmall} onClick={() => handleCalendarRemove(conn.id, conn.name)}>
                          🗑
                        </button>
                      </div>
                    </div>

                    {/* Calendars list (when loaded) */}
                    {connCalendars && connCalendars.length > 0 && (
                      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
                        <div className={s.hint}>{t('settings.calendar.calendarsLabel')}</div>
                        {connCalendars.map((cal) => (
                          <div
                            key={cal.url}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
                          >
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                background: cal.color || 'var(--accent)',
                                display: 'inline-block',
                              }}
                            />
                            <span>{cal.displayName || cal.url}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add connection form */}
              {!calShowAddForm ? (
                <button className={s.mcpBtnPrimary} onClick={() => setCalShowAddForm(true)}>
                  {t('settings.calendar.addConnection')}
                </button>
              ) : (
                <div className={s.mcpAddForm}>
                  <h4>{t('settings.calendar.newConnection')}</h4>

                  <label className={s.label}>{t('settings.calendar.provider')}</label>
                  <select
                    className={s.input}
                    value={calNewConn.provider}
                    onChange={(e) =>
                      setCalNewConn({
                        ...calNewConn,
                        provider: e.target.value as CalendarProvider,
                        serverUrl:
                          e.target.value === 'icloud'
                            ? 'https://caldav.icloud.com/'
                            : e.target.value === 'google'
                              ? 'https://apidata.googleusercontent.com/caldav/v2/'
                              : calNewConn.serverUrl,
                      })
                    }
                  >
                    <option value="caldav">{t('settings.calendar.providerCaldav')}</option>
                    <option value="nextcloud">{t('settings.calendar.providerNextcloud')}</option>
                    <option value="icloud">{t('settings.calendar.providerIcloud')}</option>
                    <option value="google">{t('settings.calendar.providerGoogle')}</option>
                  </select>

                  <label className={s.label}>{t('settings.calendar.name')}</label>
                  <input
                    className={s.input}
                    value={calNewConn.name}
                    onChange={(e) => setCalNewConn({ ...calNewConn, name: e.target.value })}
                    placeholder={t('settings.calendar.namePlaceholder')}
                  />

                  {calNewConn.provider !== 'google' && (
                    <>
                      <label className={s.label}>{t('settings.calendar.serverUrl')}</label>
                      <input
                        className={s.input}
                        value={calNewConn.serverUrl}
                        onChange={(e) => setCalNewConn({ ...calNewConn, serverUrl: e.target.value })}
                        placeholder="https://caldav.example.com/"
                      />
                    </>
                  )}

                  <label className={s.label}>{t('settings.calendar.username')}</label>
                  <input
                    className={s.input}
                    value={calNewConn.username}
                    onChange={(e) => setCalNewConn({ ...calNewConn, username: e.target.value })}
                    placeholder="email@example.com"
                  />

                  <label className={s.label}>
                    {calNewConn.provider === 'icloud'
                      ? t('settings.calendar.passwordLabel')
                      : t('settings.calendar.passwordLabelGeneric')}
                  </label>
                  <input
                    className={s.input}
                    type="password"
                    value={calNewConn.password}
                    onChange={(e) => setCalNewConn({ ...calNewConn, password: e.target.value })}
                    placeholder="••••••••"
                  />

                  {calNewConn.provider === 'google' && (
                    <>
                      <p className={s.hint}>{t('settings.calendar.googleOauthHint')}</p>
                      <p className={s.hint} style={{ marginTop: '4px' }}>
                        Aby korzystać z Google Calendar przez CalDAV, utwórz OAuth2 credentials w Google Cloud Console
                        (APIs &amp; Services &gt; Credentials &gt; OAuth 2.0 Client IDs).
                      </p>

                      <label className={s.label}>Google Client ID</label>
                      <input
                        className={s.input}
                        value={calNewConn.googleClientId}
                        onChange={(e) => setCalNewConn({ ...calNewConn, googleClientId: e.target.value })}
                        placeholder="xxxxx.apps.googleusercontent.com"
                      />

                      <label className={s.label}>Google Client Secret</label>
                      <input
                        className={s.input}
                        type="password"
                        value={calNewConn.googleClientSecret}
                        onChange={(e) => setCalNewConn({ ...calNewConn, googleClientSecret: e.target.value })}
                        placeholder="GOCSPX-xxxxxxxx"
                      />
                    </>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      className={s.mcpBtnPrimary}
                      onClick={handleCalendarAdd}
                      disabled={calLoading || !calNewConn.name || !calNewConn.serverUrl}
                    >
                      {t('settings.calendar.addAndConnect')}
                    </button>
                    <button className={s.mcpBtnSmall} onClick={() => setCalShowAddForm(false)}>
                      {t('settings.calendar.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'privacy' && <PrivacyTab />}
        {activeTab === 'telegram' && <TelegramTab />}
      </div>
    </div>
  );
}
