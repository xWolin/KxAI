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

import * as fs from 'fs';
import * as path from 'path';
import express, { Request, Response } from 'express';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MeetingCoachService } from './meeting-coach';
import { ToolsService } from './tools-service';
import { CronService } from './cron-service';
import { RAGService } from './rag-service';
import { WorkflowService } from './workflow-service';
import { SystemMonitor } from './system-monitor';
import type { AgentStatus } from './agent-loop';

interface DashboardServices {
  meetingCoach: MeetingCoachService;
  tools?: ToolsService;
  cron?: CronService;
  rag?: RAGService;
  workflow?: WorkflowService;
  systemMonitor?: SystemMonitor;
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

  constructor(meetingCoach: MeetingCoachService, port: number = 5678, services?: Partial<DashboardServices>) {
    this.meetingCoach = meetingCoach;
    this.port = port;
    this.services = { meetingCoach, ...services };
    this.app = express();
    this.app.use(express.json());

    // Load SPA HTML from file (co-located with this module)
    try {
      this.spaHtml = fs.readFileSync(path.join(__dirname, 'dashboard-spa.html'), 'utf-8');
    } catch {
      this.spaHtml = '<html><body><h1>KxAI Dashboard</h1><p>SPA file not found.</p></body></html>';
    }

    this.setupRoutes();
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
          console.error('[Dashboard] WebSocket send error:', err);
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
        console.error('[Dashboard] Activity fetch error:', err);
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

    // ─── Dashboard SPA ───
    this.app.get('/', (_req: Request, res: Response) => {
      res.type('html').send(this.spaHtml);
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
        console.log(`[Dashboard] Serwer uruchomiony: http://localhost:${this.port}`);

        // Setup WebSocket server
        this.wss = new WebSocketServer({ server: this.server! });
        this.wss.on('connection', (ws) => {
          // Send current status on connect
          ws.send(JSON.stringify({ type: 'agent:status', data: this.lastAgentStatus }));
        });

        resolve();
      });
      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[Dashboard] Port ${this.port} zajęty, próbuję ${this.port + 1}...`);
          this.port++;
          this.server = this.app.listen(this.port, '127.0.0.1', () => {
            console.log(`[Dashboard] Serwer uruchomiony: http://localhost:${this.port}`);
            this.wss = new WebSocketServer({ server: this.server! });
            this.wss.on('connection', (ws) => {
              ws.send(JSON.stringify({ type: 'agent:status', data: this.lastAgentStatus }));
            });
            resolve();
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
          console.log('[Dashboard] Serwer zatrzymany');
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
