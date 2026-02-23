import React, { useState, useEffect } from 'react';
import type { KxAIConfig, RAGFolderInfo } from '../types';

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
    { value: 'gpt-4.1', label: 'GPT-4.1 (Legacy)' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Legacy)' },
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
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [hasElevenLabsKey, setHasElevenLabsKey] = useState(false);
  const [embeddingKey, setEmbeddingKey] = useState('');
  const [hasEmbeddingKey, setHasEmbeddingKey] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState(config.embeddingModel || 'text-embedding-3-small');
  const [proactiveInterval, setProactiveInterval] = useState(
    (config.proactiveIntervalMs || 30000) / 1000
  );
  const [agentName, setAgentName] = useState(config.agentName || 'KxAI');
  const [agentEmoji, setAgentEmoji] = useState(config.agentEmoji || '🤖');
  const [saving, setSaving] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [activeTab, setActiveTab] = useState<'general' | 'persona' | 'memory' | 'knowledge'>('general');
  const [indexedFolders, setIndexedFolders] = useState<string[]>([]);
  const [folderStats, setFolderStats] = useState<RAGFolderInfo[]>([]);
  const [ragStats, setRagStats] = useState<{ totalChunks: number; totalFiles: number; embeddingType: string } | null>(null);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    checkApiKey();
    loadFiles();
    loadKnowledgeData();
  }, [provider]);

  async function checkApiKey() {
    const has = await window.kxai.hasApiKey(provider);
    setHasKey(has);
    const hasEl = await window.kxai.hasApiKey('elevenlabs');
    setHasElevenLabsKey(hasEl);
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
      // Save provider and model
      await window.kxai.setConfig('aiProvider', provider);
      await window.kxai.setConfig('aiModel', model);
      await window.kxai.setConfig('agentName', agentName);
      await window.kxai.setConfig('agentEmoji', agentEmoji);
      await window.kxai.setConfig('proactiveIntervalMs', proactiveInterval * 1000);
      await window.kxai.setConfig('embeddingModel', embeddingModel);

      // Save API key if provided
      if (apiKey.trim()) {
        await window.kxai.setApiKey(provider, apiKey.trim());
        setApiKey('');
        setHasKey(true);
      }

      // Save ElevenLabs key if provided
      if (elevenLabsKey.trim()) {
        await window.kxai.setApiKey('elevenlabs', elevenLabsKey.trim());
        setElevenLabsKey('');
        setHasElevenLabsKey(true);
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

  const inputClass = 'settings-input';
  const labelClass = 'settings-label';

  return (
    <div className="settings-panel">
      {/* Header */}
      <div className="settings-header">
        <button onClick={onBack} className="settings-header__back">
          ←
        </button>
        <span className="settings-header__title">Ustawienia</span>
      </div>

      {/* Tabs */}
      <div className="settings-tabs">
        <button className={`settings-tab${activeTab === 'general' ? ' settings-tab--active' : ''}`} onClick={() => setActiveTab('general')}>
          ⚙️ Ogólne
        </button>
        <button className={`settings-tab${activeTab === 'persona' ? ' settings-tab--active' : ''}`} onClick={() => setActiveTab('persona')}>
          🎭 Persona
        </button>
        <button className={`settings-tab${activeTab === 'memory' ? ' settings-tab--active' : ''}`} onClick={() => setActiveTab('memory')}>
          🧠 Pamięć
        </button>
        <button className={`settings-tab${activeTab === 'knowledge' ? ' settings-tab--active' : ''}`} onClick={() => setActiveTab('knowledge')}>
          📚 Wiedza
        </button>
      </div>

      {/* Content */}
      <div className="settings-content">
        {activeTab === 'general' && (
          <div className="fade-in">
            {/* Agent identity */}
            <div className="settings-section">
              <h3 className="settings-section__title">Agent</h3>

              <label className={labelClass}>Nazwa</label>
              <input
                className={inputClass}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                title="Nazwa agenta"
              />

              <label className={labelClass}>Emoji</label>
              <div className="settings-emoji-grid">
                {['🤖', '🧠', '⚡', '🔮', '🦾', '🎯', '💡', '🚀'].map((e) => (
                  <button
                    key={e}
                    onClick={() => setAgentEmoji(e)}
                    className={`settings-emoji-btn${agentEmoji === e ? ' settings-emoji-btn--selected' : ''}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Provider */}
            <div className="settings-section">
              <h3 className="settings-section__title">AI Provider</h3>

              <label className={labelClass}>Dostawca</label>
              <select
                className={`${inputClass} settings-select`}
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

              <label className={labelClass}>Model</label>
              <select
                className={`${inputClass} settings-select`}
                value={model}
                title="Model AI"
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS[provider].map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>

              <label className={labelClass}>
                Klucz API {hasKey ? '✅' : '❌'}
              </label>
              <input
                type="password"
                className={inputClass}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••••• (zmień)' : 'Wklej klucz API'}
              />
            </div>

            {/* Proactive */}
            <div className="settings-section">
              <h3 className="settings-section__title">Tryb proaktywny</h3>

              <label className={labelClass}>Interwał analizy ekranu (sekundy)</label>
              <input
                type="number"
                className={inputClass}
                value={proactiveInterval}
                onChange={(e) => setProactiveInterval(Number(e.target.value))}
                title="Interwał proaktywny w sekundach"
                min={5}
                max={300}
              />
              <p className="settings-hint">
                Co ile sekund agent analizuje ekran (min. 5s). Niższa wartość = więcej API calls.
              </p>
            </div>

            {/* ElevenLabs / Meeting Coach */}
            <div className="settings-section">
              <h3 className="settings-section__title">🎙️ Meeting Coach (ElevenLabs)</h3>

              <label className={labelClass}>
                Klucz API ElevenLabs {hasElevenLabsKey ? '✅' : '❌'}
              </label>
              <input
                type="password"
                className={inputClass}
                value={elevenLabsKey}
                onChange={(e) => setElevenLabsKey(e.target.value)}
                placeholder={hasElevenLabsKey ? '••••••••••• (zmień)' : 'Wklej klucz API ElevenLabs'}
              />
              <p className="settings-hint">
                Wymagany do transkrypcji w czasie rzeczywistym (Scribe v2). Plan Pro ($99/mies) daje 48h transkrypcji.
              </p>
            </div>

            {/* Embeddings (RAG) */}
            <div className="settings-section">
              <h3 className="settings-section__title">🧬 Embeddingi (RAG)</h3>

              <label className={labelClass}>
                Klucz API OpenAI (embeddingi) {hasEmbeddingKey ? '✅' : hasKey && provider === 'openai' ? '🔗 (główny)' : '❌'}
              </label>
              <input
                type="password"
                className={inputClass}
                value={embeddingKey}
                onChange={(e) => setEmbeddingKey(e.target.value)}
                placeholder={hasEmbeddingKey ? '••••••••••• (zmień)' : 'Osobny klucz OpenAI do embeddingów (opcjonalnie)'}
              />
              <p className="settings-hint">
                Osobny klucz OpenAI do generowania embeddingów. Jeśli nie podany, używany jest główny klucz OpenAI.
                Jeśli żaden nie jest dostępny — RAG działa na lokalnym TF-IDF (bez kosztów, niższa jakość).
              </p>

              <label className={labelClass}>Model embeddingów</label>
              <select
                className={`${inputClass} settings-select`}
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
              <h3 className="settings-section__title settings-section__title--danger">
                Strefa niebezpieczna
              </h3>
              <button onClick={clearHistory} className="settings-btn-danger">
                🗑️ Wyczyść historię konwersacji
              </button>
            </div>

            <div className="settings-save-wrapper">
              <button
                onClick={saveSettings}
                disabled={saving}
                className={`settings-btn-save${saving ? ' settings-btn-save--saving' : ''}`}
              >
                {saving ? 'Zapisywanie...' : 'Zapisz ustawienia'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'persona' && (
          <div className="fade-in">
            <p className="settings-desc">
              SOUL.md definiuje osobowość, ton i granice Twojego agenta.
              Edytuj poniżej aby dostosować zachowanie.
            </p>
            <textarea
              className={`${inputClass} settings-textarea`}
              value={soulContent}
              onChange={(e) => setSoulContent(e.target.value)}
              title="Edycja SOUL.md"
            />
            <button onClick={saveSoul} className="settings-btn-save">
              Zapisz SOUL.md
            </button>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="fade-in">
            <p className="settings-desc">
              MEMORY.md to pamięć długoterminowa Twojego agenta.
              Agent sam ją uzupełnia, ale możesz ją też edytować ręcznie.
            </p>
            <textarea
              className={`${inputClass} settings-textarea`}
              value={memoryContent}
              onChange={(e) => setMemoryContent(e.target.value)}
              title="Edycja MEMORY.md"
            />
            <button onClick={saveMemory} className="settings-btn-save">
              Zapisz MEMORY.md
            </button>
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className="fade-in">
            <p className="settings-desc">
              Zarządzaj folderami, które agent indeksuje. Dodaj foldery z kodem, dokumentami lub notatkami — agent będzie je przeszukiwał semantycznie.
            </p>

            {/* Stats */}
            {ragStats && (
              <div className="settings-section">
                <h3 className="settings-section__title">Statystyki indeksu</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div className="settings-stat-card">
                    <div className="settings-stat-card__value">{ragStats.totalFiles}</div>
                    <div className="settings-stat-card__label">Plików</div>
                  </div>
                  <div className="settings-stat-card">
                    <div className="settings-stat-card__value">{ragStats.totalChunks}</div>
                    <div className="settings-stat-card__label">Chunków</div>
                  </div>
                  <div className="settings-stat-card">
                    <div className="settings-stat-card__value">{ragStats.embeddingType}</div>
                    <div className="settings-stat-card__label">Embeddings</div>
                  </div>
                </div>
              </div>
            )}

            {/* Indexed folders */}
            <div className="settings-section">
              <h3 className="settings-section__title">Zaindeksowane foldery</h3>
              
              {folderStats.map((folder, idx) => (
                <div key={idx} className="settings-folder-item">
                  <div className="settings-folder-item__info">
                    <div className="settings-folder-item__path" title={folder.path}>
                      {folder.path}
                    </div>
                    <div className="settings-folder-item__stats">
                      {folder.fileCount} plików · {folder.chunkCount} chunków
                      {folder.lastIndexed > 0 && (
                        <> · {new Date(folder.lastIndexed).toLocaleString('pl-PL')}</>
                      )}
                    </div>
                  </div>
                  {idx > 0 && (
                    <button
                      className="settings-folder-item__remove"
                      onClick={() => handleRemoveFolder(folder.path)}
                      title="Usuń folder"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}

              <button
                className="settings-btn-save"
                onClick={handleAddFolder}
                style={{ marginTop: '8px' }}
              >
                ➕ Dodaj folder
              </button>
            </div>

            {/* Reindex */}
            <div className="settings-section">
              <button
                className="settings-btn-save"
                onClick={handleReindex}
                disabled={reindexing}
                style={{ width: '100%' }}
              >
                {reindexing ? '⏳ Reindeksowanie...' : '🔄 Przeindeksuj wszystko'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
