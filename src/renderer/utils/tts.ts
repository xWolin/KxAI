/**
 * TTS wrapper — ElevenLabs / OpenAI TTS (via main process) with Web Speech API fallback.
 *
 * Flow:
 * 1. Try ElevenLabs or OpenAI TTS via IPC (high-quality voices)
 * 2. If both fail or are disabled, fall back to Web Speech API (renderer-side)
 */

let ttsEnabled = true;
let ttsVoice: SpeechSynthesisVoice | null = null;
let ttsRate = 1.0;
let currentAudio: HTMLAudioElement | null = null;

/**
 * Initialize TTS — find the best Polish voice for Web Speech API fallback.
 */
export function initTTS(): void {
  if (!('speechSynthesis' in window)) return;

  const loadVoices = () => {
    const voices = speechSynthesis.getVoices();
    // Prefer Polish voice
    ttsVoice = voices.find((v) => v.lang.startsWith('pl')) ||
               voices.find((v) => v.lang.startsWith('en') && v.localService) ||
               voices[0] || null;
  };

  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

/**
 * Speak text aloud. Tries main process TTS first (ElevenLabs/OpenAI), falls back to Web Speech API.
 * Cancels any ongoing speech.
 */
export async function speak(text: string): Promise<void> {
  if (!ttsEnabled) return;

  // Cancel any ongoing speech
  stopSpeaking();

  // Try main process TTS (ElevenLabs → OpenAI)
  try {
    if (window.kxai?.ttsSpeak) {
      const result = await window.kxai.ttsSpeak(text);
      if (result.success && result.audioPath) {
        // Play the generated audio file
        currentAudio = new Audio(`file://${result.audioPath}`);
        currentAudio.volume = 0.8;
        currentAudio.playbackRate = ttsRate;
        currentAudio.play().catch(() => {
          // Audio playback failed — try Web Speech API fallback
          speakWebSpeechAPI(text);
        });
        return;
      }
      // If fallback flag set, use Web Speech API
      if (result.fallback) {
        speakWebSpeechAPI(text);
        return;
      }
    }
  } catch {
    // Main process TTS failed — fall back
  }

  // Fallback: Web Speech API
  speakWebSpeechAPI(text);
}

/**
 * Fallback TTS via Web Speech API (built-in, lower quality).
 */
function speakWebSpeechAPI(text: string): void {
  if (!('speechSynthesis' in window)) return;

  // Clean text — strip markdown, emojis, code blocks
  const clean = text
    .replace(/```[\s\S]*?```/g, '')           // code blocks
    .replace(/`[^`]*`/g, '')                   // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')         // bold
    .replace(/\*([^*]+)\*/g, '$1')             // italic
    .replace(/#{1,6}\s/g, '')                  // headers
    .replace(/[🤖💡📋📸⚙️🎮✅⛔⚠️●🔔]/gu, '')  // common emojis
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // links
    .trim();

  if (!clean || clean.length < 3) return;

  // Limit to first ~300 chars for quick reading
  const truncated = clean.length > 300 ? clean.slice(0, 300) + '...' : clean;

  const utterance = new SpeechSynthesisUtterance(truncated);
  if (ttsVoice) utterance.voice = ttsVoice;
  utterance.rate = ttsRate;
  utterance.pitch = 1.0;
  utterance.volume = 0.8;

  speechSynthesis.speak(utterance);
}

/**
 * Stop any ongoing speech (both main process TTS audio and Web Speech API).
 */
export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
}

/**
 * Toggle TTS on/off.
 */
export function setTTSEnabled(enabled: boolean): void {
  ttsEnabled = enabled;
  if (!enabled) stopSpeaking();
}

export function isTTSEnabled(): boolean {
  return ttsEnabled;
}

export function setTTSRate(rate: number): void {
  ttsRate = Math.max(0.5, Math.min(2.0, rate));
}
