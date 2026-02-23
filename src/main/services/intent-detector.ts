/**
 * IntentDetector — inteligentne rozpoznawanie intencji użytkownika.
 *
 * Główna funkcja: wykrywanie kiedy użytkownik mówi o ekranie, a agent powinien
 * AUTOMATYCZNIE zrobić screenshot zamiast mówić "nie widzę ekranu".
 *
 * Inspiracja: OpenClaw's intelligent context inference
 *
 * Kategorie intencji:
 * - SCREEN_LOOK — użytkownik chce żeby agent zobaczył ekran
 * - SCREEN_HELP — użytkownik potrzebuje pomocy z tym co robi na ekranie
 * - FILE_CONTEXT — użytkownik odnosi się do pliku który ma otwarty
 * - TAKE_CONTROL — (istniejący) użytkownik chce przejęcia sterowania
 * - WEB_SEARCH — użytkownik chce wyszukać coś w internecie
 * - MEMORY_RECALL — użytkownik pyta o coś co agent powinien pamiętać
 */

export type IntentType =
  | 'screen_look'
  | 'screen_help'
  | 'file_context'
  | 'web_search'
  | 'memory_recall'
  | 'none';

export interface DetectedIntent {
  type: IntentType;
  confidence: number; // 0.0 — 1.0
  /** Które wzorce dopasowano */
  matchedPatterns: string[];
  /** Sugerowana automatyczna akcja */
  autoAction?: 'screenshot' | 'web_search' | 'memory_search';
}

interface IntentPattern {
  regex: RegExp;
  intent: IntentType;
  confidence: number;
  autoAction?: 'screenshot' | 'web_search' | 'memory_search';
  label: string;
}

/**
 * Wzorce rozpoznawania intencji — po polsku i angielsku.
 * Posortowane od najwyższej pewności do najniższej.
 */
