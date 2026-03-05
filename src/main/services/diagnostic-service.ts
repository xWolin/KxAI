import { AIService } from './ai-service';
import { MemoryService } from './memory';
import { ConfigService } from './config';
import { CronService } from './cron-service';
import { WorkflowService } from './workflow-service';
import { RAGService } from './rag-service';
import { BrowserService } from './browser-service';
import { SystemMonitor } from './system-monitor';
import { ScreenMonitorService } from './screen-monitor';
import { ToolsService } from './tools-service';
import { TTSService } from './tts-service';
import { ScreenCaptureService } from './screen-capture';

/**
 * DiagnosticService — self-test system for KxAI agent.
 *
 * Runs comprehensive diagnostics across all subsystems:
 * - AI connection (latency, model, provider)
 * - Memory (read/write/list)
 * - Tools registry
 * - Screen capture & monitor
 * - Browser service
 * - RAG / vector search
 * - Cron service
 * - TTS
 * - System resources (CPU, RAM, disk, network)
 *
 * Each test returns pass/fail with timing and details.
 */

export interface DiagnosticResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  latencyMs?: number;
  details: string;
  error?: string;
}

export interface DiagnosticReport {
  timestamp: string;
  duration: number;
  summary: { pass: number; fail: number; warn: number; skip: number };
  results: DiagnosticResult[];
  system: {
    platform: string;
    arch: string;
    nodeVersion: string;
    electronVersion: string;
    memoryUsageMB: number;
    uptimeHours: number;
  };
}

export class DiagnosticService {
  private ai: AIService;
  private memory: MemoryService;
  private config: ConfigService;
  private cron: CronService;
  private workflow: WorkflowService;
  private tools: ToolsService;
  private systemMonitor: SystemMonitor;
  private rag?: RAGService;
  private browser?: BrowserService;
  private screenMonitor?: ScreenMonitorService;
  private screenCapture?: ScreenCaptureService;
  private tts?: TTSService;

  constructor(services: {
    ai: AIService;
    memory: MemoryService;
    config: ConfigService;
    cron: CronService;
    workflow: WorkflowService;
    tools: ToolsService;
    systemMonitor: SystemMonitor;
    rag?: RAGService;
    browser?: BrowserService;
    screenMonitor?: ScreenMonitorService;
    screenCapture?: ScreenCaptureService;
    tts?: TTSService;
  }) {
    this.ai = services.ai;
    this.memory = services.memory;
    this.config = services.config;
    this.cron = services.cron;
    this.workflow = services.workflow;
    this.tools = services.tools;
    this.systemMonitor = services.systemMonitor;
    this.rag = services.rag;
    this.browser = services.browser;
    this.screenMonitor = services.screenMonitor;
    this.screenCapture = services.screenCapture;
    this.tts = services.tts;
  }

  /**
   * Run full diagnostic suite.
   * Returns a structured report with all test results.
   */
  async runFullDiagnostic(): Promise<DiagnosticReport> {
    const startTime = Date.now();
    const results: DiagnosticResult[] = [];

    // Run all tests — order matters (fast → slow)
    results.push(await this.testConfig());
    results.push(await this.testMemory());
    results.push(await this.testToolsRegistry());
    results.push(await this.testCronService());
    results.push(await this.testWorkflowService());
    results.push(await this.testScreenMonitor());
    results.push(await this.testScreenCapture());
    results.push(await this.testRAG());
    results.push(await this.testBrowser());
    results.push(await this.testTTS());
    results.push(await this.testSystemResources());
    results.push(await this.testAIConnection()); // Slowest — API call

    const duration = Date.now() - startTime;

    const summary = {
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      warn: results.filter((r) => r.status === 'warn').length,
      skip: results.filter((r) => r.status === 'skip').length,
    };

    const sysInfo = this.systemMonitor.getSystemInfo();
    const _memInfo = this.systemMonitor.getMemoryInfo();

    return {
      timestamp: new Date().toISOString(),
      duration,
      summary,
      results,
      system: {
        platform: sysInfo.platform,
        arch: sysInfo.arch,
        nodeVersion: sysInfo.nodeVersion,
        electronVersion: sysInfo.electronVersion,
        memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        uptimeHours: sysInfo.uptimeHours,
      },
    };
  }

