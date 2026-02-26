/**
 * IntentDetector — inteligentne rozpoznawanie intencji użytkownika.
 *
 * Kategorie intencji:
 * - SCREEN_LOOK — użytkownik chce żeby agent zobaczył ekran
 * - SCREEN_HELP — użytkownik potrzebuje pomocy z tym co robi na ekranie
 * - FILE_CONTEXT — użytkownik odnosi się do pliku który ma otwarty
 * - TAKE_CONTROL — użytkownik chce przejęcia sterowania
 * - WEB_SEARCH — użytkownik chce wyszukać coś w internecie
 * - MEMORY_RECALL — użytkownik pyta o coś co agent powinien pamiętać
 * - CODE_EXEC — użytkownik chce żeby agent wykonał/napisał kod
 * - AUTOMATION — użytkownik chce automatyzacji (kliknij, wpisz, otwórz)
 */

export type IntentType =
  | 'screen_look'
  | 'screen_help'
  | 'file_context'
  | 'take_control'
  | 'web_search'
  | 'memory_recall'
  | 'code_exec'
  | 'automation'
  | 'none';

export interface DetectedIntent {
  type: IntentType;
  confidence: number; // 0.0 — 1.0
  matchedPatterns: string[];
  autoAction?: 'screenshot' | 'web_search' | 'memory_search' | 'take_control';
  /** Extracted context (e.g. search query, file name) */
  extractedContext?: string;
}

interface IntentPattern {
  regex: RegExp;
  intent: IntentType;
  confidence: number;
  autoAction?: 'screenshot' | 'web_search' | 'memory_search' | 'take_control';
  label: string;
  /** Optional capture group index for extracting context */
  captureGroup?: number;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // ─── Screen Look — user wants agent to see their screen ───
  {
    regex:
      /(?:zobacz|popatrz|spójrz|patrz|zerknij|sprawdź|obejrzyj|obczaj|ogarnij|pokaż\s+ci|pokażę\s+ci)\s+(?:co\s+(?:robię|mam|widzę|się\s+dzieje)|na\s+(?:ekran|monitor|pulpit|to)|sobie|tutaj|teraz|ten\s+ekran)/i,
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
    confidence: 0.9,
    autoAction: 'screenshot',
    label: 'can-you-see-this',
  },
  {
    regex: /(?:pomóż|pomoc|help)\s+(?:mi\s+)?(?:z\s+tym|z\s+te[mn]|with\s+this)/i,
    intent: 'screen_help',
    confidence: 0.8,
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
    regex:
      /(?:mam\s+(?:problem|błąd|error|bug)|coś\s+(?:nie\s+działa|się\s+(?:zepsuło|popsulo))|something\s+(?:is\s+)?(?:wrong|broken))/i,
    intent: 'screen_help',
    confidence: 0.85,
    autoAction: 'screenshot',
    label: 'something-wrong',
  },
  {
    regex: /(?:ten\s+(?:kod|plik|program|okno|błąd|komunikat|error)|this\s+(?:code|file|error|window|message))/i,
    intent: 'screen_help',
    confidence: 0.7,
    autoAction: 'screenshot',
    label: 'this-thing-reference',
  },
  {
    regex: /(?:pokaż|pokażę|poka[zż])\s+(?:ci|tobie|screen)/i,
    intent: 'screen_look',
    confidence: 0.9,
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
    regex:
      /(?:nie\s+(?:wiem|rozumiem|ogarniam)\s+co\s+(?:tu\s+jest|się\s+(?:stało|dzieje))|(?:I\s+)?(?:don'?t|cant?'?t)\s+(?:understand|figure\s+out))/i,
    intent: 'screen_help',
    confidence: 0.8,
    autoAction: 'screenshot',
    label: 'confused-about-screen',
  },

  // ─── Deictic references — "to", "tutaj", "here" ───
  {
    regex: /(?:^|\s)(?:tutaj|here|tam|there|tu\b)(?:\s|$|[.!?,])/i,
    intent: 'screen_look',
    confidence: 0.5,
    autoAction: 'screenshot',
    label: 'deictic-reference',
  },

