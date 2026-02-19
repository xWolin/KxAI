import React, { useState, useEffect, useRef } from 'react';
import type { ConversationMessage, KxAIConfig } from '../types';

interface ChatPanelProps {
  config: KxAIConfig;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenCron: () => void;
}

export function ChatPanel({ config, onClose, onOpenSettings, onOpenCron }: ChatPanelProps) {
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
    const cleanup = window.kxai.onAIStream((data) => {
      if (data.done) {
        setIsStreaming(false);
        setStreamingContent('');
        // Reload history from backend to sync with persisted messages
        loadHistory();
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

    // Optimistically add user message for instant feedback
    const optimisticMsg: ConversationMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      type: 'chat',
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const result = await window.kxai.streamMessage(userMessage);
      if (!result.success) {
        setIsStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: `❌ Błąd: ${result.error || 'Nie udało się wysłać wiadomości'}`,
            timestamp: Date.now(),
            type: 'chat',
          },
        ]);
      }
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
    setStreamingContent('');

    // Don't add optimistic message — backend stores it with screenshots
    try {
      const result = await window.kxai.streamWithScreen(
        'Przeanalizuj mój obecny ekran. Co widzisz? Jakie masz obserwacje, porady, uwagi?'
      );
      if (!result.success) {
        setIsStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: `❌ Nie udało się przeanalizować ekranu: ${result.error}`,
            timestamp: Date.now(),
          },
        ]);
      }
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
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header__info">
          <span className="chat-header__emoji">{config.agentEmoji || '🤖'}</span>
          <div>
            <div className="chat-header__name">
              {config.agentName || 'KxAI'}
            </div>
            <div className="chat-header__model">
              {config.aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · {config.aiModel}
            </div>
          </div>
        </div>

        <div className="chat-header__actions">
          {/* Proactive toggle */}
          <button
            onClick={toggleProactive}
            title={proactiveEnabled ? 'Wyłącz tryb proaktywny' : 'Włącz tryb proaktywny'}
            className={`chat-btn${proactiveEnabled ? ' chat-btn--active' : ''}`}
          >
            👁️
          </button>

          {/* Screenshot */}
          <button
            onClick={captureAndAnalyze}
            title="Zrób screenshot i analizuj"
            className="chat-btn"
          >
            📸
          </button>

          {/* Cron Jobs */}
          <button
            onClick={onOpenCron}
            title="Cron Jobs"
            className="chat-btn"
          >
            ⏰
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            title="Ustawienia"
            className="chat-btn"
          >
            ⚙️
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            title="Zwiń"
            className="chat-btn"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="chat-empty">
            <div className="chat-empty__emoji">{config.agentEmoji || '🤖'}</div>
            <div className="chat-empty__title">
              Cześć! Jestem {config.agentName || 'KxAI'}
            </div>
            <div className="chat-empty__subtitle">
              Napisz coś lub kliknij 📸 żeby przeanalizować ekran
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`fade-in chat-msg chat-msg--${msg.role}`}
          >
            <div className={`chat-bubble chat-bubble--${msg.role}`}>
              {msg.content}
            </div>
            <div className="chat-msg__time">
              {formatTime(msg.timestamp)}
            </div>
          </div>
        ))}

        {/* Streaming message */}
        {isStreaming && (
          <div className="fade-in chat-streaming">
            <div className="chat-bubble chat-bubble--assistant">
              {streamingContent || (
                <div className="chat-typing">
                  <span className="chat-typing__dot-1">●</span>
                  <span className="chat-typing__dot-2">●</span>
                  <span className="chat-typing__dot-3">●</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input">
        <div className="chat-input__row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Napisz wiadomość... (Shift+Enter = nowa linia)"
            disabled={isStreaming}
            className="chat-textarea"
            rows={1}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className={`chat-send ${input.trim() && !isStreaming ? 'chat-send--enabled' : 'chat-send--disabled'}`}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
