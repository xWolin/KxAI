/**
 * MeetingCoachService — Live Meeting Coach with real-time transcription + AI coaching.
 *
 * Orchestrates:
 * - Audio capture (via renderer IPC)
 * - Transcription (ElevenLabs Scribe v2 Realtime)
 * - AI coaching suggestions during meeting
 * - Post-meeting summary generation
 * - Meeting storage and retrieval
 *
 * Meeting detection: auto-detect via window title (Teams, Meet, Zoom)
 * or manual start by user.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { v4 as uuid } from 'uuid';
import { TranscriptionService, TranscriptEvent } from './transcription-service';
import { AIService } from './ai-service';
import { ConfigService } from './config';
import { SecurityService } from './security';
import { PromptService } from './prompt-service';

// ──────────────── Types ────────────────

export interface MeetingConfig {
  enabled: boolean;
  autoDetect: boolean;           // Auto-detect meetings via window title
  coachingEnabled: boolean;      // Send AI coaching suggestions
  coachingIntervalSec: number;   // How often to generate coaching tips (seconds)
  language: string;              // Transcription language (ISO 639-1)
  dashboardPort: number;         // Localhost dashboard port
  captureSystemAudio: boolean;   // Capture system audio (loopback)
  captureMicrophone: boolean;    // Capture microphone
}

export const DEFAULT_MEETING_CONFIG: MeetingConfig = {
  enabled: false,
  autoDetect: true,
  coachingEnabled: true,
  coachingIntervalSec: 60,
  language: 'pl',
  dashboardPort: 5678,
  captureSystemAudio: true,
  captureMicrophone: true,
};

export interface TranscriptLine {
  timestamp: number;
  speaker: string;        // 'Ja' (mic) or speaker ID from system audio
  text: string;
  source: 'mic' | 'system';
}

export interface CoachingTip {
  id: string;
  timestamp: number;
  tip: string;
  category: 'communication' | 'technical' | 'strategy' | 'general';
}

export interface MeetingSummary {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;          // minutes
  transcript: TranscriptLine[];
  coachingTips: CoachingTip[];
  summary: string;           // AI-generated summary
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
  detectedApp?: string;
}

export interface MeetingState {
  active: boolean;
  meetingId: string | null;
  startTime: number | null;
  duration: number;          // seconds elapsed
  transcriptLineCount: number;
  lastCoachingTip: string | null;
  detectedApp: string | null;
}

// Window title patterns for meeting detection
const MEETING_PATTERNS = [
  { pattern: /Microsoft Teams/i, app: 'Microsoft Teams' },
  { pattern: /Teams.*Meeting/i, app: 'Microsoft Teams' },
  { pattern: /Spotkanie.*Teams/i, app: 'Microsoft Teams' },
  { pattern: /meet\.google\.com/i, app: 'Google Meet' },
  { pattern: /Google Meet/i, app: 'Google Meet' },
  { pattern: /Zoom Meeting/i, app: 'Zoom' },
  { pattern: /zoom\.us/i, app: 'Zoom' },
  { pattern: /Spotkanie Zoom/i, app: 'Zoom' },
  { pattern: /Webex/i, app: 'Cisco Webex' },
  { pattern: /Discord.*Voice/i, app: 'Discord' },
  { pattern: /Slack.*Huddle/i, app: 'Slack' },
];

// ──────────────── Service ────────────────

export class MeetingCoachService extends EventEmitter {
  private transcriptionService: TranscriptionService;
  private aiService: AIService;
  private configService: ConfigService;
  private securityService: SecurityService;
  private promptService: PromptService;

  private config: MeetingConfig;
  private storagePath: string;

  // Active meeting state
  private meetingId: string | null = null;
  private meetingStartTime: number | null = null;
  private transcript: TranscriptLine[] = [];
  private coachingTips: CoachingTip[] = [];
  private detectedApp: string | null = null;
  private coachingTimer: ReturnType<typeof setInterval> | null = null;
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private elapsedSeconds = 0;

  // Partial transcript buffer (for display)
  private partialMic = '';
  private partialSystem = '';

  // Meeting detection
  private detectionInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    transcriptionService: TranscriptionService,
    aiService: AIService,
    configService: ConfigService,
    securityService: SecurityService,
  ) {
    super();
    this.transcriptionService = transcriptionService;
    this.aiService = aiService;
    this.configService = configService;
    this.securityService = securityService;
    this.promptService = new PromptService();

    // Load config
    const saved = configService.get('meetingCoach') as Partial<MeetingConfig> | undefined;
    this.config = { ...DEFAULT_MEETING_CONFIG, ...saved };

    // Storage path for meeting summaries
    this.storagePath = path.join(app.getPath('userData'), 'workspace', 'meetings');
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    // Wire transcription events
    this.transcriptionService.on('transcript', this.onTranscript.bind(this));
    this.transcriptionService.on('session:error', (data) => {
      console.error(`[MeetingCoach] Transcription error (${data.label}):`, data.error);
      this.emit('meeting:error', { error: data.error, source: data.label });
    });
  }

  // ──────────────── Public API ────────────────

  /**
   * Start recording a meeting.
   */
  async startMeeting(title?: string, detectedApp?: string): Promise<string> {
    if (this.meetingId) {
      throw new Error('Spotkanie jest już w toku. Najpierw je zakończ.');
    }

    const hasKey = await this.securityService.getApiKey('elevenlabs');
    if (!hasKey) {
      throw new Error('Brak klucza API ElevenLabs. Ustaw go w ustawieniach.');
    }

    this.meetingId = uuid();
    this.meetingStartTime = Date.now();
    this.transcript = [];
    this.coachingTips = [];
    this.detectedApp = detectedApp || null;
    this.elapsedSeconds = 0;
    this.partialMic = '';
    this.partialSystem = '';

    console.log(`[MeetingCoach] Starting meeting ${this.meetingId}: ${title || 'Untitled'}`);

    // Start transcription sessions
    const lang = this.config.language || 'pl';
    try {
      if (this.config.captureMicrophone) {
        await this.transcriptionService.startSession(`${this.meetingId}-mic`, 'mic', lang);
      }
      if (this.config.captureSystemAudio) {
        await this.transcriptionService.startSession(`${this.meetingId}-system`, 'system', lang);
      }
    } catch (err: any) {
      console.error('[MeetingCoach] Failed to start transcription:', err);
      this.meetingId = null;
      this.meetingStartTime = null;
      throw err;
    }

    // Duration timer
    this.durationTimer = setInterval(() => {
      this.elapsedSeconds++;
      this.emit('meeting:tick', { seconds: this.elapsedSeconds });
    }, 1000);

    // Coaching timer
    if (this.config.coachingEnabled) {
      this.coachingTimer = setInterval(() => {
        this.generateCoachingTip().catch(err => {
          console.error('[MeetingCoach] Coaching error:', err);
        });
      }, this.config.coachingIntervalSec * 1000);
    }

    this.emitState();
    this.emit('meeting:started', { meetingId: this.meetingId, title });

    return this.meetingId;
  }

  /**
   * Stop the current meeting and generate summary.
   */
  async stopMeeting(): Promise<MeetingSummary | null> {
    if (!this.meetingId) return null;

    const meetingId = this.meetingId;
    console.log(`[MeetingCoach] Stopping meeting ${meetingId}`);

    // Stop timers
    if (this.coachingTimer) { clearInterval(this.coachingTimer); this.coachingTimer = null; }
    if (this.durationTimer) { clearInterval(this.durationTimer); this.durationTimer = null; }

    // Stop transcription
    await this.transcriptionService.stopAll();

    // Notify renderer to stop audio capture
    this.emit('meeting:stop-capture');

    // Generate summary
    const summary = await this.generateSummary(meetingId);

    // Reset state
    this.meetingId = null;
    this.meetingStartTime = null;
    this.elapsedSeconds = 0;
    this.partialMic = '';
    this.partialSystem = '';

    this.emitState();
    this.emit('meeting:stopped', { meetingId, summary });

    return summary;
  }

  /**
   * Send audio chunk from renderer to transcription.
   */
  sendAudioChunk(source: 'mic' | 'system', chunk: Buffer): void {
    if (!this.meetingId) return;
    const sessionId = `${this.meetingId}-${source}`;
    this.transcriptionService.sendAudioChunk(sessionId, chunk);
  }

  /**
   * Get current meeting state.
   */
  getState(): MeetingState {
    return {
      active: this.meetingId !== null,
      meetingId: this.meetingId,
      startTime: this.meetingStartTime,
      duration: this.elapsedSeconds,
      transcriptLineCount: this.transcript.length,
      lastCoachingTip: this.coachingTips.length > 0
        ? this.coachingTips[this.coachingTips.length - 1].tip
        : null,
      detectedApp: this.detectedApp,
    };
  }

  /**
   * Get current config.
   */
  getConfig(): MeetingConfig {
    return { ...this.config };
  }

  /**
   * Update config.
   */
  setConfig(updates: Partial<MeetingConfig>): void {
    this.config = { ...this.config, ...updates };
    this.configService.set('meetingCoach', this.config);
  }

  /**
   * Check if a window title indicates a meeting.
   */
  detectMeeting(windowTitle: string): { detected: boolean; app?: string } {
    for (const { pattern, app } of MEETING_PATTERNS) {
      if (pattern.test(windowTitle)) {
        return { detected: true, app };
      }
    }
    return { detected: false };
  }

  /**
   * Start auto-detection of meetings.
   * Call this when proactive mode is active.
   */
  startAutoDetection(getWindowTitle: () => string | null): void {
    if (!this.config.enabled || !this.config.autoDetect) return;
    if (this.detectionInterval) return;

    console.log('[MeetingCoach] Auto-detection started');
    this.detectionInterval = setInterval(async () => {
      if (this.meetingId) return; // already in a meeting

      const title = getWindowTitle();
      if (!title) return;

      const { detected, app } = this.detectMeeting(title);
      if (detected) {
        console.log(`[MeetingCoach] Meeting detected: ${app} — "${title}"`);
        this.emit('meeting:detected', { app, title });
        // Don't auto-start — let user confirm or use manual start
      }
    }, 5000);
  }

  /**
   * Stop auto-detection.
   */
  stopAutoDetection(): void {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
  }

  /**
   * Get all stored meeting summaries (metadata only).
   */
  async getSummaries(): Promise<Array<{ id: string; title: string; startTime: number; duration: number; participants: string[] }>> {
    try {
      const files = fs.readdirSync(this.storagePath)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      const summaries: Array<{ id: string; title: string; startTime: number; duration: number; participants: string[] }> = [];

      for (const file of files.slice(0, 50)) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(this.storagePath, file), 'utf8'));
          summaries.push({
            id: data.id,
            title: data.title,
            startTime: data.startTime,
            duration: data.duration,
            participants: data.participants || [],
          });
        } catch { /* skip corrupt files */ }
      }

      return summaries;
    } catch {
      return [];
    }
  }

  /**
   * Get a specific meeting summary by ID.
   */
  async getSummary(meetingId: string): Promise<MeetingSummary | null> {
    try {
      const files = fs.readdirSync(this.storagePath)
        .filter(f => f.includes(meetingId));

      if (files.length === 0) return null;

      const data = JSON.parse(fs.readFileSync(path.join(this.storagePath, files[0]), 'utf8'));
      return data as MeetingSummary;
    } catch {
      return null;
    }
  }

  /**
   * Is a meeting currently active?
   */
  isMeetingActive(): boolean {
    return this.meetingId !== null;
  }

  /**
   * Get current live transcript (for overlay).
   */
  getLiveTranscript(lastN: number = 10): TranscriptLine[] {
    return this.transcript.slice(-lastN);
  }

  // ──────────────── Internal ────────────────

  /**
   * Handle incoming transcript events from TranscriptionService.
   */
  private onTranscript(event: TranscriptEvent): void {
    if (!this.meetingId) return;

    const source = event.label as 'mic' | 'system';

    if (event.isFinal) {
      const line: TranscriptLine = {
        timestamp: Date.now(),
        speaker: source === 'mic' ? 'Ja' : (event.speaker || 'Uczestnik'),
        text: event.text,
        source,
      };
      this.transcript.push(line);

      // Clear partial for this source
      if (source === 'mic') this.partialMic = '';
      else this.partialSystem = '';

      this.emit('meeting:transcript', { line, partial: false });
    } else {
      // Update partial
      if (source === 'mic') this.partialMic = event.text;
      else this.partialSystem = event.text;

      this.emit('meeting:transcript', {
        partial: true,
        source,
        text: event.text,
      });
    }
  }

  /**
   * Generate a coaching tip based on recent transcript.
   */
  private async generateCoachingTip(): Promise<void> {
    if (!this.meetingId || this.transcript.length < 3) return;

    // Get last 20 transcript lines for context
    const recentLines = this.transcript.slice(-20);
    const transcriptText = recentLines
      .map(l => `[${l.speaker}]: ${l.text}`)
      .join('\n');

    const coachingRules = this.promptService.load('MEETING_COACH.md');
    const prompt = `${coachingRules}

Transkrypcja (ostatnie wypowiedzi):
${transcriptText}

Daj JEDNĄ krótką wskazówkę (max 2 zdania) dla osoby oznaczonej jako "Ja". 
Wskazówka może dotyczyć: komunikacji, strategii rozmowy, technik negocjacji, lub merytoryki.
Jeśli nie ma nic do zasugerowania, odpowiedz "SKIP".
Odpowiedz TYLKO wskazówką, bez wstępu.`;

    try {
      const response = await this.aiService.sendMessage(prompt);
      if (response && !response.includes('SKIP')) {
        const tip: CoachingTip = {
          id: uuid(),
          timestamp: Date.now(),
          tip: response.trim(),
          category: this.categorizeCoachingTip(response),
        };
        this.coachingTips.push(tip);
        this.emit('meeting:coaching', tip);
      }
    } catch (err) {
      console.error('[MeetingCoach] Coaching generation error:', err);
    }
  }

  /**
   * Categorize a coaching tip.
   */
  private categorizeCoachingTip(tip: string): CoachingTip['category'] {
    const lower = tip.toLowerCase();
    if (/komunikacj|słuchaj|pytaj|ton|emocj|empatia|cisza/i.test(lower)) return 'communication';
    if (/techni|kod|system|architektur|implement|bug|dane/i.test(lower)) return 'technical';
    if (/strategi|negocjac|cel|priorytet|argument|decyzj/i.test(lower)) return 'strategy';
    return 'general';
  }

  /**
   * Generate full meeting summary after meeting ends.
   */
  private async generateSummary(meetingId: string): Promise<MeetingSummary> {
    const endTime = Date.now();
    const duration = Math.round(this.elapsedSeconds / 60);

    // Collect unique participants
    const participants = [...new Set(this.transcript.map(l => l.speaker))];

    // Build full transcript text
    const fullTranscript = this.transcript
      .map(l => `[${new Date(l.timestamp).toLocaleTimeString('pl')}] ${l.speaker}: ${l.text}`)
      .join('\n');

    let aiSummary = '';
    let keyPoints: string[] = [];
    let actionItems: string[] = [];

    // Generate AI summary if transcript is long enough
    if (this.transcript.length >= 5) {
      try {
        const prompt = `Wygeneruj profesjonalne podsumowanie spotkania na podstawie transkrypcji.

TRANSKRYPCJA:
${fullTranscript}

${this.promptService.load('MEETING_COACH.md')}

Odpowiedz TYLKO JSON-em, bez markdown.`;

        const response = await this.aiService.sendMessage(prompt);
        if (response) {
          try {
            // Try to parse JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              aiSummary = parsed.summary || '';
              keyPoints = parsed.keyPoints || [];
              actionItems = parsed.actionItems || [];
            }
          } catch {
            // If JSON parsing fails, use raw response as summary
            aiSummary = response;
          }
        }
      } catch (err) {
        console.error('[MeetingCoach] Summary generation error:', err);
        aiSummary = 'Nie udało się wygenerować podsumowania.';
      }
    } else {
      aiSummary = 'Spotkanie zbyt krótkie na wygenerowanie podsumowania.';
    }

    const summary: MeetingSummary = {
      id: meetingId,
      title: this.detectedApp
        ? `Spotkanie ${this.detectedApp} — ${new Date(this.meetingStartTime!).toLocaleDateString('pl')}`
        : `Spotkanie — ${new Date(this.meetingStartTime!).toLocaleDateString('pl')}`,
      startTime: this.meetingStartTime!,
      endTime,
      duration,
      transcript: [...this.transcript],
      coachingTips: [...this.coachingTips],
      summary: aiSummary,
      keyPoints,
      actionItems,
      participants,
      detectedApp: this.detectedApp || undefined,
    };

    // Save to disk
    await this.saveSummary(summary);

    return summary;
  }

  /**
   * Save meeting summary to disk.
   */
  private async saveSummary(summary: MeetingSummary): Promise<void> {
    try {
      const dateStr = new Date(summary.startTime).toISOString().slice(0, 10);
      const timeStr = new Date(summary.startTime).toLocaleTimeString('pl').replace(/:/g, '-');
      const fileName = `${dateStr}_${timeStr}_${summary.id}.json`;
      const filePath = path.join(this.storagePath, fileName);

      fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf8');
      console.log(`[MeetingCoach] Summary saved: ${fileName}`);
    } catch (err) {
      console.error('[MeetingCoach] Failed to save summary:', err);
    }
  }

  /**
   * Emit current meeting state to renderer.
   */
  private emitState(): void {
    this.emit('meeting:state', this.getState());
  }
}
