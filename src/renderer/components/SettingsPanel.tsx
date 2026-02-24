import React, { useState, useEffect } from 'react';
import type { KxAIConfig, RAGFolderInfo } from '../types';
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
              <select
                className={s.select}
                value={model}
                title="Model AI"
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS[provider].map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>

              <label className={s.label}>
                Klucz API {hasKey ? '✅' : '❌'}
              </label>
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

              <label className={s.label}>
                Klucz API Deepgram {hasDeepgramKey ? '✅' : '❌'}
              </label>
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
                Klucz API OpenAI (embeddingi) {hasEmbeddingKey ? '✅' : hasKey && provider === 'openai' ? '🔗 (główny)' : '❌'}
              </label>
              <input
                type="password"
                className={s.input}
                value={embeddingKey}
                onChange={(e) => setEmbeddingKey(e.target.value)}
                placeholder={hasEmbeddingKey ? '••••••••••• (zmień)' : 'Osobny klucz OpenAI do embeddingów (opcjonalnie)'}
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
              <h3 className={s.sectionTitleDanger}>
                Strefa niebezpieczna
              </h3>
              <button onClick={clearHistory} className={s.btnDanger}>
                🗑️ Wyczyść historię konwersacji
              </button>
            </div>

            <div className={s.saveWrapper}>
              <button
                onClick={saveSettings}
                disabled={saving}
                className={saving ? s.btnSaveSaving : s.btnSave}
              >
                {saving ? 'Zapisywanie...' : 'Zapisz ustawienia'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'persona' && (
          <div className="fade-in">
            <p className={s.desc}>
              SOUL.md definiuje osobowość, ton i granice Twojego agenta.
              Edytuj poniżej aby dostosować zachowanie.
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
              MEMORY.md to pamięć długoterminowa Twojego agenta.
              Agent sam ją uzupełnia, ale możesz ją też edytować ręcznie.
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
              Zarządzaj folderami, które agent indeksuje. Dodaj foldery z kodem, dokumentami lub notatkami — agent będzie je przeszukiwał semantycznie.
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
                      {folder.lastIndexed > 0 && (
                        <> · {new Date(folder.lastIndexed).toLocaleString('pl-PL')}</>
                      )}
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

              <button
                className={s.btnSave}
                onClick={handleAddFolder}
                style={{ marginTop: '8px' }}
              >
                ➕ Dodaj folder
              </button>
            </div>

            {/* Reindex */}
            <div className={s.section}>
              <button
                className={s.btnSave}
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