  // ─── File Context — user mentions specific files ───
  {
    regex:
      /(?:w\s+pliku|w\s+(?:tym|moim)\s+(?:pliku|kodzie|skrypcie)|in\s+(?:the\s+|my\s+)?(?:file|code|script))\s+(\S+)/i,
    intent: 'file_context',
    confidence: 0.85,
    autoAction: 'screenshot',
    label: 'in-file-reference',
    captureGroup: 1,
  },
  {
    regex:
      /(?:otwórz|otwieram|otworzyłem|edytuj[eę]?|opened?|editing)\s+(\S+\.(?:ts|tsx|js|jsx|py|java|cpp|cs|go|rs|md|json|html|css))/i,
    intent: 'file_context',
    confidence: 0.8,
    autoAction: 'screenshot',
    label: 'opened-file',
    captureGroup: 1,
  },

  // ─── Take Control ───
  {
    regex: /(?:przejmij|przejmowanie|weź)\s+(?:sterowanie|kontrolę?|control)/i,
    intent: 'take_control',
    confidence: 0.95,
    autoAction: 'take_control',
    label: 'take-control-pl',
  },
  {
    regex: /(?:take\s+(?:over|control)|control\s+(?:my\s+)?(?:computer|desktop|screen|mouse|keyboard))/i,
    intent: 'take_control',
    confidence: 0.95,
    autoAction: 'take_control',
    label: 'take-control-en',
  },
  {
    regex: /(?:zrób\s+to\s+(?:sam|za\s+mnie)|do\s+it\s+(?:for\s+me|yourself))/i,
    intent: 'take_control',
    confidence: 0.85,
    autoAction: 'take_control',
    label: 'do-it-for-me',
  },

  // ─── Web Search ───
  {
    regex: /(?:wyszukaj|szukaj|znajd[źz]|google|search)\s+(?:mi\s+)?(?:w\s+)?(?:internecie|necie|sieci|online|web)/i,
    intent: 'web_search',
    confidence: 0.9,
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
  {
    regex: /(?:wyszukaj|search|google|find)\s+(.{3,60})(?:\s+(?:w\s+necie|online|w\s+internecie))?$/i,
    intent: 'web_search',
    confidence: 0.65,
    autoAction: 'web_search',
    label: 'implicit-search',
    captureGroup: 1,
  },

  // ─── Memory Recall ───
  {
    regex:
      /(?:pamięt(?:asz|aj)|pamiętam.*powiedział|mówił(?:em|am)\s+(?:ci|że)|wcześniej|earlier|remember\s+when|you\s+said)/i,
    intent: 'memory_recall',
    confidence: 0.8,
    autoAction: 'memory_search',
    label: 'memory-recall',
  },
  {
    regex:
      /(?:co\s+(?:ci\s+)?(?:pisałem|mówiłem|mówił(?:em|am))\s+(?:o|na\s+temat|wcześniej)|what\s+(?:did\s+)?I\s+(?:say|tell|write)\s+(?:about|earlier))/i,
    intent: 'memory_recall',
    confidence: 0.85,
    autoAction: 'memory_search',
    label: 'what-did-i-say',
  },

  // ─── Code Execution ───
  {
    regex: /(?:uruchom|odpal|wykonaj|run|execute)\s+(?:ten\s+)?(?:kod|skrypt|script|program|komendę?|command)/i,
    intent: 'code_exec',
    confidence: 0.9,
    label: 'code-exec-explicit',
  },
  {
    regex: /(?:napisz|stwórz|zrób)\s+(?:mi\s+)?(?:skrypt|script|program|narzędzie|tool)/i,
    intent: 'code_exec',
    confidence: 0.8,
    label: 'create-script',
  },

  // ─── Automation ───
  {
    regex: /(?:kliknij|naciśnij|wpisz|otwórz)\s+(?:w|na|przycisk|button|pole|field|link|menu)/i,
    intent: 'automation',
    confidence: 0.85,
    autoAction: 'screenshot',
    label: 'automation-action-pl',
  },
  {
    regex: /(?:click|press|type|open)\s+(?:on|the|in)\s+/i,
    intent: 'automation',
    confidence: 0.8,
    autoAction: 'screenshot',
    label: 'automation-action-en',
  },
];

export class IntentDetector {
  /** Recent messages for contextual intent detection */
  private recentMessages: string[] = [];
  private readonly MAX_RECENT = 5;

