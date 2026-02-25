/**
 * ServiceContainer — lightweight DI container for all KxAI services.
 *
 * Replaces 22 `let` declarations + manual wiring in main.ts.
 * Provides typed access, centralized init, and ordered graceful shutdown.
 *
 * Usage:
 *   const container = new ServiceContainer();
 *   await container.init();
 *   const ai = container.get('ai');
 *   ...
 *   await container.shutdown();
 */

import { createLogger } from './logger';
import { ConfigService } from './config';
import { SecurityService } from './security';
import { DatabaseService } from './database-service';
import { MemoryService } from './memory';
import { AIService } from './ai-service';
import { ScreenCaptureService } from './screen-capture';
import { CronService } from './cron-service';
import { ToolsService } from './tools-service';
import { WorkflowService } from './workflow-service';
import { AgentLoop } from './agent-loop';
import { EmbeddingService } from './embedding-service';
import { RAGService } from './rag-service';
import { AutomationService } from './automation-service';
import { BrowserService } from './browser-service';
import { PluginService } from './plugin-service';
import { SecurityGuard } from './security-guard';
import { SystemMonitor } from './system-monitor';
import { TTSService } from './tts-service';
import { ScreenMonitorService } from './screen-monitor';
import { TranscriptionService } from './transcription-service';
import { MeetingCoachService } from './meeting-coach';
import { DashboardServer } from './dashboard-server';
import { DiagnosticService } from './diagnostic-service';
import { UpdaterService } from './updater-service';
import { McpClientService } from './mcp-client-service';
import { FileIntelligenceService } from './file-intelligence';
import { CalendarService } from './calendar-service';
import { PrivacyService } from './privacy-service';
import { ClipboardService } from './clipboard-service';

const log = createLogger('Container');

// ─── Service Map — typed registry of all services ───

export interface ServiceMap {
  config: ConfigService;
  security: SecurityService;
  database: DatabaseService;
  memory: MemoryService;
  ai: AIService;
  screenCapture: ScreenCaptureService;
  cron: CronService;
  tools: ToolsService;
  workflow: WorkflowService;
  agentLoop: AgentLoop;
  embedding: EmbeddingService;
  rag: RAGService;
  automation: AutomationService;
  browser: BrowserService;
  plugins: PluginService;
  securityGuard: SecurityGuard;
  systemMonitor: SystemMonitor;
  tts: TTSService;
  screenMonitor: ScreenMonitorService;
  transcription: TranscriptionService;
  meetingCoach: MeetingCoachService;
  dashboard: DashboardServer;
  diagnostic: DiagnosticService;
  updater: UpdaterService;
  mcpClient: McpClientService;
  fileIntelligence: FileIntelligenceService;
  calendar: CalendarService;
  privacy: PrivacyService;
  clipboard: ClipboardService;
}

export type ServiceKey = keyof ServiceMap;

/**
 * IPC-compatible services object — matches the Services interface expected by setupIPC().
 * Provides backward compatibility with existing ipc.ts without changing its interface.
 */
export interface IPCServices {
  configService: ConfigService;
  securityService: SecurityService;
  memoryService: MemoryService;
  aiService: AIService;
  screenCapture: ScreenCaptureService;
  cronService: CronService;
  toolsService: ToolsService;
  workflowService: WorkflowService;
  agentLoop: AgentLoop;
  ragService: RAGService;
  automationService: AutomationService;
  browserService: BrowserService;
  pluginService: PluginService;
  securityGuardService: SecurityGuard;
  systemMonitorService: SystemMonitor;
  ttsService: TTSService;
  screenMonitorService: ScreenMonitorService;
  meetingCoachService?: MeetingCoachService;
  dashboardServer?: DashboardServer;
  updaterService: UpdaterService;
  mcpClientService: McpClientService;
  calendarService: CalendarService;
  privacyService: PrivacyService;
  clipboardService: ClipboardService;
}

export class ServiceContainer {
  private services = new Map<string, any>();
  private initialized = false;

