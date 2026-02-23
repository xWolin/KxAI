/**
 * CoachingOverlay — Real-time event-driven meeting coaching overlay.
 *
 * Features:
 * - Live transcript with speaker labels
 * - Streaming AI coaching suggestions (appears instantly when question detected)
 * - Speaker mapping UI (rename participants)
 * - Split view: transcript left, coaching right
 * - Prominent coaching display for easy reading during meetings
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { KxAIConfig, MeetingBriefingParticipant, MeetingBriefingInfo } from '../types';

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

export function CoachingOverlay({ config, onBack }: Props) {
  const [meetingState, setMeetingState] = useState<MeetingState>({
    active: false, meetingId: null, startTime: null,
    duration: 0, transcriptLineCount: 0, lastCoachingTip: null,
    detectedApp: null, speakers: [], isCoaching: false, hasBriefing: false,
  });
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [partialMic, setPartialMic] = useState('');
  const [partialSystem, setPartialSystem] = useState('');
  const [coachingTips, setCoachingTips] = useState<CoachingTip[]>([]);
  const [activeCoaching, setActiveCoaching] = useState<CoachingTip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [hasElevenLabsKey, setHasElevenLabsKey] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerNameInput, setSpeakerNameInput] = useState('');

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
  const [newParticipantCompany, setNewParticipantCompany] = useState('');
  const [newParticipantNotes, setNewParticipantNotes] = useState('');

  const transcriptRef = useRef<HTMLDivElement>(null);
  const coachingRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const systemProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // Check API key on mount + load existing briefing
  useEffect(() => {
    window.kxai.hasApiKey('elevenlabs').then(setHasElevenLabsKey);
    window.kxai.meetingGetBriefing().then((b: MeetingBriefingInfo | null) => {
      if (b) {
        setBriefingTopic(b.topic || '');
        setBriefingAgenda(b.agenda || '');
        setBriefingNotes(b.notes || '');
        setBriefingUrls(b.urls.join('\n'));
        setBriefingProjectPaths(b.projectPaths.join('\n'));
        setBriefingParticipants(b.participants || []);
        setBriefingSaved(true);
      }
    });
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
        setTranscriptLines(prev => [...prev.slice(-99), data.line]);
        if (data.line.source === 'mic') setPartialMic('');
        else setPartialSystem('');
      }
    }));

    // Coaching started — new tip being streamed
    cleanups.push(window.kxai.onMeetingCoaching((tip: CoachingTip) => {
      setActiveCoaching({ ...tip, tip: '' });
    }));

    // Coaching chunk — streaming text
    if (window.kxai.onMeetingCoachingChunk) {
      cleanups.push(window.kxai.onMeetingCoachingChunk((data: { id: string; chunk: string; fullText: string }) => {
        setActiveCoaching(prev => {
          if (!prev || prev.id !== data.id) return prev;
          return { ...prev, tip: data.fullText };
        });
      }));
    }

    // Coaching done — finalize
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

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcriptLines, partialMic, partialSystem]);

  // Auto-scroll coaching
  useEffect(() => {
    if (coachingRef.current) {
      coachingRef.current.scrollTop = coachingRef.current.scrollHeight;
    }
  }, [activeCoaching, coachingTips]);

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
        const sourcesResult = await window.kxai.getDesktopSources();
        if (sourcesResult?.success && sourcesResult.data && sourcesResult.data.length > 0) {
          const sourceId = sourcesResult.data[0].id;
          const systemStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-ignore — Electron-specific constraint: chromeMediaSourceId is REQUIRED in Electron 33+
              mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId },
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

  useEffect(() => {
    const cleanup = window.kxai.onMeetingStopCapture(() => stopAudioCapture());
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
    setActiveCoaching(null);

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
      await window.kxai.meetingStop();
    } catch (err: any) {
      setError(err.message || 'Błąd podczas zatrzymywania');
    } finally {
      setIsStopping(false);
    }
  };

  const handleOpenDashboard = async () => {
    const url = await window.kxai.meetingGetDashboardUrl();
    if (url) window.open(url, '_blank');
  };

  const handleRenameSpeaker = (speakerId: string) => {
    if (speakerNameInput.trim() && window.kxai.meetingMapSpeaker) {
      window.kxai.meetingMapSpeaker(speakerId, speakerNameInput.trim());
      setEditingSpeaker(null);
      setSpeakerNameInput('');
    }
  };

  // ──────────── Briefing Handlers ────────────

  const handleAddParticipant = () => {
    if (!newParticipantName.trim()) return;
    setBriefingParticipants(prev => [...prev, {
      name: newParticipantName.trim(),
      role: newParticipantRole.trim() || undefined,
      company: newParticipantCompany.trim() || undefined,
      notes: newParticipantNotes.trim() || undefined,
    }]);
    setNewParticipantName('');
    setNewParticipantRole('');
    setNewParticipantCompany('');
    setNewParticipantNotes('');
    setBriefingSaved(false);
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
    await window.kxai.meetingClearBriefing();
    setBriefingTopic('');
    setBriefingAgenda('');
    setBriefingNotes('');
    setBriefingUrls('');
    setBriefingProjectPaths('');
    setBriefingParticipants([]);
    setBriefingSaved(false);
    setShowBriefing(false);
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
        <button className="coaching-overlay__back" onClick={onBack} title="Powrót">←</button>
        <span className="coaching-overlay__title">🎙️ Meeting Coach</span>
        <div className="coaching-overlay__actions">
          <button className="coaching-overlay__btn coaching-overlay__btn--dashboard" onClick={handleOpenDashboard} title="Dashboard">📊</button>
        </div>
      </div>

      {/* Error */}
      {error && <div className="coaching-overlay__error">⚠️ {error}</div>}

      {/* Controls */}
      <div className="coaching-overlay__controls">
        {!meetingState.active ? (
          <button className="coaching-overlay__btn coaching-overlay__btn--start" onClick={handleStart} disabled={isStarting}>
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
              <span className="coaching-overlay__line-count">💬 {meetingState.transcriptLineCount}</span>
              {meetingState.isCoaching && (
                <span className="coaching-overlay__coaching-indicator">🧠 Generuję...</span>
              )}
              {meetingState.hasBriefing && (
                <span className="coaching-overlay__briefing-indicator" title="Briefing załadowany">📋</span>
              )}
            </div>
            <button className="coaching-overlay__btn coaching-overlay__btn--stop" onClick={handleStop} disabled={isStopping}>
              {isStopping ? '⏳ Kończę...' : '⏹ Zakończ'}
            </button>
          </div>
        )}
      </div>

      {/* Active meeting content */}
      {meetingState.active && (
        <div className="coaching-overlay__content">
          {/* ═══════ COACHING SUGGESTION (prominent, top) ═══════ */}
          {(activeCoaching || coachingTips.length > 0) && (
            <div className="coaching-overlay__coaching-panel">
              {activeCoaching ? (
                <div className="coaching-overlay__active-coaching">
                  <div className="coaching-overlay__coaching-label">
                    💡 Sugestia odpowiedzi
                    {activeCoaching.questionText && (
                      <span className="coaching-overlay__question-preview">
                        na: "{activeCoaching.questionText.substring(0, 60)}..."
                      </span>
                    )}
                  </div>
                  <div className="coaching-overlay__coaching-text coaching-overlay__coaching-text--streaming">
                    {activeCoaching.tip || '▍'}
                    {activeCoaching.tip && <span className="coaching-overlay__cursor">▍</span>}
                  </div>
                </div>
              ) : coachingTips.length > 0 && (
                <div className="coaching-overlay__last-coaching">
                  <div className="coaching-overlay__coaching-label">
                    ✅ Ostatnia sugestia
                    <span className="coaching-overlay__coaching-time">
                      {formatTime(coachingTips[coachingTips.length - 1].timestamp)}
                    </span>
                  </div>
                  <div className="coaching-overlay__coaching-text">
                    {coachingTips[coachingTips.length - 1].tip}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════ TRANSCRIPT ═══════ */}
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
              <div className="coaching-overlay__empty">🎤 Oczekuję na mowę...</div>
            )}
          </div>

          {/* ═══════ SPEAKERS ═══════ */}
          {meetingState.speakers.length > 0 && (
            <div className="coaching-overlay__speakers">
              <div className="coaching-overlay__speakers-label">👥 Uczestnicy:</div>
              <div className="coaching-overlay__speakers-list">
                {meetingState.speakers.map(speaker => (
                  <div key={speaker.id} className="coaching-overlay__speaker">
                    {editingSpeaker === speaker.id ? (
                      <div className="coaching-overlay__speaker-edit">
                        <input
                          className="coaching-overlay__speaker-input"
                          value={speakerNameInput}
                          onChange={e => setSpeakerNameInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRenameSpeaker(speaker.id)}
                          placeholder="Nazwa..."
                          autoFocus
                        />
                        <button className="coaching-overlay__speaker-save" onClick={() => handleRenameSpeaker(speaker.id)}>✓</button>
                        <button className="coaching-overlay__speaker-cancel" onClick={() => setEditingSpeaker(null)}>✗</button>
                      </div>
                    ) : (
                      <span
                        className="coaching-overlay__speaker-name"
                        onClick={() => {
                          setEditingSpeaker(speaker.id);
                          setSpeakerNameInput(speaker.name);
                        }}
                        title="Kliknij aby zmienić nazwę"
                      >
                        {speaker.name}
                        {speaker.isAutoDetected && ' ✏️'}
                        <span className="coaching-overlay__speaker-count">({speaker.utteranceCount})</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════ COACHING HISTORY ═══════ */}
          {coachingTips.length > 1 && (
            <div className="coaching-overlay__tips-history" ref={coachingRef}>
              <div className="coaching-overlay__tips-label">📋 Historia sugestii ({coachingTips.length})</div>
              {coachingTips.slice().reverse().slice(1).map(tip => (
                <div key={tip.id} className="coaching-overlay__tip-history-item">
                  <span className="coaching-overlay__tip-time">{formatTime(tip.timestamp)}</span>
                  {tip.questionText && (
                    <div className="coaching-overlay__tip-question">❓ {tip.questionText}</div>
                  )}
                  <div className="coaching-overlay__tip-answer">{tip.tip}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Idle state — briefing + start */}
      {!meetingState.active && (
        <div className="coaching-overlay__idle">
          {/* Briefing toggle */}
          <div className="coaching-overlay__briefing-toggle">
            <button
              className={`coaching-overlay__btn coaching-overlay__btn--briefing ${showBriefing ? 'coaching-overlay__btn--active' : ''}`}
              onClick={() => setShowBriefing(!showBriefing)}
            >
              📋 {showBriefing ? 'Ukryj briefing' : 'Pre-meeting briefing'}
              {briefingSaved && !showBriefing && <span className="coaching-overlay__briefing-badge">✓</span>}
            </button>
          </div>

          {/* Briefing Form */}
          {showBriefing && (
            <div className="coaching-overlay__briefing-form">
              {/* Topic */}
              <div className="coaching-overlay__briefing-field">
                <label className="coaching-overlay__briefing-label">📌 Temat spotkania</label>
                <input
                  className="coaching-overlay__briefing-input"
                  value={briefingTopic}
                  onChange={e => { setBriefingTopic(e.target.value); setBriefingSaved(false); }}
                  placeholder="np. Sprint review, design review, 1:1 z managerem..."
                />
              </div>

              {/* Agenda */}
              <div className="coaching-overlay__briefing-field">
                <label className="coaching-overlay__briefing-label">📝 Agenda</label>
                <textarea
                  className="coaching-overlay__briefing-textarea"
                  value={briefingAgenda}
                  onChange={e => { setBriefingAgenda(e.target.value); setBriefingSaved(false); }}
                  placeholder="Punkty do omówienia..."
                  rows={2}
                />
              </div>

              {/* Participants */}
              <div className="coaching-overlay__briefing-field">
                <label className="coaching-overlay__briefing-label">👥 Uczestnicy</label>
                {briefingParticipants.length > 0 && (
                  <div className="coaching-overlay__briefing-participants">
                    {briefingParticipants.map((p, i) => (
                      <div key={i} className="coaching-overlay__briefing-participant">
                        <span className="coaching-overlay__briefing-participant-info">
                          <strong>{p.name}</strong>
                          {p.role && <span> — {p.role}</span>}
                          {p.company && <span> ({p.company})</span>}
                          {p.notes && <span className="coaching-overlay__briefing-participant-notes">: {p.notes}</span>}
                        </span>
                        <button
                          className="coaching-overlay__briefing-remove"
                          onClick={() => handleRemoveParticipant(i)}
                          title="Usuń"
                        >✗</button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="coaching-overlay__briefing-add-participant">
                  <input
                    className="coaching-overlay__briefing-input coaching-overlay__briefing-input--small"
                    value={newParticipantName}
                    onChange={e => setNewParticipantName(e.target.value)}
                    placeholder="Imię i nazwisko"
                    onKeyDown={e => e.key === 'Enter' && handleAddParticipant()}
                  />
                  <input
                    className="coaching-overlay__briefing-input coaching-overlay__briefing-input--small"
                    value={newParticipantRole}
                    onChange={e => setNewParticipantRole(e.target.value)}
                    placeholder="Rola (opcjonalnie)"
                    onKeyDown={e => e.key === 'Enter' && handleAddParticipant()}
                  />
                  <input
                    className="coaching-overlay__briefing-input coaching-overlay__briefing-input--small"
                    value={newParticipantCompany}
                    onChange={e => setNewParticipantCompany(e.target.value)}
                    placeholder="Firma (opcjonalnie)"
                    onKeyDown={e => e.key === 'Enter' && handleAddParticipant()}
                  />
                  <input
                    className="coaching-overlay__briefing-input coaching-overlay__briefing-input--small"
                    value={newParticipantNotes}
                    onChange={e => setNewParticipantNotes(e.target.value)}
                    placeholder="Notatki (opcjonalnie)"
                    onKeyDown={e => e.key === 'Enter' && handleAddParticipant()}
                  />
                  <button className="coaching-overlay__btn coaching-overlay__btn--add" onClick={handleAddParticipant}>+ Dodaj</button>
                </div>
              </div>

              {/* Notes */}
              <div className="coaching-overlay__briefing-field">
                <label className="coaching-overlay__briefing-label">📄 Notatki / kontekst</label>
                <textarea
                  className="coaching-overlay__briefing-textarea"
                  value={briefingNotes}
                  onChange={e => { setBriefingNotes(e.target.value); setBriefingSaved(false); }}
                  placeholder="Wolne notatki: co pamiętać, tło rozmowy, kluczowe fakty..."
                  rows={3}
                />
              </div>

              {/* URLs */}
              <div className="coaching-overlay__briefing-field">
                <label className="coaching-overlay__briefing-label">🌐 Strony internetowe (po jednym URL w linii)</label>
                <textarea
                  className="coaching-overlay__briefing-textarea"
                  value={briefingUrls}
                  onChange={e => { setBriefingUrls(e.target.value); setBriefingSaved(false); }}
                  placeholder="https://github.com/org/repo&#10;https://docs.example.com/api"
                  rows={2}
                />
              </div>

              {/* Project paths */}
              <div className="coaching-overlay__briefing-field">
                <label className="coaching-overlay__briefing-label">📁 Ścieżki projektów (lokalne foldery, po jednym w linii)</label>
                <textarea
                  className="coaching-overlay__briefing-textarea"
                  value={briefingProjectPaths}
                  onChange={e => { setBriefingProjectPaths(e.target.value); setBriefingSaved(false); }}
                  placeholder="C:\Projects\my-app&#10;/home/user/repos/backend"
                  rows={2}
                />
              </div>

              {/* Actions */}
              <div className="coaching-overlay__briefing-actions">
                <button
                  className="coaching-overlay__btn coaching-overlay__btn--save"
                  onClick={handleSaveBriefing}
                  disabled={briefingLoading}
                >
                  {briefingLoading ? '⏳ Przetwarzam...' : briefingSaved ? '✅ Zapisany' : '💾 Zapisz briefing'}
                </button>
                {briefingSaved && (
                  <button className="coaching-overlay__btn coaching-overlay__btn--clear" onClick={handleClearBriefing}>
                    🗑️ Wyczyść
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="coaching-overlay__idle-info">
            <p>Rozpocznij nagrywanie aby aktywować real-time coaching.</p>
            {briefingSaved && (
              <p style={{ fontSize: '0.75rem', color: '#4ade80', marginTop: '0.2rem' }}>
                ✅ Briefing załadowany — coach zna kontekst spotkania
              </p>
            )}
            <p style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.3rem' }}>
              Agent automatycznie wykrywa pytania skierowane do Ciebie i natychmiast podpowiada co odpowiedzieć.
            </p>
            <p style={{ marginTop: '0.5rem' }}>
              <button className="coaching-overlay__btn coaching-overlay__btn--link" onClick={handleOpenDashboard}>
                📊 Otwórz dashboard
              </button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────── Helpers ────────────

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}
