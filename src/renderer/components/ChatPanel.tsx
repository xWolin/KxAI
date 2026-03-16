import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ConversationMessage, KxAIConfig } from '../types';
import { useAgentStore, useChatStore } from '../stores';
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
 * Copy button for user messages (plain text).
 */
function UserBubble({ content }: { content: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await window.kxai.copyToClipboard(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [content]);

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
      <span>{content}</span>
    </div>
  );
}

/**
 * Memoized markdown message bubble with copy button.
 */
function MessageContent({ content, highlighterReady }: { content: string; highlighterReady: boolean }) {
  const { t } = useTranslation();
  const html = useMemo(() => renderMarkdown(content), [content]);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const cleaned = stripControlBlocks(content);
    try {
      await window.kxai.copyToClipboard(cleaned);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
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
          window.kxai.copyToClipboard(code.textContent || '');
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
  refreshTrigger?: number;
}

export function ChatPanel({
  config,
  onClose,
  onOpenSettings,
  onOpenCron,
  onOpenMeeting,
  refreshTrigger,
}: ChatPanelProps) {
  // ─── Local UI state (not persisted across panel open/close) ───
  const [input, setInput] = useState('');
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [cortexEnabled, setCortexEnabled] = useState(true);
  const [cortexStatus, setCortexStatus] = useState<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [highlighterReady, setHighlighterReady] = useState(false);
  const [screenshotPreviews, setScreenshotPreviews] = useState<Record<string, string[]>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [exportFeedback, setExportFeedback] = useState(false);

  // ─── Chat state from global store — persists while panel is closed ───
  // When the user presses Esc/X during an ongoing tool loop, streaming
  // state stays alive in the store and is visible again on next open.
  const {
    messages,
    isStreaming,
    streamingContent,
    addMessage,
    setMessages: storeSetMessages,
    setStreaming,
    setStreamingContent: storeSetStreamingContent,
    clearHistory,
  } = useChatStore();

  // Agent status & RAG progress from global store (subscribed in useStoreInit)
  const agentStatus = useAgentStore((s) => s.agentStatus);
  const ragProgress = useAgentStore((s) => s.ragProgress);
  const { t } = useTranslation();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  const loadHistory = useCallback(async () => {
    const history = await window.kxai.getConversationHistory();
    storeSetMessages(history);
    // Screenshot preview ID remap is handled by the useEffect([messages]) above.
  }, [storeSetMessages]);

  useEffect(() => {
    loadHistory();
    loadCortexState();
    initHighlighter().then(() => setHighlighterReady(true));
    // onAIStream is now registered globally in useStoreInit — it persists
    // across ChatPanel mount/unmount so progress is never lost.
  }, [loadHistory]);

  // Remap screenshot preview IDs when messages change (optimistic opt-* → real backend IDs)
  useEffect(() => {
    setScreenshotPreviews((prev) => {
      const oldKeys = Object.keys(prev);
      if (oldKeys.length === 0) return prev;
      const analysisMessages = messages.filter((m: ConversationMessage) => m.type === 'analysis' && m.role === 'user');
      const newPreviews: Record<string, string[]> = {};
      for (const oldKey of oldKeys) {
        if (messages.some((m: ConversationMessage) => m.id === oldKey)) {
          newPreviews[oldKey] = prev[oldKey];
          continue;
        }
        const mapped = new Set(Object.keys(newPreviews));
        const match = analysisMessages.find((m: ConversationMessage) => !mapped.has(m.id));
        if (match) {
          newPreviews[match.id] = prev[oldKey];
        }
      }
      return Object.keys(newPreviews).length > 0 ? newPreviews : prev;
    });
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Reload chat when a proactive message arrives while chat is open
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      loadHistory();
    }
  }, [refreshTrigger, loadHistory]);

  async function loadCortexState() {
    try {
      const status = await window.kxai.cortexGetStatus();
      setCortexEnabled(status?.enabled ?? true);
      setCortexStatus(status);
    } catch {
      // Fallback to legacy proactive mode
      const mode = await window.kxai.getProactiveMode();
      setProactiveEnabled(mode);
      setCortexEnabled(mode);
    }
  }

  // Poll cortex state to update queue depth while chat is open
  useEffect(() => {
    const interval = setInterval(() => {
      if (cortexEnabled) {
        window.kxai
          .cortexGetStatus?.()
          .then(setCortexStatus)
          .catch(() => {});
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [cortexEnabled]);

  async function sendMessage() {
    if (!input.trim() || isStreaming) return;

    const userMessage = input.trim();

    // Secret detection — warn user before sending API keys, tokens, etc.
    const secretPatterns = [
      /sk-[a-zA-Z0-9]{20,}/,
      /sk-proj-[a-zA-Z0-9_-]{40,}/,
      /sk-ant-[a-zA-Z0-9_-]{40,}/,
      /AIza[a-zA-Z0-9_-]{30,}/,
      /ghp_[a-zA-Z0-9]{36}/,
      /github_pat_[a-zA-Z0-9_]{50,}/,
      /AKIA[A-Z0-9]{16}/,
    ];
    if (secretPatterns.some((p) => p.test(userMessage))) {
      const confirmed = window.confirm(t('chat.secretWarning'));
      if (!confirmed) return;
    }

    setInput('');
    setStreaming(true);
    storeSetStreamingContent('');

    // Optimistically add user message for instant feedback
    const optimisticMsg: ConversationMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      type: 'chat',
    };
    addMessage(optimisticMsg);

    try {
      const result = await window.kxai.streamMessage(userMessage);
      // Safety: ensure streaming is always reset after IPC completes
      setStreaming(false);
      if (result.success) {
        // Sync with backend to get real IDs (replaces optimistic msg + stream msg)
        await loadHistory();
      } else {
        addMessage({
          id: Date.now().toString(),
          role: 'assistant',
          content: t('chat.error.generic', { error: result.error || t('chat.error.sendFailed') }),
          timestamp: Date.now(),
          type: 'chat',
        });
      }
    } catch (error: any) {
      setStreaming(false);
      addMessage({
        id: Date.now().toString(),
        role: 'assistant',
        content: t('chat.error.generic', { error: error.message || t('chat.error.sendFailed') }),
        timestamp: Date.now(),
        type: 'chat',
      });
    }
  }

  async function toggleCortex() {
    const newMode = !cortexEnabled;
    await window.kxai.cortexSetEnabled(newMode);
    setCortexEnabled(newMode);
    // Sync legacy proactive state
    setProactiveEnabled(newMode);
  }

  const captureAndAnalyze = useCallback(async () => {
    setStreaming(true);
    storeSetStreamingContent('');

    // Capture screenshot for preview thumbnails (all monitors)
    let previewUrls: string[] = [];
    try {
      const capture = await window.kxai.captureScreen();
      if (capture.success && capture.data?.length) {
        previewUrls = capture.data.map((d: any) => d.base64).filter(Boolean);
      }
    } catch {
      /* screenshot capture may fail */
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
    addMessage(screenshotMsg);

    // Store preview thumbnails (all monitors)
    if (previewUrls.length > 0) {
      setScreenshotPreviews((prev) => ({ ...prev, [msgId]: previewUrls }));
    }

    try {
      const result = await window.kxai.streamWithScreen(t('chat.screenshot.prompt'));
      // Safety: always reset streaming state after IPC completes
      setStreaming(false);
      if (result.success) {
        // Sync with backend to get real IDs
        await loadHistory();
      } else {
        setStreaming(false);
        addMessage({
          id: Date.now().toString(),
          role: 'assistant',
          content: t('chat.error.screenshotFailed', { error: result.error ?? '' }),
          timestamp: Date.now(),
        });
      }
    } catch (error: any) {
      setStreaming(false);
      addMessage({
        id: Date.now().toString(),
        role: 'assistant',
        content: t('chat.error.screenshotFailed', { error: error.message }),
        timestamp: Date.now(),
      });
    }
  }, [setStreaming, storeSetStreamingContent, t, addMessage, loadHistory]);

  // ─── Export conversation ───

  const exportConversation = useCallback(async () => {
    if (messages.length === 0) return;

    const lines = messages.map((msg) => {
      const time = new Date(msg.timestamp).toLocaleString();
      const role =
        msg.role === 'user'
          ? t('chat.export.roleUser')
          : msg.role === 'assistant'
            ? t('chat.export.roleAssistant')
            : 'System';
      const content = msg.role === 'assistant' ? stripControlBlocks(msg.content) : msg.content;
      return `[${time}] ${role}:\n${content}`;
    });

    const text = lines.join('\n\n---\n\n');
    try {
      // Use electron.clipboard via IPC — always works (navigator.clipboard may fail in Electron)
      await window.kxai.copyToClipboard(text);
      setExportFeedback(true);
      setTimeout(() => setExportFeedback(false), 2000);
    } catch {
      /* ignore */
    }
  }, [messages, t]);

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
          setStreaming(false);
        }
        return;
      }

      // Ctrl+Shift+Backspace — clear chat
      if (ctrl && e.shiftKey && e.key === 'Backspace') {
        e.preventDefault();
        clearHistory();
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
    setStreaming(true);
    storeSetStreamingContent('');

    const userMsg: ConversationMessage = {
      id: `opt-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
      type: 'chat',
    };
    addMessage(userMsg);

    try {
      const result = await window.kxai.streamMessage(message);
      setStreaming(false);
      if (result.success) {
        await loadHistory();
      }
    } catch (error: any) {
      setStreaming(false);
      addMessage({
        id: Date.now().toString(),
        role: 'assistant',
        content: t('chat.error.generic', { error: error.message }),
        timestamp: Date.now(),
      });
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

  async function openDashboard() {
    try {
      const url = await window.kxai.getDashboardUrl();
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to open dashboard:', err);
    }
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
              {cortexEnabled && cortexStatus && (cortexStatus.thinkQueueDepth > 0 || cortexStatus.isThinking) && (
                <span className={s.cortexIndicator} title="Cortex Background Tasks">
                  {' '}
                  · 🧠 {cortexStatus.isThinking ? 'Myśli...' : 'W kolejce: ' + cortexStatus.thinkQueueDepth}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={s.headerActions}>
          {/* Cortex Engine toggle */}
          <button
            onClick={toggleCortex}
            title={cortexEnabled ? t('chat.cortex.disable') : t('chat.cortex.enable')}
            aria-label={cortexEnabled ? t('chat.cortex.disable') : t('chat.cortex.enable')}
            className={cortexEnabled ? s.btnActive : s.btn}
          >
            🧠
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

          {/* Export conversation */}
          <button
            onClick={exportConversation}
            title={t('chat.export.title')}
            aria-label={t('chat.export.title')}
            className={exportFeedback ? s.btnActive : s.btn}
            disabled={messages.length === 0}
          >
            {exportFeedback ? '✓' : '📋'}
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
              {msg.type === 'analysis' && screenshotPreviews[msg.id]?.length > 0 && (
                <div className={s.screenshotPreviewContainer}>
                  {screenshotPreviews[msg.id].map((url, idx) => (
                    <img
                      key={idx}
                      src={url}
                      alt={`${t('chat.screenshot.preview')} ${idx + 1}`}
                      className={s.screenshotPreview}
                      loading="lazy"
                    />
                  ))}
                </div>
              )}
              {msg.role === 'assistant' ? (
                <MessageContent content={msg.content} highlighterReady={highlighterReady} />
              ) : (
                <UserBubble content={msg.content} />
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
                setStreaming(false);
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
