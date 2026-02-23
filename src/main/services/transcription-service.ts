/**
 * TranscriptionService — Real-time Speech-to-Text via ElevenLabs Scribe v2.
 *
 * Uses WebSocket connection to ElevenLabs Realtime STT API.
 * Receives PCM 16kHz audio chunks and returns partial/committed transcripts.
 * Supports multiple concurrent sessions (e.g. mic + system audio).
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { SecurityService } from './security';

// ──────────────── Types ────────────────

export interface TranscriptEvent {
  sessionId: string;
  label: string;         // 'mic' | 'system'
  text: string;
  isFinal: boolean;
  speaker?: string;
  timestamp?: number;
  words?: Array<{ text: string; start: number; end: number }>;
}

export interface TranscriptionSessionInfo {
  id: string;
  label: string;
  connected: boolean;
  language: string;
}

interface ActiveSession {
  id: string;
  label: string;
  ws: WebSocket | null;
  connected: boolean;
  language: string;
}

// ──────────────── Service ────────────────

export class TranscriptionService extends EventEmitter {
  private sessions: Map<string, ActiveSession> = new Map();
  private securityService: SecurityService;
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT = 3;

  constructor(securityService: SecurityService) {
    super();
    this.securityService = securityService;
  }

  /**
   * Start a new transcription session via ElevenLabs WebSocket.
   */
  async startSession(sessionId: string, label: string, language: string = 'pl'): Promise<void> {
    // Stop existing session if any
    if (this.sessions.has(sessionId)) {
      await this.stopSession(sessionId);
    }

    const apiKey = await this.securityService.getApiKey('elevenlabs');
    if (!apiKey) {
      throw new Error('Brak klucza API ElevenLabs. Ustaw go w ustawieniach.');
    }

    this.reconnectAttempts.set(sessionId, 0);
    await this.connectSession(sessionId, label, language, apiKey);
  }

  private async connectSession(
    sessionId: string, label: string, language: string, apiKey: string
  ): Promise<void> {
    const wsUrl = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    wsUrl.searchParams.set('model_id', 'scribe_v2_realtime');
    wsUrl.searchParams.set('language_code', language);
    wsUrl.searchParams.set('audio_format', 'pcm_16000');
    // VAD commit strategy for instant transcript delivery on silence
    wsUrl.searchParams.set('commit_strategy', 'vad');
    wsUrl.searchParams.set('vad_silence_threshold_secs', '1.2');
    wsUrl.searchParams.set('vad_threshold', '0.4');
    wsUrl.searchParams.set('min_speech_duration_ms', '100');
    wsUrl.searchParams.set('min_silence_duration_ms', '100');
    // Enable word-level timestamps for better analysis
    wsUrl.searchParams.set('include_timestamps', 'true');

    const ws = new WebSocket(wsUrl.toString(), {
      headers: { 'xi-api-key': apiKey },
    });

    const session: ActiveSession = {
      id: sessionId,
      label,
      ws,
      connected: false,
      language,
    };

    this.sessions.set(sessionId, session);

    ws.on('open', () => {
      session.connected = true;
      // NOTE: Don't reset reconnectAttempts here — only reset after receiving
      // actual transcript data. Otherwise, a connect→immediate-close loop
      // would reset the counter every time and reconnect infinitely.
      console.log(`[Transcription] Session '${label}' connected`);
      this.emit('session:connected', { sessionId, label });
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(sessionId, label, msg);
      } catch (err) {
        console.error(`[Transcription] Parse error:`, err);
      }
    });

    ws.on('error', (err: Error) => {
      console.error(`[Transcription] Session '${label}' error:`, err.message);
      this.emit('session:error', { sessionId, label, error: err.message });
    });

    ws.on('close', async (code: number, reason: Buffer) => {
      session.connected = false;
      const reasonStr = reason.toString();
      console.log(`[Transcription] Session '${label}' closed: ${code} ${reasonStr}`);

      // Don't reconnect on policy violations (invalid request) — the request
      // itself is malformed and retrying won't help.
      if (code === 1008) {
        console.error(`[Transcription] Session '${label}' rejected with 1008 (invalid request) — nie ponawiam`);
        this.sessions.delete(sessionId);
        this.reconnectAttempts.delete(sessionId);
        this.emit('session:error', { sessionId, label, error: `Serwer odrzucił połączenie: ${reasonStr}` });
        this.emit('session:closed', { sessionId, label });
        return;
      }

      // Auto-reconnect on unexpected close
      const attempts = this.reconnectAttempts.get(sessionId) || 0;
      if (code !== 1000 && attempts < this.MAX_RECONNECT) {
        this.reconnectAttempts.set(sessionId, attempts + 1);
        console.log(`[Transcription] Reconnecting '${label}'... (attempt ${attempts + 1})`);
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts))); // exponential backoff
        if (this.sessions.has(sessionId)) {
          // Re-fetch API key to avoid using a stale/rotated key
          const freshKey = await this.securityService.getApiKey('elevenlabs');
          if (!freshKey) {
            console.error(`[Transcription] Cannot reconnect '${label}': no ElevenLabs API key`);
            this.sessions.delete(sessionId);
            this.emit('session:closed', { sessionId, label });
            return;
          }
          await this.connectSession(sessionId, label, language, freshKey);
        }
      } else {
        this.sessions.delete(sessionId);
        this.emit('session:closed', { sessionId, label });
      }
    });
  }

  /**
   * Handle incoming WebSocket messages from ElevenLabs.
   * ElevenLabs uses `message_type` field for event types.
   */
  private handleMessage(sessionId: string, label: string, msg: any): void {
    const msgType = msg.message_type || msg.type;

    switch (msgType) {
      case 'session_started':
        console.log(`[Transcription] Session '${label}' started, server config:`, JSON.stringify(msg.config || {}).substring(0, 200));
        break;

      case 'partial_transcript':
        if (msg.text?.trim()) {
          // Reset reconnect counter — we're getting real data
          this.reconnectAttempts.set(sessionId, 0);
          this.emit('transcript', {
            sessionId,
            label,
            text: msg.text,
            isFinal: false,
          } as TranscriptEvent);
        }
        break;

      case 'committed_transcript':
        if (msg.text?.trim()) {
          this.reconnectAttempts.set(sessionId, 0);
          this.emit('transcript', {
            sessionId,
            label,
            text: msg.text,
            isFinal: true,
            speaker: msg.speaker_id,
          } as TranscriptEvent);
        }
        break;

      case 'committed_transcript_with_timestamps':
        if (msg.text?.trim()) {
          this.reconnectAttempts.set(sessionId, 0);
          const words = msg.words
            ?.filter((w: any) => w.type === 'word')
            ?.map((w: any) => ({ text: w.text, start: w.start, end: w.end }));
          this.emit('transcript', {
            sessionId,
            label,
            text: msg.text,
            isFinal: true,
            speaker: msg.speaker_id,
            words,
          } as TranscriptEvent);
        }
        break;

      default:
        // Handle error message types
        if (msgType?.includes('error') || msgType?.includes('Error')) {
          console.error(`[Transcription] Server error in '${label}': ${msgType}`, msg.message || msg);
          this.emit('session:error', { sessionId, label, error: msg.message || msgType });
        }
        // Ignore unknown message types
        break;
    }
  }

  /**
   * Send a PCM audio chunk to a specific session.
   * Expected format: raw PCM 16-bit, 16kHz, mono.
   * Converts to base64 and wraps in ElevenLabs JSON message format.
   */
  sendAudioChunk(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (session?.ws && session.connected && session.ws.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: chunk.toString('base64'),
        sample_rate: 16000,
      });
      session.ws.send(message);
    }
  }

  /**
   * Stop a specific transcription session.
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.ws) {
      this.sessions.delete(sessionId);
      return;
    }

    try {
      if (session.ws.readyState === WebSocket.OPEN) {
        // Send commit to get final transcripts before closing
        session.ws.send(JSON.stringify({ message_type: 'commit' }));
        await new Promise(r => setTimeout(r, 800));
        session.ws.close(1000, 'Session ended');
      }
    } catch (err) {
      console.error(`[Transcription] Error closing session '${sessionId}':`, err);
    }
    this.sessions.delete(sessionId);
    this.reconnectAttempts.delete(sessionId);
  }

  /**
   * Stop all active sessions.
   */
  async stopAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.stopSession(id);
    }
  }

  /**
   * Check if a session is actively connected.
   */
  isSessionActive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.connected === true;
  }

  /**
   * Get list of active session IDs.
   */
  getActiveSessions(): TranscriptionSessionInfo[] {
    return Array.from(this.sessions.values())
      .filter(s => s.connected)
      .map(s => ({ id: s.id, label: s.label, connected: s.connected, language: s.language }));
  }
}
