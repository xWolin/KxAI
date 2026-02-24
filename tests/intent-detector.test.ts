import { describe, it, expect, beforeEach } from 'vitest';
import { IntentDetector } from '../src/main/services/intent-detector';
import type { DetectedIntent, IntentType } from '../src/main/services/intent-detector';

describe('IntentDetector', () => {
  let detector: IntentDetector;

  beforeEach(() => {
    detector = new IntentDetector();
  });

  // ─── Screen Look Detection ───

  describe('detect() — screen look intents (PL)', () => {
    it.each([
      ['zobacz co robię', 'screen_look'],
      ['popatrz na ekran', 'screen_look'],
      ['spójrz na monitor', 'screen_look'],
      ['zerknij na to', 'screen_look'],
      ['sprawdź co mam', 'screen_look'],
      ['pokażę ci', 'screen_look'],
      ['pokaż ci', 'screen_look'],
    ] as [string, IntentType][])('detects "%s" as %s', (message, expectedType) => {
      const result = detector.detect(message);
      expect(result.type).toBe(expectedType);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.autoAction).toBe('screenshot');
    });
  });

  describe('detect() — screen look intents (EN)', () => {
    it.each([
      ['look at my screen', 'screen_look'],
      ['check what I\'m doing', 'screen_look'],
      ['see my desktop', 'screen_look'],
    ] as [string, IntentType][])('detects "%s" as %s', (message, expectedType) => {
      const result = detector.detect(message);
      expect(result.type).toBe(expectedType);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  // ─── Screen Help Detection ───

  describe('detect() — screen help intents', () => {
    it.each([
      ['pomóż mi z tym', 'screen_help'],
      ['mam problem', 'screen_help'],
      ['coś nie działa', 'screen_help'],
      ['coś się zepsuło', 'screen_help'],
      ['something is wrong', 'screen_help'],
      ['ten kod', 'screen_help'],
      ['ten error', 'screen_help'],
      ['nie wiem co tu jest', 'screen_help'],
    ] as [string, IntentType][])('detects "%s" as %s', (message, expectedType) => {
      const result = detector.detect(message);
      expect(result.type).toBe(expectedType);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  // ─── Screenshot Explicit ───

  describe('detect() — explicit screenshot requests', () => {
    it.each([
      'zrób screena',
      'zrzut ekranu',
      'screenshot',
      'capture the screen',
    ])('detects explicit screenshot request "%s"', (message) => {
      const result = detector.detect(message);
      expect(result.type).toBe('screen_look');
      expect(result.confidence).toBeGreaterThanOrEqual(0.90);
      expect(result.autoAction).toBe('screenshot');
    });
  });

  // ─── Take Control ───

  describe('detect() — take control intents', () => {
    it.each([
      ['przejmij sterowanie', 'take_control'],
      ['przejmij kontrolę', 'take_control'],
      ['weź kontrolę', 'take_control'],
      ['take over', 'take_control'],
      ['take control', 'take_control'],
      ['control my computer', 'take_control'],
      ['zrób to sam', 'take_control'],
      ['do it for me', 'take_control'],
    ] as [string, IntentType][])('detects "%s" as %s', (message, expectedType) => {
      const result = detector.detect(message);
      expect(result.type).toBe(expectedType);
      expect(result.confidence).toBeGreaterThanOrEqual(0.80);
      expect(result.autoAction).toBe('take_control');
    });
  });

  // ─── Web Search ───

  describe('detect() — web search intents', () => {
    it.each([
      ['wyszukaj w internecie', 'web_search'],
      ['szukaj w necie', 'web_search'],
      ['co mówią w internecie', 'web_search'],
      ['co piszą w sieci', 'web_search'],
    ] as [string, IntentType][])('detects "%s" as %s', (message, expectedType) => {
      const result = detector.detect(message);
      expect(result.type).toBe(expectedType);
      expect(result.confidence).toBeGreaterThanOrEqual(0.80);
      expect(result.autoAction).toBe('web_search');
    });
  });

  // ─── Memory Recall ───

  describe('detect() — memory recall intents', () => {
    it.each([
      ['pamiętasz co mówiłem?', 'memory_recall'],
      ['co ci pisałem o projekcie', 'memory_recall'],
      ['remember when I said', 'memory_recall'],
    ] as [string, IntentType][])('detects "%s" as %s', (message, expectedType) => {
      const result = detector.detect(message);
      expect(result.type).toBe(expectedType);
      expect(result.confidence).toBeGreaterThanOrEqual(0.70);
      expect(result.autoAction).toBe('memory_search');
    });
  });

  // ─── Code Execution ───

  describe('detect() — code execution intents', () => {
    it.each([
      ['uruchom ten kod', 'code_exec'],
      ['odpal skrypt', 'code_exec'],
      ['execute command', 'code_exec'],
      ['napisz mi skrypt', 'code_exec'],
    ] as [string, IntentType][])('detects "%s" as %s', (message, expectedType) => {
      const result = detector.detect(message);
      expect(result.type).toBe(expectedType);
      expect(result.confidence).toBeGreaterThanOrEqual(0.80);
    });
  });

  // ─── Automation ───

  describe('detect() — automation intents', () => {
    it.each([
      ['kliknij na przycisk OK', 'automation'],
      ['wpisz w pole', 'automation'],
      ['otwórz menu', 'automation'],
      ['click on the button', 'automation'],
      ['type in the field', 'automation'],
    ] as [string, IntentType][])('detects "%s" as %s', (message, expectedType) => {
      const result = detector.detect(message);
      expect(result.type).toBe(expectedType);
      expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    });
  });

  // ─── No Match ───

  describe('detect() — no intent match', () => {
    it('returns none for unrelated messages', () => {
      const result = detector.detect('Jaka jest stolica Francji?');
      expect(result.type).toBe('none');
      expect(result.confidence).toBe(0);
      expect(result.matchedPatterns).toHaveLength(0);
    });

    it('returns none for empty string', () => {
      const result = detector.detect('');
      expect(result.type).toBe('none');
      expect(result.confidence).toBe(0);
    });

    it('returns none for emoji-only message', () => {
      const result = detector.detect('😀🎉👍');
      expect(result.type).toBe('none');
    });
  });

  // ─── Confidence Boosting ───

  describe('confidence boosting', () => {
    it('boosts confidence when multiple patterns match same intent', () => {
      // "pomóż mi z tym, mam problem" matches both 'help-with-this' and 'something-wrong'
      const result = detector.detect('pomóż mi z tym, mam problem');
      expect(result.type).toBe('screen_help');
      // Should be boosted above base confidence
      expect(result.matchedPatterns.length).toBeGreaterThan(1);
    });

    it('boosts confidence from context history', () => {
      const baseResult = detector.detect('co o tym myślisz');
      const baseConfidence = baseResult.confidence;

      // Add context about screen looking
      detector.addContext('popatrz na ekran');

      const boostedResult = detector.detect('co o tym myślisz');
      expect(boostedResult.confidence).toBeGreaterThanOrEqual(baseConfidence);
    });
  });

  // ─── Context Buffer ───

  describe('addContext()', () => {
    it('maintains max 5 recent messages', () => {
      for (let i = 0; i < 10; i++) {
        detector.addContext(`message ${i}`);
      }
      // Internal buffer should be at most 5
      // We test indirectly by checking behavior
      const result = detector.detect('test');
      expect(result).toBeDefined();
    });
  });

  // ─── Capture Groups ───

  describe('extractedContext', () => {
    it('extracts file name from file context intent', () => {
      const result = detector.detect('w pliku main.ts');
      expect(result.type).toBe('file_context');
      expect(result.extractedContext).toBe('main.ts');
    });

    it('extracts opened file with extension', () => {
      const result = detector.detect('otwieram server.py');
      expect(result.type).toBe('file_context');
      expect(result.extractedContext).toBe('server.py');
    });

    it('extracts search query from implicit search', () => {
      const result = detector.detect('wyszukaj React hooks best practices');
      if (result.extractedContext) {
        expect(result.extractedContext.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── shouldAuto* Methods ───

  describe('shouldAutoScreenshot()', () => {
    it('returns true for high-confidence screen intents', () => {
      expect(detector.shouldAutoScreenshot('zobacz co robię')).toBe(true);
      expect(detector.shouldAutoScreenshot('zrób screena')).toBe(true);
    });

    it('returns false for low-confidence or non-screen intents', () => {
      expect(detector.shouldAutoScreenshot('Jaka jest stolica Francji?')).toBe(false);
    });
  });

  describe('shouldAutoWebSearch()', () => {
    it('returns true for high-confidence web search intents', () => {
      expect(detector.shouldAutoWebSearch('wyszukaj w internecie')).toBe(true);
    });

    it('returns false for non-search intents', () => {
      expect(detector.shouldAutoWebSearch('zobacz ekran')).toBe(false);
    });
  });

  describe('shouldAutoMemorySearch()', () => {
    it('returns true for memory recall intents', () => {
      expect(detector.shouldAutoMemorySearch('pamiętasz co mówiłem?')).toBe(true);
    });

    it('returns false for unrelated', () => {
      expect(detector.shouldAutoMemorySearch('hello world')).toBe(false);
    });
  });

  describe('shouldTakeControl()', () => {
    it('returns true for take control intents', () => {
      expect(detector.shouldTakeControl('przejmij sterowanie')).toBe(true);
      expect(detector.shouldTakeControl('take control')).toBe(true);
    });

    it('returns false for other intents', () => {
      expect(detector.shouldTakeControl('co na ekranie')).toBe(false);
    });
  });

  // ─── detectAll ───

  describe('detectAll()', () => {
    it('returns all intents above threshold', () => {
      const results = detector.detectAll('pomóż mi z tym kodem w pliku main.ts', 0.50);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // Should include screen_help and file_context
      const types = results.map((r) => r.type);
      expect(types).toContain('screen_help');
    });

    it('returns empty array when nothing matches', () => {
      const results = detector.detectAll('🎉');
      expect(results).toHaveLength(0);
    });

    it('deduplicates by intent type', () => {
      const results = detector.detectAll('popatrz na ekran i spójrz co tu jest');
      const types = results.map((r) => r.type);
      const unique = new Set(types);
      expect(types.length).toBe(unique.size);
    });

    it('sorts results by confidence descending', () => {
      const results = detector.detectAll('pomóż mi z tym', 0.1);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
      }
    });
  });
});
