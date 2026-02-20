/**
 * Simple TTS wrapper using Web Speech API.
 * Zero dependencies, works in Electron renderer.
 */

let ttsEnabled = true;
let ttsVoice: SpeechSynthesisVoice | null = null;
let ttsRate = 1.0;

/**
 * Initialize TTS — find the best Polish voice.
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
 * Speak text aloud. Cancels any ongoing speech.
 */
export function speak(text: string): void {
  if (!ttsEnabled || !('speechSynthesis' in window)) return;

  // Cancel any ongoing speech
  speechSynthesis.cancel();

  // Clean text — strip markdown, emojis, code blocks
  const clean = text
    .replace(/```[\s\S]*?```/g, '')           // code blocks
    .replace(/`[^`]*`/g, '')                   // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')         // bold
    .replace(/\*([^*]+)\*/g, '$1')             // italic
    .replace(/#{1,6}\s/g, '')                  // headers
    .replace(/[🤖💡📋📸⚙️🎮✅⛔⚠️●]/gu, '')  // common emojis
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
 * Stop any ongoing speech.
 */
export function stopSpeaking(): void {
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
