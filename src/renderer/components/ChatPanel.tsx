import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ConversationMessage, KxAIConfig, AgentStatus, IndexProgress } from '../types';

// Configure marked for chat messages
marked.setOptions({
  breaks: true,    // GFM line breaks
  gfm: true,
});

// Override link renderer to open links externally
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }: { href: string; title?: string | null; text: string }) => {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};
marked.use({ renderer });

/**
 * Strip internal AI control blocks (tool, cron, take_control, update_memory)
 * from the displayed message — users shouldn't see raw JSON blocks.
 */
function stripControlBlocks(text: string): string {
  return text
    .replace(/```(?:tool|cron|take_control|update_memory)\s*\n[\s\S]*?\n```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Render markdown to sanitized HTML.
 * Uses DOMPurify to prevent XSS via event handlers or malicious attributes.
 */
function renderMarkdown(text: string): string {
  const cleaned = stripControlBlocks(text);
  if (!cleaned) return '';
  const html = marked.parse(cleaned);
  // marked.parse can return string | Promise<string> — we only use sync mode
  if (typeof html !== 'string') return '';
  return DOMPurify.sanitize(html);
}

/**
 * Memoized markdown message bubble with copy button.
 */
function MessageContent({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const cleaned = stripControlBlocks(content);
    try {
      await navigator.clipboard.writeText(cleaned);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, [content]);

  if (!html) return null;
  return (
    <div className="chat-bubble-wrapper">
      <button
        className={`chat-copy-btn${copied ? ' chat-copy-btn--copied' : ''}`}
        onClick={handleCopy}
        title="Kopiuj wiadomość"
      >
        {copied ? '✓' : '📋'}
      </button>
      <div
        className="chat-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

interface ChatPanelProps {
  config: KxAIConfig;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenCron: () => void;
  onOpenMeeting: () => void;
  refreshTrigger?: number;
}

export function ChatPanel({ config, onClose, onOpenSettings, onOpenCron, onOpenMeeting, refreshTrigger }: ChatPanelProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ state: 'idle' });
  const [ragProgress, setRagProgress] = useState<IndexProgress | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // Keep a ref to streaming content so the onAIStream callback can read the latest value
  const streamingContentRef = useRef('');

  useEffect(() => {
    loadHistory();
    loadProactiveMode();

    // Listen for streaming chunks
    const cleanup = window.kxai.onAIStream((data) => {
      if (data.takeControlStart) {
        // Take-control mode starting — open a new stream to show output
        setIsStreaming(true);
        setStreamingContent(data.chunk || '');
        streamingContentRef.current = data.chunk || '';
        return;
      }
      if (data.done) {
        // Capture the streamed content before clearing
        const finalContent = streamingContentRef.current;
        setIsStreaming(false);
        setStreamingContent('');
        streamingContentRef.current = '';

        if (finalContent) {
          // Immediately add the AI response to local state
          setMessages((prev) => [
            ...prev,
            {
              id: `stream-${Date.now()}`,
              role: 'assistant' as const,
              content: finalContent,
              timestamp: Date.now(),
              type: 'chat' as const,
            },
          ]);
        }
        // NOTE: Do NOT call loadHistory() here!
        // It would overwrite locally-added error messages.
        // Syncing with backend happens in sendMessage/captureAndAnalyze on success.
      } else if (data.chunk) {
        setStreamingContent((prev) => {
          const updated = prev + data.chunk;
          streamingContentRef.current = updated;
          return updated;
        });
      }
    });

    // Listen for agent status updates
    const cleanupStatus = window.kxai.onAgentStatus?.((status) => {
      setAgentStatus(status);
    });

    // Listen for RAG indexing progress
    const cleanupRag = window.kxai.onRagProgress?.((progress) => {
      if (progress.phase === 'done' || progress.phase === 'error') {
        setRagProgress(null);
      } else {
        setRagProgress(progress);
      }
    });

    return () => {
      cleanup();
      cleanupStatus?.();
      cleanupRag?.();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Reload chat when a proactive message arrives while chat is open
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      loadHistory();
    }
  }, [refreshTrigger]);

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
      // Safety: ensure streaming is always reset after IPC completes
      setIsStreaming(false);
      if (result.success) {
        // Sync with backend to get real IDs (replaces optimistic msg + stream msg)
        await loadHistory();
      } else {
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
    streamingContentRef.current = '';

    // Add optimistic user message so it's visible immediately
    const screenshotMsg: ConversationMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: '📸 Przeanalizuj mój obecny ekran. Co widzisz? Jakie masz obserwacje, porady, uwagi?',
      timestamp: Date.now(),
      type: 'analysis',
    };
    setMessages((prev) => [...prev, screenshotMsg]);

    try {
      const result = await window.kxai.streamWithScreen(
        'Przeanalizuj mój obecny ekran. Co widzisz? Jakie masz obserwacje, porady, uwagi?'
      );
      // Safety: always reset streaming state after IPC completes
      setIsStreaming(false);
      if (result.success) {
        // Sync with backend to get real IDs
        await loadHistory();
      } else {
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

  // ─── Voice Input (OpenAI Whisper via MediaRecorder) ───

  function toggleVoiceInput() {
    if (isRecording) {
      stopVoiceInput();
    } else {
      startVoiceInput();
    }
  }

  async function startVoiceInput() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release mic
        stream.getTracks().forEach(t => t.stop());

        if (chunks.length === 0) return;

        setInput(prev => prev || '⏳ Transkrybuję...');

        try {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          // Convert to base64 (chunked to avoid O(n²) string concat)
          const arrayBuffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
          }
          const base64 = btoa(binary);

          const result = await window.kxai.transcribeAudio(base64);
          if (result.success && result.text) {
            setInput(prev => {
              const clean = prev === '⏳ Transkrybuję...' ? '' : prev;
              return (clean ? clean + ' ' : '') + result.text;
            });
            inputRef.current?.focus();
          } else {
            setInput(prev => prev === '⏳ Transkrybuję...'
              ? `⚠️ ${result.error || 'Transkrypcja nie powiodła się'}`
              : prev);
          }
        } catch (err: any) {
          console.error('[ChatPanel] Whisper transcription error:', err);
          setInput(prev => prev === '⏳ Transkrybuję...'
            ? '⚠️ Błąd transkrypcji'
            : prev);
        }
      };

      mediaRecorder.onerror = () => {
        stream.getTracks().forEach(t => t.stop());
        setIsRecording(false);
        recognitionRef.current = null;
      };

      mediaRecorder.start();
      recognitionRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err: any) {
      console.error('[ChatPanel] Mic access failed:', err);
      setInput(prev => prev || '⚠️ Brak uprawnień do mikrofonu');
    }
  }

  function stopVoiceInput() {
    if (recognitionRef.current && recognitionRef.current.state !== 'inactive') {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  }

  async function openDashboard() {
    try {
      const url = await window.kxai.getDashboardUrl();
      if (url) {
        window.open(url, '_blank');
      }
    } catch (err) {
      console.error('[ChatPanel] Nie udało się otworzyć dashboardu:', err);
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
              {agentStatus.state !== 'idle' && (
                <span className="chat-header__status-badge" title={agentStatus.detail || agentStatus.state}>
                  {agentStatus.state === 'thinking' ? '🧠' :
                   agentStatus.state === 'tool-calling' ? '⚙️' :
                   agentStatus.state === 'streaming' ? '📡' :
                   agentStatus.state === 'heartbeat' ? '💓' :
                   agentStatus.state === 'take-control' ? '🎮' :
                   agentStatus.state === 'sub-agent' ? '🤖' : ''}
                </span>
              )}
            </div>
            <div className="chat-header__model">
              {config.aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · {config.aiModel}
              {agentStatus.state !== 'idle' && (
                <span className="chat-header__status-text"> · {
                  agentStatus.state === 'thinking' ? 'myślę...' :
                  agentStatus.state === 'tool-calling' ? agentStatus.toolName || 'narzędzie...' :
                  agentStatus.state === 'streaming' ? 'odpowiadam...' :
                  agentStatus.state === 'heartbeat' ? 'heartbeat' :
                  agentStatus.state === 'take-control' ? 'sterowanie' :
                  agentStatus.state === 'sub-agent' ? 'sub-agent' : ''
                }</span>
              )}
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

          {/* Dashboard */}
          <button
            onClick={openDashboard}
            title="Otwórz Dashboard"
            className="chat-btn"
          >
            📊
          </button>

          {/* Meeting Coach */}
          <button
            onClick={onOpenMeeting}
            title="Meeting Coach"
            className="chat-btn"
          >
            🎙️
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

      {/* RAG Indexing Progress Bar */}
      {ragProgress && (
        <div className="chat-rag-progress">
          <div className="chat-rag-progress__info">
            <span className="chat-rag-progress__label">
              📚 Indeksowanie: {ragProgress.phase === 'scanning' ? 'Skanowanie plików' :
                ragProgress.phase === 'chunking' ? 'Dzielenie na fragmenty' :
                ragProgress.phase === 'embedding' ? 'Generowanie embeddingów' :
                ragProgress.phase === 'saving' ? 'Zapisywanie indeksu' : ragProgress.phase}
            </span>
            <span className="chat-rag-progress__percent">{Math.round(ragProgress.overallPercent)}%</span>
          </div>
          <div className="chat-rag-progress__bar">
            <div
              className="chat-rag-progress__fill"
              style={{ width: `${ragProgress.overallPercent}%` }}
            />
          </div>
          <div className="chat-rag-progress__detail">
            {ragProgress.filesProcessed}/{ragProgress.filesTotal} plików · {ragProgress.chunksCreated} fragmentów
            {ragProgress.currentFile && (
              <span title={ragProgress.currentFile}> · {ragProgress.currentFile.split(/[/\\]/).pop()}</span>
            )}
          </div>
        </div>
      )}

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
              {msg.role === 'assistant' ? (
                <MessageContent content={msg.content} />
              ) : (
                msg.content
              )}
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
              {streamingContent ? (
                <MessageContent content={streamingContent} />
              ) : (
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
            onClick={toggleVoiceInput}
            title={isRecording ? 'Zatrzymaj nagrywanie' : 'Nagrywaj głos'}
            className={`chat-voice${isRecording ? ' chat-voice--recording' : ''}`}
            disabled={isStreaming}
          >
            {isRecording ? '⏹' : '🎤'}
          </button>
          {isStreaming ? (
            <button
              onClick={async () => {
                await window.kxai.agentStop();
                setIsStreaming(false);
              }}
              title="Zatrzymaj agenta"
              className="chat-send chat-send--stop"
            >
              ■
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className={`chat-send ${input.trim() ? 'chat-send--enabled' : 'chat-send--disabled'}`}
            >
              ➤
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