  /**
   * Track a message for contextual analysis.
   */
  addContext(message: string): void {
    this.recentMessages.push(message);
    if (this.recentMessages.length > this.MAX_RECENT) {
      this.recentMessages.shift();
    }
  }

  /**
   * Detect the user's intent from their message.
   * Returns the highest-confidence match, or 'none' if nothing matches.
   * Considers recent conversation context for better accuracy.
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
    const sameIntentMatches = matches.filter((m) => m.intent === best.intent);
    let boostedConfidence = best.confidence;
    if (sameIntentMatches.length > 1) {
      boostedConfidence = Math.min(1.0, best.confidence + sameIntentMatches.length * 0.05);
    }

    // Contextual boost: if recent messages were about the same topic, increase confidence
    if (this.recentMessages.length > 0) {
      const recentIntents: IntentType[] = this.recentMessages.flatMap((msg) => {
        const found: IntentType[] = [];
        for (const p of INTENT_PATTERNS) {
          if (msg.match(p.regex)) found.push(p.intent);
        }
        return found;
      });

      if (recentIntents.includes(best.intent)) {
        boostedConfidence = Math.min(1.0, boostedConfidence + 0.1);
      }
    }

    // Extract context from capture groups
    let extractedContext: string | undefined;
    if (best.captureGroup !== undefined && best.match[best.captureGroup]) {
      extractedContext = best.match[best.captureGroup].trim();
    }

    return {
      type: best.intent,
      confidence: boostedConfidence,
      matchedPatterns: sameIntentMatches.map((m) => m.label),
      autoAction: best.autoAction,
      extractedContext,
    };
  }

  /**
   * Check if message contains a screen-related intent that should trigger auto-screenshot.
   */
  shouldAutoScreenshot(message: string): boolean {
    const intent = this.detect(message);
    return intent.autoAction === 'screenshot' && intent.confidence >= 0.7;
  }

  /**
   * Check if the message needs web search context enrichment.
   */
  shouldAutoWebSearch(message: string): boolean {
    const intent = this.detect(message);
    return intent.autoAction === 'web_search' && intent.confidence >= 0.8;
  }

  /**
   * Check if the message is a memory recall that should trigger RAG search.
   */
  shouldAutoMemorySearch(message: string): boolean {
    const intent = this.detect(message);
    return intent.autoAction === 'memory_search' && intent.confidence >= 0.7;
  }

  /**
   * Check if user wants the agent to take control.
   */
  shouldTakeControl(message: string): boolean {
    const intent = this.detect(message);
    return intent.autoAction === 'take_control' && intent.confidence >= 0.8;
  }

  /**
   * Get all detected intents above a threshold (for multi-intent messages).
   */
  detectAll(message: string, minConfidence: number = 0.5): DetectedIntent[] {
    const seen = new Set<IntentType>();
    const results: DetectedIntent[] = [];

    for (const pattern of INTENT_PATTERNS) {
      const match = message.match(pattern.regex);
      if (match && pattern.confidence >= minConfidence && !seen.has(pattern.intent)) {
        seen.add(pattern.intent);
        results.push({
          type: pattern.intent,
          confidence: pattern.confidence,
          matchedPatterns: [pattern.label],
          autoAction: pattern.autoAction,
          extractedContext: pattern.captureGroup !== undefined ? match[pattern.captureGroup]?.trim() : undefined,
        });
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }
}
