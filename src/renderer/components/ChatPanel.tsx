import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ConversationMessage, KxAIConfig } from '../types';
import { useAgentStore } from '../stores';
import s from './ChatPanel.module.css';
import { cn } from '../utils/cn';
import { useTranslation } from '../i18n';
import { initHighlighter, highlightCode } from '../utils/highlighter';

// Configure marked for chat messages
marked.setOptions({
  breaks: true, // GFM line breaks
  gfm: true,
});

// Override link renderer to open links externally
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }: { href: string; title?: string | null; text: string }) => {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

// Escape HTML for plain code fallback
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Syntax highlighting for code blocks (shiki when ready, plain fallback)
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = lang || '';
  const highlighted = language ? highlightCode(text, language) : null;
  const codeHtml = highlighted || `<pre><code>${escapeHtml(text)}</code></pre>`;
  const langLabel = language ? `<span data-code-lang>${escapeHtml(language)}</span>` : '';
  const copyBtn = `<button data-code-copy aria-label="Copy code">📋</button>`;
  return `<div data-code-block><div data-code-header>${langLabel}${copyBtn}</div>${codeHtml}</div>`;
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
  return DOMPurify.sanitize(html, { ADD_ATTR: ['style'] });
}

/**
 * Memoized markdown message bubble with copy button.
 */
function MessageContent({ content, highlighterReady }: { content: string; highlighterReady: boolean }) {
  const { t } = useTranslation();
  const html = useMemo(() => renderMarkdown(content), [content, highlighterReady]);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const cleaned = stripControlBlocks(content);
    try {
      await navigator.clipboard.writeText(cleaned);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard write unavailable */
    }
  }, [content]);

  /** Event delegation: handle clicks on code block copy buttons inside rendered markdown. */
  const handleCodeCopy = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.hasAttribute('data-code-copy')) {
      e.stopPropagation();
      const block = target.closest('[data-code-block]');
      if (block) {
        const code = block.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.textContent || '');
          target.textContent = '✓';
          setTimeout(() => {
            target.textContent = '📋';
          }, 1500);
        }
      }
    }
  }, []);

  if (!html) return null;
  return (
    <div className={s.bubbleWrapper}>
      <button
        className={copied ? s.copyBtnCopied : s.copyBtn}
        onClick={handleCopy}
        title={t('chat.copyMessage')}
        aria-label={t('chat.copyMessage')}
      >
        {copied ? '✓' : '📋'}
      </button>
      <div className={s.markdown} dangerouslySetInnerHTML={{ __html: html }} onClick={handleCodeCopy} />
    </div>
  );
}

interface ChatPanelProps {
  config: KxAIConfig;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenCron: () => void;
  onOpenMeeting: () => void;
  onOpenDashboard: () => void;
  refreshTrigger?: number;
}

