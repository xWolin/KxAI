import React, { useState, useEffect, useCallback } from 'react';
import type { KxAIConfig, RAGFolderInfo } from '../types';
import type { McpServerConfig, McpHubStatus, McpRegistryEntry } from '@shared/types/mcp';
import type { CalendarConfig, CalendarStatus, CalendarInfo, CalendarProvider } from '@shared/types/calendar';
import s from './SettingsPanel.module.css';
import { cn } from '../utils/cn';

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

export function SettingsPanel({ config, onBack, onConfigUpdate }: SettingsPanelProps) {
  const [provider, setProvider] = useState(config.aiProvider || 'openai');
  const [model, setModel] = useState(config.aiModel || 'gpt-5');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [deepgramKey, setDeepgramKey] = useState('');
  const [hasDeepgramKey, setHasDeepgramKey] = useState(false);
  const [embeddingKey, setEmbeddingKey] = useState('');
  const [hasEmbeddingKey, setHasEmbeddingKey] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState(config.embeddingModel || 'text-embedding-3-small');
  const [proactiveInterval, setProactiveInterval] = useState((config.proactiveIntervalMs || 30000) / 1000);
  const [agentName, setAgentName] = useState(config.agentName || 'KxAI');
  const [agentEmoji, setAgentEmoji] = useState(config.agentEmoji || '🤖');
  const [saving, setSaving] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [activeTab, setActiveTab] = useState<'general' | 'persona' | 'memory' | 'knowledge' | 'mcp' | 'calendar'>(
    'general',
  );
  const [indexedFolders, setIndexedFolders] = useState<string[]>([]);
  const [folderStats, setFolderStats] = useState<RAGFolderInfo[]>([]);
  const [ragStats, setRagStats] = useState<{ totalChunks: number; totalFiles: number; embeddingType: string } | null>(
    null,
  );
  const [reindexing, setReindexing] = useState(false);

  // MCP state
  const [mcpStatus, setMcpStatus] = useState<McpHubStatus | null>(null);
  const [mcpRegistry, setMcpRegistry] = useState<McpRegistryEntry[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
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
  });

  useEffect(() => {
    checkApiKey();
    loadFiles();
    loadKnowledgeData();
  }, [provider]);

  async function checkApiKey() {
    const has = await window.kxai.hasApiKey(provider);
    setHasKey(has);
    const hasEl = await window.kxai.hasApiKey('deepgram');
    setHasDeepgramKey(hasEl);
    const hasEmb = await window.kxai.hasApiKey('openai-embeddings');
    setHasEmbeddingKey(hasEmb);
  }

  async function loadFiles() {
    const soul = await window.kxai.getMemory('SOUL.md');
    const memory = await window.kxai.getMemory('MEMORY.md');
    if (soul) setSoulContent(soul);
    if (memory) setMemoryContent(memory);
  }

  async function saveSettings() {
    setSaving(true);
    try {
      // Save all config changes in a single batch (1 IPC call + 1 write)
      await window.kxai.setConfigBatch({
        aiProvider: provider,
        aiModel: model,
        agentName,
        agentEmoji,
        proactiveIntervalMs: proactiveInterval * 1000,
        embeddingModel,
      });

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

      onConfigUpdate();
    } catch (error) {
      console.error('Save settings error:', error);
    }
    setSaving(false);
  }

  async function saveSoul() {
    await window.kxai.setMemory('SOUL.md', soulContent);
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
      const folderList = await window.kxai.ragGetFolders();
      setIndexedFolders(folderList);
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
    if (!confirm(`Usunąć folder z indeksu?\n${folderPath}`)) return;
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

  async function clearHistory() {
    if (confirm('Czy na pewno chcesz wyczyścić historię konwersacji?')) {
      await window.kxai.clearConversationHistory();
    }
  }

  // ── MCP Functions ──
  const loadMcpData = useCallback(async () => {
    try {
      setMcpLoading(true);
      const [status, registry] = await Promise.all([window.kxai.mcpGetStatus(), window.kxai.mcpGetRegistry()]);
      setMcpStatus(status);
      setMcpRegistry(registry);
    } catch (err) {
      console.error('Failed to load MCP data:', err);
    } finally {
      setMcpLoading(false);
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
    if (!confirm(`Usunąć serwer MCP "${name}"?`)) return;
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
        await window.kxai.mcpConnect(added.id);
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
      for (const line of mcpEnvInput.split('\n')) {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          envObj[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
        }
      }
      // Remove and re-add with updated env
      const servers = await window.kxai.mcpListServers();
      const server = servers.find((s) => s.id === serverId);
      if (!server) return;
      await window.kxai.mcpRemoveServer(serverId);
      await window.kxai.mcpAddServer({
        ...server,
        env: Object.keys(envObj).length > 0 ? envObj : undefined,
      });
      setMcpEnvEditing(null);
      setMcpEnvInput('');
      await loadMcpData();
    } catch (err) {
      console.error('MCP update env error:', err);
    }
  }

  function getMcpStatusBadge(status: string) {
    switch (status) {
      case 'connected':
        return { text: 'Połączony', cls: s.mcpBadgeConnected };
      case 'connecting':
        return { text: 'Łączenie...', cls: s.mcpBadgeConnecting };
      case 'reconnecting':
        return { text: 'Reconnect...', cls: s.mcpBadgeConnecting };
      case 'error':
        return { text: 'Błąd', cls: s.mcpBadgeError };
      default:
        return { text: 'Rozłączony', cls: s.mcpBadgeDisconnected };
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
      const result = await window.kxai.calendarAddConnection({
        name: calNewConn.name,
        provider: calNewConn.provider,
        serverUrl:
          calNewConn.provider === 'google' || calNewConn.provider === 'icloud'
            ? defaults.serverUrl
            : calNewConn.serverUrl,
        authMethod: defaults.authMethod as 'Basic' | 'OAuth' | 'Bearer',
        username: calNewConn.username || '',
        enabled: true,
      });
      if (result.success && result.connectionId && calNewConn.password) {
        await window.kxai.calendarStoreCredential(result.connectionId, calNewConn.password);
      }
      setCalShowAddForm(false);
      setCalNewConn({ name: '', provider: 'caldav', serverUrl: '', username: '', password: '' });
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
    if (!confirm(`Usunąć połączenie "${name}"?`)) return;
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
        return { text: 'Połączony', cls: s.mcpBadgeConnected };
      case 'connecting':
        return { text: 'Łączenie...', cls: s.mcpBadgeConnecting };
      case 'error':
        return { text: 'Błąd', cls: s.mcpBadgeError };
      default:
        return { text: 'Rozłączony', cls: s.mcpBadgeDisconnected };
    }
  }

  return (
    <div className={s.panel}>
      {/* Header */}
      <div className={s.header}>
        <button onClick={onBack} className={s.headerBack}>
          ←
        </button>
        <span className={s.headerTitle}>Ustawienia</span>
      </div>

      {/* Tabs */}
      <div className={s.tabs}>
        <button className={activeTab === 'general' ? s.tabActive : s.tab} onClick={() => setActiveTab('general')}>
          ⚙️ Ogólne
        </button>
        <button className={activeTab === 'persona' ? s.tabActive : s.tab} onClick={() => setActiveTab('persona')}>
          🎭 Persona
        </button>
        <button className={activeTab === 'memory' ? s.tabActive : s.tab} onClick={() => setActiveTab('memory')}>
          🧠 Pamięć
        </button>
        <button className={activeTab === 'knowledge' ? s.tabActive : s.tab} onClick={() => setActiveTab('knowledge')}>
          📚 Wiedza
        </button>
        <button className={activeTab === 'mcp' ? s.tabActive : s.tab} onClick={() => setActiveTab('mcp')}>
          🔌 MCP
        </button>
        <button className={activeTab === 'calendar' ? s.tabActive : s.tab} onClick={() => setActiveTab('calendar')}>
          📅 Kalendarz
        </button>
      </div>

      {/* Content */}
      <div className={s.content}>
        {activeTab === 'general' && (
          <div className="fade-in">
            {/* Agent identity */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Agent</h3>

              <label className={s.label}>Nazwa</label>
              <input
                className={s.input}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                title="Nazwa agenta"
              />

              <label className={s.label}>Emoji</label>
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

            {/* AI Provider */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>AI Provider</h3>

              <label className={s.label}>Dostawca</label>
              <select
                className={s.select}
                value={provider}
                title="Dostawca AI"
                onChange={(e) => {
                  const p = e.target.value as 'openai' | 'anthropic';
                  setProvider(p);
                  setModel(MODELS[p][0].value);
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>

              <label className={s.label}>Model</label>
              <select className={s.select} value={model} title="Model AI" onChange={(e) => setModel(e.target.value)}>
                {MODELS[provider].map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              <label className={s.label}>Klucz API {hasKey ? '✅' : '❌'}</label>
              <input
                type="password"
                className={s.input}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••••• (zmień)' : 'Wklej klucz API'}
              />
            </div>

            {/* Proactive */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Tryb proaktywny</h3>

              <label className={s.label}>Interwał analizy ekranu (sekundy)</label>
              <input
                type="number"
                className={s.input}
                value={proactiveInterval}
                onChange={(e) => setProactiveInterval(Number(e.target.value))}
                title="Interwał proaktywny w sekundach"
                min={5}
                max={300}
              />
              <p className={s.hint}>
                Co ile sekund agent analizuje ekran (min. 5s). Niższa wartość = więcej API calls.
              </p>
            </div>

            {/* Deepgram / Meeting Coach */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>🎙️ Meeting Coach (Deepgram)</h3>

              <label className={s.label}>Klucz API Deepgram {hasDeepgramKey ? '✅' : '❌'}</label>
              <input
                type="password"
                className={s.input}
                value={deepgramKey}
                onChange={(e) => setDeepgramKey(e.target.value)}
                placeholder={hasDeepgramKey ? '••••••••••• (zmień)' : 'Wklej klucz API Deepgram'}
              />
              <p className={s.hint}>
                Wymagany do transkrypcji w czasie rzeczywistym (Nova-3 z diaryzacją). Pay-as-you-go: ~$0.0043/min.
              </p>
            </div>

            {/* Embeddings (RAG) */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>🧬 Embeddingi (RAG)</h3>

              <label className={s.label}>
                Klucz API OpenAI (embeddingi){' '}
                {hasEmbeddingKey ? '✅' : hasKey && provider === 'openai' ? '🔗 (główny)' : '❌'}
              </label>
              <input
                type="password"
                className={s.input}
                value={embeddingKey}
                onChange={(e) => setEmbeddingKey(e.target.value)}
                placeholder={
                  hasEmbeddingKey ? '••••••••••• (zmień)' : 'Osobny klucz OpenAI do embeddingów (opcjonalnie)'
                }
              />
              <p className={s.hint}>
                Osobny klucz OpenAI do generowania embeddingów. Jeśli nie podany, używany jest główny klucz OpenAI.
                Jeśli żaden nie jest dostępny — RAG działa na lokalnym TF-IDF (bez kosztów, niższa jakość).
              </p>

              <label className={s.label}>Model embeddingów</label>
              <select
                className={s.select}
                value={embeddingModel}
                title="Model embeddingów"
                onChange={(e) => setEmbeddingModel(e.target.value)}
              >
                <option value="text-embedding-3-small">text-embedding-3-small (tani, szybki)</option>
                <option value="text-embedding-3-large">text-embedding-3-large (dokładniejszy)</option>
                <option value="text-embedding-ada-002">text-embedding-ada-002 (legacy)</option>
              </select>
            </div>

            {/* Danger zone */}
            <div>
              <h3 className={s.sectionTitleDanger}>Strefa niebezpieczna</h3>
              <button onClick={clearHistory} className={s.btnDanger}>
                🗑️ Wyczyść historię konwersacji
              </button>
            </div>

            <div className={s.saveWrapper}>
              <button onClick={saveSettings} disabled={saving} className={saving ? s.btnSaveSaving : s.btnSave}>
                {saving ? 'Zapisywanie...' : 'Zapisz ustawienia'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'persona' && (
          <div className="fade-in">
            <p className={s.desc}>
              SOUL.md definiuje osobowość, ton i granice Twojego agenta. Edytuj poniżej aby dostosować zachowanie.
            </p>
            <textarea
              className={s.textarea}
              value={soulContent}
              onChange={(e) => setSoulContent(e.target.value)}
              title="Edycja SOUL.md"
            />
            <button onClick={saveSoul} className={s.btnSave}>
              Zapisz SOUL.md
            </button>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="fade-in">
            <p className={s.desc}>
              MEMORY.md to pamięć długoterminowa Twojego agenta. Agent sam ją uzupełnia, ale możesz ją też edytować
              ręcznie.
            </p>
            <textarea
              className={s.textarea}
              value={memoryContent}
              onChange={(e) => setMemoryContent(e.target.value)}
              title="Edycja MEMORY.md"
            />
            <button onClick={saveMemory} className={s.btnSave}>
              Zapisz MEMORY.md
            </button>
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className="fade-in">
            <p className={s.desc}>
              Zarządzaj folderami, które agent indeksuje. Dodaj foldery z kodem, dokumentami lub notatkami — agent
              będzie je przeszukiwał semantycznie.
            </p>

            {/* Stats */}
            {ragStats && (
              <div className={s.section}>
                <h3 className={s.sectionTitle}>Statystyki indeksu</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{ragStats.totalFiles}</div>
                    <div className={s.statCardLabel}>Plików</div>
                  </div>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{ragStats.totalChunks}</div>
                    <div className={s.statCardLabel}>Chunków</div>
                  </div>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{ragStats.embeddingType}</div>
                    <div className={s.statCardLabel}>Embeddings</div>
                  </div>
                </div>
              </div>
            )}

            {/* Indexed folders */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Zaindeksowane foldery</h3>

              {folderStats.map((folder, idx) => (
                <div key={idx} className={s.folderItem}>
                  <div className={s.folderItemInfo}>
                    <div className={s.folderItemPath} title={folder.path}>
                      {folder.path}
                    </div>
                    <div className={s.folderItemStats}>
                      {folder.fileCount} plików · {folder.chunkCount} chunków
                      {folder.lastIndexed > 0 && <> · {new Date(folder.lastIndexed).toLocaleString('pl-PL')}</>}
                    </div>
                  </div>
                  {idx > 0 && (
                    <button
                      className={s.folderItemRemove}
                      onClick={() => handleRemoveFolder(folder.path)}
                      title="Usuń folder"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              <button className={s.btnSave} onClick={handleAddFolder} style={{ marginTop: '8px' }}>
                ➕ Dodaj folder
              </button>
            </div>

            {/* Reindex */}
            <div className={s.section}>
              <button className={s.btnSave} onClick={handleReindex} disabled={reindexing} style={{ width: '100%' }}>
                {reindexing ? '⏳ Reindeksowanie...' : '🔄 Przeindeksuj wszystko'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'mcp' && (
          <div className="fade-in">
            <p className={s.desc}>
              Zarządzaj serwerami MCP (Model Context Protocol). Agent może łączyć się z zewnętrznymi usługami —
              kalendarzem, Slackiem, GitHubem i wieloma innymi.
            </p>

            {/* Hub Stats */}
            {mcpStatus && (
              <div className={s.section}>
                <h3 className={s.sectionTitle}>Status Hub</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{mcpStatus.connectedCount}</div>
                    <div className={s.statCardLabel}>Połączonych</div>
                  </div>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{mcpStatus.servers.length}</div>
                    <div className={s.statCardLabel}>Serwerów</div>
                  </div>
                  <div className={s.statCard}>
                    <div className={s.statCardValue}>{mcpStatus.totalTools}</div>
                    <div className={s.statCardLabel}>Narzędzi</div>
                  </div>
                </div>
              </div>
            )}

            {/* Connected Servers */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Skonfigurowane serwery</h3>

              {mcpStatus && mcpStatus.servers.length === 0 && (
                <p className={s.hint}>Brak skonfigurowanych serwerów. Dodaj z rejestru poniżej lub ręcznie.</p>
              )}

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
                            title="Rozłącz"
                          >
                            ⏹
                          </button>
                        ) : (
                          <button
                            className={s.mcpBtnSmallAccent}
                            onClick={() => handleMcpConnect(server.id)}
                            title="Połącz"
                          >
                            ▶
                          </button>
                        )}
                        <button
                          className={s.mcpBtnSmall}
                          onClick={() => {
                            // Find server config to prefill env
                            window.kxai.mcpListServers().then((servers) => {
                              const srv = servers.find((ss) => ss.id === server.id);
                              const envStr = srv?.env
                                ? Object.entries(srv.env)
                                    .map(([k, v]) => `${k}=${v}`)
                                    .join('\n')
                                : '';
                              setMcpEnvEditing(server.id);
                              setMcpEnvInput(envStr);
                            });
                          }}
                          title="Edytuj env vars"
                        >
                          ⚙
                        </button>
                        <button
                          className={s.folderItemRemove}
                          onClick={() => handleMcpRemove(server.id, server.name)}
                          title="Usuń"
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

                    {/* Env editor */}
                    {mcpEnvEditing === server.id && (
                      <div className={s.mcpEnvEditor}>
                        <label className={s.label}>Zmienne środowiskowe (KEY=value, po jednej na linię)</label>
                        <textarea
                          className={s.mcpEnvTextarea}
                          value={mcpEnvInput}
                          onChange={(e) => setMcpEnvInput(e.target.value)}
                          placeholder="GITHUB_TOKEN=ghp_xxx&#10;SLACK_TOKEN=xoxb-xxx"
                          rows={4}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                          <button className={s.mcpBtnSmallAccent} onClick={() => handleMcpUpdateEnv(server.id)}>
                            Zapisz
                          </button>
                          <button className={s.mcpBtnSmall} onClick={() => setMcpEnvEditing(null)}>
                            Anuluj
                          </button>
                        </div>
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
                {mcpShowAddForm ? '✕ Anuluj' : '➕ Dodaj serwer ręcznie'}
              </button>

              {mcpShowAddForm && (
                <div className={s.mcpAddForm}>
                  <label className={s.label}>Nazwa</label>
                  <input
                    className={s.input}
                    value={mcpNewServer.name}
                    onChange={(e) => setMcpNewServer((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="np. moj-serwer"
                  />

                  <label className={s.label}>Transport</label>
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
                    <option value="stdio">stdio (lokalny proces)</option>
                    <option value="streamable-http">Streamable HTTP</option>
                    <option value="sse">SSE (Server-Sent Events)</option>
                  </select>

                  {mcpNewServer.transport === 'stdio' ? (
                    <>
                      <label className={s.label}>Komenda</label>
                      <input
                        className={s.input}
                        value={mcpNewServer.command}
                        onChange={(e) => setMcpNewServer((prev) => ({ ...prev, command: e.target.value }))}
                        placeholder="npx, node, python..."
                      />
                      <label className={s.label}>Argumenty (spacja)</label>
                      <input
                        className={s.input}
                        value={mcpNewServer.args}
                        onChange={(e) => setMcpNewServer((prev) => ({ ...prev, args: e.target.value }))}
                        placeholder="-y @modelcontextprotocol/server-github"
                      />
                    </>
                  ) : (
                    <>
                      <label className={s.label}>URL</label>
                      <input
                        className={s.input}
                        value={mcpNewServer.url}
                        onChange={(e) => setMcpNewServer((prev) => ({ ...prev, url: e.target.value }))}
                        placeholder="http://localhost:3000/mcp"
                      />
                    </>
                  )}

                  <label className={s.label}>Zmienne środowiskowe (KEY=value)</label>
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
                    Auto-connect przy starcie
                  </label>

                  <button
                    className={s.btnSave}
                    onClick={handleMcpAddCustom}
                    disabled={mcpAddingServer || !mcpNewServer.name}
                    style={{ marginTop: '12px' }}
                  >
                    {mcpAddingServer ? '⏳ Dodawanie...' : '✅ Dodaj serwer'}
                  </button>
                </div>
              )}
            </div>

            {/* Registry */}
            <div className={s.section}>
              <h3 className={s.sectionTitle}>📦 Rejestr integracji</h3>
              <p className={s.hint}>
                Gotowe integracje MCP. Kliknij aby dodać — agent automatycznie zyska nowe narzędzia.
              </p>

              {mcpRegistry.map((entry) => {
                const alreadyAdded = mcpStatus?.servers.some((s) => s.name.toLowerCase() === entry.name.toLowerCase());
                return (
                  <div key={entry.id} className={s.mcpRegistryItem}>
                    <div className={s.mcpRegistryInfo}>
                      <span className={s.mcpServerIcon}>{entry.icon}</span>
                      <div>
                        <div className={s.mcpRegistryName}>{entry.name}</div>
                        <div className={s.mcpRegistryDesc}>{entry.description}</div>
                        {entry.requiresSetup && <span className={s.mcpRequiresSetup}>⚙ Wymaga konfiguracji</span>}
                      </div>
                    </div>
                    <button
                      className={alreadyAdded ? s.mcpBtnSmall : s.mcpBtnSmallAccent}
                      onClick={() => !alreadyAdded && handleMcpAddFromRegistry(entry)}
                      disabled={alreadyAdded || mcpAddingServer}
                      title={alreadyAdded ? 'Już dodany' : 'Dodaj i połącz'}
                    >
                      {alreadyAdded ? '✓' : '+'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="fade-in">
            <div className={s.section}>
              <h3 className={s.sectionTitle}>📅 Połączenia kalendarzy (CalDAV)</h3>
              <p className={s.hint}>
                Połącz kalendarze Google, iCloud, Nextcloud lub dowolny serwer CalDAV. Agent będzie mógł sprawdzać
                wydarzenia, tworzyć przypomnienia i proaktywnie informować o spotkaniach.
              </p>

              {calLoading && <div className={s.mcpLoading}>Ładowanie...</div>}

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
                              Ostatnia sync: {new Date(conn.lastSync).toLocaleString('pl-PL')}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className={s.mcpServerActions}>
                        <span className={badge.cls}>{badge.text}</span>
                        {conn.status === 'connected' ? (
                          <button className={s.mcpBtnSmall} onClick={() => handleCalendarDisconnect(conn.id)}>
                            Rozłącz
                          </button>
                        ) : (
                          <button className={s.mcpBtnSmallAccent} onClick={() => handleCalendarConnect(conn.id)}>
                            Połącz
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
                        <div className={s.hint}>Kalendarze:</div>
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
                  + Dodaj połączenie
                </button>
              ) : (
                <div className={s.mcpAddForm}>
                  <h4>Nowe połączenie CalDAV</h4>

                  <label className={s.label}>Dostawca</label>
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
                    <option value="caldav">CalDAV (ogólny)</option>
                    <option value="nextcloud">Nextcloud</option>
                    <option value="icloud">iCloud</option>
                    <option value="google">Google Calendar</option>
                  </select>

                  <label className={s.label}>Nazwa</label>
                  <input
                    className={s.input}
                    value={calNewConn.name}
                    onChange={(e) => setCalNewConn({ ...calNewConn, name: e.target.value })}
                    placeholder="np. Mój kalendarz"
                  />

                  {calNewConn.provider !== 'google' && (
                    <>
                      <label className={s.label}>URL serwera CalDAV</label>
                      <input
                        className={s.input}
                        value={calNewConn.serverUrl}
                        onChange={(e) => setCalNewConn({ ...calNewConn, serverUrl: e.target.value })}
                        placeholder="https://caldav.example.com/"
                      />
                    </>
                  )}

                  <label className={s.label}>Użytkownik</label>
                  <input
                    className={s.input}
                    value={calNewConn.username}
                    onChange={(e) => setCalNewConn({ ...calNewConn, username: e.target.value })}
                    placeholder="email@example.com"
                  />

                  <label className={s.label}>
                    {calNewConn.provider === 'icloud' ? 'Hasło aplikacji (app-specific password)' : 'Hasło'}
                  </label>
                  <input
                    className={s.input}
                    type="password"
                    value={calNewConn.password}
                    onChange={(e) => setCalNewConn({ ...calNewConn, password: e.target.value })}
                    placeholder="••••••••"
                  />

                  {calNewConn.provider === 'google' && (
                    <p className={s.hint}>
                      ⚠️ Google Calendar wymaga OAuth 2.0. Funkcja w przygotowaniu — na razie użyj CalDAV z innym
                      dostawcą.
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      className={s.mcpBtnPrimary}
                      onClick={handleCalendarAdd}
                      disabled={calLoading || !calNewConn.name || !calNewConn.serverUrl}
                    >
                      Dodaj i połącz
                    </button>
                    <button className={s.mcpBtnSmall} onClick={() => setCalShowAddForm(false)}>
                      Anuluj
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
