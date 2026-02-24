/**
 * MeetingCoachService — Event-driven Real-time Meeting Coach.
 *
 * Architecture:
 * 1. Two audio channels: mic (user = "Ja") + system (others)
 * 2. Deepgram Nova-3 Realtime with diarization for instant transcripts with speaker IDs
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
import { ScreenCaptureService } from './screen-capture';

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
  photoBase64?: string; // zdjęcie uczestnika (base64 jpg/png)
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

/** Result of OSINT research on a meeting participant */
export interface ParticipantResearch {
  name: string;
  company?: string;
  role?: string;
  summary: string;          // executive summary
  experience: string[];     // career highlights
  interests: string[];      // topics, projects, passions
  socialMedia: Array<{ platform: string; url: string; snippet?: string }>;
  commonGround: string[];   // shared interests with user
  talkingPoints: string[];  // icebreakers, topics to discuss
  cautions: string[];       // things to avoid
  sources: string[];        // URLs used for research
  photoDescription?: string;
  researchedAt: number;     // timestamp
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
  sentiment?: string;
  diarized?: boolean;
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
  private screenCapture: ScreenCaptureService | null = null;

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
  private isStopping = false;
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

  // Screen-based speaker identification
  private lastScreenIdentifyTime = 0;
  private readonly SCREEN_IDENTIFY_COOLDOWN = 8000; // Min 8s between screen captures for speaker ID
  private pendingScreenIdentify = false;



  constructor(
    transcriptionService: TranscriptionService,
    aiService: AIService,
    configService: ConfigService,
    securityService: SecurityService,
    ragService?: any,
    screenCapture?: ScreenCaptureService,
  ) {
    super();
    this.transcriptionService = transcriptionService;
    this.aiService = aiService;
    this.configService = configService;
    this.securityService = securityService;
    this.promptService = new PromptService();
    this.ragService = ragService || null;
    this.screenCapture = screenCapture || null;

    const saved = configService.get('meetingCoach') as Partial<MeetingConfig> | undefined;
    this.config = { ...DEFAULT_MEETING_CONFIG, ...saved };

    this.storagePath = path.join(app.getPath('userData'), 'workspace', 'meetings');
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    // Wire transcription events
    this.transcriptionService.on('transcript', this.onTranscript.bind(this));
    this.transcriptionService.on('session:error', (data) => {
      // Suppress errors during shutdown
      if (this.isStopping) {
        console.log(`[MeetingCoach] Suppressed transcription error during shutdown (${data.label}):`, data.error);
        return;
      }
      console.error(`[MeetingCoach] Transcription error (${data.label}):`, data.error);
      this.emit('meeting:error', { error: data.error, source: data.label });
    });
  }

  // ──────────────── Public API ────────────────

