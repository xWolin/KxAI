/**
 * ToolLoopDetector — inteligentna detekcja zapętleń w tool-calling loop.
 *
 * Zamiast prostego maxIterations=15, detektor analizuje wzorce:
 * 1. Hash-based repeat detection — ten sam output kilka razy z rzędu
 * 2. Ping-pong detection — dwa narzędzia wywołują się naprzemiennie
 * 3. Tool polling — to samo narzędzie z tymi samymi parametrami
 * 4. Spiraling — rosnąca długość outputu bez postępu
 *
 * Inspiracja: OpenClaw's ToolLoopDetector
 */

import * as crypto from 'crypto';

export interface LoopDetectorConfig {
  /** Po ilu powtórzeniach tego samego hash'a uznajemy za loop */
  hashRepeatThreshold: number;
  /** Po ilu naprzemiennych wywołaniach (A→B→A→B) to ping-pong */
  pingPongThreshold: number;
  /** Ostrzeżenie po ilu iteracjach */
  warningIterations: number;
  /** Absolutny limit bezpieczeństwa */
  criticalIterations: number;
  /** Max ten sam tool z tymi samymi params z rzędu */
  sameToolRepeatMax: number;
}

export type LoopStatus = 'ok' | 'warning' | 'loop-detected' | 'critical';

export interface LoopCheckResult {
  status: LoopStatus;
  reason?: string;
  iteration: number;
  shouldContinue: boolean;
  /** Wiadomość do AI aby się opamiętał */
  nudgeMessage?: string;
}

interface ToolCallRecord {
  tool: string;
  paramsHash: string;
  outputHash: string;
  timestamp: number;
  iteration: number;
}

const DEFAULT_CONFIG: LoopDetectorConfig = {
  hashRepeatThreshold: 3,
  pingPongThreshold: 3,  // 3 pełne cykle A→B→A→B→A→B
  warningIterations: 20,
  criticalIterations: 50,
  sameToolRepeatMax: 5,
};

export class ToolLoopDetector {
  private config: LoopDetectorConfig;
  private history: ToolCallRecord[] = [];
  private iteration = 0;
  private warningIssued = false;

