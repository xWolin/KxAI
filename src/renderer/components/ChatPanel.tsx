import React, { useState, useEffect, useRef } from 'react';
import type { ConversationMessage, KxAIConfig } from '../types';

interface ChatPanelProps {
  config: KxAIConfig;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function ChatPanel({ config, onClose, onOpenSettings }: ChatPanelProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadHistory();
    loadProactiveMode();

    // Listen for streaming chunks
    window.kxai.onAIStream((data) => {
      if (data.done) {
        setIsStreaming(false);
        loadHistory(); // Reload to get the full message stored by backend
        setStreamingContent('');
      } else if (data.chunk) {
        setStreamingContent((prev) => prev + data.chunk);
      }
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  async function loadHistory() {
    const history = await window.kxai.getConversationHistory();
    setMessages(history);
  }

  async function loadProactiveMode() {
    const mode = await window.kxai.getProactiveMode();
    setProactiveEnabled(mode);
  }

  async function sendMessage() {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    // Optimistically add user message
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        type: 'chat',
      },
    ]);

    try {
      await window.kxai.streamMessage(userMessage);
    } catch (error: any) {
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `❌ Błąd: ${error.message || 'Nie udało się wysłać wiadomości'}`,
          timestamp: Date.now(),
          type: 'chat',
        },
      ]);
    }
  }

  async function toggleProactive() {
    const newMode = !proactiveEnabled;
    await window.kxai.setProactiveMode(newMode);
    setProactiveEnabled(newMode);
  }

  async function captureAndAnalyze() {
    setIsStreaming(true);
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'user',
        content: '📸 Analizuj mój ekran',
        timestamp: Date.now(),
        type: 'analysis',
      },
    ]);

    try {
      await window.kxai.streamMessage(
        'Przeanalizuj mój obecny ekran. Co widzisz? Jakie masz obserwacje, porady, uwagi?',
        '[Zrzut ekranu został dołączony automatycznie]'
      );
    } catch (error: any) {
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: `❌ Nie udało się przeanalizować ekranu: ${error.message}`,
          timestamp: Date.now(),
        },
      ]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

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
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)',
        WebkitAppRegion: 'drag',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 24 }}>{config.agentEmoji || '🤖'}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {config.agentName || 'KxAI'}
            </div>
            <div style={{
              fontSize: 11,
              color: 'var(--text-muted)',
            }}>
              {config.aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · {config.aiModel}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' }}>
          {/* Proactive toggle */}
          <button
            onClick={toggleProactive}
            title={proactiveEnabled ? 'Wyłącz tryb proaktywny' : 'Włącz tryb proaktywny'}
            style={{
              background: proactiveEnabled ? 'var(--accent)' : 'transparent',
              border: `1px solid ${proactiveEnabled ? 'var(--accent)' : 'var(--border)'}`,
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            👁️
          </button>

          {/* Screenshot */}
          <button
            onClick={captureAndAnalyze}
            title="Zrób screenshot i analizuj"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            📸
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            title="Ustawienia"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ⚙️
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            title="Zwiń"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
        {messages.length === 0 && !isStreaming && (
          <div style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            padding: '40px 20px',
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{config.agentEmoji || '🤖'}</div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>
              Cześć! Jestem {config.agentName || 'KxAI'}
            </div>
            <div style={{ fontSize: 12 }}>
              Napisz coś lub kliknij 📸 żeby przeanalizować ekran
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className="fade-in"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={{
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user'
                ? '12px 12px 4px 12px'
                : '12px 12px 12px 4px',
              background: msg.role === 'user'
                ? 'var(--accent)'
                : 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              lineHeight: 1.5,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content}
            </div>
            <div style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              marginTop: 2,
              padding: '0 4px',
            }}>
              {formatTime(msg.timestamp)}
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {isStreaming && (
          <div className="fade-in" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}>
            <div style={{
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: '12px 12px 12px 4px',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              lineHeight: 1.5,
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
            }}>
              {streamingContent || (
                <div style={{ display: 'flex', gap: 4 }}>
                  <span style={{ animation: 'dotPulse 1.4s infinite 0s' }}>●</span>
                  <span style={{ animation: 'dotPulse 1.4s infinite 0.2s' }}>●</span>
                  <span style={{ animation: 'dotPulse 1.4s infinite 0.4s' }}>●</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
      }}>
        <div style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Napisz wiadomość... (Shift+Enter = nowa linia)"
            disabled={isStreaming}
            style={{
              flex: 1,
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontFamily: 'var(--font)',
              resize: 'none',
              outline: 'none',
              minHeight: 40,
              maxHeight: 120,
              lineHeight: 1.4,
            }}
            rows={1}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            style={{
              background: input.trim() && !isStreaming ? 'var(--accent)' : 'var(--bg-tertiary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              color: 'var(--text-primary)',
              cursor: input.trim() && !isStreaming ? 'pointer' : 'not-allowed',
              fontSize: 16,
              transition: 'var(--transition)',
            }}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