  /**
   * Get a registered service by key (typed).
   * Throws if the container hasn't been initialized yet or service doesn't exist.
   */
  get<K extends ServiceKey>(key: K): ServiceMap[K] {
    if (!this.initialized) {
      throw new Error(`ServiceContainer not initialized — call init() first`);
    }
    const svc = this.services.get(key);
    if (!svc) {
      throw new Error(`Service '${key}' not found in container`);
    }
    return svc as ServiceMap[K];
  }

  /**
   * Check if a service is registered (useful for optional services).
   */
  has(key: ServiceKey): boolean {
    return this.services.has(key);
  }

  /**
   * Initialize all services in dependency order.
   * Replaces the ~100 lines of initializeServices() in main.ts.
   *
   * Performance optimizations:
   * - Phase 3: memory + embedding initialized in parallel (no cross-deps)
   * - Phase 4: rag + plugins initialized in parallel
   * - Phase 6 (deferred): MCP, dashboard, diagnostic — non-critical, post-window
   * - Per-phase timing for profiling
   */
  async init(): Promise<void> {
    if (this.initialized) {
      throw new Error('ServiceContainer already initialized');
    }

    log.info('Initializing services...');
    const t0 = Date.now();
    const phase = (name: string) => {
      const start = Date.now();
      return () => log.info(`  ${name}: ${Date.now() - start}ms`);
    };

    // ── Phase 1: Core (no deps) ──
    let p = phase('Phase 1 — Core');
    const config = new ConfigService();
    const security = new SecurityService();
    const database = new DatabaseService();
    this.set('config', config);
    this.set('security', security);
    this.set('database', database);

    // Initialize database early (needed by memory, embedding, RAG)
    database.initialize();
    p();

    // ── Phase 2: Services depending on core (constructors only — fast) ──
    p = phase('Phase 2 — Construct');
    const memory = new MemoryService(config, database);
    const ai = new AIService(config, security);
    const screenCapture = new ScreenCaptureService();
    const cron = new CronService();
    const tools = new ToolsService();
    const workflow = new WorkflowService();
    const embedding = new EmbeddingService(security, config, database);
    const automation = new AutomationService();
    const browser = new BrowserService();
    const plugins = new PluginService();
    const securityGuard = new SecurityGuard();
    const systemMonitor = new SystemMonitor();
    const tts = new TTSService(security);
    const screenMonitor = new ScreenMonitorService();
    const transcription = new TranscriptionService(security);
    const updater = new UpdaterService();
    const mcpClient = new McpClientService();
    const fileIntelligence = new FileIntelligenceService();
    const calendar = new CalendarService(config);
    const privacy = new PrivacyService(database);
    const clipboardSvc = new ClipboardService();

    this.set('memory', memory);
    this.set('ai', ai);
    this.set('screenCapture', screenCapture);
    this.set('cron', cron);
    this.set('tools', tools);
    this.set('workflow', workflow);
    this.set('embedding', embedding);
    this.set('automation', automation);
    this.set('browser', browser);
    this.set('plugins', plugins);
    this.set('securityGuard', securityGuard);
    this.set('systemMonitor', systemMonitor);
    this.set('tts', tts);
    this.set('screenMonitor', screenMonitor);
    this.set('transcription', transcription);
    this.set('updater', updater);
    this.set('mcpClient', mcpClient);
    this.set('fileIntelligence', fileIntelligence);
    this.set('calendar', calendar);
    this.set('privacy', privacy);
    this.set('clipboard', clipboardSvc);
    p();

    // ── Phase 3: Async initialization (parallelized — no cross-deps) ──
    p = phase('Phase 3 — Async init (memory ‖ embedding)');
    await Promise.all([memory.initialize(), embedding.initialize()]);
    p();

    // ── Phase 4: Services depending on async-initialized services (parallelized) ──
    p = phase('Phase 4 — RAG ‖ plugins');
    const rag = new RAGService(embedding, config, database, fileIntelligence);
    this.set('rag', rag);
    await Promise.all([rag.initialize(), plugins.initialize()]);
    p();

    // ── Phase 5: Cross-service wiring (sync, fast) ──
    p = phase('Phase 5 — Wiring');
    ai.setMemoryService(memory);

    tools.setServices({
      automation,
      browser,
      rag,
      plugins,
      cron,
      fileIntelligence,
      calendar,
      privacy,
      securityGuard,
      systemMonitor,
    });

    // MCP Client wiring (dependencies only, no network I/O)
    mcpClient.setDependencies({ toolsService: tools, configService: config });

    // Clipboard wiring
    clipboardSvc.setDependencies({ database, toolsService: tools, configService: config });

    // Agent loop — central orchestrator
    const agentLoop = new AgentLoop(ai, tools, cron, workflow, memory, config);
    agentLoop.setRAGService(rag);
    agentLoop.setAutomationService(automation);
    agentLoop.setScreenCaptureService(screenCapture);
    this.set('agentLoop', agentLoop);

    // Screen monitor ↔ screen capture
    screenMonitor.setScreenCapture(screenCapture);
    agentLoop.setScreenMonitorService(screenMonitor);

    // Meeting Coach
    const meetingCoach = new MeetingCoachService(transcription, ai, config, security, rag, screenCapture);
    this.set('meetingCoach', meetingCoach);

    // Start cron jobs (non-blocking, no I/O)
    cron.startAll();

    // Calendar initialization (loads connections from config, auto-connects in background)
    void calendar.initialize();
    p();

    this.initialized = true;
    log.info(`Core services initialized in ${Date.now() - t0}ms`);
  }