export function ChatPanel({
  config,
  onClose,
  onOpenSettings,
  onOpenCron,
  onOpenMeeting,
  onOpenDashboard,
  refreshTrigger,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [highlighterReady, setHighlighterReady] = useState(false);
  const [screenshotPreviews, setScreenshotPreviews] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);

  // Agent status & RAG progress from global store (subscribed in useStoreInit)
  const agentStatus = useAgentStore((s) => s.agentStatus);
  const ragProgress = useAgentStore((s) => s.ragProgress);
  const { t } = useTranslation();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  // Keep a ref to streaming content so the onAIStream callback can read the latest value
  const streamingContentRef = useRef('');

  useEffect(() => {
    loadHistory();
    loadProactiveMode();
    initHighlighter().then(() => setHighlighterReady(true));

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

    return () => {
      cleanup();
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
            content: t('chat.error.generic', { error: result.error || t('chat.error.sendFailed') }),
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
          content: t('chat.error.generic', { error: error.message || t('chat.error.sendFailed') }),
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

    // Capture screenshot for preview thumbnail
    let previewUrl: string | undefined;
    try {
      const capture = await window.kxai.captureScreen();
      if (capture.success && capture.data?.[0]?.base64) {
        previewUrl = capture.data[0].base64;
      }
    } catch {
      /* screen capture unavailable */
    }

    // Add optimistic user message so it's visible immediately
    const msgId = `opt-${Date.now()}`;
    const screenshotMsg: ConversationMessage = {
      id: msgId,
      role: 'user',
      content: t('chat.screenshot.prompt'),
      timestamp: Date.now(),
      type: 'analysis',
    };
    setMessages((prev) => [...prev, screenshotMsg]);

    // Store preview thumbnail
    if (previewUrl) {
      setScreenshotPreviews((prev) => ({ ...prev, [msgId]: previewUrl! }));
    }

    try {
      const result = await window.kxai.streamWithScreen(t('chat.screenshot.prompt'));
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
            content: t('chat.error.screenshotFailed', { error: result.error ?? '' }),
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
          content: t('chat.error.screenshotFailed', { error: error.message }),
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

  // ─── Global keyboard shortcuts ───

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+L — focus input
      if (ctrl && e.key === 'l') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // Escape — close panel (when input is not focused or is empty)
      if (e.key === 'Escape') {
        if (document.activeElement !== inputRef.current || !input) {
          onClose();
        }
        return;
      }

      // Ctrl+Shift+S — screenshot & analyze
      if (ctrl && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        if (!isStreaming) captureAndAnalyze();
        return;
      }

      // Ctrl+Shift+X — stop agent
      if (ctrl && e.shiftKey && e.key === 'X') {
        e.preventDefault();
        if (isStreaming) {
          window.kxai.agentStop();
          setIsStreaming(false);
        }
        return;
      }

      // Ctrl+Shift+Backspace — clear chat
      if (ctrl && e.shiftKey && e.key === 'Backspace') {
        e.preventDefault();
        window.kxai.clearConversationHistory().then(() => {
          setMessages([]);
        });
        return;
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [input, isStreaming, onClose]);

  // ─── Drag & Drop files ───

  const dragCounter = useRef(0);

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Electron adds .path to File objects (not in standard Web API)
    const paths = files.map((f) => (f as File & { path: string }).path).filter(Boolean);
    if (paths.length === 0) return;

    // Build a message asking the AI to analyze the dropped files
    const fileList = paths.map((p) => `- ${p}`).join('\n');
    const message =
      paths.length === 1 ? t('chat.drop.single', { path: paths[0] }) : t('chat.drop.multiple', { files: fileList });

    // Send as a regular chat message
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    streamingContentRef.current = '';

    const userMsg: ConversationMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
      type: 'chat',
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const result = await window.kxai.streamMessage(message);
      setIsStreaming(false);
      if (result.success) {
        await loadHistory();
      }
    } catch (error: any) {
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: t('chat.error.generic', { error: error.message }),
          timestamp: Date.now(),
        },
      ]);
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
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release mic
        stream.getTracks().forEach((t) => t.stop());

        if (chunks.length === 0) return;

        setInput((prev) => prev || t('chat.voice.transcribing'));

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
            setInput((prev) => {
              const clean = prev === t('chat.voice.transcribing') ? '' : prev;
              return (clean ? clean + ' ' : '') + result.text;
            });
            inputRef.current?.focus();
          } else {
            setInput((prev) =>
              prev === t('chat.voice.transcribing')
                ? `⚠️ ${result.error || t('chat.voice.transcriptionFailed')}`
                : prev,
            );
          }
        } catch (err: any) {
          console.error('[ChatPanel] Whisper transcription error:', err);
          setInput((prev) => (prev === t('chat.voice.transcribing') ? t('chat.voice.transcriptionError') : prev));
        }
      };

      mediaRecorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        recognitionRef.current = null;
      };

      mediaRecorder.start();
      recognitionRef.current = mediaRecorder;
      setIsRecording(true);
    } catch (err: any) {
      console.error('[ChatPanel] Mic access failed:', err);
      setInput((prev) => prev || t('chat.voice.noMicPermission'));
    }
  }

  function stopVoiceInput() {
    if (recognitionRef.current && recognitionRef.current.state !== 'inactive') {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  }

  function openDashboard() {
    onOpenDashboard();
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div
      className={s.panel}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag & Drop overlay */}
      {isDragging && (
        <div className={s.dropOverlay}>
          <div className={s.dropIcon}>📎</div>
          <div className={s.dropText}>{t('chat.drop.hint')}</div>
        </div>
      )}

      {/* Header */}
      <div className={s.header}>
        <div className={s.headerInfo}>
          <span className={s.headerEmoji}>{config.agentEmoji || '🤖'}</span>
          <div>
            <div className={s.headerName}>
              {config.agentName || 'KxAI'}
              {agentStatus.state !== 'idle' && (
                <span className={s.statusBadge} title={agentStatus.detail || agentStatus.state} aria-hidden="true">
                  {agentStatus.state === 'thinking'
                    ? '🧠'
                    : agentStatus.state === 'tool-calling'
                      ? '⚙️'
                      : agentStatus.state === 'streaming'
                        ? '📡'
                        : agentStatus.state === 'heartbeat'
                          ? '💓'
                          : agentStatus.state === 'take-control'
                            ? '🎮'
                            : agentStatus.state === 'sub-agent'
                              ? '🤖'
                              : ''}
                </span>
              )}
            </div>
            <div className={s.headerModel}>
              {config.aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · {config.aiModel}
              {agentStatus.state !== 'idle' && (
                <span className={s.statusText}>
                  {' '}
                  ·{' '}
                  {agentStatus.state === 'thinking'
                    ? t('chat.status.thinking')
                    : agentStatus.state === 'tool-calling'
                      ? agentStatus.toolName || t('chat.status.toolCalling')
                      : agentStatus.state === 'streaming'
                        ? t('chat.status.streaming')
                        : agentStatus.state === 'heartbeat'
                          ? t('chat.status.heartbeat')
                          : agentStatus.state === 'take-control'
                            ? t('chat.status.takeControl')
                            : agentStatus.state === 'sub-agent'
                              ? t('chat.status.subAgent')
                              : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={s.headerActions}>
          {/* Proactive toggle */}
          <button
            onClick={toggleProactive}
            title={proactiveEnabled ? t('chat.proactive.disable') : t('chat.proactive.enable')}
            aria-label={proactiveEnabled ? t('chat.proactive.disable') : t('chat.proactive.enable')}
            className={proactiveEnabled ? s.btnActive : s.btn}
          >
            👁️
          </button>

          {/* Screenshot */}
          <button
            onClick={captureAndAnalyze}
            title={t('chat.screenshot.title')}
            aria-label={t('chat.screenshot.title')}
            className={s.btn}
          >
            📸
          </button>

          {/* Cron Jobs */}
          <button onClick={onOpenCron} title="Cron Jobs" aria-label="Cron Jobs" className={s.btn}>
            ⏰
          </button>

          {/* Dashboard */}
          <button
            onClick={openDashboard}
            title={t('chat.dashboard.title')}
            aria-label={t('chat.dashboard.title')}
            className={s.btn}
          >
            📊
          </button>

          {/* Meeting Coach */}
          <button onClick={onOpenMeeting} title="Meeting Coach" aria-label="Meeting Coach" className={s.btn}>
            🎙️
          </button>

          {/* Settings */}
          <button
            onClick={onOpenSettings}
            title={t('chat.settings.title')}
            aria-label={t('chat.settings.title')}
            className={s.btn}
          >
            ⚙️
          </button>

          {/* Close */}
          <button onClick={onClose} title={t('chat.minimize')} aria-label={t('chat.minimize')} className={s.btn}>
            ✕
          </button>
        </div>
      </div>

      {/* RAG Indexing Progress Bar */}
      {ragProgress && (
        <div className={s.ragProgress}>
          <div className={s.ragInfo}>
            <span className={s.ragLabel}>
              {t('chat.rag.indexing')}{' '}
              {ragProgress.phase === 'scanning'
                ? t('chat.rag.scanning')
                : ragProgress.phase === 'chunking'
                  ? t('chat.rag.chunking')
                  : ragProgress.phase === 'embedding'
                    ? t('chat.rag.embedding')
                    : ragProgress.phase === 'saving'
                      ? t('chat.rag.saving')
                      : ragProgress.phase}
            </span>
            <span className={s.ragPercent}>{Math.round(ragProgress.overallPercent)}%</span>
          </div>
          <div className={s.ragBar}>
            <div className={s.ragFill} style={{ width: `${ragProgress.overallPercent}%` }} />
          </div>
          <div className={s.ragDetail}>
            {ragProgress.filesProcessed}/{ragProgress.filesTotal} {t('chat.rag.files')} · {ragProgress.chunksCreated}{' '}
            {t('chat.rag.chunks')}
            {ragProgress.currentFile && (
              <span title={ragProgress.currentFile}> · {ragProgress.currentFile.split(/[/\\]/).pop()}</span>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className={s.messages} role="log" aria-live="polite">
        {messages.length === 0 && !isStreaming && (
          <div className={s.empty}>
            <div className={s.emptyEmoji}>{config.agentEmoji || '🤖'}</div>
            <div className={s.emptyTitle}>{t('chat.empty.title', { name: config.agentName || 'KxAI' })}</div>
            <div className={s.emptySubtitle}>{t('chat.empty.subtitle')}</div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('fade-in', msg.role === 'user' ? s.msgUser : s.msgAssistant)}>
            <div className={msg.role === 'user' ? s.bubbleUser : s.bubbleAssistant}>
              {msg.type === 'analysis' && screenshotPreviews[msg.id] && (
                <img
                  src={screenshotPreviews[msg.id]}
                  alt={t('chat.screenshot.preview')}
                  className={s.screenshotPreview}
                  loading="lazy"
                />
              )}
              {msg.role === 'assistant' ? (
                <MessageContent content={msg.content} highlighterReady={highlighterReady} />
              ) : (
                msg.content
              )}
            </div>
            <div className={s.msgTime}>{formatTime(msg.timestamp)}</div>
          </div>
        ))}

        {/* Streaming message */}
        {isStreaming && (
          <div className={cn('fade-in', s.streaming)} aria-live="polite">
            <div className={s.bubbleAssistant}>
              {streamingContent ? (
                <MessageContent content={streamingContent} highlighterReady={highlighterReady} />
              ) : (
                <div className={s.typing}>
                  <span className={s.dot1}>●</span>
                  <span className={s.dot2}>●</span>
                  <span className={s.dot3}>●</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={s.input}>
        <div className={s.inputRow}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.input.placeholder')}
            aria-label={t('chat.input.placeholder')}
            disabled={isStreaming}
            className={s.textarea}
            rows={1}
          />
          <button
            onClick={toggleVoiceInput}
            title={isRecording ? t('chat.voice.stopRecording') : t('chat.voice.startRecording')}
            aria-label={isRecording ? t('chat.voice.stopRecording') : t('chat.voice.startRecording')}
            className={isRecording ? s.voiceRecording : s.voice}
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
              title={t('chat.stopAgent')}
              aria-label={t('chat.stopAgent')}
              className={s.sendStop}
            >
              ■
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              aria-label="Send message"
              className={input.trim() ? s.sendEnabled : s.sendDisabled}
            >
              ➤
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