  async startMeeting(title?: string, detectedApp?: string): Promise<string> {
    if (this.meetingId) {
      throw new Error('Spotkanie jest już w toku. Najpierw je zakończ.');
    }

    const hasKey = await this.securityService.getApiKey('deepgram');
    if (!hasKey) {
      throw new Error('Brak klucza API Deepgram. Ustaw go w ustawieniach.');
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
    this.isStopping = true;

    if (this.durationTimer) { clearInterval(this.durationTimer); this.durationTimer = null; }

    // Signal renderer to stop audio capture BEFORE closing transcription sessions
    this.emit('meeting:stop-capture');

    // Give renderer ~200ms to actually stop sending chunks
    await new Promise(r => setTimeout(r, 200));

    await this.transcriptionService.stopAll();

    const summary = await this.generateSummary(meetingId);

    this.meetingId = null;
    this.meetingStartTime = null;
    this.elapsedSeconds = 0;
    this.partialMic = '';
    this.partialSystem = '';
    this.isCoaching = false;
    this.isStopping = false;
    this.coachingQueue = [];
    this.speakers = new Map();
    this.recentSystemUtterances = [];
    this.recentMicUtterances = [];
    this.audioChunkCount = 0;

    this.emitState();
    this.emit('meeting:stopped', { meetingId, summary });
    return summary;
  }

  private audioChunkCount = 0;
  private lastAudioLog = 0;

  sendAudioChunk(source: 'mic' | 'system', chunk: Buffer): void {
    if (!this.meetingId) {
      if (this.audioChunkCount === 0) console.warn('[MeetingCoach] sendAudioChunk called but no active meeting');
      return;
    }
    this.audioChunkCount++;

    // Log every 10 seconds
    const now = Date.now();
    if (now - this.lastAudioLog > 10000) {
      this.lastAudioLog = now;
      console.log(`[MeetingCoach] Audio: ${this.audioChunkCount} chunks received (source=${source}, size=${chunk.length}bytes)`);
    }

    const sessionId = `${this.meetingId}-${source}`;
    this.transcriptionService.sendAudioChunk(sessionId, chunk);
  }

  /**
   * Map a speaker to a name (manual labeling from UI).
   */
  mapSpeaker(speakerId: string, name: string): void {
    const existing = this.speakers.get(speakerId);
    const oldName = existing?.name;
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

    // Update existing transcript lines — compare against old resolved name or raw speakerId
    for (const line of this.transcript) {
      if (line.source === 'system' && (line.speaker === speakerId || (oldName && line.speaker === oldName))) {
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
   * Only http/https schemes are allowed. Follows up to maxRedirects redirects
   * and enforces a cumulative deadline across all redirects.
   */
  private async fetchUrlContent(
    url: string,
    options?: { maxRedirects?: number; deadline?: number },
  ): Promise<string> {
    const MAX_REDIRECTS = options?.maxRedirects ?? 5;
    const deadline = options?.deadline ?? Date.now() + 10000; // 10s total

    // Validate scheme
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`fetchUrlContent: invalid URL "${url}"`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`fetchUrlContent: unsupported scheme "${parsed.protocol}" — only http/https allowed`);
    }

    // SSRF protection: block private/internal addresses
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const blockedPatterns = [
      /^localhost$/i, /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./, /^0\./, /^::1$/, /^::$/, /^0+:0+:0+:0+:0+:0+:0+:[01]$/,
      /^f[cd][0-9a-f]{2}:/i, /^fe[89ab][0-9a-f]:/i,
      /\.local$/i, /\.internal$/i, /\.localhost$/i, /^169\.254\./,
    ];
    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        throw new Error(`fetchUrlContent: blocked internal address (SSRF protection)`);
      }
    }

    if (MAX_REDIRECTS < 0) {
      throw new Error('fetchUrlContent: too many redirects');
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('fetchUrlContent: overall timeout exceeded');
    }

    const https = await import('https');
    const http = await import('http');
    const mod = parsed.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = mod.get(url, { timeout: Math.min(remaining, 10000), headers: { 'User-Agent': 'KxAI-MeetingCoach/1.0' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          this.fetchUrlContent(res.headers.location, {
            maxRedirects: MAX_REDIRECTS - 1,
            deadline,
          }).then(resolve).catch(reject);
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
      req.on('timeout', () => { req.destroy(); reject(new Error('fetchUrlContent: request timeout')); });
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
    console.log(`[MeetingCoach] Transcript event: source=${source}, isFinal=${event.isFinal}, text="${event.text.substring(0, 80)}", speaker=${event.speaker || 'none'}`);

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
   * Hybrid approach: fast regex pre-filter → AI classification for accuracy.
   */
  private async evaluateForCoaching(utterance: TranscriptLine): Promise<void> {
    const now = Date.now();
    if (this.isCoaching || (now - this.lastCoachingTime) < this.COACHING_COOLDOWN) return;

    const text = utterance.text.trim();
    if (text.length < 8) return; // Too short to be meaningful

    // Step 1: Fast regex pre-filter — cheaply eliminates obvious non-questions
    const regexMatch = this.detectQuestionFast(text);
    const isDirected = this.isQuestionDirected(text);

    // Step 2: AI classification for utterances that pass regex OR are long enough
    // This catches questions without "?" and rhetorical patterns regex misses
    const sensitivity = this.config.questionDetectionSensitivity;
    let shouldTrigger = false;

    if (regexMatch || text.length > 20) {
      // Use fast AI classification (tiny prompt, ~50 tokens response)
      const aiResult = await this.classifyWithAI(text, isDirected);

      if (aiResult === 'direct_question') {
        shouldTrigger = true;
      } else if (aiResult === 'indirect_question') {
        shouldTrigger = sensitivity !== 'low';
      } else if (aiResult === 'request') {
        shouldTrigger = sensitivity === 'high' || (sensitivity === 'medium' && isDirected);
      } else if (regexMatch && isDirected) {
        // AI said no, but regex + directed = still trigger on high
        shouldTrigger = sensitivity === 'high';
      }

      // Context boost: if user spoke recently, lower the threshold
      if (!shouldTrigger && aiResult !== 'statement' && this.isConversationContextFavorable()) {
        shouldTrigger = sensitivity !== 'low';
      }
    }

    if (!shouldTrigger) return;

    console.log(`[MeetingCoach] 🎯 Question detected: "${text.substring(0, 80)}..."`);
    this.triggerCoaching(text);
  }

  /**
   * Fast AI classification of utterance type.
   * Uses minimal prompt for speed (~200ms with GPT-4o-mini / Haiku).
   */
  private async classifyWithAI(text: string, isDirected: boolean): Promise<'direct_question' | 'indirect_question' | 'request' | 'statement'> {
    try {
      const prompt = `Classify this meeting utterance. Reply with ONLY one word: direct_question, indirect_question, request, or statement.

"${text.substring(0, 200)}"`;

      const response = await this.aiService.sendMessage(
        prompt, undefined, undefined, { skipHistory: true }
      );
      if (!response) return 'statement';

      const lower = response.trim().toLowerCase().replace(/[^a-z_]/g, '');
      if (lower.includes('direct_question')) return 'direct_question';
      if (lower.includes('indirect_question')) return 'indirect_question';
      if (lower.includes('request')) return 'request';
      return 'statement';
    } catch (err) {
      // If AI fails, fall back to regex result
      console.warn('[MeetingCoach] AI classification failed, using regex fallback:', err);
      return isDirected ? 'direct_question' : 'statement';
    }
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

    // Trigger async screen-based identification for new speakers
    this.tryScreenIdentify(speakerId);

    return autoName;
  }

  /**
   * Try to identify the current speaker by capturing a screenshot of the meeting app.
   * In Teams/Meet/Zoom the active speaker's tile has a highlighted border.
   * AI vision reads the name label from the highlighted tile.
   */
  private async tryScreenIdentify(speakerId: string): Promise<void> {
    if (!this.screenCapture) return;
    if (this.pendingScreenIdentify) return;

    const now = Date.now();
    if (now - this.lastScreenIdentifyTime < this.SCREEN_IDENTIFY_COOLDOWN) return;

    this.pendingScreenIdentify = true;
    this.lastScreenIdentifyTime = now;

    try {
      // Small delay to let the speaking indicator appear on screen
      await new Promise(r => setTimeout(r, 500));

      const screenshot = await this.screenCapture.captureFast();
      if (!screenshot) {
        console.warn('[MeetingCoach] Screen capture failed for speaker identification');
        return;
      }

      const base64Data = screenshot.base64.replace(/^data:image\/\w+;base64,/, '');

      // Build list of known participants from briefing
      let participantHint = '';
      if (this.briefing?.participants.length) {
        participantHint = `\nOczekiwani uczestnicy spotkania: ${this.briefing.participants.map(p => p.name).join(', ')}`;
      }

      const prompt = `Przeanalizuj zrzut ekranu z aplikacji do spotkań wideo (Microsoft Teams, Google Meet, Zoom, Discord itp.).

Szukam osoby, która AKTUALNIE MÓWI — jej kafelek/okienko powinno mieć podświetloną/kolorową obramówkę (zwykle niebieską, zieloną lub fioletową).

Przeczytaj IMIĘ I NAZWISKO osoby, której kafelek jest podświetlony (aktywnie mówi).
${participantHint}

Jeśli nie widzisz aplikacji do spotkań lub nie możesz odczytać nazwy mówcy, zwróć: {"speaker": null, "reason": "..."}
Jeśli widzisz mówcę, zwróć: {"speaker": "Imię Nazwisko", "confidence": "high"|"medium"|"low", "app": "Teams"|"Meet"|"Zoom"|"inne"}

Odpowiedz TYLKO JSON-em, bez markdown.`;

      const response = await this.aiService.sendVisionMessage(
        prompt,
        [{ base64Data: base64Data, mediaType: 'image/png' }],
      );

      if (response) {
        try {
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            if (result.speaker && result.confidence !== 'low') {
              console.log(`[MeetingCoach] 🎯 Screen identified speaker "${result.speaker}" (confidence: ${result.confidence}, app: ${result.app})`);

              // Map the speaker
              const speaker = this.speakers.get(speakerId);
              if (speaker && speaker.isAutoDetected) {
                const originalAutoName = speaker.name;
                speaker.name = result.speaker;
                speaker.isAutoDetected = false;

                // Also update recent transcript lines from this speaker
                // Only update lines created since the screen identify was triggered
                const identifyStart = this.lastScreenIdentifyTime || Date.now();
                for (const line of this.transcript) {
                  if (line.source === 'system' && line.speaker === originalAutoName) {
                    if (line.timestamp >= identifyStart - 10000) {
                      line.speaker = result.speaker;
                    }
                  }
                }

                // Detect app if not already set
                if (!this.detectedApp && result.app) {
                  this.detectedApp = result.app;
                }

                this.emitState();
                this.emit('meeting:speaker-identified', {
                  speakerId,
                  name: result.speaker,
                  confidence: result.confidence,
                  app: result.app,
                });

                console.log(`[MeetingCoach] Speaker ${speakerId} → "${result.speaker}" (via screen)`);
              }
            } else {
              console.log(`[MeetingCoach] Screen identify: no speaker found — ${result.reason || 'unknown'}`);
            }
          }
        } catch (parseErr) {
          console.warn('[MeetingCoach] Failed to parse screen identify response:', parseErr);
        }
      }
    } catch (err) {
      console.warn('[MeetingCoach] Screen-based speaker identification error:', err);
    } finally {
      this.pendingScreenIdentify = false;
    }
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

    // Truncate transcript to avoid exceeding token limits (~50k chars ≈ 12k tokens)
    const MAX_TRANSCRIPT_CHARS = 50000;
    const truncatedTranscript = fullTranscript.length > MAX_TRANSCRIPT_CHARS
      ? fullTranscript.slice(-MAX_TRANSCRIPT_CHARS) + '\n\n[...wcześniejsza część transkrypcji pominięta ze względu na długość]'
      : fullTranscript;

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
${truncatedTranscript}

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
      diarized: true,  // Deepgram Nova-3 provides real-time diarization
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

  // ──────────────── Batch Diarization ────────────────

  /**
   * Build a WAV file from raw PCM 16-bit 16kHz mono chunks.
   * Mixes system + mic channels into a single mono stream.
   */
  /**
   * Format Deepgram speaker ID (e.g. "0", "1") into readable label.
   */
  private formatSpeakerId(speakerId: string): string {
    if (!speakerId || speakerId === 'unknown') return 'Uczestnik';
    const num = parseInt(speakerId, 10);
    if (!isNaN(num)) {
      return `Mówca ${num + 1}`;
    }
    return speakerId;
  }

  // ──────────────── Meeting Prep — Participant Research (OSINT) ────────────────

  /**
   * Research a meeting participant using web search + AI analysis.
   * Searches multiple sources (LinkedIn, Twitter, company sites, etc.)
   * and synthesizes findings into a structured profile.
   * 
   * @param participant - Participant info (name, company, role, optional photo)
   * @param userContext - Optional context about the user for finding common ground
   * @param onProgress - Optional callback for progress updates
   */
  async researchParticipant(
    participant: MeetingBriefingParticipant,
    userContext?: string,
    onProgress?: (status: string) => void,
  ): Promise<ParticipantResearch> {
    const { name, company, role, photoBase64 } = participant;
    console.log(`[MeetingCoach] Researching participant: ${name} (${company || 'unknown company'})`);

    onProgress?.(`Szukam informacji o ${name}...`);

    // Step 1: Generate search queries
    const searchQueries = [
      `${name}${company ? ' ' + company : ''}`,
      `${name} LinkedIn`,
      `${name}${company ? ' ' + company : ''} site:linkedin.com`,
      `${name}${role ? ' ' + role : ''} interview OR article OR presentation`,
    ];
    if (company) {
      searchQueries.push(`${company} ${role || 'team'}`);
    }

    // Step 2: Search the web for each query
    const allSearchResults: Array<{ title: string; text: string; url: string }> = [];
    const https = require('https');

    for (const query of searchQueries) {
      try {
        onProgress?.(`Wyszukuję: "${query}"`);

        // Use DuckDuckGo HTML search endpoint for actual web results
        const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const htmlData = await new Promise<string>((resolve, reject) => {
          const req = https.get(htmlUrl, { headers: { 'User-Agent': 'KxAI-MeetingCoach/1.0' } }, (res: any) => {
            let body = '';
            res.on('data', (chunk: string) => body += chunk);
            res.on('end', () => resolve(body));
            res.on('error', reject);
          });
          req.on('error', reject);
          req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        });

        // Parse HTML result blocks
        const resultBlocks = htmlData.match(/<a[^>]+class="result__a"[^>]*>[\s\S]*?<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>[\s\S]*?<\/a>/g) || [];
        for (const block of resultBlocks.slice(0, 5)) {
          const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/);
          const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
          const urlMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/);
          if (titleMatch && snippetMatch) {
            const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
            const text = snippetMatch[1].replace(/<[^>]+>/g, '').trim();
            const resultUrl = urlMatch ? decodeURIComponent(urlMatch[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, '').split('&')[0]) : '';
            if (title && text) allSearchResults.push({ title: title.slice(0, 100), text, url: resultUrl });
          }
        }

        // Fallback: try Instant Answer API for abstract/summary
        if (allSearchResults.length === 0) {
          const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
          const iaData = await new Promise<string>((resolve, reject) => {
            const req = https.get(iaUrl, (res: any) => {
              let body = '';
              res.on('data', (chunk: string) => body += chunk);
              res.on('end', () => resolve(body));
              res.on('error', reject);
            });
            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
          });
          const json = JSON.parse(iaData);
          if (json.AbstractText) {
            allSearchResults.push({ title: 'Summary', text: json.AbstractText, url: json.AbstractURL });
          }
          if (json.RelatedTopics) {
            for (const t of json.RelatedTopics.slice(0, 5)) {
              if (t.Text && t.FirstURL) {
                allSearchResults.push({ title: t.Text.slice(0, 100), text: t.Text, url: t.FirstURL });
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[MeetingCoach] Search failed for "${query}":`, err);
      }
    }

    // Step 3: Fetch content from the most promising URLs
    const uniqueUrls = [...new Set(allSearchResults.filter(r => r.url).map(r => r.url))].slice(0, 6);
    const fetchedContent: Array<{ url: string; content: string }> = [];

    for (const fetchUrl of uniqueUrls) {
      try {
        onProgress?.(`Czytam: ${fetchUrl.slice(0, 60)}...`);
        const content = await this.fetchUrlContent(fetchUrl);
        if (content && content.length > 50) {
          fetchedContent.push({ url: fetchUrl, content: content.slice(0, 3000) });
        }
      } catch {
        // Skip failed fetches
      }
    }

    // Step 4: Describe photo if provided
    let photoDescription = '';
    if (photoBase64) {
      try {
        onProgress?.('Analizuję zdjęcie...');
        const photoPrompt = `Opisz tę osobę na zdjęciu krótko (wygląd, przybliżony wiek, styl). To ${name}${company ? ' z ' + company : ''}.`;
        const photoDataUrl = photoBase64.startsWith('data:') ? photoBase64 : `data:image/jpeg;base64,${photoBase64}`;
        photoDescription = await this.aiService.sendMessageWithVision(
          photoPrompt,
          photoDataUrl,
          'Jesteś asystentem opisującym osoby na zdjęciach. Bądź zwięzły i profesjonalny.',
        ) || '';
      } catch (err) {
        console.warn('[MeetingCoach] Photo analysis failed:', err);
      }
    }

    // Step 5: AI synthesis — compile all data into structured profile
    onProgress?.('AI analizuje zebrane informacje...');

    const searchContext = allSearchResults.map(r => `[${r.title}] ${r.text} (${r.url})`).join('\n\n');
    const fetchedContext = fetchedContent.map(f => `=== ${f.url} ===\n${f.content}`).join('\n\n');
    const photoCtx = photoDescription ? `\nOpis ze zdjęcia: ${photoDescription}` : '';

    const synthesisPrompt = `Jesteś ekspertem od researchu osób. Na podstawie zebranych danych, stwórz szczegółowy profil osoby.

OSOBA: ${name}
${company ? `FIRMA: ${company}` : ''}
${role ? `ROLA: ${role}` : ''}
${photoCtx}

WYNIKI WYSZUKIWANIA:
${searchContext || '(brak wyników wyszukiwania)'}

TREŚĆ STRON:
${fetchedContext || '(brak pobranej treści)'}

${userContext ? `KONTEKST UŻYTKOWNIKA (do znalezienia wspólnych punktów):\n${userContext}` : ''}

Odpowiedz WYŁĄCZNIE poprawnym JSON (bez markdown code blocks):
{
  "summary": "2-3 zdania kim jest ta osoba i co jest najważniejsze",
  "experience": ["stanowisko 1 - firma - lata", "stanowisko 2"],
  "interests": ["zainteresowanie 1", "temat 2"],
  "socialMedia": [{"platform": "LinkedIn", "url": "https://...", "snippet": "opis profilu"}],
  "commonGround": ["wspólny punkt 1", "temat do rozmowy 2"],
  "talkingPoints": ["icebreaker 1", "pytanie 2", "temat 3"],
  "cautions": ["unikać tematu X", "wrażliwa kwestia Y"]
}

Jeśli nie masz wystarczających danych o danym polu, użyj pustej tablicy [].
Pisz po polsku.`;

    try {
      const aiResponse = await this.aiService.sendMessage(
        synthesisPrompt,
        undefined,
        'Jesteś ekspertem od researchu osób (OSINT). Odpowiadasz WYŁĄCZNIE poprawnym JSON bez markdown code blocks.',
        { skipHistory: true },
      );

      // Parse AI response
      let parsed: any;
      try {
        // Strip markdown code blocks if AI wrapped response
        const raw = aiResponse ?? '';
        const cleaned = raw
          .replace(/```json\s*\n?/gi, '')
          .replace(/```\s*$/gm, '')
          .trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.warn('[MeetingCoach] Failed to parse AI research response, using raw text');
        parsed = {
          summary: aiResponse.slice(0, 500),
          experience: [],
          interests: [],
          socialMedia: [],
          commonGround: [],
          talkingPoints: [],
          cautions: [],
        };
      }

      const result: ParticipantResearch = {
        name,
        company,
        role,
        summary: parsed.summary || `Badanie ${name} zakończone, ale brak wystarczających danych.`,
        experience: parsed.experience || [],
        interests: parsed.interests || [],
        socialMedia: parsed.socialMedia || [],
        commonGround: parsed.commonGround || [],
        talkingPoints: parsed.talkingPoints || [],
        cautions: parsed.cautions || [],
        sources: uniqueUrls,
        photoDescription: photoDescription || undefined,
        researchedAt: Date.now(),
      };

      console.log(`[MeetingCoach] Research complete for ${name}: ${result.summary.slice(0, 100)}...`);
      onProgress?.(`✅ Research ${name} zakończony`);

      return result;
    } catch (err: any) {
      console.error(`[MeetingCoach] AI synthesis failed for ${name}:`, err);
      return {
        name,
        company,
        role,
        summary: `Nie udało się dokończyć researchu: ${err.message}`,
        experience: [],
        interests: [],
        socialMedia: [],
        commonGround: [],
        talkingPoints: [],
        cautions: [],
        sources: uniqueUrls,
        researchedAt: Date.now(),
      };
    }
  }

  /**
   * Research all participants in a meeting prep batch.
   * Returns results as they complete (via onResult callback).
   */
  async researchAllParticipants(
    participants: MeetingBriefingParticipant[],
    userContext?: string,
    onResult?: (result: ParticipantResearch, index: number) => void,
    onProgress?: (status: string) => void,
  ): Promise<ParticipantResearch[]> {
    const results: ParticipantResearch[] = [];

    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      onProgress?.(`Badam ${i + 1}/${participants.length}: ${p.name}...`);
      const result = await this.researchParticipant(p, userContext, onProgress);
      results.push(result);
      onResult?.(result, i);
    }

    onProgress?.(`✅ Research zakończony — ${results.length} osób zbadanych`);
    return results;
  }
}