  /**
   * Initialize non-critical services after the main window is shown.
   * This includes dashboard, diagnostic, MCP client auto-connect.
   * Splitting these from init() shaves ~200-500ms off perceived startup time.
   */
  async initDeferred(): Promise<void> {
    if (!this.initialized) {
      throw new Error('ServiceContainer not initialized — call init() first');
    }

    log.info('Initializing deferred services...');
    const t0 = Date.now();

    const meetingCoach = this.get('meetingCoach');
    const tools = this.get('tools');
    const cron = this.get('cron');
    const rag = this.get('rag');
    const workflow = this.get('workflow');
    const systemMonitor = this.get('systemMonitor');
    const mcpClient = this.get('mcpClient');
    const ai = this.get('ai');
    const memory = this.get('memory');
    const config = this.get('config');
    const browser = this.get('browser');
    const screenMonitor = this.get('screenMonitor');
    const screenCapture = this.get('screenCapture');
    const tts = this.get('tts');

    // Dashboard server
    const meetingConfig = meetingCoach.getConfig();
    const dashboard = new DashboardServer(meetingCoach, meetingConfig.dashboardPort, {
      tools,
      cron,
      rag,
      workflow,
      systemMonitor,
      mcpClient,
    });
    this.set('dashboard', dashboard);

    // Start dashboard (non-blocking)
    dashboard.start().catch((err) => {
      log.error('Dashboard server failed to start:', err);
    });

    // Forward meeting events to dashboard WebSocket
    const meetingDashEvents = [
      'meeting:state',
      'meeting:transcript',
      'meeting:coaching',
      'meeting:coaching-chunk',
      'meeting:coaching-done',
      'meeting:started',
      'meeting:stopped',
    ];
    for (const event of meetingDashEvents) {
      meetingCoach.on(event, (data: any) => {
        dashboard.pushEvent(event, data);
      });
    }

    // Diagnostic service — self-test
    const diagnostic = new DiagnosticService({
      ai,
      memory,
      config,
      cron,
      workflow,
      tools,
      systemMonitor,
      rag,
      browser,
      screenMonitor,
      screenCapture,
      tts,
    });
    this.set('diagnostic', diagnostic);

    // Register self-test tool
    tools.register(
      {
        name: 'self_test',
        description:
          'Uruchamia pełną diagnostykę agenta — testuje wszystkie podsystemy (AI, pamięć, narzędzia, przeglądarkę, RAG, cron, TTS, screen monitor, zasoby systemowe). Użyj gdy użytkownik prosi o self-test lub "przetestuj się".',
        category: 'system',
        parameters: {},
      },
      async () => {
        const report = await diagnostic.runFullDiagnostic();
        return {
          success: report.summary.fail === 0,
          data: DiagnosticService.formatReport(report),
        };
      },
    );

    // Initialize MCP Client (auto-connects configured servers — network I/O)
    await mcpClient.initialize();

    // Initialize Clipboard Pipeline (opt-in monitoring, tools registration)
    const clipboardSvc = this.get('clipboard');
    await clipboardSvc.initialize();

    log.info(`Deferred services initialized in ${Date.now() - t0}ms`);
  }

