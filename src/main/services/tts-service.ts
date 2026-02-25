/**
 * TTS Service — Text-to-Speech via ElevenLabs (primary) or OpenAI TTS (fallback).
 *
 * Provider priority:
 * 1. 'elevenlabs' — High-quality ElevenLabs voices (requires API key)
 * 2. 'openai' — OpenAI TTS (requires OpenAI API key, high quality)
 * 3. 'web' — Renderer-side Web Speech API (lowest quality, last resort)
 *
 * Runs in main process because both ElevenLabs HTTP and OpenAI require Node.js.
 * Renderer communicates via IPC: tts:speak, tts:stop, tts:set-config.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import { SecurityService } from './security';

// Re-export from shared types (canonical source)
export type { TTSConfig } from '../../shared/types/tts';
import type { TTSConfig } from '../../shared/types/tts';

const DEFAULT_CONFIG: TTSConfig = {
  enabled: true,
  provider: 'elevenlabs',
  elevenLabsVoiceId: 'onwK4e9ZLuTAKqWW03F9', // "Daniel" — clear male voice
  elevenLabsModel: 'eleven_multilingual_v2',
  openaiVoice: 'onyx', // Deep male voice, good for Polish
  openaiModel: 'tts-1-hd', // High quality
  maxChars: 4000,
};

// ElevenLabs voice IDs for reference:
// onwK4e9ZLuTAKqWW03F9 — Daniel (clear male)
// EXAVITQu4vr4xnSDxMaL — Sarah (warm female)
// pFZP5JQG7iQjIQuC4Bku — Lily (British female)
// TX3LPaxmHKxFdv7VOQHJ — Liam (American male)
// JBFqnCBsd6RMkjVDRZzb — George (British male)

// OpenAI TTS voices: alloy, echo, fable, onyx, nova, shimmer

export class TTSService {
  private config: TTSConfig;
  private speaking = false;
  private tempDir: string;
  private security?: SecurityService;

  constructor(security?: SecurityService, config?: Partial<TTSConfig>) {
    this.security = security;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tempDir = path.join(os.tmpdir(), 'kxai-tts');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Speak text. Tries ElevenLabs first (if configured), then OpenAI TTS, then returns null for Web Speech fallback.
   * Returns path to generated audio file or null.
   */
  async speak(text: string): Promise<string | null> {
    if (!this.config.enabled) return null;

    // If provider is 'web', let renderer handle it
    if (this.config.provider === 'web') return null;

    // Clean text — strip markdown, emojis, code blocks
    const clean = this.cleanText(text);
    if (!clean || clean.length < 3) return null;

    // Truncate
    const truncated = clean.length > this.config.maxChars ? clean.slice(0, this.config.maxChars) + '...' : clean;

    // Try ElevenLabs first (if provider is 'elevenlabs')
    if (this.config.provider === 'elevenlabs') {
      const elResult = await this.speakElevenLabs(truncated);
      if (elResult) return elResult;
      console.warn('ElevenLabs TTS failed — falling back to OpenAI TTS');
    }

    // Fallback / explicit provider: OpenAI TTS
    const oaiResult = await this.speakOpenAI(truncated);
    if (oaiResult) return oaiResult;

    console.warn('OpenAI TTS also failed — renderer will use Web Speech API');
    return null;
  }

  /**
   * Generate speech via ElevenLabs Text-to-Speech REST API.
   */
  private async speakElevenLabs(text: string): Promise<string | null> {
    if (!this.security) return null;

    const apiKey = await this.security.getApiKey('elevenlabs');
    if (!apiKey) {
      console.warn('ElevenLabs TTS: no API key configured');
      return null;
    }

    const voiceId = this.config.elevenLabsVoiceId || DEFAULT_CONFIG.elevenLabsVoiceId;
    const model = this.config.elevenLabsModel || DEFAULT_CONFIG.elevenLabsModel;
    const audioPath = path.join(this.tempDir, `tts-el-${Date.now()}.mp3`);

    try {
      this.speaking = true;
      const audioBuffer = await this.elevenLabsRequest(apiKey, voiceId, model, text);
      fs.writeFileSync(audioPath, audioBuffer);
      this.speaking = false;
      return audioPath;
    } catch (err) {
      this.speaking = false;
      console.error('ElevenLabs TTS error:', err);
      return null;
    }
  }

  /**
   * HTTPS request to ElevenLabs TTS API.
   */
  private elevenLabsRequest(apiKey: string, voiceId: string, model: string, text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      });

      const REQUEST_TIMEOUT_MS = 30_000;

      const req = https.request(
        {
          hostname: 'api.elevenlabs.io',
          path: `/v1/text-to-speech/${voiceId}`,
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', (chunk: Buffer) => (errBody += chunk.toString()));
            res.on('end', () => reject(new Error(`ElevenLabs API ${res.statusCode}: ${errBody.slice(0, 200)}`)));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`ElevenLabs TTS request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Generate speech via OpenAI TTS API.
   * Uses the same API key as the main AI service.
   */
  private async speakOpenAI(text: string): Promise<string | null> {
    if (!this.security) return null;

    const apiKey = await this.security.getApiKey('openai');
    if (!apiKey) {
      console.warn('OpenAI TTS: no API key configured');
      return null;
    }

    const voice = this.config.openaiVoice || DEFAULT_CONFIG.openaiVoice;
    const model = this.config.openaiModel || DEFAULT_CONFIG.openaiModel;
    const audioPath = path.join(this.tempDir, `tts-oai-${Date.now()}.mp3`);

    try {
      this.speaking = true;
      const audioBuffer = await this.openaiTTSRequest(apiKey, model, voice, text);
      fs.writeFileSync(audioPath, audioBuffer);
      this.speaking = false;
      return audioPath;
    } catch (err) {
      this.speaking = false;
      console.error('OpenAI TTS error:', err);
      return null;
    }
  }

  /**
   * HTTPS request to OpenAI TTS API.
   */
  private openaiTTSRequest(apiKey: string, model: string, voice: string, text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model,
        input: text,
        voice,
        response_format: 'mp3',
      });

      const REQUEST_TIMEOUT_MS = 30_000;

      const req = https.request(
        {
          hostname: 'api.openai.com',
          path: '/v1/audio/speech',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          if (res.statusCode !== 200) {
            let errBody = '';
            res.on('data', (chunk: Buffer) => (errBody += chunk.toString()));
            res.on('end', () => reject(new Error(`OpenAI TTS API ${res.statusCode}: ${errBody.slice(0, 200)}`)));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`OpenAI TTS request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Stop speaking (cleanup).
   */
  stop(): void {
    this.speaking = false;
  }

  /**
   * Update TTS configuration.
   */
  setConfig(updates: Partial<TTSConfig>): void {
    Object.assign(this.config, updates);
  }

  getConfig(): TTSConfig {
    return { ...this.config };
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Clean text for TTS — strip markdown, emojis, code blocks.
   */
  private cleanText(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, '') // code blocks
      .replace(/`[^`]*`/g, '') // inline code
      .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
      .replace(/\*([^*]+)\*/g, '$1') // italic
      .replace(/#{1,6}\s/g, '') // headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
      .replace(/[🤖💡📋📸🎮✅⛔●🔔]|⚙️|⚠️/gu, '') // common emojis
      .replace(/\n{3,}/g, '\n\n') // excessive newlines
      .trim();
  }

  /**
   * Cleanup old temp files (older than 1 hour).
   */
  cleanup(): void {
    try {
      const files = fs.readdirSync(this.tempDir);
      const cutoff = Date.now() - 60 * 60 * 1000;
      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      /* non-critical */
    }
  }
}
