/**
 * CoachingOverlay — Compact real-time meeting coaching popup.
 *
 * Features:
 * - Compact coaching bar at top-center of screen during active meeting
 * - Shows recording status, duration, and current coaching tip
 * - Full transcript & details available on dashboard
 * - Pre-meeting briefing form before start
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { KxAIConfig, MeetingBriefingParticipant, MeetingBriefingInfo } from '../types';
import s from './CoachingOverlay.module.css';
import { cn } from '../utils/cn';

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
  isStreaming?: boolean;
  questionText?: string;
}

interface SpeakerInfo {
  id: string;
  name: string;
  source: 'system';
  utteranceCount: number;
  lastSeen: number;
  isAutoDetected: boolean;
}

interface MeetingState {
  active: boolean;
  meetingId: string | null;
  startTime: number | null;
  duration: number;
  transcriptLineCount: number;
  lastCoachingTip: string | null;
  detectedApp: string | null;
  speakers: SpeakerInfo[];
  isCoaching: boolean;
  hasBriefing: boolean;
}

interface Props {
  config: KxAIConfig;
  onBack: () => void;
}

// Compact coaching bar dimensions
const COACHING_BAR_WIDTH = 420;
const COACHING_BAR_HEIGHT = 140;
const COACHING_BAR_EXPANDED_HEIGHT = 340;

export function CoachingOverlay({ config, onBack }: Props) {
  const [meetingState, setMeetingState] = useState<MeetingState>({
    active: false, meetingId: null, startTime: null,
    duration: 0, transcriptLineCount: 0, lastCoachingTip: null,
    detectedApp: null, speakers: [], isCoaching: false, hasBriefing: false,
  });
  const [coachingTips, setCoachingTips] = useState<CoachingTip[]>([]);
  const [activeCoaching, setActiveCoaching] = useState<CoachingTip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [hasDeepgramKey, setHasDeepgramKey] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Briefing state
  const [showBriefing, setShowBriefing] = useState(false);
  const [briefingTopic, setBriefingTopic] = useState('');
  const [briefingAgenda, setBriefingAgenda] = useState('');
  const [briefingNotes, setBriefingNotes] = useState('');
  const [briefingUrls, setBriefingUrls] = useState('');
  const [briefingProjectPaths, setBriefingProjectPaths] = useState('');
  const [briefingParticipants, setBriefingParticipants] = useState<MeetingBriefingParticipant[]>([]);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingSaved, setBriefingSaved] = useState(false);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantRole, setNewParticipantRole] = useState('');

  // Last few transcript lines for compact display
  const [recentLines, setRecentLines] = useState<TranscriptLine[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const micWorkletRef = useRef<AudioWorkletNode | null>(null);
  const systemWorkletRef = useRef<AudioWorkletNode | null>(null);
  const prevActiveRef = useRef(false);

  // Check API key on mount + load existing briefing
  useEffect(() => {
    window.kxai.hasApiKey('deepgram').then(setHasDeepgramKey).catch(err => {
      console.error('[CoachingOverlay] Failed to check Deepgram API key:', err);
    });
    window.kxai.meetingGetBriefing().then((b: MeetingBriefingInfo | null) => {
      if (b) {
        setBriefingTopic(b.topic || '');
        setBriefingAgenda(b.agenda || '');
        setBriefingNotes(b.notes || '');
        setBriefingUrls(Array.isArray(b.urls) ? b.urls.join('\n') : '');
        setBriefingProjectPaths(Array.isArray(b.projectPaths) ? b.projectPaths.join('\n') : '');
        setBriefingParticipants(Array.isArray(b.participants) ? b.participants : []);
        setBriefingSaved(true);
      }
    }).catch(err => {
      console.error('[CoachingOverlay] Failed to load briefing:', err);
    });
  }, []);

  // Wire up IPC events
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(window.kxai.onMeetingState((state: MeetingState) => {
      setMeetingState(state);
    }));

    cleanups.push(window.kxai.onMeetingTranscript((data: any) => {
      if (!data.partial && data.line) {
        setRecentLines(prev => [...prev.slice(-4), data.line]);
      }
    }));

    cleanups.push(window.kxai.onMeetingCoaching((tip: CoachingTip) => {
      setActiveCoaching({ ...tip, tip: '' });
    }));

    if (window.kxai.onMeetingCoachingChunk) {
      cleanups.push(window.kxai.onMeetingCoachingChunk((data: { id: string; chunk: string; fullText: string }) => {
        setActiveCoaching(prev => {
          if (!prev || prev.id !== data.id) return prev;
          return { ...prev, tip: data.fullText };
        });
      }));
    }

    if (window.kxai.onMeetingCoachingDone) {
      cleanups.push(window.kxai.onMeetingCoachingDone((data: { id: string; tip: string; category: string; questionText?: string }) => {
        setCoachingTips(prev => [...prev, {
          id: data.id,
          timestamp: Date.now(),
          tip: data.tip,
          category: data.category,
          questionText: data.questionText,
        }]);
        setActiveCoaching(null);
      }));
    }

    cleanups.push(window.kxai.onMeetingError((data: { error: string }) => {
      setError(data.error);
      setTimeout(() => setError(null), 8000);
    }));

    window.kxai.meetingGetState().then(setMeetingState);

    return () => cleanups.forEach(fn => fn());
  }, []);

  // Window size management: compact bar when meeting active, normal for setup
  useEffect(() => {
    if (meetingState.active && !prevActiveRef.current) {
      // Meeting just started — switch to compact coaching bar at top-center
      const screenWidth = window.screen.availWidth;
      const x = Math.round((screenWidth - COACHING_BAR_WIDTH) / 2);
      window.kxai.setWindowSize(COACHING_BAR_WIDTH, COACHING_BAR_HEIGHT);
      window.kxai.setWindowPosition(x, 8);
    } else if (!meetingState.active && prevActiveRef.current) {
      // Meeting just ended — return to normal chat window size
      window.kxai.setWindowSize(420, 600);
    }
    prevActiveRef.current = meetingState.active;
  }, [meetingState.active]);

  // Expand/collapse the compact bar
  useEffect(() => {
    if (meetingState.active) {
      const height = expanded ? COACHING_BAR_EXPANDED_HEIGHT : COACHING_BAR_HEIGHT;
      window.kxai.setWindowSize(COACHING_BAR_WIDTH, height);
    }
  }, [expanded, meetingState.active]);

  // ──────────── Audio Capture ────────────

  const startAudioCapture = useCallback(async () => {
    try {
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      const workletCode = `
        class PCMForwarder extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (input && input[0] && input[0].length > 0) {
              this.port.postMessage(input[0]);
            }
            return true;
          }
        }
        registerProcessor('pcm-forwarder', PCMForwarder);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const createPCMWorklet = (source: MediaStreamAudioSourceNode, label: 'mic' | 'system'): AudioWorkletNode => {
        const node = new AudioWorkletNode(ctx, 'pcm-forwarder');
        let chunkCount = 0;
        let silentChunks = 0;
        let lastLogTime = Date.now();
        node.port.onmessage = (e) => {
          const float32: Float32Array = e.data;
          chunkCount++;

          // Check if chunk is silent (all near-zero values)
          let maxAbs = 0;
          for (let i = 0; i < float32.length; i++) {
            const abs = Math.abs(float32[i]);
            if (abs > maxAbs) maxAbs = abs;
          }
          if (maxAbs < 0.001) silentChunks++;

          // Log diagnostics every 10 seconds
          const now = Date.now();
          if (now - lastLogTime > 10000) {
            lastLogTime = now;
            const silentPct = Math.round((silentChunks / chunkCount) * 100);
            console.log(`[CoachingOverlay] PCM ${label}: ${chunkCount} chunks, ${silentPct}% silent, maxAmplitude=${maxAbs.toFixed(4)}`);
          }

          const int16 = float32ToInt16(float32);
          window.kxai.meetingSendAudio(label, int16.buffer as ArrayBuffer);
        };
        source.connect(node);
        // Don't connect to ctx.destination — we only process PCM data,
        // playing it back would cause mic feedback / double system audio
        return node;
      };

      // Microphone
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
        });
        micStreamRef.current = micStream;
        const micSource = ctx.createMediaStreamSource(micStream);
        micWorkletRef.current = createPCMWorklet(micSource, 'mic');
      } catch (err) {
        console.warn('[CoachingOverlay] Mic capture failed:', err);
      }

      // System audio via getDisplayMedia (Electron 33+)
      try {
        const systemStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });

        const videoTracks = systemStream.getVideoTracks();
        const audioTracks = systemStream.getAudioTracks();
        console.log(`[CoachingOverlay] getDisplayMedia: ${videoTracks.length} video tracks, ${audioTracks.length} audio tracks`);

        // Stop video tracks — we only need audio
        // NOTE: Don't remove them from stream, just stop to save resources
        videoTracks.forEach(t => {
          console.log(`[CoachingOverlay] Stopping video track: ${t.label} (state=${t.readyState})`);
          t.stop();
        });

        if (audioTracks.length > 0) {
          console.log(`[CoachingOverlay] System audio track: ${audioTracks[0].label} (state=${audioTracks[0].readyState}, enabled=${audioTracks[0].enabled})`);

          // Monitor audio track state
          audioTracks[0].onended = () => {
            console.warn('[CoachingOverlay] System audio track ENDED unexpectedly!');
          };
          audioTracks[0].onmute = () => {
            console.warn('[CoachingOverlay] System audio track MUTED');
          };

          systemStreamRef.current = systemStream;
          const sysSource = ctx.createMediaStreamSource(systemStream);
          systemWorkletRef.current = createPCMWorklet(sysSource, 'system');
        } else {
          console.warn('[CoachingOverlay] getDisplayMedia returned no audio tracks');
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
    micWorkletRef.current?.disconnect();
    systemWorkletRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    systemStreamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close();
    micWorkletRef.current = null;
    systemWorkletRef.current = null;
    micStreamRef.current = null;
    systemStreamRef.current = null;
    audioContextRef.current = null;
  }, []);

  useEffect(() => {
    const cleanup = window.kxai.onMeetingStopCapture(() => stopAudioCapture());
    return cleanup;
  }, [stopAudioCapture]);

  // ──────────── Handlers ────────────

  const handleStart = async () => {
    if (!hasDeepgramKey) {
      setError('Ustaw klucz API Deepgram w ustawieniach');
      return;
    }
    setIsStarting(true);
    setError(null);
    setRecentLines([]);
    setCoachingTips([]);
    setActiveCoaching(null);

    try {
      await startAudioCapture();
      await window.kxai.meetingStart();
    } catch (err: any) {
      stopAudioCapture();
      setError(err.message || 'Nie udało się rozpocząć spotkania');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      stopAudioCapture();
      await window.kxai.meetingStop();
    } catch (err: any) {
      setError(err.message || 'Błąd podczas zatrzymywania');
    } finally {
      setIsStopping(false);
    }
  };

  const handleOpenDashboard = async () => {
    const url = await window.kxai.meetingGetDashboardUrl();
    if (url) window.open(url + '/#/meetings', '_blank');
  };

  // ──────────── Briefing Handlers ────────────

  const handleAddParticipant = () => {
    if (!newParticipantName.trim()) return;
    setBriefingParticipants(prev => [...prev, {
      name: newParticipantName.trim(),
      role: newParticipantRole.trim() || undefined,
    }]);
    setNewParticipantName('');
    setNewParticipantRole('');
    setBriefingSaved(false);
  };

  const handleCopyTip = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const handleRemoveParticipant = (index: number) => {
    setBriefingParticipants(prev => prev.filter((_, i) => i !== index));
    setBriefingSaved(false);
  };

  const handleSaveBriefing = async () => {
    setBriefingLoading(true);
    setError(null);
    try {
      const briefing: MeetingBriefingInfo = {
        topic: briefingTopic.trim(),
        agenda: briefingAgenda.trim() || undefined,
        participants: briefingParticipants,
        notes: briefingNotes.trim(),
        urls: briefingUrls.split('\n').map(u => u.trim()).filter(Boolean),
        projectPaths: briefingProjectPaths.split('\n').map(p => p.trim()).filter(Boolean),
      };
      const result = await window.kxai.meetingSetBriefing(briefing);
      if (result.success) {
        setBriefingSaved(true);
      } else {
        setError(result.error || 'Nie udało się zapisać briefingu');
      }
    } catch (err: any) {
      setError(err.message || 'Błąd zapisu briefingu');
    } finally {
      setBriefingLoading(false);
    }
  };

  const handleClearBriefing = async () => {
    try {
      await window.kxai.meetingClearBriefing();
      setBriefingTopic('');
      setBriefingAgenda('');
      setBriefingNotes('');
      setBriefingUrls('');
      setBriefingProjectPaths('');
      setBriefingParticipants([]);
      setBriefingSaved(false);
      setShowBriefing(false);
    } catch (err: any) {
      setError(err.message || 'Nie udało się wyczyścić briefingu');
    }
  };

  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTime = (ts: number): string => {
    return new Date(ts).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // ──────────── Render: Active Meeting (Compact Bar) ────────────

  if (meetingState.active) {
    return (
      <div className={s.bar}>
        <div className={s.barHeader}>
          <div className={s.barStatus}>
            <span className={s.barRecDot} />
            <span className={s.barTimer}>{formatDuration(meetingState.duration)}</span>
            {meetingState.detectedApp && (
              <span className={s.barApp}>{meetingState.detectedApp}</span>
            )}
            <span className={s.barLines}>💬 {meetingState.transcriptLineCount}</span>
          </div>
          <div className={s.barActions}>
            <button className={s.barBtnExpand} onClick={() => setExpanded(!expanded)} title={expanded ? 'Zwiń' : 'Rozwiń'}>
              {expanded ? '▲' : '▼'}
            </button>
            <button className={s.barBtnDashboard} onClick={handleOpenDashboard} title="Dashboard">📊</button>
            <button className={s.barBtnStop} onClick={handleStop} disabled={isStopping}>
              {isStopping ? '⏳' : '⏹'} Zakończ
            </button>
          </div>
        </div>

        {error && <div className={s.barError}>⚠️ {error}</div>}

        <div className={s.barTipArea}>
          {activeCoaching ? (
            <div className={s.barActiveTip}>
              <div className={s.barTipLabel}>
                💡 Sugestia
                {activeCoaching.questionText && (
                <span className={s.barTipQuestion}> — „{activeCoaching.questionText.length > 50 ? activeCoaching.questionText.substring(0, 50) + '...' : activeCoaching.questionText}”</span>
                )}
              </div>
              <div className={s.barTipTextStreaming}>
                {activeCoaching.tip || '▍'}
                {activeCoaching.tip && <span className={s.barCursor}>▍</span>}
              </div>
            </div>
          ) : coachingTips.length > 0 ? (
            <div className={s.barLastTip}>
              <div className={s.barTipLabel}>
                ✅ Ostatnia sugestia
                <span className={s.barTipTime}>{formatTime(coachingTips[coachingTips.length - 1].timestamp)}</span>
              </div>
              <div className={s.barTipTextWrap}>
                <div className={s.barTipText}>{coachingTips[coachingTips.length - 1].tip}</div>
                <button className={s.barBtnCopy} onClick={() => handleCopyTip(coachingTips[coachingTips.length - 1].tip)} title="Kopiuj">📋</button>
              </div>
            </div>
          ) : meetingState.isCoaching ? (
            <div className={s.barGenerating}>🧠 Generuję sugestię...</div>
          ) : (
            <div className={s.barWaiting}>
              <span>🎤 Nasłuchuję pytań...</span>
              {recentLines.length > 0 && (
                <span className={s.barLastUtterance}>
                  <span className={recentLines[recentLines.length - 1].speaker === 'Ja' ? s.barSpeakerMe : s.barSpeaker}>{recentLines[recentLines.length - 1].speaker}:</span>
                  {' '}{recentLines[recentLines.length - 1].text.substring(0, 60)}{recentLines[recentLines.length - 1].text.length > 60 ? '…' : ''}
                </span>
              )}
            </div>
          )}
        </div>

        {/* P7: Speaker activity indicators */}
        {meetingState.speakers.length > 0 && !expanded && (
          <div className={s.barSpeakersStrip}>
            {meetingState.speakers.map(spk => (
              <span key={spk.id} className={Date.now() - spk.lastSeen < 3000 ? s.barSpeakerDotActive : s.barSpeakerDot} title={`${spk.name} (${spk.utteranceCount})`}>
                {spk.name.substring(0, 2).toUpperCase()}
              </span>
            ))}
          </div>
        )}

        {expanded && (
          <div className={s.barExpanded}>
            {recentLines.length > 0 && (
              <div>
                <div className={s.barSectionLabel}>Ostatnie wypowiedzi:</div>
                {recentLines.map((line, i) => (
                  <div key={i} className={s.barRecentLine}>
                    <span className={line.speaker === 'Ja' ? s.barSpeakerMe : s.barSpeaker}>{line.speaker}:</span>
                    <span className={s.barText}>{line.text}</span>
                  </div>
                ))}
              </div>
            )}
            {coachingTips.length > 1 && (
              <div className={s.barHistory}>
                <div className={s.barSectionLabel}>Historia sugestii ({coachingTips.length}):</div>
                {coachingTips.slice(-3).reverse().map(tip => (
                  <div key={tip.id} className={s.barHistoryItem}>
                    <span className={s.barHistoryTime}>{formatTime(tip.timestamp)}</span>
                    <span className={s.barHistoryText}>{tip.tip.substring(0, 120)}...</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ──────────── Render: Idle State (Setup) ────────────

  return (
    <div className={s.overlay}>
      <div className={s.header}>
        <button className={s.back} onClick={onBack} title="Powrót">←</button>
        <span className={s.title}>🎤️ Meeting Coach</span>
        <div className={s.actions}>
          <button className={s.btnDashboard} onClick={handleOpenDashboard} title="Dashboard">📊</button>
        </div>
      </div>

      {error && <div className={s.error}>⚠️ {error}</div>}

      <div className={s.controls}>
        <button className={s.btnStart} onClick={handleStart} disabled={isStarting}>
          {isStarting ? '⏳ Uruchamiam...' : '🔴 Rozpocznij nagrywanie'}
        </button>
      </div>

      <div className={s.briefingToggle}>
        <button
          className={showBriefing ? s.btnBriefingActive : s.btnBriefing}
          onClick={() => setShowBriefing(!showBriefing)}
        >
          📋 {showBriefing ? 'Ukryj briefing' : 'Pre-meeting briefing'}
          {briefingSaved && !showBriefing && <span className={s.briefingBadge}>✓</span>}
        </button>
      </div>

      {showBriefing && (
        <div className={s.briefingForm}>
          <div className={s.briefingField}>
            <label className={s.briefingLabel}>📌 Temat spotkania</label>
            <input className={s.briefingInput} value={briefingTopic} onChange={e => { setBriefingTopic(e.target.value); setBriefingSaved(false); }} placeholder="np. Sprint review, design review, 1:1..." />
          </div>
          <div className={s.briefingField}>
            <label className={s.briefingLabel}>📝 Agenda</label>
            <textarea className={s.briefingTextarea} value={briefingAgenda} onChange={e => { setBriefingAgenda(e.target.value); setBriefingSaved(false); }} placeholder="Punkty do omówienia..." rows={2} />
          </div>
          <div className={s.briefingField}>
            <label className={s.briefingLabel}>👥 Uczestnicy</label>
            {briefingParticipants.length > 0 && (
              <div className={s.briefingParticipants}>
                {briefingParticipants.map((p, i) => (
                  <div key={i} className={s.briefingParticipant}>
                    <span className={s.briefingParticipantInfo}>
                      <strong>{p.name}</strong>{p.role && ` — ${p.role}`}{p.company && ` (${p.company})`}
                    </span>
                    <button className={s.briefingRemove} onClick={() => handleRemoveParticipant(i)}>✗</button>
                  </div>
                ))}
              </div>
            )}
            <div className={s.briefingAddParticipant}>
              <input className={s.briefingInputSmall} value={newParticipantName} onChange={e => setNewParticipantName(e.target.value)} placeholder="Imię" onKeyDown={e => e.key === 'Enter' && handleAddParticipant()} />
              <input className={s.briefingInputSmall} value={newParticipantRole} onChange={e => setNewParticipantRole(e.target.value)} placeholder="Rola" onKeyDown={e => e.key === 'Enter' && handleAddParticipant()} />
              <button className={s.btnAdd} onClick={handleAddParticipant}>+ Dodaj</button>
            </div>
          </div>
          <div className={s.briefingField}>
            <label className={s.briefingLabel}>📄 Notatki</label>
            <textarea className={s.briefingTextarea} value={briefingNotes} onChange={e => { setBriefingNotes(e.target.value); setBriefingSaved(false); }} placeholder="Wolne notatki..." rows={2} />
          </div>
          <div className={s.briefingActions}>
            <button className={s.btnSave} onClick={handleSaveBriefing} disabled={briefingLoading}>
              {briefingLoading ? '⏳ Przetwarzam...' : briefingSaved ? '✅ Zapisany' : '💾 Zapisz briefing'}
            </button>
            {briefingSaved && <button className={s.btnClear} onClick={handleClearBriefing}>🗑️ Wyczyść</button>}
          </div>
        </div>
      )}

      <div className={s.idleInfo}>
        <p>Rozpocznij nagrywanie aby aktywować real-time coaching.</p>
        {briefingSaved && <p style={{ fontSize: '0.75rem', color: 'var(--neon-green)', marginTop: '0.2rem' }}>✅ Briefing załadowany</p>}
        <p style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.3rem' }}>
          Po starcie okno zmieni się w kompaktowy pasek z podpowiedziami.<br />
          Transkrypcja live dostępna na dashboardzie.
        </p>
        <p style={{ marginTop: '0.5rem' }}>
          <button className={s.btnLink} onClick={handleOpenDashboard}>📊 Otwórz dashboard</button>
        </p>
      </div>
    </div>
  );
}

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const val = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
  }
  return int16;
}
