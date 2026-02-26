/**
 * DashboardServer — Full agent dashboard on localhost.
 *
 * Serves a responsive SPA dashboard on localhost:5678 (configurable).
 * Features:
 *   - Agent status & activity timeline
 *   - Tools reference & keyboard shortcuts
 *   - Cron jobs management
 *   - RAG index stats
 *   - System monitor
 *   - Meeting summaries
 *   - WebSocket for real-time updates
 *
 * Endpoints:
 *   GET /                    — Dashboard SPA
 *   GET /api/status          — Agent state snapshot
 *   GET /api/tools           — Available tools list
 *   GET /api/cron            — Cron jobs
 *   GET /api/rag             — RAG stats
 *   GET /api/system          — System snapshot
 *   GET /api/meetings        — Meeting summaries
 *   GET /api/meeting/:id     — Single meeting detail
 *   GET /api/activity        — Workflow activity log
 *   GET /api/subagents       — Active sub-agents
 *   WebSocket /ws            — Real-time agent events
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MeetingCoachService, ParticipantResearch } from './meeting-coach';
import { ToolsService } from './tools-service';
import { CronService } from './cron-service';
import { RAGService } from './rag-service';
import { WorkflowService } from './workflow-service';
import { SystemMonitor } from './system-monitor';
import { McpClientService } from './mcp-client-service';
import { createLogger } from './logger';
import type { AgentStatus } from './agent-loop';

const log = createLogger('Dashboard');

interface DashboardServices {
  meetingCoach: MeetingCoachService;
  tools?: ToolsService;
  cron?: CronService;
  rag?: RAGService;
  workflow?: WorkflowService;
  systemMonitor?: SystemMonitor;
  mcpClient?: McpClientService;
}

export class DashboardServer {
  private app: express.Express;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private meetingCoach: MeetingCoachService;
  private services: DashboardServices;
  private port: number;
  private lastAgentStatus: AgentStatus = { state: 'idle' };
  private subAgentListFn?: () => any[];
  private subAgentResultsFn?: () => any[];
  private spaHtml: string;
  /** Per-session auth token — required for all /api/* requests */
  private authToken: string;

  constructor(meetingCoach: MeetingCoachService, port: number = 5678, services?: Partial<DashboardServices>) {
    this.meetingCoach = meetingCoach;
    this.port = port;
    this.services = { meetingCoach, ...services };
    this.app = express();
    this.app.use(express.json({ limit: '1mb' }));

    // Generate random auth token per session
    this.authToken = crypto.randomBytes(32).toString('hex');

    // Auth middleware for /api/* routes
    this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token !== this.authToken) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      next();
    });

    // Load SPA HTML from file (co-located with this module)
    try {
      this.spaHtml = fs.readFileSync(path.join(__dirname, 'dashboard-spa.html'), 'utf-8');
    } catch {
      this.spaHtml = '<html><body><h1>KxAI Dashboard</h1><p>SPA file not found.</p></body></html>';
    }

    this.setupRoutes();
  }

  /** Get the auth token — pass to renderer via IPC so in-app dashboard can authenticate */
  getAuthToken(): string {
    return this.authToken;
  }

  /**
   * Set functions to get sub-agent data (injected from IPC layer to avoid circular deps).
   */
  setSubAgentAccessors(listFn: () => any[], resultsFn: () => any[]): void {
    this.subAgentListFn = listFn;
    this.subAgentResultsFn = resultsFn;
  }

  /**
   * Push agent status to all WebSocket clients.
   */
  pushAgentStatus(status: AgentStatus): void {
    this.lastAgentStatus = status;
    this.broadcast({ type: 'agent:status', data: status });
  }

  /**
   * Push arbitrary event to all WebSocket clients.
   */
  pushEvent(eventType: string, data: any): void {
    this.broadcast({ type: eventType, data });
  }

  private broadcast(message: { type: string; data: any }): void {
    if (!this.wss) return;
    const json = JSON.stringify(message);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(json);
        } catch (err) {
          log.error('WebSocket send error:', err);
        }
      }
    });
  }

  private setupRoutes(): void {
    // ─── API: Agent Status ───
    this.app.get('/api/status', (_req: Request, res: Response) => {
      res.json({
        success: true,
        data: {
          agentStatus: this.lastAgentStatus,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        },
      });
    });

    // ─── API: Tools ───
    this.app.get('/api/tools', (_req: Request, res: Response) => {
      if (!this.services.tools) {
        res.json({ success: true, data: [] });
        return;
      }
      const tools = this.services.tools.getDefinitions();
      res.json({ success: true, data: tools });
    });

    // ─── API: Cron Jobs ───
    this.app.get('/api/cron', (_req: Request, res: Response) => {
      if (!this.services.cron) {
        res.json({ success: true, data: [] });
        return;
      }
      const jobs = this.services.cron.getJobs();
      res.json({ success: true, data: jobs });
    });

    // ─── API: RAG Stats ───
    this.app.get('/api/rag', (_req: Request, res: Response) => {
      if (!this.services.rag) {
        res.json({ success: true, data: null });
        return;
      }
      const stats = this.services.rag.getStats();
      res.json({ success: true, data: stats });
    });

    // ─── API: System ───
    this.app.get('/api/system', async (_req: Request, res: Response) => {
      if (!this.services.systemMonitor) {
        res.json({ success: true, data: null });
        return;
      }
      try {
        const snapshot = await this.services.systemMonitor.getSnapshot();
        res.json({ success: true, data: snapshot });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ─── API: Activity ───
    this.app.get('/api/activity', async (_req: Request, res: Response) => {
      if (!this.services.workflow) {
        res.json({ success: true, data: [] });
        return;
      }
      try {
        const limit = parseInt(String(_req.query.limit)) || 50;
        const activity = await this.services.workflow.getActivityLog(limit);
        res.json({ success: true, data: activity });
      } catch (err: any) {
        log.error('Activity fetch error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ─── API: Sub-agents ───
    this.app.get('/api/subagents', (_req: Request, res: Response) => {
      const active = this.subAgentListFn?.() || [];
      const results = this.subAgentResultsFn?.() || [];
      res.json({ success: true, data: { active, results } });
    });

    // ─── API: Meetings ───
    this.app.get('/api/meetings', async (_req: Request, res: Response) => {
      try {
        const summaries = await this.meetingCoach.getSummaries();
        res.json({ success: true, data: summaries });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.get('/api/meeting/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;
        const summary = await this.meetingCoach.getSummary(id);
        if (!summary) {
          res.status(404).json({ success: false, error: 'Nie znaleziono spotkania' });
          return;
        }
        res.json({ success: true, data: summary });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ─── API: Meeting Prep — Research participant ───
    this.app.post('/api/meeting-prep/research', async (req: Request, res: Response) => {
      try {
        const { participants, userContext } = req.body as {
          participants: Array<{ name: string; company?: string; role?: string; photoBase64?: string }>;
          userContext?: string;
        };

        if (!participants || !Array.isArray(participants) || participants.length === 0) {
          res.status(400).json({ success: false, error: 'Brak uczestników do zbadania' });
          return;
        }

        if (participants.length > 10) {
          res.status(400).json({ success: false, error: 'Maksymalnie 10 uczestników na raz' });
          return;
        }

        // Research all participants sequentially
        const results: ParticipantResearch[] = [];
        for (const p of participants) {
          if (!p.name || p.name.trim().length < 2) continue;
          const result = await this.meetingCoach.researchParticipant(
            { name: p.name.trim(), company: p.company, role: p.role, photoBase64: p.photoBase64 },
            userContext,
          );
          results.push(result);
        }

        res.json({ success: true, data: results });
      } catch (err: any) {
        log.error('Meeting prep research error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ─── API: Meeting Prep — Research single participant (streaming progress via WebSocket) ───
    this.app.post('/api/meeting-prep/research-one', async (req: Request, res: Response) => {
      try {
        const { name, company, role, photoBase64, userContext } = req.body as {
          name: string;
          company?: string;
          role?: string;
          photoBase64?: string;
          userContext?: string;
        };

        if (!name || name.trim().length < 2) {
          res.status(400).json({ success: false, error: 'Podaj imię i nazwisko (min 2 znaki)' });
          return;
        }

        const result = await this.meetingCoach.researchParticipant(
          { name: name.trim(), company, role, photoBase64 },
          userContext,
          (status: string) => this.broadcast({ type: 'meeting-prep:progress', data: { name, status } }),
        );

        res.json({ success: true, data: result });
      } catch (err: any) {
        log.error('Meeting prep research-one error:', err);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ─── API: MCP Hub ───
    this.app.get('/api/mcp', (_req: Request, res: Response) => {
      if (!this.services.mcpClient) {
        res.json({ success: true, data: { servers: [], totalTools: 0, connectedCount: 0 } });
        return;
      }
      res.json({ success: true, data: this.services.mcpClient.getStatus() });
    });

    this.app.get('/api/mcp/registry', (_req: Request, res: Response) => {
      if (!this.services.mcpClient) {
        res.json({ success: true, data: [] });
        return;
      }
      res.json({ success: true, data: this.services.mcpClient.getRegistry() });
    });

    this.app.post('/api/mcp/connect', async (req: Request, res: Response) => {
      if (!this.services.mcpClient) {
        res.status(503).json({ success: false, error: 'MCP not available' });
        return;
      }
      try {
        await this.services.mcpClient.connect(req.body.id);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/mcp/disconnect', async (req: Request, res: Response) => {
      if (!this.services.mcpClient) {
        res.status(503).json({ success: false, error: 'MCP not available' });
        return;
      }
      try {
        await this.services.mcpClient.disconnect(req.body.id);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/mcp/remove', async (req: Request, res: Response) => {
      if (!this.services.mcpClient) {
        res.status(503).json({ success: false, error: 'MCP not available' });
        return;
      }
      try {
        await this.services.mcpClient.removeServer(req.body.id);
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.post('/api/mcp/add-from-registry', async (req: Request, res: Response) => {
      if (!this.services.mcpClient) {
        res.status(503).json({ success: false, error: 'MCP not available' });
        return;
      }
      try {
        const registry = this.services.mcpClient.getRegistry();
        const entry = registry.find((r) => r.id === req.body.registryId);
        if (!entry) {
          res.status(404).json({ success: false, error: 'Registry entry not found' });
          return;
        }

        const config = {
          name: entry.name,
          transport: entry.transport as any,
          command: entry.command,
          args: entry.args,
          url: entry.url,
          env: entry.env,
          autoConnect: !entry.requiresSetup,
          enabled: true,
          icon: entry.icon,
          category: entry.category,
        };
        const server = await this.services.mcpClient.addServer(config);

        // Auto-connect if no setup required
        if (!entry.requiresSetup) {
          await this.services.mcpClient.connect(server.id).catch(() => {});
        }

        res.json({ success: true, data: server });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // ─── Dashboard SPA ───
    this.app.get('/', (_req: Request, res: Response) => {
      // Inject auth token into SPA so it can authenticate API calls
      const html = this.spaHtml.replace("var API = '';", `var API = ''; var AUTH_TOKEN = '${this.authToken}';`);
      res.type('html').send(html);
    });

    // Legacy meeting routes — redirect to SPA
    this.app.get('/meeting/:id', async (req: Request, res: Response) => {
      res.redirect(`/#/meeting/${req.params.id}`);
    });
  }

  async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '127.0.0.1', () => {
        log.info(`Serwer uruchomiony: http://localhost:${this.port}`);

        // Setup WebSocket server
        this.wss = new WebSocketServer({ server: this.server!, maxPayload: 1024 * 1024 });
        this.wss.on('connection', (ws, req) => {
          // Validate auth token from query parameter
          const url = new URL(req.url || '', `http://localhost:${this.port}`);
          const token = url.searchParams.get('token');
          if (token !== this.authToken) {
            ws.close(4001, 'Unauthorized');
            return;
          }
          // Send current status on connect
          ws.send(JSON.stringify({ type: 'agent:status', data: this.lastAgentStatus }));
        });

        resolve();
      });
      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          log.warn(`Port ${this.port} zajęty, próbuję ${this.port + 1}...`);
          this.port++;
          const retryServer = this.app.listen(this.port, '127.0.0.1', () => {
            log.info(`Serwer uruchomiony: http://localhost:${this.port}`);
            this.server = retryServer;
            this.wss = new WebSocketServer({ server: this.server!, maxPayload: 1024 * 1024 });
            this.wss.on('connection', (ws, req) => {
              // Validate auth token from query parameter
              const url = new URL(req.url || '', `http://localhost:${this.port}`);
              const token = url.searchParams.get('token');
              if (token !== this.authToken) {
                ws.close(4001, 'Unauthorized');
                return;
              }
              ws.send(JSON.stringify({ type: 'agent:status', data: this.lastAgentStatus }));
            });
            resolve();
          });
          retryServer.on('error', (retryErr: any) => {
            reject(retryErr);
          });
        } else {
          reject(err);
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          log.info('Serwer zatrzymany');
          this.server = null;
          resolve();
        });
      });
    }
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  getPort(): number {
    return this.port;
  }
}