  // ─── Individual Tests ───

  private async testConfig(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    try {
      const config = this.config.getAll();
      const provider = config.aiProvider || 'nie ustawiony';
      const model = config.aiModel || 'nie ustawiony';
      const onboarded = config.onboarded ? 'tak' : 'nie';
      const userName = (config as any).userName || 'nie ustawiony';
      const agentName = (config as any).agentName || 'nie ustawiony';

      const isConfigured = !!config.aiProvider && !!config.aiModel;

      return {
        name: 'Konfiguracja',
        status: isConfigured ? 'pass' : 'fail',
        latencyMs: Date.now() - t0,
        details: `Provider: ${provider}, Model: ${model}, Onboarding: ${onboarded}, User: ${userName}, Agent: ${agentName}`,
        error: isConfigured ? undefined : 'Brak konfiguracji AI provider/model',
      };
    } catch (err: any) {
      return { name: 'Konfiguracja', status: 'fail', latencyMs: Date.now() - t0, details: '', error: err.message };
    }
  }

  private async testMemory(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    try {
      // Write test
      const testKey = '__diagnostic_test__.md';
      const testContent = `Diagnostic test: ${new Date().toISOString()}`;
      await this.memory.set(testKey, testContent);

      // Read test
      const readBack = await this.memory.get(testKey);
      const readOk = readBack === testContent;

      // Check conversation history
      const history = this.memory.getConversationHistory();

      // Clean up
      await this.memory.set(testKey, '');

      return {
        name: 'Pamięć (Memory)',
        status: readOk ? 'pass' : 'fail',
        latencyMs: Date.now() - t0,
        details: `Zapis/odczyt: ${readOk ? 'OK' : 'BŁĄD'}, Historia konwersacji: ${history.length} wiadomości`,
        error: readOk ? undefined : 'Zapis i odczyt nie zgadzają się',
      };
    } catch (err: any) {
      return { name: 'Pamięć (Memory)', status: 'fail', latencyMs: Date.now() - t0, details: '', error: err.message };
    }
  }

  private async testToolsRegistry(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    try {
      const defs = this.tools.getDefinitions();
      const categories: Record<string, number> = {};
      for (const d of defs) {
        categories[d.category] = (categories[d.category] || 0) + 1;
      }
      const catSummary = Object.entries(categories)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

      // Test a safe tool (get_current_time)
      const timeResult = await this.tools.execute('get_current_time', {});

      return {
        name: 'Narzędzia (Tools)',
        status: timeResult.success ? 'pass' : 'warn',
        latencyMs: Date.now() - t0,
        details: `${defs.length} narzędzi zarejestrowanych [${catSummary}]. Test get_current_time: ${timeResult.success ? 'OK' : 'BŁĄD'}`,
      };
    } catch (err: any) {
      return { name: 'Narzędzia (Tools)', status: 'fail', latencyMs: Date.now() - t0, details: '', error: err.message };
    }
  }

  private async testCronService(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    try {
      const jobs = this.cron.getJobs();
      const activeJobs = jobs.filter((j) => j.enabled).length;
      return {
        name: 'Cron Jobs',
        status: 'pass',
        latencyMs: Date.now() - t0,
        details: `${jobs.length} jobów (${activeJobs} aktywnych)`,
      };
    } catch (err: any) {
      return { name: 'Cron Jobs', status: 'fail', latencyMs: Date.now() - t0, details: '', error: err.message };
    }
  }

  private async testWorkflowService(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    try {
      const log = this.workflow.getActivityLog(100);
      const patterns = this.workflow.getPatterns();
      const timeCtx = this.workflow.buildTimeContext();
      return {
        name: 'Workflow / Wzorce',
        status: 'pass',
        latencyMs: Date.now() - t0,
        details: `${log.length} wpisów aktywności, ${patterns.length} wzorców, kontekst czasu: ${timeCtx.length} znaków`,
      };
    } catch (err: any) {
      return { name: 'Workflow / Wzorce', status: 'fail', latencyMs: Date.now() - t0, details: '', error: err.message };
    }
  }