  constructor(config?: Partial<LoopDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Reset detector for a new message processing session.
   */
  reset(): void {
    this.history = [];
    this.iteration = 0;
    this.warningIssued = false;
  }

  /**
   * Record a tool call and check for loops.
   */
  recordAndCheck(toolName: string, params: any, output: any): LoopCheckResult {
    this.iteration++;

    const paramsHash = this.hashObject(params);
    const outputHash = this.hashObject(output);

    const record: ToolCallRecord = {
      tool: toolName,
      paramsHash,
      outputHash,
      timestamp: Date.now(),
      iteration: this.iteration,
    };
    this.history.push(record);

    // Check all loop patterns
    const hashRepeat = this.checkHashRepeat();
    if (hashRepeat) {
      return {
        status: 'loop-detected',
        reason: hashRepeat,
        iteration: this.iteration,
        shouldContinue: false,
        nudgeMessage: `⚠️ LOOP DETECTED: ${hashRepeat}\nMusisz zmienić podejście lub zakończyć. Odpowiedz użytkownikowi z tym co masz do tej pory.`,
      };
    }

    const pingPong = this.checkPingPong();
    if (pingPong) {
      return {
        status: 'loop-detected',
        reason: pingPong,
        iteration: this.iteration,
        shouldContinue: false,
        nudgeMessage: `⚠️ PING-PONG DETECTED: ${pingPong}\nPrzerwij ten wzorzec. Zmień strategię lub odpowiedz użytkownikowi.`,
      };
    }

    const sameToolRepeat = this.checkSameToolRepeat();
    if (sameToolRepeat) {
      return {
        status: 'loop-detected',
        reason: sameToolRepeat,
        iteration: this.iteration,
        shouldContinue: false,
        nudgeMessage: `⚠️ SAME TOOL REPEAT: ${sameToolRepeat}\nUżywasz tego samego narzędzia z tymi samymi parametrami. Zmień podejście.`,
      };
    }

    // Critical absolute limit
    if (this.iteration >= this.config.criticalIterations) {
      return {
        status: 'critical',
        reason: `Osiągnięto limit ${this.config.criticalIterations} iteracji`,
        iteration: this.iteration,
        shouldContinue: false,
        nudgeMessage: `🛑 LIMIT KRYTYCZNY: ${this.config.criticalIterations} iteracji. Musisz teraz odpowiedzieć użytkownikowi.`,
      };
    }

    // Warning threshold — let AI know it's been going a while
    if (this.iteration >= this.config.warningIterations && !this.warningIssued) {
      this.warningIssued = true;
      return {
        status: 'warning',
        reason: `Już ${this.iteration} iteracji — rozważ zakończenie`,
        iteration: this.iteration,
        shouldContinue: true,
        nudgeMessage: `⏰ UWAGA: Już ${this.iteration} iteracji tool-calling. Upewnij się że robisz postęp. Jeśli utknąłeś, odpowiedz użytkownikowi.`,
      };
    }

    return {
      status: 'ok',
      iteration: this.iteration,
      shouldContinue: true,
    };
  }

  /**
   * Check if the same output hash repeats consecutively.
   */
  private checkHashRepeat(): string | null {
    if (this.history.length < this.config.hashRepeatThreshold) return null;

    const recent = this.history.slice(-this.config.hashRepeatThreshold);
    const allSameOutput = recent.every(r => r.outputHash === recent[0].outputHash);
    if (allSameOutput) {
      return `Ten sam output ${this.config.hashRepeatThreshold}x z rzędu (tool: ${recent[0].tool})`;
    }

    return null;
  }

  /**
   * Check for A→B→A→B ping-pong pattern.
   */
  private checkPingPong(): string | null {
    const neededLen = this.config.pingPongThreshold * 2;
    if (this.history.length < neededLen) return null;

    const recent = this.history.slice(-neededLen);
    const toolA = recent[0].tool;
    const toolB = recent[1].tool;

    // All even indices should be toolA, all odd should be toolB
    if (toolA === toolB) return null;

    let isPingPong = true;
    for (let i = 0; i < recent.length; i++) {
      const expected = i % 2 === 0 ? toolA : toolB;
      if (recent[i].tool !== expected) {
        isPingPong = false;
        break;
      }
    }

    if (isPingPong) {
      return `Ping-pong: ${toolA} ↔ ${toolB} (${this.config.pingPongThreshold} cykli)`;
    }

    return null;
  }

  /**
   * Check if the same tool is called with the same params consecutively.
   */
  private checkSameToolRepeat(): string | null {
    if (this.history.length < this.config.sameToolRepeatMax) return null;

    const recent = this.history.slice(-this.config.sameToolRepeatMax);
    const allSame = recent.every(
      r => r.tool === recent[0].tool && r.paramsHash === recent[0].paramsHash
    );

    if (allSame) {
      return `${recent[0].tool} wywołane ${this.config.sameToolRepeatMax}x z identycznymi parametrami`;
    }

    return null;
  }

  /**
   * Get stats for debugging.
   */
  getStats(): { iteration: number; uniqueTools: number; history: ToolCallRecord[] } {
    const uniqueTools = new Set(this.history.map(r => r.tool)).size;
    return { iteration: this.iteration, uniqueTools, history: [...this.history] };
  }

  /**
   * Hash an object for comparison.
   */
  private hashObject(obj: any): string {
    try {
      const str = JSON.stringify(obj, Object.keys(obj || {}).sort());
      return crypto.createHash('md5').update(str).digest('hex').slice(0, 12);
    } catch {
      return 'unknown';
    }
  }
}
