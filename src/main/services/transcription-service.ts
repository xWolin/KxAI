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
    wsUrl.searchParams.set('model_id', 'scribe_v1');
    wsUrl.searchParams.set('language_code', language);
    wsUrl.searchParams.set('sample_rate', '16000');

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
      this.reconnectAttempts.set(sessionId, 0);
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

      // Auto-reconnect on unexpected close
      const attempts = this.reconnectAttempts.get(sessionId) || 0;
      if (code !== 1000 && attempts < this.MAX_RECONNECT) {
        this.reconnectAttempts.set(sessionId, attempts + 1);
        console.log(`[Transcription] Reconnecting '${label}'... (attempt ${attempts + 1})`);
        await new Promise(r => setTimeout(r, 1000 * (attempts + 1)));
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
   */
  private handleMessage(sessionId: string, label: string, msg: any): void {
    switch (msg.type) {
      case 'session_started':
        console.log(`[Transcription] Session '${label}' started, server_id: ${msg.session_id}`);
        break;

      case 'partial_transcript':
        if (msg.text?.trim()) {
          this.emit('transcript', {
            sessionId,
            label,
            text: msg.text,
            isFinal: false,
          } as TranscriptEvent);
        }
        break;

      case 'committed_transcript':
      case 'committed_transcript_with_timestamps':
        if (msg.text?.trim()) {
          this.emit('transcript', {
            sessionId,
            label,
            text: msg.text,
            isFinal: true,
            speaker: msg.speaker_id,
            words: msg.words,
          } as TranscriptEvent);
        }
        break;

      case 'error':
        console.error(`[Transcription] Server error in '${label}':`, msg.message || msg);
        this.emit('session:error', { sessionId, label, error: msg.message || 'Unknown error' });
        break;

      default:
        // Ignore unknown message types (e.g. vad_event)
        break;
    }
  }

  /**
   * Send a PCM audio chunk to a specific session.
   * Expected format: raw PCM 16-bit, 16kHz, mono.
   */
  sendAudioChunk(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (session?.ws && session.connected && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(chunk);
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
        // Send flush to get final transcripts
        session.ws.send(JSON.stringify({ type: 'flush' }));
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
