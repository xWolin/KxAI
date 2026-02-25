/**
 * TranscriptionService — Real-time Speech-to-Text via Deepgram Nova-3.
 *
 * Uses WebSocket connection to Deepgram Live Streaming API.
 * Receives PCM 16kHz audio chunks and returns partial/committed transcripts.
 * Supports real-time speaker diarization (speaker IDs per word).
 * Supports multiple concurrent sessions (e.g. mic + system audio).
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { SecurityService } from './security';

// ──────────────── Types ────────────────

export interface TranscriptEvent {
  sessionId: string;
  label: string; // 'mic' | 'system'
  text: string;
  isFinal: boolean;
  speaker?: string; // e.g. "0", "1", "2" — Deepgram speaker ID
  timestamp?: number;
  words?: Array<{ text: string; start: number; end: number; speaker?: number }>;
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
  keepAliveTimer: ReturnType<typeof setInterval> | null;
}

// ──────────────── Service ────────────────

export class TranscriptionService extends EventEmitter {
  private sessions: Map<string, ActiveSession> = new Map();
  private securityService: SecurityService;
  private reconnectAttempts: Map<string, number> = new Map();
  private readonly MAX_RECONNECT = 3;
  _emptyResultCount: Map<string, number> = new Map();

  constructor(securityService: SecurityService) {
    super();
    this.securityService = securityService;
  }

  /**
   * Start a new transcription session via Deepgram WebSocket.
   */
  async startSession(sessionId: string, label: string, language: string = 'pl'): Promise<void> {
    // Stop existing session if any
    if (this.sessions.has(sessionId)) {
      await this.stopSession(sessionId);
    }

    const apiKey = await this.securityService.getApiKey('deepgram');
    if (!apiKey) {
      throw new Error('Brak klucza API Deepgram. Ustaw go w ustawieniach.');
    }

    this.reconnectAttempts.set(sessionId, 0);
    await this.connectSession(sessionId, label, language, apiKey);
  }

  private async connectSession(sessionId: string, label: string, language: string, apiKey: string): Promise<void> {
    // Build Deepgram Live Streaming WebSocket URL
    const params = new URLSearchParams({
      model: 'nova-3',
      language,
      smart_format: 'true',
      punctuate: 'true',
      diarize: 'true', // Real-time speaker diarization!
      interim_results: 'true',
      utterance_end_ms: '1500', // 1.5s silence = utterance end
      vad_events: 'true',
      endpointing: '300', // 300ms endpointing for responsive results
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
    });

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    const session: ActiveSession = {
      id: sessionId,
      label,
      ws,
      connected: false,
      language,
      keepAliveTimer: null,
    };

    this.sessions.set(sessionId, session);

    ws.on('open', () => {
      session.connected = true;
      console.log(`[Transcription] Session '${label}' connected (Deepgram Nova-3, diarize=true)`);
      this.emit('session:connected', { sessionId, label });

      // Deepgram requires KeepAlive messages if no audio for >12s
      session.keepAliveTimer = setInterval(() => {
        if (session.ws && session.connected && session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 8000);
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
      if (session.keepAliveTimer) {
        clearInterval(session.keepAliveTimer);
        session.keepAliveTimer = null;
      }
      const reasonStr = reason.toString();
      console.log(`[Transcription] Session '${label}' closed: ${code} ${reasonStr}`);

      // Don't reconnect on auth errors (401/403)
      if (code === 1008 || code === 4001 || code === 4003) {
        console.error(`[Transcription] Session '${label}' rejected (auth/policy error) — nie ponawiam`);
        this.sessions.delete(sessionId);
        this.reconnectAttempts.delete(sessionId);
        this.emit('session:error', { sessionId, label, error: `Deepgram odrzucił połączenie: ${reasonStr}` });
        this.emit('session:closed', { sessionId, label });
        return;
      }

      // Auto-reconnect on unexpected close
      const attempts = this.reconnectAttempts.get(sessionId) || 0;
      if (code !== 1000 && attempts < this.MAX_RECONNECT) {
        this.reconnectAttempts.set(sessionId, attempts + 1);
        console.log(`[Transcription] Reconnecting '${label}'... (attempt ${attempts + 1})`);
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempts))); // exponential backoff
        if (this.sessions.has(sessionId)) {
          try {
            const freshKey = await this.securityService.getApiKey('deepgram');
            if (!freshKey) {
              console.error(`[Transcription] Cannot reconnect '${label}': no Deepgram API key`);
              this.sessions.delete(sessionId);
              this.reconnectAttempts.delete(sessionId);
              this.emit('session:error', { sessionId, label, error: 'Reconnect failed: no Deepgram API key' });
              this.emit('session:closed', { sessionId, label });
              return;
            }
            await this.connectSession(sessionId, label, language, freshKey);
          } catch (err) {
            console.error(`[Transcription] Reconnect failed for '${label}':`, err);
            this.sessions.delete(sessionId);
            this.reconnectAttempts.delete(sessionId);
            this.emit('session:error', { sessionId, label, error: `Reconnect failed: ${err}` });
            this.emit('session:closed', { sessionId, label });
          }
        }
      } else {
        this.sessions.delete(sessionId);
        this.emit('session:closed', { sessionId, label });
      }
    });
  }

  /**
   * Handle incoming WebSocket messages from Deepgram.
   *
   * Deepgram message types:
   * - Results: transcript data (is_final + speech_final flags)
   * - SpeechStarted: voice activity started
   * - UtteranceEnd: silence after speech ended
   * - Metadata: session info
   * - Error: error messages
   */
  private handleMessage(sessionId: string, label: string, msg: any): void {
    const msgType = msg.type;

    switch (msgType) {
      case 'Results': {
        // Reset reconnect counter on real data
        this.reconnectAttempts.set(sessionId, 0);

        const alt = msg.channel?.alternatives?.[0];
        if (!alt || !alt.transcript?.trim()) {
          // Log empty results occasionally for diagnostics
          if (!this._emptyResultCount) this._emptyResultCount = new Map();
          const count = (this._emptyResultCount.get(sessionId) || 0) + 1;
          this._emptyResultCount.set(sessionId, count);
          if (count <= 3 || count % 100 === 0) {
            console.log(`[Transcription] Empty result #${count} for '${label}' (speech detected but no transcript)`);
          }
          break;
        }

        console.log(
          `[Transcription] Got transcript from '${label}': "${alt.transcript.substring(0, 80)}" (is_final=${msg.is_final})`,
        );

        const transcript = alt.transcript;
        const isFinal = msg.is_final === true;

        // Extract speaker from words with diarization
        let speaker: string | undefined;
        const words: Array<{ text: string; start: number; end: number; speaker?: number }> = [];

        if (alt.words && Array.isArray(alt.words)) {
          // Determine dominant speaker for this utterance
          const speakerCounts = new Map<number, number>();

          for (const w of alt.words) {
            words.push({
              text: w.word || w.text,
              start: w.start,
              end: w.end,
              speaker: w.speaker,
            });
            if (w.speaker !== undefined && w.speaker !== null) {
              speakerCounts.set(w.speaker, (speakerCounts.get(w.speaker) || 0) + 1);
            }
          }

          // Use majority speaker for the whole utterance
          if (speakerCounts.size > 0) {
            let maxCount = 0;
            let dominantSpeaker = 0;
            for (const [spk, count] of speakerCounts) {
              if (count > maxCount) {
                maxCount = count;
                dominantSpeaker = spk;
              }
            }
            speaker = String(dominantSpeaker);
          }
        }

        this.emit('transcript', {
          sessionId,
          label,
          text: transcript,
          isFinal,
          speaker,
          words: isFinal ? words : undefined,
        } as TranscriptEvent);
        break;
      }

      case 'SpeechStarted':
        // Voice activity detected — useful for UI indicators
        this.emit('speech:started', { sessionId, label, timestamp: msg.timestamp });
        break;

      case 'UtteranceEnd':
        // Silence after speech — utterance boundary
        this.emit('utterance:end', { sessionId, label });
        break;

      case 'Metadata':
        console.log(`[Transcription] Session '${label}' metadata:`, JSON.stringify(msg).substring(0, 200));
        break;

      case 'Error':
        console.error(`[Transcription] Deepgram error in '${label}':`, msg.message || msg.description || msg);
        this.emit('session:error', { sessionId, label, error: msg.message || msg.description || 'Deepgram error' });
        break;

      default:
        // Ignore unknown message types (KeepAlive acks, etc.)
        break;
    }
  }

  /**
   * Send a PCM audio chunk to a specific session.
   * Expected format: raw PCM 16-bit, 16kHz, mono.
   * Deepgram accepts raw binary audio data directly (no base64 wrapping needed).
   */
  private chunkCounters: Map<string, number> = new Map();
  private lastChunkLog: Map<string, number> = new Map();

  sendAudioChunk(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);

    // Count chunks for diagnostics
    const count = (this.chunkCounters.get(sessionId) || 0) + 1;
    this.chunkCounters.set(sessionId, count);

    // Log every 500 chunks (~8s of audio at 128-sample frames @ 16kHz)
    const now = Date.now();
    const lastLog = this.lastChunkLog.get(sessionId) || 0;
    if (now - lastLog > 10000) {
      // Log every 10 seconds
      this.lastChunkLog.set(sessionId, now);
      const connected = session?.connected ?? false;
      const wsState = session?.ws?.readyState ?? -1;
      console.log(
        `[Transcription] Audio stats '${sessionId}': ${count} chunks sent, connected=${connected}, ws.readyState=${wsState}, chunkSize=${chunk.length}bytes`,
      );
    }

    if (!session) {
      if (count === 1) console.warn(`[Transcription] No session found for '${sessionId}' — audio chunk dropped`);
      return;
    }
    if (!session.connected) {
      if (count === 1) console.warn(`[Transcription] Session '${sessionId}' not yet connected — audio chunk dropped`);
      return;
    }
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
      if (count <= 3)
        console.warn(
          `[Transcription] WebSocket not open for '${sessionId}' (state=${session.ws?.readyState}) — audio chunk dropped`,
        );
      return;
    }

    try {
      session.ws.send(chunk);
    } catch (err) {
      console.warn(`[Transcription] ws.send failed for '${sessionId}':`, err);
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

    if (session.keepAliveTimer) {
      clearInterval(session.keepAliveTimer);
      session.keepAliveTimer = null;
    }

    try {
      if (session.ws.readyState === WebSocket.OPEN) {
        // Send CloseStream to get final transcripts before closing
        session.ws.send(JSON.stringify({ type: 'CloseStream' }));
        await new Promise((r) => setTimeout(r, 800));
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
      .filter((s) => s.connected)
      .map((s) => ({ id: s.id, label: s.label, connected: s.connected, language: s.language }));
  }
}