  /**
   * Graceful shutdown — stops services in reverse dependency order.
   * 6-phase sequential shutdown with proper error isolation.
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    log.info('Graceful shutdown started');
    const t0 = Date.now();

    // ── Phase 1: Stop active processing (prevent new work) ──
    this.trySync('agentLoop', (s) => s.stopProcessing());
    this.trySync('screenMonitor', (s) => s.stop());
    this.trySync('cron', (s) => s.stopAll());
    this.trySync('updater', (s) => s.destroy());
    this.trySync('clipboard', (s) => s.shutdown());

    // ── Phase 2: Close network connections ──
    await this.tryAsync('calendar', (s) => s.shutdown());
    await this.tryAsync('mcpClient', (s) => s.shutdown());
    await this.tryAsync('meetingCoach', (s) => s.stopMeeting());
    await this.tryAsync('transcription', (s) => s.stopAll());
    await this.tryAsync('browser', (s) => s.close());
    await this.tryAsync('dashboard', (s) => s.stop());

    // ── Phase 3: Stop watchers and plugins ──
    this.trySync('rag', (s) => s.destroy());
    this.trySync('plugins', (s) => s.destroy());

    // ── Phase 4: Cleanup temp resources ──
    this.trySync('tts', (s) => s.cleanup());

    // ── Phase 5: Flush caches & persist data ──
    this.trySync('embedding', (s) => {
      s.flushCache();
      s.terminateWorker();
    });
    await this.tryAsync('config', (s) => s.shutdown());

    // ── Phase 6: Close database (must be last) ──
    this.trySync('memory', (s) => s.shutdown());
    this.trySync('database', (s) => s.close());

    log.info(`Graceful shutdown completed in ${Date.now() - t0}ms`);
  }

  /**
   * Returns an IPC-compatible services object for setupIPC().
   * Maps container's short keys to the expected property names.
   */
  getIPCServices(): IPCServices {
    return {
      configService: this.get('config'),
      securityService: this.get('security'),
      memoryService: this.get('memory'),
      aiService: this.get('ai'),
      screenCapture: this.get('screenCapture'),
      cronService: this.get('cron'),
      toolsService: this.get('tools'),
      workflowService: this.get('workflow'),
      agentLoop: this.get('agentLoop'),
      ragService: this.get('rag'),
      automationService: this.get('automation'),
      browserService: this.get('browser'),
      pluginService: this.get('plugins'),
      securityGuardService: this.get('securityGuard'),
      systemMonitorService: this.get('systemMonitor'),
      ttsService: this.get('tts'),
      screenMonitorService: this.get('screenMonitor'),
      meetingCoachService: this.has('meetingCoach') ? this.get('meetingCoach') : undefined,
      dashboardServer: this.has('dashboard') ? this.get('dashboard') : undefined,
      updaterService: this.get('updater'),
      mcpClientService: this.get('mcpClient'),
      calendarService: this.get('calendar'),
      privacyService: this.get('privacy'),
      clipboardService: this.get('clipboard'),
    };
  }

  // ─── Private helpers ───

  private set<K extends ServiceKey>(key: K, service: ServiceMap[K]): void {
    this.services.set(key, service);
  }

  /** Safely call a sync method on a service, logging errors. */
  private trySync<K extends ServiceKey>(key: K, fn: (service: ServiceMap[K]) => void): void {
    if (!this.has(key)) return;
    try {
      fn(this.get(key));
    } catch (err) {
      log.error(`${key} shutdown error:`, err);
    }
  }

  /** Safely call an async method on a service, logging errors. */
  private async tryAsync<K extends ServiceKey>(key: K, fn: (service: ServiceMap[K]) => Promise<any>): Promise<void> {
    if (!this.has(key)) return;
    try {
      await fn(this.get(key));
    } catch (err) {
      log.error(`${key} shutdown error:`, err);
    }
  }
}
