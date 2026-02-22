/**
 * DashboardServer — Localhost HTTP server for viewing meeting summaries.
 *
 * Serves a responsive HTML dashboard on localhost:5678 (configurable).
 * Uses Node.js built-in http + express for routing.
 *
 * Endpoints:
 *   GET /                — Dashboard (list of meetings)
 *   GET /meeting/:id     — Single meeting detail view
 *   GET /api/meetings    — JSON list of meetings
 *   GET /api/meeting/:id — JSON single meeting
 */

import express, { Request, Response } from 'express';
import * as http from 'http';
import { MeetingCoachService, MeetingSummary } from './meeting-coach';

export class DashboardServer {
  private app: express.Express;
  private server: http.Server | null = null;
  private meetingCoach: MeetingCoachService;
  private port: number;

  constructor(meetingCoach: MeetingCoachService, port: number = 5678) {
    this.meetingCoach = meetingCoach;
    this.port = port;
    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // API endpoints
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

    // HTML pages
    this.app.get('/', async (_req: Request, res: Response) => {
      try {
        const summaries = await this.meetingCoach.getSummaries();
        res.send(this.renderListPage(summaries));
      } catch (err: any) {
        console.error('[Dashboard] Error rendering list page:', err);
        res.status(500).send(this.renderErrorPage('Wewnętrzny błąd serwera'));
      }
    });

    this.app.get('/meeting/:id', async (req: Request, res: Response) => {
      try {
        const id = req.params.id as string;
        const summary = await this.meetingCoach.getSummary(id);
        if (!summary) {
          res.status(404).send(this.renderErrorPage('Nie znaleziono spotkania'));
          return;
        }
        res.send(this.renderDetailPage(summary));
      } catch (err: any) {
        console.error('[Dashboard] Error rendering detail page:', err);
        res.status(500).send(this.renderErrorPage('Wewnętrzny błąd serwera'));
      }
    });
  }

