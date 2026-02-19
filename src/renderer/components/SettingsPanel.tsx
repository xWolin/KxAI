import React, { useState, useEffect } from 'react';
import type { KxAIConfig } from '../types';

interface SettingsPanelProps {
  config: KxAIConfig;
  onBack: () => void;
  onConfigUpdate: () => void;
}

const MODELS = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'o3', label: 'o3' },
    { value: 'o4-mini', label: 'o4-mini' },
  ],
  anthropic: [
    { value: 'claude-opus-4-0', label: 'Claude Opus 4' },
    { value: 'claude-sonnet-4-0', label: 'Claude Sonnet 4' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  ],
};

export function SettingsPanel({ config, onBack, onConfigUpdate }: SettingsPanelProps) {
  const [provider, setProvider] = useState(config.aiProvider || 'openai');
  const [model, setModel] = useState(config.aiModel || 'gpt-4o');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [proactiveInterval, setProactiveInterval] = useState(
    (config.proactiveIntervalMs || 30000) / 1000
  );
  const [agentName, setAgentName] = useState(config.agentName || 'KxAI');
  const [agentEmoji, setAgentEmoji] = useState(config.agentEmoji || '🤖');
  const [saving, setSaving] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [memoryContent, setMemoryContent] = useState('');
  const [activeTab, setActiveTab] = useState<'general' | 'persona' | 'memory'>('general');

  useEffect(() => {
    checkApiKey();
    loadFiles();
  }, [provider]);

  async function checkApiKey() {
    const has = await window.kxai.hasApiKey(provider);
    setHasKey(has);
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

      // Save API key if provided
      if (apiKey.trim()) {
        await window.kxai.setApiKey(provider, apiKey.trim());
        setApiKey('');
        setHasKey(true);
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

  async function clearHistory() {
    if (confirm('Czy na pewno chcesz wyczyścić historię konwersacji?')) {
      await window.kxai.clearConversationHistory();
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontFamily: 'var(--font)',
    outline: 'none',
    marginBottom: 12,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    color: 'var(--text-secondary)',
    marginBottom: 4,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px',
    background: active ? 'var(--accent)' : 'transparent',
    border: 'none',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 'var(--radius-xs)',
    transition: 'var(--transition)',
  });

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: 'var(--bg-primary)',
      borderRadius: 'var(--radius)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: 'var(--shadow)',
      border: '1px solid var(--border)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: '1px solid var(--border)',
        WebkitAppRegion: 'drag',
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 16,
            WebkitAppRegion: 'no-drag',
          }}
        >
          ←
        </button>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Ustawienia</span>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        padding: '8px',
        gap: 4,
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
      }}>
        <button style={tabStyle(activeTab === 'general')} onClick={() => setActiveTab('general')}>
          ⚙️ Ogólne
        </button>
        <button style={tabStyle(activeTab === 'persona')} onClick={() => setActiveTab('persona')}>
          🎭 Persona
        </button>
        <button style={tabStyle(activeTab === 'memory')} onClick={() => setActiveTab('memory')}>
          🧠 Pamięć
        </button>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
      }}>
        {activeTab === 'general' && (
          <div className="fade-in">
            {/* Agent identity */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Agent</h3>

              <label style={labelStyle}>Nazwa</label>
              <input
                style={inputStyle}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
              />

              <label style={labelStyle}>Emoji</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {['🤖', '🧠', '⚡', '🔮', '🦾', '🎯', '💡', '🚀'].map((e) => (
                  <button
                    key={e}
                    onClick={() => setAgentEmoji(e)}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 'var(--radius-xs)',
                      border: agentEmoji === e ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: agentEmoji === e ? 'var(--accent-light)' : 'transparent',
                      cursor: 'pointer',
                      fontSize: 18,
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Provider */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>AI Provider</h3>

              <label style={labelStyle}>Dostawca</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as 'openai' | 'anthropic';
                  setProvider(p);
                  setModel(MODELS[p][0].value);
                }}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>

              <label style={labelStyle}>Model</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {MODELS[provider].map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>

              <label style={labelStyle}>
                Klucz API {hasKey ? '✅' : '❌'}
              </label>
              <input
                type="password"
                style={inputStyle}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••••• (zmień)' : 'Wklej klucz API'}
              />
            </div>

            {/* Proactive */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Tryb proaktywny</h3>

              <label style={labelStyle}>Interwał analizy ekranu (sekundy)</label>
              <input
                type="number"
                style={inputStyle}
                value={proactiveInterval}
                onChange={(e) => setProactiveInterval(Number(e.target.value))}
                min={5}
                max={300}
              />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                Co ile sekund agent analizuje ekran (min. 5s). Niższa wartość = więcej API calls.
              </p>
            </div>

            {/* Danger zone */}
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--error)' }}>
                Strefa niebezpieczna
              </h3>
              <button
                onClick={clearHistory}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--error)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 16px',
                  color: 'var(--error)',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                🗑️ Wyczyść historię konwersacji
              </button>
            </div>

            <div style={{ marginTop: 20 }}>
              <button
                onClick={saveSettings}
                disabled={saving}
                style={{
                  width: '100%',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  color: 'var(--text-primary)',
                  cursor: saving ? 'wait' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {saving ? 'Zapisywanie...' : 'Zapisz ustawienia'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'persona' && (
          <div className="fade-in">
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              SOUL.md definiuje osobowość, ton i granice Twojego agenta.
              Edytuj poniżej aby dostosować zachowanie.
            </p>
            <textarea
              style={{
                ...inputStyle,
                minHeight: 350,
                resize: 'vertical',
                fontSize: 12,
                fontFamily: 'monospace',
                lineHeight: 1.5,
              }}
              value={soulContent}
              onChange={(e) => setSoulContent(e.target.value)}
            />
            <button
              onClick={saveSoul}
              style={{
                width: '100%',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Zapisz SOUL.md
            </button>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="fade-in">
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
              MEMORY.md to pamięć długoterminowa Twojego agenta.
              Agent sam ją uzupełnia, ale możesz ją też edytować ręcznie.
            </p>
            <textarea
              style={{
                ...inputStyle,
                minHeight: 350,
                resize: 'vertical',
                fontSize: 12,
                fontFamily: 'monospace',
                lineHeight: 1.5,
              }}
              value={memoryContent}
              onChange={(e) => setMemoryContent(e.target.value)}
            />
            <button
              onClick={saveMemory}
              style={{
                width: '100%',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Zapisz MEMORY.md
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
