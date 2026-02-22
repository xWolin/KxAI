/**
 * CoachingOverlay — Real-time meeting coaching overlay.
 *
 * Shows:
 * - Meeting status (recording, duration)
 * - Live transcript (last few lines)
 * - AI coaching suggestions
 * - Start/stop controls
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { KxAIConfig } from '../types';

interface TranscriptLine {
  timestamp: number;
  speaker: string;
  text: string;
  source: 'mic' | 'system';
}

interface CoachingTip {
  id: string;
  timestamp: number;
  tip: string;
  category: string;
}

interface MeetingState {
  active: boolean;
  meetingId: string | null;
  startTime: number | null;
  duration: number;
  transcriptLineCount: number;
  lastCoachingTip: string | null;
  detectedApp: string | null;
}

interface Props {
  config: KxAIConfig;
  onBack: () => void;
}

export function CoachingOverlay({ config, onBack }: Props) {
  const [meetingState, setMeetingState] = useState<MeetingState>({
    active: false, meetingId: null, startTime: null,
    duration: 0, transcriptLineCount: 0, lastCoachingTip: null, detectedApp: null,
  });
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [partialMic, setPartialMic] = useState('');
  const [partialSystem, setPartialSystem] = useState('');
  const [coachingTips, setCoachingTips] = useState<CoachingTip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showTips, setShowTips] = useState(true);
  const [hasElevenLabsKey, setHasElevenLabsKey] = useState(false);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const systemProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // Check API key on mount
  useEffect(() => {
    window.kxai.hasApiKey('elevenlabs').then(setHasElevenLabsKey);
  }, []);

  // Wire up IPC events
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(window.kxai.onMeetingState((state: MeetingState) => {
      setMeetingState(state);
    }));

    cleanups.push(window.kxai.onMeetingTranscript((data: any) => {
      if (data.partial) {
        if (data.source === 'mic') setPartialMic(data.text);
        else setPartialSystem(data.text);
      } else if (data.line) {
        setTranscriptLines(prev => [...prev.slice(-49), data.line]);
        if (data.line.source === 'mic') setPartialMic('');
        else setPartialSystem('');
      }
    }));

    cleanups.push(window.kxai.onMeetingCoaching((tip: CoachingTip) => {
      setCoachingTips(prev => [...prev, tip]);
    }));

    cleanups.push(window.kxai.onMeetingError((data: { error: string }) => {
      setError(data.error);
      setTimeout(() => setError(null), 8000);
    }));

    // Get initial state
    window.kxai.meetingGetState().then(setMeetingState);

    return () => cleanups.forEach(fn => fn());
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcriptLines, partialMic, partialSystem]);

  // ──────────── Audio Capture ────────────

  const startAudioCapture = useCallback(async () => {
    try {
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      // Microphone
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
        });
        micStreamRef.current = micStream;

        const micSource = ctx.createMediaStreamSource(micStream);
        const micProcessor = ctx.createScriptProcessor(4096, 1, 1);
        micProcessorRef.current = micProcessor;

        micProcessor.onaudioprocess = (e) => {
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = float32ToInt16(float32);
          window.kxai.meetingSendAudio('mic', int16.buffer as ArrayBuffer);
        };

        micSource.connect(micProcessor);
        micProcessor.connect(ctx.destination);
      } catch (err) {
        console.warn('[CoachingOverlay] Mic capture failed:', err);
      }

      // System audio (via desktopCapturer)
      try {
        // @ts-ignore — Electron desktopCapturer in renderer
        const sources = await (window as any).kxai.captureScreen();
        if (sources?.success && sources.data?.length > 0) {
          const systemStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-ignore — Electron-specific constraint
              mandatory: {
                chromeMediaSource: 'desktop',
              },
            } as any,
            video: false,
          });
          systemStreamRef.current = systemStream;

          const sysSource = ctx.createMediaStreamSource(systemStream);
          const sysProcessor = ctx.createScriptProcessor(4096, 1, 1);
          systemProcessorRef.current = sysProcessor;

          sysProcessor.onaudioprocess = (e) => {
            const float32 = e.inputBuffer.getChannelData(0);
            const int16 = float32ToInt16(float32);
            window.kxai.meetingSendAudio('system', int16.buffer as ArrayBuffer);
          };

          sysSource.connect(sysProcessor);
          sysProcessor.connect(ctx.destination);
        }
      } catch (err) {
        console.warn('[CoachingOverlay] System audio capture failed:', err);
      }
    } catch (err) {
      console.error('[CoachingOverlay] Audio capture failed:', err);
      setError('Nie udało się uruchomić przechwytywania audio');
    }
  }, []);

  const stopAudioCapture = useCallback(() => {
    micProcessorRef.current?.disconnect();
    systemProcessorRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    systemStreamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close();

    micProcessorRef.current = null;
    systemProcessorRef.current = null;
    micStreamRef.current = null;
    systemStreamRef.current = null;
    audioContextRef.current = null;
  }, []);

  // Listen for stop-capture event from main
  useEffect(() => {
    const cleanup = window.kxai.onMeetingStopCapture(() => {
      stopAudioCapture();
    });
    return cleanup;
  }, [stopAudioCapture]);

  // ──────────── Handlers ────────────

  const handleStart = async () => {
    if (!hasElevenLabsKey) {
      setError('Ustaw klucz API ElevenLabs w ustawieniach');
      return;
    }

    setIsStarting(true);
    setError(null);
    setTranscriptLines([]);
    setCoachingTips([]);

    try {
      await window.kxai.meetingStart();
      await startAudioCapture();
    } catch (err: any) {
      setError(err.message || 'Nie udało się rozpocząć spotkania');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      stopAudioCapture();
      const result = await window.kxai.meetingStop();
      if (result?.data?.id) {
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || 'Błąd podczas zatrzymywania');
    } finally {
      setIsStopping(false);
    }
  };

  const handleOpenDashboard = async () => {
    const url = await window.kxai.meetingGetDashboardUrl();
    if (url) {
      // Open in default browser
      window.open(url, '_blank');
    }
  };

  // ──────────── Format helpers ────────────

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTime = (ts: number): string => {
    return new Date(ts).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // ──────────── Render ────────────

  return (
    <div className="coaching-overlay">
      {/* Header */}
      <div className="coaching-overlay__header">
        <button className="coaching-overlay__back" onClick={onBack} title="Powrót">
          ←
        </button>
        <span className="coaching-overlay__title">🎙️ Meeting Coach</span>
        <div className="coaching-overlay__actions">
          <button className="coaching-overlay__btn coaching-overlay__btn--dashboard" onClick={handleOpenDashboard} title="Otwórz dashboard">
            📊
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="coaching-overlay__error">
          ⚠️ {error}
        </div>
      )}

      {/* Controls */}
      <div className="coaching-overlay__controls">
        {!meetingState.active ? (
          <button
            className="coaching-overlay__btn coaching-overlay__btn--start"
            onClick={handleStart}
            disabled={isStarting}
          >
            {isStarting ? '⏳ Uruchamiam...' : '🔴 Rozpocznij nagrywanie'}
          </button>
        ) : (
          <div className="coaching-overlay__active-controls">
            <div className="coaching-overlay__status">
              <span className="coaching-overlay__recording-dot" />
              <span>{formatDuration(meetingState.duration)}</span>
              {meetingState.detectedApp && (
                <span className="coaching-overlay__app-badge">{meetingState.detectedApp}</span>
              )}
              <span className="coaching-overlay__line-count">
                💬 {meetingState.transcriptLineCount}
              </span>
            </div>
            <button
              className="coaching-overlay__btn coaching-overlay__btn--stop"
              onClick={handleStop}
              disabled={isStopping}
            >
              {isStopping ? '⏳ Kończę...' : '⏹ Zakończ'}
            </button>
          </div>
        )}
      </div>

      {/* Content area */}
      {meetingState.active && (
        <div className="coaching-overlay__content">
          {/* Tabs */}
          <div className="coaching-overlay__tabs">
            <button
              className={`coaching-overlay__tab ${!showTips ? 'coaching-overlay__tab--active' : ''}`}
              onClick={() => setShowTips(false)}
            >
              📜 Transkrypcja
            </button>
            <button
              className={`coaching-overlay__tab ${showTips ? 'coaching-overlay__tab--active' : ''}`}
              onClick={() => setShowTips(true)}
            >
              💡 Wskazówki ({coachingTips.length})
            </button>
          </div>

          {/* Transcript */}
          {!showTips && (
            <div className="coaching-overlay__transcript" ref={transcriptRef}>
              {transcriptLines.map((line, i) => (
                <div key={i} className="coaching-overlay__line">
                  <span className="coaching-overlay__line-time">{formatTime(line.timestamp)}</span>
                  <span className={`coaching-overlay__line-speaker ${line.speaker === 'Ja' ? 'coaching-overlay__line-speaker--me' : ''}`}>
                    {line.speaker}:
                  </span>
                  <span className="coaching-overlay__line-text">{line.text}</span>
                </div>
              ))}

              {/* Partials */}
              {partialMic && (
                <div className="coaching-overlay__line coaching-overlay__line--partial">
                  <span className="coaching-overlay__line-speaker coaching-overlay__line-speaker--me">Ja:</span>
                  <span className="coaching-overlay__line-text">{partialMic}...</span>
                </div>
              )}
              {partialSystem && (
                <div className="coaching-overlay__line coaching-overlay__line--partial">
                  <span className="coaching-overlay__line-speaker">Uczestnik:</span>
                  <span className="coaching-overlay__line-text">{partialSystem}...</span>
                </div>
              )}

              {transcriptLines.length === 0 && !partialMic && !partialSystem && (
                <div className="coaching-overlay__empty">
                  🎤 Oczekuję na mowę...
                </div>
              )}
            </div>
          )}

          {/* Coaching tips */}
          {showTips && (
            <div className="coaching-overlay__tips">
              {coachingTips.length === 0 ? (
                <div className="coaching-overlay__empty">
                  💡 Wskazówki pojawią się po kilku wypowiedziach...
                </div>
              ) : (
                coachingTips.slice().reverse().map(tip => (
                  <div key={tip.id} className="coaching-overlay__tip">
                    <div className="coaching-overlay__tip-header">
                      <span className="coaching-overlay__tip-category">{tip.category}</span>
                      <span className="coaching-overlay__tip-time">{formatTime(tip.timestamp)}</span>
                    </div>
                    <div className="coaching-overlay__tip-text">{tip.tip}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Summaries link when no active meeting */}
      {!meetingState.active && (
        <div className="coaching-overlay__idle">
          <div className="coaching-overlay__idle-info">
            <p>Rozpocznij nagrywanie, aby aktywować transkrypcję i coaching w czasie rzeczywistym.</p>
            <p style={{ marginTop: '0.5rem' }}>
              <button className="coaching-overlay__btn coaching-overlay__btn--link" onClick={handleOpenDashboard}>
                📊 Otwórz dashboard z podsumowaniami
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────── Helpers ────────────

/**
 * Convert Float32Array audio samples to Int16Array (PCM 16-bit).
 */
function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}