  /**
   * Start the dashboard server.
   */
  async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '127.0.0.1', () => {
        console.log(`[Dashboard] Serwer uruchomiony: http://localhost:${this.port}`);
        resolve();
      });
      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[Dashboard] Port ${this.port} zajęty, próbuję ${this.port + 1}...`);
          this.port++;
          this.server = this.app.listen(this.port, '127.0.0.1', () => {
            console.log(`[Dashboard] Serwer uruchomiony: http://localhost:${this.port}`);
            resolve();
          });
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Stop the dashboard server.
   */
  async stop(): Promise<void> {
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

  /**
   * Get the dashboard URL.
   */
  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Get the actual port.
   */
  getPort(): number {
    return this.port;
  }

  // ──────────────── HTML Rendering ────────────────

  private renderLayout(title: string, content: string): string {
    return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — KxAI Meeting Coach</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface2: #21262d;
      --border: #30363d;
      --text: #e6edf3;
      --text-dim: #8b949e;
      --accent: #58a6ff;
      --accent2: #3fb950;
      --warning: #d29922;
      --danger: #f85149;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
    header {
      display: flex; align-items: center; gap: 1rem;
      padding-bottom: 1.5rem; border-bottom: 1px solid var(--border);
      margin-bottom: 2rem;
    }
    header h1 { font-size: 1.5rem; font-weight: 600; }
    header .logo { font-size: 2rem; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .meeting-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .meeting-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 1rem 1.25rem;
      transition: border-color 0.2s;
    }
    .meeting-card:hover { border-color: var(--accent); }
    .meeting-card h3 { font-size: 1.05rem; margin-bottom: 0.25rem; }
    .meeting-card .meta { color: var(--text-dim); font-size: 0.85rem; }

    .detail-section {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 1.25rem; margin-bottom: 1.25rem;
    }
    .detail-section h2 {
      font-size: 1.1rem; margin-bottom: 0.75rem;
      padding-bottom: 0.5rem; border-bottom: 1px solid var(--border);
    }
    .transcript-line {
      padding: 0.3rem 0; font-size: 0.9rem;
      border-bottom: 1px solid var(--surface2);
    }
    .transcript-line .speaker {
      font-weight: 600; color: var(--accent);
      margin-right: 0.5rem;
    }
    .transcript-line .speaker--me { color: var(--accent2); }
    .transcript-line .time { color: var(--text-dim); font-size: 0.8rem; margin-right: 0.5rem; }

    .tip-card {
      background: var(--surface2); border-left: 3px solid var(--warning);
      padding: 0.75rem 1rem; margin-bottom: 0.5rem; border-radius: 0 6px 6px 0;
      font-size: 0.9rem;
    }
    .tip-card .category { 
      font-size: 0.75rem; text-transform: uppercase; 
      color: var(--warning); margin-bottom: 0.25rem; 
    }

    .key-point { padding: 0.3rem 0; }
    .key-point::before { content: "•"; color: var(--accent); margin-right: 0.5rem; }
    .action-item { padding: 0.3rem 0; }
    .action-item::before { content: "☐"; margin-right: 0.5rem; color: var(--accent2); }

    .badge {
      display: inline-block; padding: 0.15rem 0.5rem;
      border-radius: 12px; font-size: 0.75rem;
      background: var(--surface2); color: var(--text-dim);
    }
    .participants { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }

    .empty-state {
      text-align: center; padding: 3rem; color: var(--text-dim);
    }
    .empty-state .icon { font-size: 3rem; margin-bottom: 1rem; }

    .back-link { margin-bottom: 1.5rem; display: inline-block; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <span class="logo">🎙️</span>
      <h1><a href="/">KxAI Meeting Coach</a></h1>
    </header>
    ${content}
  </div>
</body>
</html>`;
  }

  private renderListPage(
    summaries: Array<{ id: string; title: string; startTime: number; duration: number; participants: string[] }>
  ): string {
    if (summaries.length === 0) {
      return this.renderLayout('Dashboard', `
        <div class="empty-state">
          <div class="icon">📋</div>
          <h2>Brak spotkań</h2>
          <p>Rozpocznij nagrywanie spotkania w KxAI, a podsumowania pojawią się tutaj.</p>
        </div>
      `);
    }

    const cards = summaries.map(s => {
      const date = new Date(s.startTime).toLocaleDateString('pl', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      const time = new Date(s.startTime).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' });
      return `
        <a href="/meeting/${s.id}" class="meeting-card">
          <h3>${this.escapeHtml(s.title)}</h3>
          <div class="meta">
            📅 ${date} o ${time} &nbsp;·&nbsp; ⏱️ ${s.duration} min
            &nbsp;·&nbsp; 👥 ${s.participants.length} uczestników
          </div>
          <div class="participants">
            ${s.participants.map(p => `<span class="badge">${this.escapeHtml(p)}</span>`).join('')}
          </div>
        </a>
      `;
    }).join('');

    return this.renderLayout('Dashboard', `
      <h2 style="margin-bottom: 1rem;">Spotkania (${summaries.length})</h2>
      <div class="meeting-list">${cards}</div>
    `);
  }

  private renderDetailPage(summary: MeetingSummary): string {
    const date = new Date(summary.startTime).toLocaleDateString('pl', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const timeStart = new Date(summary.startTime).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' });
    const timeEnd = new Date(summary.endTime).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' });

    // Summary section
    const summarySection = summary.summary ? `
      <div class="detail-section">
        <h2>📝 Podsumowanie</h2>
        <p>${this.escapeHtml(summary.summary)}</p>
      </div>
    ` : '';

    // Key points
    const keyPointsSection = summary.keyPoints.length > 0 ? `
      <div class="detail-section">
        <h2>🔑 Kluczowe punkty</h2>
        ${summary.keyPoints.map(p => `<div class="key-point">${this.escapeHtml(p)}</div>`).join('')}
      </div>
    ` : '';

    // Action items
    const actionItemsSection = summary.actionItems.length > 0 ? `
      <div class="detail-section">
        <h2>✅ Zadania do wykonania</h2>
        ${summary.actionItems.map(a => `<div class="action-item">${this.escapeHtml(a)}</div>`).join('')}
      </div>
    ` : '';

    // Coaching tips
    const coachingSection = summary.coachingTips.length > 0 ? `
      <div class="detail-section">
        <h2>💡 Wskazówki coachingowe (${summary.coachingTips.length})</h2>
        ${summary.coachingTips.map(t => `
          <div class="tip-card">
            <div class="category">${t.category}</div>
            ${this.escapeHtml(t.tip)}
          </div>
        `).join('')}
      </div>
    ` : '';

    // Transcript
    const transcriptLines = summary.transcript.map(l => {
      const time = new Date(l.timestamp).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const speakerClass = l.speaker === 'Ja' ? 'speaker--me' : '';
      return `
        <div class="transcript-line">
          <span class="time">${time}</span>
          <span class="speaker ${speakerClass}">${this.escapeHtml(l.speaker)}:</span>
          ${this.escapeHtml(l.text)}
        </div>
      `;
    }).join('');

    const transcriptSection = summary.transcript.length > 0 ? `
      <div class="detail-section">
        <h2>📜 Transkrypcja (${summary.transcript.length} wypowiedzi)</h2>
        ${transcriptLines}
      </div>
    ` : '';

    return this.renderLayout(summary.title, `
      <a href="/" class="back-link">← Powrót do listy</a>
      <h2 style="margin-bottom: 0.5rem;">${this.escapeHtml(summary.title)}</h2>
      <div class="meta" style="color: var(--text-dim); margin-bottom: 1.5rem;">
        📅 ${date} &nbsp;·&nbsp; 🕐 ${timeStart} — ${timeEnd} &nbsp;·&nbsp; ⏱️ ${summary.duration} min
        &nbsp;·&nbsp; 👥 ${(summary.participants || []).map(p => this.escapeHtml(p)).join(', ')}
        ${summary.detectedApp ? `&nbsp;·&nbsp; 📱 ${this.escapeHtml(summary.detectedApp)}` : ''}
      </div>
      ${summarySection}
      ${keyPointsSection}
      ${actionItemsSection}
      ${coachingSection}
      ${transcriptSection}
    `);
  }

  private renderErrorPage(message: string): string {
    return this.renderLayout('Błąd', `
      <div class="empty-state">
        <div class="icon">❌</div>
        <h2>${this.escapeHtml(message)}</h2>
        <p><a href="/">← Powrót do listy</a></p>
      </div>
    `);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
