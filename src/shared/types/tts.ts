/**
 * Shared TTS types — used by both main process and renderer.
 */

export interface TTSConfig {
  enabled: boolean;
  provider: 'elevenlabs' | 'openai' | 'web';
  elevenLabsVoiceId: string;       // ElevenLabs voice ID
  elevenLabsModel: string;         // ElevenLabs model
  openaiVoice: string;             // OpenAI TTS voice (alloy, echo, fable, onyx, nova, shimmer)
  openaiModel: string;             // OpenAI TTS model (tts-1, tts-1-hd)
  maxChars: number;                // Max characters to speak (truncate longer text)
}
