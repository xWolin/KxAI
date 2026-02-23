/**
 * MeetingCoachService — Event-driven Real-time Meeting Coach.
 *
 * Architecture:
 * 1. Two audio channels: mic (user = "Ja") + system (others)
 * 2. ElevenLabs Scribe v2 Realtime with VAD commit for instant transcripts
 * 3. Event-driven question detection on each committed_transcript from system channel
 * 4. Streaming AI coaching responses with RAG context injection
 * 5. Speaker mapping via AI context analysis + manual labeling
 * 6. Post-meeting summary with full transcript + speaker map
 *
 * Flow:
 *   system audio → committed_transcript → question detection → RAG search → streaming AI → overlay
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
  autoDetect: boolean;
  coachingEnabled: boolean;
  language: string;
  dashboardPort: number;
  captureSystemAudio: boolean;
  captureMicrophone: boolean;
  // Sensitivity & feature flags
  questionDetectionSensitivity: 'low' | 'medium' | 'high';
  useRAG: boolean;
  streamingCoaching: boolean;
}

export const DEFAULT_MEETING_CONFIG: MeetingConfig = {
  enabled: false,
  autoDetect: true,
  coachingEnabled: true,
  language: 'pl',
  dashboardPort: 5678,
  captureSystemAudio: true,
  captureMicrophone: true,
  questionDetectionSensitivity: 'medium',
  useRAG: true,
  streamingCoaching: true,
};

export interface TranscriptLine {
  timestamp: number;
  speaker: string;
  text: string;
  source: 'mic' | 'system';
}

export interface CoachingTip {
  id: string;
  timestamp: number;
  tip: string;
  category: 'answer' | 'communication' | 'technical' | 'strategy' | 'general';
  isStreaming?: boolean;
  questionText?: string;
}

export interface SpeakerInfo {
  id: string;
  name: string;
  source: 'system';
  utteranceCount: number;
  lastSeen: number;
  isAutoDetected: boolean;
}

export interface MeetingBriefingParticipant {
  name: string;
  role?: string;        // e.g. "Tech Lead", "Product Owner"
  company?: string;
  notes?: string;       // co o nim wiedzieć
}

export interface MeetingBriefing {
  topic: string;
  agenda?: string;
  participants: MeetingBriefingParticipant[];
  notes: string;         // free-form notes / context
  urls: string[];        // URLs to fetch content from
  projectPaths: string[]; // local/remote paths to RAG-index
  // Populated after processing
  urlContents?: Array<{ url: string; content: string; error?: string }>;
  ragIndexed?: boolean;
}

export interface MeetingSummary {
  id: string;
  title: string;
  startTime: number;
  endTime: number;
  duration: number;
  transcript: TranscriptLine[];
  coachingTips: CoachingTip[];
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  participants: string[];
  speakers: SpeakerInfo[];
  detectedApp?: string;
  briefing?: MeetingBriefing;
}

export interface MeetingState {
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

// Question detection patterns (Polish + English)
const QUESTION_PATTERNS = [
  // Polish question words + question mark
  /\b(co|jak|kiedy|gdzie|dlaczego|czemu|czy|ile|kto|jaki|jaka|jakie|który|która|które)\b.*\?/i,
  // Polish question words at start of sentence
  /^(co|jak|kiedy|gdzie|dlaczego|czemu|czy|ile|kto|jaki|jaka|jakie|który|która|które)\s+/i,
  // English question words
  /\b(what|how|when|where|why|who|which|can|could|would|should|do|does|did|is|are|was|were|will|have|has)\b.*\?/i,
  // Direct request patterns (Polish)
  /\b(powiedz|opowiedz|wyjaśnij|wytłumacz|przedstaw|omów|opisz|pokaż)\b/i,
  // Direct request patterns (English)
  /\b(tell|explain|describe|elaborate|show|present)\b/i,
  // Question mark at end
  /\?\s*$/,
  // Polish intonation-based questions (word order implies question)
  /\b(może|prawda|zgadzasz|zgadza|myślisz|uważasz|sądzisz|wiesz|wiecie|pamiętasz|pamiętacie)\b/i,
];

// Patterns suggesting the question is directed at the user
const DIRECTED_PATTERNS = [
  /\b(ty|pan|pani|wy|wasz|twój|twoja|twoje|państwo)\b/i,
  /\b(you|your)\b/i,
  /\b(możesz|mógłbyś|mogłabyś|zrobiłeś|zrobiłaś|myślisz|uważasz|sądzisz|wiesz)\b/i,
  /\b(could you|can you|would you|do you|are you|have you|will you)\b/i,
];

// ──────────────── Service ────────────────

export class MeetingCoachService extends EventEmitter {
  private transcriptionService: TranscriptionService;
  private aiService: AIService;
  private configService: ConfigService;
  private securityService: SecurityService;
  private promptService: PromptService;
  private ragService: any | null = null;

  private config: MeetingConfig;
  private storagePath: string;

  // Active meeting state
  private meetingId: string | null = null;
  private meetingStartTime: number | null = null;
  private transcript: TranscriptLine[] = [];
  private coachingTips: CoachingTip[] = [];
  private speakers: Map<string, SpeakerInfo> = new Map();
  private detectedApp: string | null = null;
  private durationTimer: ReturnType<typeof setInterval> | null = null;
  private elapsedSeconds = 0;

  // Partial transcript buffer
  private partialMic = '';
  private partialSystem = '';

  // Coaching state
  private isCoaching = false;
  private coachingQueue: string[] = [];
  private lastCoachingTime = 0;
  private readonly COACHING_COOLDOWN = 5000; // Min 5s between coaching triggers

  // Transcript context windows
  private recentSystemUtterances: TranscriptLine[] = [];
  private recentMicUtterances: TranscriptLine[] = [];

  // Meeting detection
  private detectionInterval: ReturnType<typeof setInterval> | null = null;

  // Pre-meeting briefing
  private briefing: MeetingBriefing | null = null;

  constructor(
    transcriptionService: TranscriptionService,
    aiService: AIService,
    configService: ConfigService,
    securityService: SecurityService,
    ragService?: any,
  ) {
    super();
    this.transcriptionService = transcriptionService;
    this.aiService = aiService;
    this.configService = configService;
    this.securityService = securityService;
    this.promptService = new PromptService();
    this.ragService = ragService || null;

    const saved = configService.get('meetingCoach') as Partial<MeetingConfig> | undefined;
    this.config = { ...DEFAULT_MEETING_CONFIG, ...saved };

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
    this.speakers = new Map();
    this.detectedApp = detectedApp || null;
    this.elapsedSeconds = 0;
    this.partialMic = '';
    this.partialSystem = '';
    this.isCoaching = false;
    this.coachingQueue = [];
    this.lastCoachingTime = 0;
    this.recentSystemUtterances = [];
    this.recentMicUtterances = [];

    console.log(`[MeetingCoach] Starting meeting ${this.meetingId}: ${title || 'Untitled'}`);

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

    this.emitState();
    this.emit('meeting:started', { meetingId: this.meetingId, title });
    return this.meetingId;
  }

  async stopMeeting(): Promise<MeetingSummary | null> {
    if (!this.meetingId) return null;

    const meetingId = this.meetingId;
    console.log(`[MeetingCoach] Stopping meeting ${meetingId}`);

    if (this.durationTimer) { clearInterval(this.durationTimer); this.durationTimer = null; }

    await this.transcriptionService.stopAll();
    this.emit('meeting:stop-capture');

    const summary = await this.generateSummary(meetingId);

    this.meetingId = null;
    this.meetingStartTime = null;
    this.elapsedSeconds = 0;
    this.partialMic = '';
    this.partialSystem = '';
    this.isCoaching = false;
    this.coachingQueue = [];
    this.speakers = new Map();

    this.emitState();
    this.emit('meeting:stopped', { meetingId, summary });
    return summary;
  }

  sendAudioChunk(source: 'mic' | 'system', chunk: Buffer): void {
    if (!this.meetingId) return;
    const sessionId = `${this.meetingId}-${source}`;
    this.transcriptionService.sendAudioChunk(sessionId, chunk);
  }

  /**
   * Map a speaker to a name (manual labeling from UI).
   */
  mapSpeaker(speakerId: string, name: string): void {
    const existing = this.speakers.get(speakerId);
    if (existing) {
      existing.name = name;
      existing.isAutoDetected = false;
    } else {
      this.speakers.set(speakerId, {
        id: speakerId,
        name,
        source: 'system',
        utteranceCount: 0,
        lastSeen: Date.now(),
        isAutoDetected: false,
      });
    }

    // Update existing transcript lines
    for (const line of this.transcript) {
      if (line.source === 'system' && line.speaker === speakerId) {
        line.speaker = name;
      }
    }
    this.emitState();
  }

  /**
   * Set pre-meeting briefing context.
   * Automatically fetches URL contents and indexes project paths via RAG.
   */
  async setBriefing(briefing: MeetingBriefing): Promise<void> {
    this.briefing = { ...briefing, urlContents: [], ragIndexed: false };

    console.log(`[MeetingCoach] Briefing set: topic="${briefing.topic}", ${briefing.participants.length} participants, ${briefing.urls.length} URLs, ${briefing.projectPaths.length} project paths`);

    // Fetch URL contents in parallel
    if (briefing.urls.length > 0) {
      console.log(`[MeetingCoach] Fetching ${briefing.urls.length} URLs...`);
      const urlResults = await Promise.allSettled(
        briefing.urls.map(url => this.fetchUrlContent(url)),
      );
      this.briefing.urlContents = urlResults.map((result, i) => {
        if (result.status === 'fulfilled') {
          return { url: briefing.urls[i], content: result.value };
        } else {
          console.warn(`[MeetingCoach] Failed to fetch ${briefing.urls[i]}:`, result.reason);
          return { url: briefing.urls[i], content: '', error: String(result.reason) };
        }
      });
      console.log(`[MeetingCoach] Fetched ${this.briefing.urlContents.filter(u => !u.error).length}/${briefing.urls.length} URLs`);
    }

    // Index project paths via RAG
    if (briefing.projectPaths.length > 0 && this.ragService) {
      console.log(`[MeetingCoach] Indexing ${briefing.projectPaths.length} project paths via RAG...`);
      for (const projPath of briefing.projectPaths) {
        try {
          await this.ragService.addFolder(projPath);
        } catch (err) {
          console.warn(`[MeetingCoach] Failed to index ${projPath}:`, err);
        }
      }
      this.briefing.ragIndexed = true;
      console.log('[MeetingCoach] RAG indexing complete');
    }

    this.emit('meeting:briefing-updated', this.getBriefing());
  }

  getBriefing(): MeetingBriefing | null {
    return this.briefing ? { ...this.briefing } : null;
  }

  clearBriefing(): void {
    this.briefing = null;
    this.emit('meeting:briefing-updated', null);
  }

  /**
   * Fetch text content from a URL for briefing context.
   */
  private async fetchUrlContent(url: string): Promise<string> {
    const https = await import('https');
    const http = await import('http');
    const mod = url.startsWith('https') ? https : http;

    return new Promise((resolve, reject) => {
      const req = mod.get(url, { timeout: 10000, headers: { 'User-Agent': 'KxAI-MeetingCoach/1.0' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.fetchUrlContent(res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          // Strip HTML tags for cleaner text
          const text = data
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 5000); // Limit to 5000 chars per URL
          resolve(text);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

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
      speakers: Array.from(this.speakers.values()),
      isCoaching: this.isCoaching,
      hasBriefing: this.briefing !== null,
    };
  }

  getConfig(): MeetingConfig { return { ...this.config }; }

  setConfig(updates: Partial<MeetingConfig>): void {
    this.config = { ...this.config, ...updates };
    this.configService.set('meetingCoach', this.config);
  }

  detectMeeting(windowTitle: string): { detected: boolean; app?: string } {
    for (const { pattern, app } of MEETING_PATTERNS) {
      if (pattern.test(windowTitle)) return { detected: true, app };
    }
    return { detected: false };
  }

  startAutoDetection(getWindowTitle: () => string | null): void {
    if (!this.config.enabled || !this.config.autoDetect) return;
    if (this.detectionInterval) return;

    console.log('[MeetingCoach] Auto-detection started');
    this.detectionInterval = setInterval(async () => {
      if (this.meetingId) return;
      const title = getWindowTitle();
      if (!title) return;
      const { detected, app } = this.detectMeeting(title);
      if (detected) {
        console.log(`[MeetingCoach] Meeting detected: ${app} — "${title}"`);
        this.emit('meeting:detected', { app, title });
      }
    }, 5000);
  }

  stopAutoDetection(): void {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
  }

  async getSummaries(): Promise<Array<{ id: string; title: string; startTime: number; duration: number; participants: string[] }>> {
    try {
      const files = fs.readdirSync(this.storagePath).filter(f => f.endsWith('.json')).sort().reverse();
      const summaries: Array<{ id: string; title: string; startTime: number; duration: number; participants: string[] }> = [];
      for (const file of files.slice(0, 50)) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(this.storagePath, file), 'utf8'));
          summaries.push({ id: data.id, title: data.title, startTime: data.startTime, duration: data.duration, participants: data.participants || [] });
        } catch { /* skip */ }
      }
      return summaries;
    } catch { return []; }
  }

  async getSummary(meetingId: string): Promise<MeetingSummary | null> {
    try {
      const files = fs.readdirSync(this.storagePath).filter(f => f.includes(meetingId));
      if (files.length === 0) return null;
      return JSON.parse(fs.readFileSync(path.join(this.storagePath, files[0]), 'utf8'));
    } catch { return null; }
  }

  isMeetingActive(): boolean { return this.meetingId !== null; }

  getLiveTranscript(lastN: number = 10): TranscriptLine[] {
    return this.transcript.slice(-lastN);
  }

  // ──────────────── Event-Driven Coaching Engine ────────────────

  /**
   * Handle incoming transcript events from TranscriptionService.
   * Core event handler that drives the entire coaching system.
   */
  private onTranscript(event: TranscriptEvent): void {
    if (!this.meetingId) return;

    const source = event.label as 'mic' | 'system';

    if (event.isFinal) {
      const speakerName = this.resolveSpeakerName(source, event.speaker);
      const line: TranscriptLine = {
        timestamp: Date.now(),
        speaker: speakerName,
        text: event.text,
        source,
      };
      this.transcript.push(line);

      // Track in recent utterances window
      if (source === 'system') {
        this.recentSystemUtterances.push(line);
        if (this.recentSystemUtterances.length > 15) this.recentSystemUtterances.shift();
      } else {
        this.recentMicUtterances.push(line);
        if (this.recentMicUtterances.length > 10) this.recentMicUtterances.shift();
      }

      if (source === 'mic') this.partialMic = '';
      else this.partialSystem = '';

      this.emit('meeting:transcript', { line, partial: false });

      if (source === 'system') {
        this.trackSpeaker(event.speaker || 'unknown');
      }

      // ═══════ EVENT-DRIVEN COACHING TRIGGER ═══════
      if (source === 'system' && this.config.coachingEnabled) {
        this.evaluateForCoaching(line);
      }

    } else {
      if (source === 'mic') this.partialMic = event.text;
      else this.partialSystem = event.text;

      this.emit('meeting:transcript', { partial: true, source, text: event.text });
    }
  }

  /**
   * Evaluate a system audio utterance for coaching trigger.
   * Replaces old timer-based approach with instant event-driven detection.
   */
  private async evaluateForCoaching(utterance: TranscriptLine): Promise<void> {
    const now = Date.now();
    if (this.isCoaching || (now - this.lastCoachingTime) < this.COACHING_COOLDOWN) return;

    // Step 1: Fast regex-based question detection
    const isLikelyQuestion = this.detectQuestionFast(utterance.text);
    if (!isLikelyQuestion) return;

    // Step 2: Is the question directed at the user?
    const isDirected = this.isQuestionDirected(utterance.text);

    // Step 3: Apply sensitivity filter
    const sensitivity = this.config.questionDetectionSensitivity;
    const shouldTrigger = sensitivity === 'high'
      ? isLikelyQuestion
      : sensitivity === 'medium'
        ? isLikelyQuestion && (isDirected || this.isConversationContextFavorable())
        : isDirected; // 'low' — only explicit questions directed at user

    if (!shouldTrigger) return;

    console.log(`[MeetingCoach] 🎯 Question detected: "${utterance.text.substring(0, 80)}..."`);
    this.triggerCoaching(utterance.text);
  }

  private detectQuestionFast(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 5) return false;
    for (const pattern of QUESTION_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
    return false;
  }

  private isQuestionDirected(text: string): boolean {
    for (const pattern of DIRECTED_PATTERNS) {
      if (pattern.test(text)) return true;
    }
    return false;
  }

  /**
   * Check if conversation context suggests the next question is for the user.
   * If user was the last speaker or spoke recently, it's more likely the question is for them.
   */
  private isConversationContextFavorable(): boolean {
    if (this.recentMicUtterances.length === 0) return false;
    const lastMicTime = this.recentMicUtterances[this.recentMicUtterances.length - 1].timestamp;
    const lastSystemTime = this.recentSystemUtterances.length > 1
      ? this.recentSystemUtterances[this.recentSystemUtterances.length - 2]?.timestamp || 0
      : 0;

    // If user spoke recently (within last 30s) and was part of the conversation flow
    return (lastMicTime > lastSystemTime - 5000) && (Date.now() - lastMicTime < 30000);
  }

  /**
   * Trigger streaming coaching response.
   */
  private async triggerCoaching(questionText: string): Promise<void> {
    if (this.isCoaching) {
      this.coachingQueue.push(questionText);
      return;
    }

    this.isCoaching = true;
    this.lastCoachingTime = Date.now();
    this.emitState();

    const tipId = uuid();

    try {
      const recentContext = this.buildRecentContext();

      // Get RAG context if enabled
      let ragContext = '';
      if (this.config.useRAG && this.ragService) {
        try {
          ragContext = await this.ragService.buildRAGContext(questionText, 1500);
        } catch (err) {
          console.warn('[MeetingCoach] RAG search failed:', err);
        }
      }

      const coachingPrompt = this.buildCoachingPrompt(questionText, recentContext, ragContext);

      const tip: CoachingTip = {
        id: tipId,
        timestamp: Date.now(),
        tip: '',
        category: 'answer',
        isStreaming: true,
        questionText,
      };
      this.coachingTips.push(tip);

      // Emit "coaching started"
      this.emit('meeting:coaching', { ...tip });

      if (this.config.streamingCoaching) {
        // ═══════ STREAMING COACHING ═══════
        await this.aiService.streamMessage(
          coachingPrompt,
          undefined,
          (chunk: string) => {
            tip.tip += chunk;
            this.emit('meeting:coaching-chunk', {
              id: tipId,
              chunk,
              fullText: tip.tip,
            });
          },
          this.promptService.load('MEETING_COACH.md'),
        );
      } else {
        const response = await this.aiService.sendMessage(coachingPrompt);
        tip.tip = response || '';
      }

      tip.isStreaming = false;
      tip.category = this.categorizeCoachingTip(tip.tip);

      this.emit('meeting:coaching-done', {
        id: tipId,
        tip: tip.tip,
        category: tip.category,
        questionText,
      });

    } catch (err) {
      console.error('[MeetingCoach] Coaching generation error:', err);
      this.emit('meeting:coaching-done', {
        id: tipId,
        tip: '(Nie udało się wygenerować podpowiedzi)',
        category: 'general',
        error: true,
      });
    } finally {
      this.isCoaching = false;
      this.emitState();

      // Process queued questions
      if (this.coachingQueue.length > 0) {
        const nextQuestion = this.coachingQueue.shift()!;
        setTimeout(() => this.triggerCoaching(nextQuestion), 1000);
      }
    }
  }

  private buildRecentContext(): string {
    const last30 = this.transcript.slice(-30);
    if (last30.length === 0) return '(brak wcześniejszej transkrypcji)';
    return last30.map(l => `[${l.speaker}]: ${l.text}`).join('\n');
  }

  private buildCoachingPrompt(questionText: string, recentContext: string, ragContext: string): string {
    const speakerList = Array.from(this.speakers.values())
      .map(s => `- ${s.name} (${s.utteranceCount} wypowiedzi)`)
      .join('\n');

    let prompt = `PYTANIE ZADANE PODCZAS SPOTKANIA:
"${questionText}"

PRZEBIEG ROZMOWY (ostatnie wypowiedzi):
${recentContext}

UCZESTNICY SPOTKANIA:
- Ja (użytkownik)
${speakerList || '- Inni uczestnicy'}
`;

    // ═══════ BRIEFING CONTEXT INJECTION ═══════
    if (this.briefing) {
      prompt += `\n--- PRE-MEETING BRIEFING ---\n`;

      if (this.briefing.topic) {
        prompt += `TEMAT SPOTKANIA: ${this.briefing.topic}\n`;
      }

      if (this.briefing.agenda) {
        prompt += `AGENDA: ${this.briefing.agenda}\n`;
      }

      if (this.briefing.participants.length > 0) {
        prompt += `\nINFORMACJE O UCZESTNIKACH:\n`;
        for (const p of this.briefing.participants) {
          let desc = `- ${p.name}`;
          if (p.role) desc += ` — ${p.role}`;
          if (p.company) desc += ` (${p.company})`;
          if (p.notes) desc += `: ${p.notes}`;
          prompt += desc + '\n';
        }
      }

      if (this.briefing.notes) {
        prompt += `\nNOTATKI PRE-MEETING:\n${this.briefing.notes}\n`;
      }

      if (this.briefing.urlContents && this.briefing.urlContents.length > 0) {
        const validUrls = this.briefing.urlContents.filter(u => u.content && !u.error);
        if (validUrls.length > 0) {
          prompt += `\nKONTEKST ZE STRON INTERNETOWYCH:\n`;
          for (const u of validUrls) {
            // Limit each URL to 1500 chars in prompt to avoid bloat
            const trimmed = u.content.substring(0, 1500);
            prompt += `[${u.url}]: ${trimmed}\n\n`;
          }
        }
      }

      prompt += `--- KONIEC BRIEFINGU ---\n\n`;
    }

    if (ragContext) {
      prompt += `
KONTEKST PROJEKTU (z bazy wiedzy):
${ragContext}
`;
    }

    prompt += `
Wygeneruj DOKŁADNĄ odpowiedź, którą użytkownik może powiedzieć 1:1 naturalnym językiem.
Odpowiedź ma brzmieć naturalnie, jakby to mówił ekspert w rozmowie.
NIE pisz wskazówek ani rad — pisz gotową odpowiedź do powiedzenia.
Bądź rzeczowy i konkretny. Max 3-4 zdania.`;

    return prompt;
  }

  // ──────────────── Speaker Mapping ────────────────

  private resolveSpeakerName(source: 'mic' | 'system', speakerId?: string): string {
    if (source === 'mic') return 'Ja';

    if (!speakerId || speakerId === 'unknown') {
      return this.getDefaultSystemSpeaker();
    }

    const mapped = this.speakers.get(speakerId);
    if (mapped) return mapped.name;

    // Auto-assign numbered name for new speakers
    const speakerNum = this.speakers.size + 1;
    const autoName = `Uczestnik ${speakerNum}`;
    this.speakers.set(speakerId, {
      id: speakerId,
      name: autoName,
      source: 'system',
      utteranceCount: 0,
      lastSeen: Date.now(),
      isAutoDetected: true,
    });
    this.emitState();
    return autoName;
  }

  private getDefaultSystemSpeaker(): string {
    if (this.speakers.size === 0) {
      this.speakers.set('system-default', {
        id: 'system-default',
        name: 'Uczestnik',
        source: 'system',
        utteranceCount: 0,
        lastSeen: Date.now(),
        isAutoDetected: true,
      });
    }
    return 'Uczestnik';
  }

  private trackSpeaker(speakerId: string): void {
    const key = speakerId || 'system-default';
    const speaker = this.speakers.get(key);
    if (speaker) {
      speaker.utteranceCount++;
      speaker.lastSeen = Date.now();
    }
  }

  // ──────────────── Categorization ────────────────

  private categorizeCoachingTip(tip: string): CoachingTip['category'] {
    const lower = tip.toLowerCase();
    if (/komunikacj|słuchaj|pytaj|ton|emocj|empatia|cisza/i.test(lower)) return 'communication';
    if (/techni|kod|system|architektur|implement|bug|dane|api|baz/i.test(lower)) return 'technical';
    if (/strategi|negocjac|cel|priorytet|argument|decyzj|budżet|koszt/i.test(lower)) return 'strategy';
    return 'answer';
  }

  // ──────────────── Summary ────────────────

  private async generateSummary(meetingId: string): Promise<MeetingSummary> {
    const endTime = Date.now();
    const duration = Math.round(this.elapsedSeconds / 60);
    const participants = [...new Set(this.transcript.map(l => l.speaker))];
    const speakersArray = Array.from(this.speakers.values());

    const fullTranscript = this.transcript
      .map(l => `[${new Date(l.timestamp).toLocaleTimeString('pl')}] ${l.speaker}: ${l.text}`)
      .join('\n');

    let aiSummary = '';
    let keyPoints: string[] = [];
    let actionItems: string[] = [];

    if (this.transcript.length >= 5) {
      try {
        const speakerDesc = speakersArray
          .map(s => `- ${s.name}: ${s.utteranceCount} wypowiedzi`)
          .join('\n');

        let briefingContext = '';
        if (this.briefing) {
          briefingContext = `\nBRIEFING PRE-MEETING:\n`;
          if (this.briefing.topic) briefingContext += `Temat: ${this.briefing.topic}\n`;
          if (this.briefing.agenda) briefingContext += `Agenda: ${this.briefing.agenda}\n`;
          if (this.briefing.participants.length > 0) {
            briefingContext += `Uczestnicy: ${this.briefing.participants.map(p => `${p.name}${p.role ? ` (${p.role})` : ''}`).join(', ')}\n`;
          }
          if (this.briefing.notes) briefingContext += `Notatki: ${this.briefing.notes}\n`;
        }

        const prompt = `Wygeneruj profesjonalne podsumowanie spotkania.

UCZESTNICY:
- Ja (użytkownik)
${speakerDesc}
${briefingContext}
TRANSKRYPCJA:
${fullTranscript}

Odpowiedz TYLKO JSON-em bez markdown:
{
  "summary": "Ogólne podsumowanie (2-3 zdania)",
  "keyPoints": ["punkt 1", "punkt 2"],
  "actionItems": ["zadanie 1 (kto: osoba)", "zadanie 2 (kto: osoba)"]
}`;

        const response = await this.aiService.sendMessage(prompt);
        if (response) {
          try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              aiSummary = parsed.summary || '';
              keyPoints = parsed.keyPoints || [];
              actionItems = parsed.actionItems || [];
            }
          } catch { aiSummary = response; }
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
      speakers: speakersArray,
      detectedApp: this.detectedApp || undefined,
      briefing: this.briefing || undefined,
    };

    await this.saveSummary(summary);
    return summary;
  }

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

  private emitState(): void {
    this.emit('meeting:state', this.getState());
  }
}