const INTENT_PATTERNS: IntentPattern[] = [
  // ─── Screen Look — user wants agent to see their screen ───
  {
    regex: /(?:zobacz|popatrz|spójrz|patrz|zerknij|sprawdź|obejrzyj|obczaj|ogarnij|pokaż\s+ci|pokażę\s+ci)\s+(?:co\s+(?:robię|mam|widzę|się\s+dzieje)|na\s+(?:ekran|monitor|pulpit|to)|sobie|tutaj|teraz|ten\s+ekran)/i,
    intent: 'screen_look',
    confidence: 0.95,
    autoAction: 'screenshot',
    label: 'direct-screen-look',
  },
  {
    regex: /(?:look|check|see|watch)\s+(?:at\s+)?(?:my\s+)?(?:screen|desktop|monitor|what\s+I'm\s+doing|this)/i,
    intent: 'screen_look',
    confidence: 0.95,
    autoAction: 'screenshot',
    label: 'direct-screen-look-en',
  },
  {
    regex: /(?:widzisz|widzisz\s+to|widzisz\s+co|co\s+widzisz|potrzebuję?\s+(?:twojej\s+)?pomocy\s+z\s+tym)/i,
    intent: 'screen_look',
    confidence: 0.90,
    autoAction: 'screenshot',
    label: 'can-you-see-this',
  },
  {
    regex: /(?:pomóż|pomoc|help)\s+(?:mi\s+)?(?:z\s+tym|z\s+te[mn]|with\s+this)/i,
    intent: 'screen_help',
    confidence: 0.80,
    autoAction: 'screenshot',
    label: 'help-with-this',
  },
  {
    regex: /(?:co\s+(?:o\s+tym|myślisz|sądzisz|powiesz|na\s+to)|what\s+(?:do\s+you\s+)?think)/i,
    intent: 'screen_look',
    confidence: 0.75,
    autoAction: 'screenshot',
    label: 'what-do-you-think',
  },
  {
    regex: /(?:mam\s+(?:problem|błąd|error|bug)|coś\s+(?:nie\s+działa|się\s+(?:zepsuło|popsulo))|something\s+(?:is\s+)?(?:wrong|broken))/i,
    intent: 'screen_help',
    confidence: 0.85,
    autoAction: 'screenshot',
    label: 'something-wrong',
  },
  {
    regex: /(?:ten\s+(?:kod|plik|program|okno|błąd|komunikat|error)|this\s+(?:code|file|error|window|message))/i,
    intent: 'screen_help',
    confidence: 0.70,
    autoAction: 'screenshot',
    label: 'this-thing-reference',
  },
  {
    regex: /(?:pokaż|pokażę|poka[zż])\s+(?:ci|tobie|screen)/i,
    intent: 'screen_look',
    confidence: 0.90,
    autoAction: 'screenshot',
    label: 'let-me-show-you',
  },
  {
    regex: /(?:screen\s*shot|zrzut\s*ekranu|zrób\s+(?:mi\s+)?(?:screena?|zrzut)|capture\s+(?:the\s+)?screen)/i,
    intent: 'screen_look',
    confidence: 0.95,
    autoAction: 'screenshot',
    label: 'explicit-screenshot',
  },
  {
    regex: /(?:nie\s+(?:wiem|rozumiem|ogarniam)\s+co\s+(?:tu\s+jest|się\s+(?:stało|dzieje))|(?:I\s+)?(?:don'?t|cant?'?t)\s+(?:understand|figure\s+out))/i,
    intent: 'screen_help',
    confidence: 0.80,
    autoAction: 'screenshot',
    label: 'confused-about-screen',
  },

  // ─── Deictic references — "to", "tutaj", "here" ───
  {
    regex: /(?:^|\s)(?:tutaj|here|tam|there|tu\b)(?:\s|$|[.!?,])/i,
    intent: 'screen_look',
    confidence: 0.50, // lower — might not be about screen
    autoAction: 'screenshot',
    label: 'deictic-reference',
  },

  // ─── Web Search ───
  {
    regex: /(?:wyszukaj|szukaj|znajd[źz]|google|search)\s+(?:mi\s+)?(?:w\s+)?(?:internecie|necie|sieci|online|web)/i,
    intent: 'web_search',
    confidence: 0.90,
    autoAction: 'web_search',
    label: 'web-search-explicit',
  },
  {
    regex: /(?:co\s+(?:mówią?|piszą?|jest)\s+(?:w\s+)?(?:internecie|necie|sieci|online))/i,
    intent: 'web_search',
    confidence: 0.85,
    autoAction: 'web_search',
    label: 'web-lookup',
  },

  // ─── Memory Recall ───
  {
    regex: /(?:pamięt(?:asz|aj)|pamiętam.*powiedział|mówił(?:em|am)\s+(?:ci|że)|wcześniej|earlier|remember\s+when|you\s+said)/i,
    intent: 'memory_recall',
    confidence: 0.80,
    autoAction: 'memory_search',
    label: 'memory-recall',
  },
];

export class IntentDetector {
  /**
   * Detect the user's intent from their message.
   * Returns the highest-confidence match, or 'none' if nothing matches.
   */
  detect(message: string): DetectedIntent {
    const matches: Array<IntentPattern & { match: RegExpMatchArray }> = [];

    for (const pattern of INTENT_PATTERNS) {
      const match = message.match(pattern.regex);
      if (match) {
        matches.push({ ...pattern, match });
      }
    }

    if (matches.length === 0) {
      return { type: 'none', confidence: 0, matchedPatterns: [] };
    }

    // Sort by confidence (highest first)
    matches.sort((a, b) => b.confidence - a.confidence);

    const best = matches[0];

    // Boost confidence if multiple patterns matched the same intent
    const sameIntentMatches = matches.filter(m => m.intent === best.intent);
    let boostedConfidence = best.confidence;
    if (sameIntentMatches.length > 1) {
      boostedConfidence = Math.min(1.0, best.confidence + sameIntentMatches.length * 0.05);
    }

    return {
      type: best.intent,
      confidence: boostedConfidence,
      matchedPatterns: sameIntentMatches.map(m => m.label),
      autoAction: best.autoAction,
    };
  }

  /**
   * Check if message contains a screen-related intent that should trigger auto-screenshot.
   * Convenience method for the most common use case.
   */
  shouldAutoScreenshot(message: string): boolean {
    const intent = this.detect(message);
    return (
      intent.autoAction === 'screenshot' &&
      intent.confidence >= 0.70
    );
  }

  /**
   * Check if the message needs web search context enrichment.
   */
  shouldAutoWebSearch(message: string): boolean {
    const intent = this.detect(message);
    return intent.autoAction === 'web_search' && intent.confidence >= 0.80;
  }

  /**
   * Check if the message is a memory recall that should trigger RAG search.
   */
  shouldAutoMemorySearch(message: string): boolean {
    const intent = this.detect(message);
    return intent.autoAction === 'memory_search' && intent.confidence >= 0.70;
  }
}