  private async testScreenMonitor(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    if (!this.screenMonitor) {
      return { name: 'Screen Monitor', status: 'skip', details: 'Serwis nie zainicjalizowany' };
    }
    try {
      const running = this.screenMonitor.isRunning();
      const idleSec = this.screenMonitor.getIdleSeconds();
      const win = this.screenMonitor.getCurrentWindow();
      const ctx = this.screenMonitor.buildMonitorContext();

      return {
        name: 'Screen Monitor',
        status: running ? 'pass' : 'warn',
        latencyMs: Date.now() - t0,
        details: `Działa: ${running ? 'tak' : 'nie'}, Idle: ${idleSec}s, Okno: "${win.title.slice(0, 50)}", Kontekst: ${ctx.length} znaków`,
      };
    } catch (err: any) {
      return { name: 'Screen Monitor', status: 'fail', latencyMs: Date.now() - t0, details: '', error: err.message };
    }
  }

  private async testScreenCapture(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    if (!this.screenCapture) {
      return { name: 'Screen Capture', status: 'skip', details: 'Serwis nie zainicjalizowany' };
    }
    try {
      const capture = await this.screenCapture.captureForComputerUse();
      const hasCapture = !!capture && !!capture.base64;
      return {
        name: 'Screen Capture',
        status: hasCapture ? 'pass' : 'warn',
        latencyMs: Date.now() - t0,
        details: hasCapture
          ? `Screenshot OK (${Math.round(capture!.base64.length / 1024)}KB base64)`
          : 'Nie udało się zrobić screenshota',
      };
    } catch (err: any) {
      return { name: 'Screen Capture', status: 'fail', latencyMs: Date.now() - t0, details: '', error: err.message };
    }
  }

  private async testRAG(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    if (!this.rag) {
      return { name: 'RAG / Vector Search', status: 'skip', details: 'Serwis nie zainicjalizowany' };
    }
    try {
      const stats = this.rag.getStats();
      const searchResult = await this.rag.search('test', 1);
      return {
        name: 'RAG / Vector Search',
        status: stats.indexed ? 'pass' : 'warn',
        latencyMs: Date.now() - t0,
        details: `Zindeksowany: ${stats.indexed ? 'tak' : 'nie'}, ${stats.totalChunks} chunków z ${stats.totalFiles} plików, Embedding: ${stats.embeddingType}, Test search: ${searchResult.length} wyników`,
      };
    } catch (err: any) {
      return {
        name: 'RAG / Vector Search',
        status: 'fail',
        latencyMs: Date.now() - t0,
        details: '',
        error: err.message,
      };
    }
  }

  private async testBrowser(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    if (!this.browser) {
      return { name: 'Przeglądarka (Browser)', status: 'skip', details: 'Serwis nie zainicjalizowany' };
    }
    try {
      const running = this.browser.isRunning();
      return {
        name: 'Przeglądarka (Browser)',
        status: 'pass',
        latencyMs: Date.now() - t0,
        details: `Serwis dostępny, przeglądarka: ${running ? 'uruchomiona' : 'nie uruchomiona (gotowa do startu)'}`,
      };
    } catch (err: any) {
      return {
        name: 'Przeglądarka (Browser)',
        status: 'fail',
        latencyMs: Date.now() - t0,
        details: '',
        error: err.message,
      };
    }
  }

  private async testTTS(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    if (!this.tts) {
      return { name: 'TTS (Text-to-Speech)', status: 'skip', details: 'Serwis nie zainicjalizowany' };
    }
    try {
      const config = this.tts.getConfig();
      const speaking = this.tts.isSpeaking();
      return {
        name: 'TTS (Text-to-Speech)',
        status: config.enabled ? 'pass' : 'warn',
        latencyMs: Date.now() - t0,
        details: `Enabled: ${config.enabled}, Provider: ${config.provider}, Voice: ${config.openaiVoice || 'default'}, Model: ${config.openaiModel}, Mówi teraz: ${speaking ? 'tak' : 'nie'}`,
      };
    } catch (err: any) {
      return {
        name: 'TTS (Text-to-Speech)',
        status: 'fail',
        latencyMs: Date.now() - t0,
        details: '',
        error: err.message,
      };
    }
  }

