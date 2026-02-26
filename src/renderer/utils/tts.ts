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
    ttsVoice =
      voices.find((v) => v.lang.startsWith('pl')) ||
      voices.find((v) => v.lang.startsWith('en') && v.localService) ||
      voices[0] ||
      null;
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
      if (result.success && result.audioData) {
        // Play the generated audio via base64 data URL
        currentAudio = new Audio(result.audioData);
        currentAudio.volume = 0.8;
        currentAudio.playbackRate = ttsRate;
        currentAudio.play().catch((err) => {
          console.warn('[TTS] Audio playback failed, falling back to Web Speech:', err);
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
  } catch (err) {
    console.warn('[TTS] Main process TTS failed, falling back:', err);
  }

  // Fallback: Web Speech API
  speakWebSpeechAPI(text);
}

/**
 * Fallback TTS via Web Speech API (built-in, lower quality).
 * Splits long text into chunks to avoid browser truncation limits.
 */
function speakWebSpeechAPI(text: string): void {
  if (!('speechSynthesis' in window)) return;

  // Clean text — strip markdown, emojis, code blocks
  const clean = text
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/`[^`]*`/g, '') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/#{1,6}\s/g, '') // headers
    .replace(/🤖|💡|📋|📸|⚙️|🎮|✅|⛔|⚠️|●|🔔/gu, '') // common emojis
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .trim();

  if (!clean || clean.length < 3) return;

  // Split into chunks at sentence boundaries to avoid browser TTS limits (~200-300 chars)
  const chunks = splitIntoChunks(clean, 250);

  for (const chunk of chunks) {
    const utterance = new SpeechSynthesisUtterance(chunk);
    if (ttsVoice) utterance.voice = ttsVoice;
    utterance.rate = ttsRate;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    speechSynthesis.speak(utterance);
  }
}

/**
 * Split text into chunks at sentence boundaries, respecting maxLen.
 */
function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find the best split point (sentence end) within maxLen
    let splitAt = -1;
    for (const sep of ['. ', '! ', '? ', '.\n', ';\n', ', ', '\n']) {
      const idx = remaining.lastIndexOf(sep, maxLen);
      if (idx > 0 && idx > splitAt) {
        splitAt = idx + sep.length;
      }
    }

    // No good split point — force split at maxLen
    if (splitAt <= 0) {
      const spaceIdx = remaining.lastIndexOf(' ', maxLen);
      splitAt = spaceIdx > 0 ? spaceIdx + 1 : maxLen;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks;
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
