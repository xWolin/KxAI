/**
 * TTS Service — Text-to-Speech via Edge TTS (main process).
 *
 * Uses Microsoft Edge TTS (node-edge-tts) as the primary provider — free, high-quality neural voices.
 * Falls back to renderer-side Web Speech API if Edge TTS fails.
 *
 * Runs in main process because node-edge-tts requires Node.js.
 * Renderer communicates via IPC: tts:speak, tts:stop, tts:set-config.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface TTSConfig {
  enabled: boolean;
  provider: 'edge' | 'web';       // 'edge' = node-edge-tts (default), 'web' = renderer Web Speech API
  voice: string;                   // Edge TTS voice name
  rate: string;                    // e.g. '+0%', '+20%', '-10%'
  volume: string;                  // e.g. '+0%'
  maxChars: number;                // Max characters to speak (truncate longer text)
}

const DEFAULT_CONFIG: TTSConfig = {
  enabled: true,
  provider: 'edge',
  voice: 'pl-PL-MarekNeural',     // Polish male voice (high quality)
  rate: '+0%',
  volume: '+0%',
  maxChars: 500,
};

// Alternative voices for reference:
// pl-PL-ZofiaNeural (female), en-US-MichelleNeural, en-US-GuyNeural

export class TTSService {
  private config: TTSConfig;
  private speaking = false;
  private tempDir: string;

  constructor(config?: Partial<TTSConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.tempDir = path.join(os.tmpdir(), 'kxai-tts');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Speak text using Edge TTS. Returns path to generated audio file.
   * Returns null if disabled or provider is 'web' (handled by renderer).
   */
  async speak(text: string): Promise<string | null> {
    if (!this.config.enabled || this.config.provider !== 'edge') {
      return null; // Let renderer handle via Web Speech API
    }

    // Clean text — strip markdown, emojis, code blocks
    const clean = this.cleanText(text);
    if (!clean || clean.length < 3) return null;

    // Truncate
    const truncated = clean.length > this.config.maxChars
      ? clean.slice(0, this.config.maxChars) + '...'
      : clean;

    const audioPath = path.join(this.tempDir, `tts-${Date.now()}.mp3`);

    try {
      const { EdgeTTS } = await import('node-edge-tts');
      const tts = new EdgeTTS({
        voice: this.config.voice,
        rate: this.config.rate,
        volume: this.config.volume,
      });

      this.speaking = true;
      await tts.ttsPromise(truncated, audioPath);
      this.speaking = false;

      return audioPath;
    } catch (err) {
      this.speaking = false;
      console.error('Edge TTS error:', err);
      return null; // Fallback: renderer will use Web Speech API
    }
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
      .replace(/```[\s\S]*?```/g, '')             // code blocks
      .replace(/`[^`]*`/g, '')                     // inline code
      .replace(/\*\*([^*]+)\*\*/g, '$1')           // bold
      .replace(/\*([^*]+)\*/g, '$1')               // italic
      .replace(/#{1,6}\s/g, '')                    // headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // links
      .replace(/[🤖💡📋📸⚙️🎮✅⛔⚠️●🔔]/gu, '') // common emojis
      .replace(/\n{3,}/g, '\n\n')                  // excessive newlines
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
    } catch { /* non-critical */ }
  }
}