  private async testSystemResources(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    try {
      const mem = this.systemMonitor.getMemoryInfo();
      const net = this.systemMonitor.getNetworkInfo();
      const warnings = await this.systemMonitor.getWarnings();

      const memStatus = mem.usagePercent < 85 ? 'OK' : 'WYSOKI';
      const hasInternet = net.connected;

      return {
        name: 'Zasoby systemowe',
        status: warnings.length === 0 ? 'pass' : 'warn',
        latencyMs: Date.now() - t0,
        details: `RAM: ${mem.usedGB.toFixed(1)}/${mem.totalGB.toFixed(1)}GB (${mem.usagePercent}% — ${memStatus}), Internet: ${hasInternet ? 'tak' : 'NIE'}, Ostrzeżenia: ${warnings.length > 0 ? warnings.join('; ') : 'brak'}`,
      };
    } catch (err: any) {
      return { name: 'Zasoby systemowe', status: 'fail', latencyMs: Date.now() - t0, details: '', error: err.message };
    }
  }

  private async testAIConnection(): Promise<DiagnosticResult> {
    const t0 = Date.now();
    try {
      // Send minimal test message — measures actual API round-trip
      // skipHistory: true — diagnostic messages must NOT appear in conversation
      const response = await this.ai.sendMessage(
        'Odpowiedz jednym słowem: OK',
        undefined,
        'Jesteś systemem diagnostycznym. Odpowiadaj jednym słowem.',
        { skipHistory: true },
      );
      const latency = Date.now() - t0;
      const gotResponse = response && response.trim().length > 0;

      const config = this.config.getAll();
      const provider = config.aiProvider || '?';
      const model = config.aiModel || '?';

      return {
        name: 'Połączenie AI',
        status: gotResponse ? 'pass' : 'fail',
        latencyMs: latency,
        details: `Provider: ${provider}, Model: ${model}, Latency: ${latency}ms, Odpowiedź: "${response.trim().slice(0, 50)}"`,
        error: gotResponse ? undefined : 'Brak odpowiedzi z API',
      };
    } catch (err: any) {
      return {
        name: 'Połączenie AI',
        status: 'fail',
        latencyMs: Date.now() - t0,
        details: '',
        error: `Nie można połączyć z API: ${err.message}`,
      };
    }
  }

  /**
   * Format report as human-readable markdown.
   */
  static formatReport(report: DiagnosticReport): string {
    const statusEmoji: Record<string, string> = {
      pass: '✅',
      fail: '❌',
      warn: '⚠️',
      skip: '⏭️',
    };

    let md = `# 🔬 Raport Diagnostyczny KxAI\n\n`;
    md += `**Data:** ${new Date(report.timestamp).toLocaleString('pl-PL')}\n`;
    md += `**Czas trwania:** ${report.duration}ms\n`;
    md += `**System:** ${report.system.platform} ${report.system.arch}, Node ${report.system.nodeVersion}, Electron ${report.system.electronVersion}\n`;
    md += `**Pamięć procesu:** ${report.system.memoryUsageMB}MB\n\n`;

    md += `## Podsumowanie\n`;
    md += `| Status | Ilość |\n|---|---|\n`;
    md += `| ✅ Pass | ${report.summary.pass} |\n`;
    md += `| ❌ Fail | ${report.summary.fail} |\n`;
    md += `| ⚠️ Warn | ${report.summary.warn} |\n`;
    md += `| ⏭️ Skip | ${report.summary.skip} |\n\n`;

    md += `## Wyniki testów\n\n`;
    for (const r of report.results) {
      md += `### ${statusEmoji[r.status]} ${r.name}`;
      if (r.latencyMs !== undefined) md += ` (${r.latencyMs}ms)`;
      md += `\n`;
      md += `${r.details}\n`;
      if (r.error) md += `**Błąd:** ${r.error}\n`;
      md += `\n`;
    }

    // Overall verdict
    if (report.summary.fail === 0) {
      md += `---\n\n🎉 **Wszystkie krytyczne systemy działają poprawnie!**\n`;
    } else {
      md += `---\n\n🚨 **${report.summary.fail} test(ów) nie przeszło — wymaga uwagi.**\n`;
    }

    return md;
  }
}
