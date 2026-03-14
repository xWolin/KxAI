import React, { useState, useEffect, useCallback } from 'react';
import type { ToolDefinition, CronJob, ActivityEntry, SystemSnapshot, ParticipantResearchRecord } from '../types';
import type { McpHubStatus } from '@shared/types';
import s from './DashboardPanel.module.css';
import { cn } from '../utils/cn';
import { useTranslation } from '../i18n';
import { useAgentStore } from '../stores';
import { PanelHeader, Tabs, StatCard, Badge, Spinner, ProgressBar } from './ui';

// ─── Types ───

interface RAGStats {
  totalChunks: number;
  totalFiles: number;
  indexed: boolean;
  embeddingType: 'openai' | 'tfidf';
  folders: { path: string; fileCount: number; chunkCount: number; lastIndexed: number }[];
}

interface DashboardPanelProps {
  onBack: () => void;
}

const TABS = [
  { id: 'overview', label: '📊 Przegląd' },
  { id: 'tools', label: '🔧 Narzędzia' },
  { id: 'cron', label: '⏰ Cron' },
  { id: 'system', label: '💻 System' },
  { id: 'mcp', label: '🔌 MCP' },
  { id: 'activity', label: '📋 Aktywność' },
  { id: 'research', label: '🔬 Badania' },
];

// ─── Component ───

export function DashboardPanel({ onBack }: DashboardPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  const agentStatus = useAgentStore((s) => s.agentStatus);

  return (
    <div className={s.panel}>
      <PanelHeader emoji="📊" name={t('dashboard.title')} onBack={onBack}>
        <StatusDot state={agentStatus.state} />
      </PanelHeader>
      <Tabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} className={s.tabs} />
      <div className={s.content}>
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'tools' && <ToolsTab />}
        {activeTab === 'cron' && <CronTab />}
        {activeTab === 'system' && <SystemTab />}
        {activeTab === 'mcp' && <McpTab />}
        {activeTab === 'activity' && <ActivityTab />}
        {activeTab === 'research' && <ResearchHistoryTab />}
      </div>
    </div>
  );
}

// ─── Status dot ───

function StatusDot({ state }: { state: string }) {
  const isActive = state !== 'idle';
  return <span className={cn(s.statusDot, isActive && s.statusDotActive)} title={state} />;
}

// ─── Overview Tab ───

function OverviewTab() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [cron, setCron] = useState<CronJob[]>([]);
  const [rag, setRag] = useState<RAGStats | null>(null);
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const agentStatus = useAgentStore((s) => s.agentStatus);

  useEffect(() => {
    Promise.all([
      window.kxai.getTools().catch(() => []),
      window.kxai.getCronJobs().catch(() => []),
      window.kxai.ragStats().catch(() => null),
      window.kxai
        .systemSnapshot()
        .then((r) => (r.success ? r.data! : null))
        .catch(() => null),
    ]).then(([t, c, r, sys]) => {
      setTools(t);
      setCron(c);
      setRag(r);
      setSystem(sys);
      setLoading(false);
    });
  }, []);

  if (loading) return <Spinner />;

  const cpuPercent = system?.cpu?.usagePercent ?? 0;
  const memPercent = system?.memory?.usagePercent ?? 0;

  return (
    <div className={s.overviewGrid}>
      <StatCard value={tools.length} label={t('dashboard.overview.tools')} />
      <StatCard value={cron.filter((j) => j.enabled).length} label={t('dashboard.overview.cronActive')} />
      <StatCard value={rag?.totalFiles ?? 0} label={t('dashboard.overview.ragFiles')} />
      <StatCard value={rag?.totalChunks ?? 0} label={t('dashboard.overview.ragChunks')} />
      <StatCard value={`${cpuPercent}%`} label="CPU" />
      <StatCard value={`${memPercent}%`} label="RAM" />

      <div className={s.overviewStatus}>
        <div className={s.overviewStatusRow}>
          <span className={s.overviewLabel}>{t('dashboard.overview.agentState')}</span>
          <Badge variant={agentStatus.state === 'idle' ? 'default' : 'accent'}>{agentStatus.state}</Badge>
        </div>
        {agentStatus.detail && <div className={s.overviewDetail}>{agentStatus.detail}</div>}
        <div className={s.overviewStatusRow}>
          <span className={s.overviewLabel}>{t('dashboard.overview.embedding')}</span>
          <Badge variant="default">{rag?.embeddingType ?? '—'}</Badge>
        </div>
        {system?.battery && (
          <div className={s.overviewStatusRow}>
            <span className={s.overviewLabel}>{t('dashboard.overview.battery')}</span>
            <span>
              {system.battery.percent}% {system.battery.charging ? '⚡' : '🔋'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tools Tab ───

function ToolsTab() {
  const { t } = useTranslation();
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    window.kxai
      .getTools()
      .then(setTools)
      .catch(() => [])
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  // Group by category
  const grouped = tools.reduce(
    (acc, tool) => {
      const cat = tool.category || 'other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(tool);
      return acc;
    },
    {} as Record<string, ToolDefinition[]>,
  );

  const filterLower = filter.toLowerCase();
  const categories = Object.keys(grouped).sort();

  return (
    <div>
      <input
        className={s.searchInput}
        placeholder={t('dashboard.tools.search')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className={s.toolCount}>
        {tools.length} {t('dashboard.tools.total')}
      </div>
      {categories.map((cat) => {
        const catTools = grouped[cat].filter(
          (tool) =>
            !filterLower ||
            tool.name.toLowerCase().includes(filterLower) ||
            tool.description.toLowerCase().includes(filterLower),
        );
        if (catTools.length === 0) return null;
        return (
          <div key={cat} className={s.toolCategory}>
            <div className={s.toolCategoryHeader}>
              <Badge variant="accent">{cat}</Badge>
              <span className={s.toolCategoryCount}>{catTools.length}</span>
            </div>
            {catTools.map((tool) => (
              <div key={tool.name} className={s.toolItem}>
                <div className={s.toolName}>{tool.name}</div>
                <div className={s.toolDesc}>{tool.description}</div>
                <div className={s.toolParams}>
                  {Object.keys(tool.parameters).length} {t('dashboard.tools.params')}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ─── Cron Tab ───

function CronTab() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.kxai
      .getCronJobs()
      .then(setJobs)
      .catch(() => [])
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (jobs.length === 0) return <div className={s.emptyMsg}>{t('dashboard.cron.empty')}</div>;

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{t('dashboard.cron.name')}</th>
            <th>{t('dashboard.cron.schedule')}</th>
            <th>{t('dashboard.cron.category')}</th>
            <th>{t('dashboard.cron.status')}</th>
            <th>{t('dashboard.cron.runs')}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className={!job.enabled ? s.rowDisabled : undefined}>
              <td className={s.cellName}>{job.name}</td>
              <td>
                <code className={s.code}>{job.schedule}</code>
              </td>
              <td>
                <Badge variant="default">{job.category}</Badge>
              </td>
              <td>
                <Badge variant={job.enabled ? 'success' : 'default'}>
                  {job.enabled ? t('dashboard.cron.enabled') : t('dashboard.cron.disabled')}
                </Badge>
              </td>
              <td>{job.runCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── System Tab ───

function SystemTab() {
  const { t } = useTranslation();
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    window.kxai
      .systemSnapshot()
      .then((r) => {
        if (r.success && r.data) setSystem(r.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setLoading(true);
    window.kxai
      .systemSnapshot()
      .then((r) => {
        if (r.success && r.data) setSystem(r.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading && !system) return <Spinner />;
  if (!system) return <div className={s.emptyMsg}>{t('dashboard.system.unavailable')}</div>;

  const cpuPercent = system.cpu?.usagePercent ?? 0;
  const memPercent = system.memory?.usagePercent ?? 0;
  const memUsedGB = system.memory?.usedGB ?? 0;
  const memTotalGB = system.memory?.totalGB ?? 1;

  return (
    <div>
      <div className={s.systemMetrics}>
        <div className={s.metric}>
          <div className={s.metricLabel}>CPU</div>
          <ProgressBar value={cpuPercent} />
          <div className={s.metricValue}>{cpuPercent}%</div>
        </div>
        <div className={s.metric}>
          <div className={s.metricLabel}>RAM</div>
          <ProgressBar value={memPercent} />
          <div className={s.metricValue}>
            {memUsedGB.toFixed(1)} / {memTotalGB.toFixed(1)} GB
          </div>
        </div>
        {system.battery && (
          <div className={s.metric}>
            <div className={s.metricLabel}>
              {t('dashboard.system.battery')} {system.battery.charging ? '⚡' : ''}
            </div>
            <ProgressBar value={system.battery.percent} />
            <div className={s.metricValue}>{system.battery.percent}%</div>
          </div>
        )}
      </div>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <tbody>
            <InfoRow label={t('dashboard.system.hostname')} value={system.system?.hostname} />
            <InfoRow
              label={t('dashboard.system.os')}
              value={`${system.system?.platform} ${system.system?.osVersion} ${system.system?.arch}`}
            />
            <InfoRow label="Node.js" value={system.system?.nodeVersion} />
            <InfoRow label="Electron" value={system.system?.electronVersion} />
            <InfoRow label={t('dashboard.system.uptime')} value={formatUptime(system.system?.uptimeHours)} />
            {system.cpu?.model && (
              <InfoRow label="CPU" value={`${system.cpu.model} (${system.cpu.cores} ${t('dashboard.system.cores')})`} />
            )}
            {system.disk?.[0] && (
              <InfoRow
                label={t('dashboard.system.disk')}
                value={`${system.disk[0].usedGB.toFixed(1)} / ${system.disk[0].totalGB.toFixed(1)} GB`}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number }) {
  return (
    <tr>
      <td className={s.infoLabel}>{label}</td>
      <td>{value ?? '—'}</td>
    </tr>
  );
}

// ─── MCP Tab ───

function McpTab() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<McpHubStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    window.kxai
      .mcpGetStatus()
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const cleanup = window.kxai.onMcpStatus(setStatus);
    return cleanup;
  }, [refresh]);

  if (loading && !status) return <Spinner />;

  const servers = status?.servers ?? [];

  return (
    <div>
      <div className={s.mcpSummary}>
        <StatCard
          value={servers.filter((sv) => sv.status === 'connected').length}
          label={t('dashboard.mcp.connected')}
        />
        <StatCard value={servers.length} label={t('dashboard.mcp.total')} />
        <StatCard value={servers.reduce((n, sv) => n + (sv.tools?.length ?? 0), 0)} label={t('dashboard.mcp.tools')} />
      </div>

      {servers.length === 0 ? (
        <div className={s.emptyMsg}>{t('dashboard.mcp.empty')}</div>
      ) : (
        <div className={s.mcpList}>
          {servers.map((sv) => (
            <div key={sv.id} className={s.mcpServer}>
              <div className={s.mcpServerHeader}>
                <span className={cn(s.mcpDot, sv.status === 'connected' && s.mcpDotConnected)} />
                <span className={s.mcpServerName}>{sv.name}</span>
                <Badge variant={sv.status === 'connected' ? 'success' : sv.status === 'error' ? 'error' : 'default'}>
                  {sv.status}
                </Badge>
              </div>
              <div className={s.mcpServerMeta}>
                {sv.transport} · {sv.tools?.length ?? 0} {t('dashboard.mcp.tools').toLowerCase()}
              </div>
              <div className={s.mcpServerActions}>
                {sv.status === 'connected' ? (
                  <button className={s.actionBtn} onClick={() => window.kxai.mcpDisconnect(sv.id).then(refresh)}>
                    {t('dashboard.mcp.disconnect')}
                  </button>
                ) : (
                  <button className={s.actionBtn} onClick={() => window.kxai.mcpConnect(sv.id).then(refresh)}>
                    {t('dashboard.mcp.connect')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Activity Tab ───

function ActivityTab() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.kxai
      .getWorkflowActivity(50)
      .then(setEntries)
      .catch(() => [])
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (entries.length === 0) return <div className={s.emptyMsg}>{t('dashboard.activity.empty')}</div>;

  return (
    <div className={s.activityList}>
      {entries.map((entry, i) => (
        <div key={i} className={s.activityItem}>
          <span className={s.activityTime}>
            {new Date(entry.timestamp).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className={s.activityAction}>{entry.action}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Research History Tab ───

const CONFIDENCE_BADGE: Record<string, 'success' | 'accent' | 'error' | 'default'> = {
  high: 'success',
  medium: 'accent',
  low: 'error',
  unknown: 'default',
};

function ResearchHistoryTab() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<ParticipantResearchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<ParticipantResearchRecord | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    window.kxai
      .getResearchHistory?.()
      .then((r) => setRecords(r ?? []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRerun = useCallback(
    async (id: string) => {
      setRerunning(id);
      try {
        await window.kxai.rerunParticipantResearch?.(id);
        load();
      } finally {
        setRerunning(null);
      }
    },
    [load],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await window.kxai.deleteResearchRecord?.(id);
      setSelected((prev) => (prev?.id === id ? null : prev));
      load();
    },
    [load],
  );

  if (loading) return <Spinner />;

  const filterLower = filter.toLowerCase();
  const filtered = records.filter(
    (r) =>
      !filterLower ||
      r.name.toLowerCase().includes(filterLower) ||
      (r.company ?? '').toLowerCase().includes(filterLower) ||
      (r.role ?? '').toLowerCase().includes(filterLower),
  );

  if (records.length === 0) {
    return (
      <div className={s.researchEmpty}>
        <div className={s.researchEmptyIcon}>🔬</div>
        <div className={s.researchEmptyTitle}>{t('dashboard.research.empty')}</div>
        <div className={s.researchEmptyHint}>{t('dashboard.research.emptyHint')}</div>
      </div>
    );
  }

  return (
    <div className={s.researchLayout}>
      {/* Sidebar — record list */}
      <div className={s.researchSidebar}>
        <input
          className={s.searchInput}
          placeholder={t('dashboard.research.search')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className={s.researchCount}>
          {filtered.length} / {records.length} {t('dashboard.research.records')}
        </div>
        <div className={s.researchList}>
          {filtered.map((rec) => (
            <div
              key={rec.id}
              className={`${s.researchItem} ${selected?.id === rec.id ? s.researchItemSelected : ''}`}
              onClick={() => setSelected(rec)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setSelected(rec)}
            >
              <div className={s.researchItemHeader}>
                {rec.photoBase64 ? (
                  <img src={`data:image/jpeg;base64,${rec.photoBase64}`} alt={rec.name} className={s.researchThumb} />
                ) : (
                  <div className={s.researchThumbPlaceholder}>👤</div>
                )}
                <div className={s.researchItemMeta}>
                  <div className={s.researchItemName}>{rec.name}</div>
                  {rec.company && <div className={s.researchItemCompany}>{rec.company}</div>}
                </div>
                <Badge variant={CONFIDENCE_BADGE[rec.confidence] ?? 'default'}>{rec.confidence}</Badge>
              </div>
              {rec.stale && <div className={s.researchStale}>⚠ {t('dashboard.research.stale')}</div>}
              <div className={s.researchItemDate}>
                {new Date(rec.lastRunAt).toLocaleDateString('pl-PL', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail pane */}
      <div className={s.researchDetail}>
        {selected ? (
          <ResearchDetail
            record={selected}
            rerunning={rerunning === selected.id}
            onRerun={() => handleRerun(selected.id)}
            onDelete={() => handleDelete(selected.id)}
          />
        ) : (
          <div className={s.researchDetailEmpty}>{t('dashboard.research.selectHint')}</div>
        )}
      </div>
    </div>
  );
}

function ResearchDetail({
  record,
  rerunning,
  onRerun,
  onDelete,
}: {
  record: ParticipantResearchRecord;
  rerunning: boolean;
  onRerun: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={s.researchDetailContent}>
      {/* Person header */}
      <div className={s.researchDetailHeader}>
        {record.photoBase64 ? (
          <img
            src={`data:image/jpeg;base64,${record.photoBase64}`}
            alt={record.name}
            className={s.researchDetailPhoto}
          />
        ) : (
          <div className={s.researchDetailPhotoPlaceholder}>👤</div>
        )}
        <div>
          <div className={s.researchDetailName}>{record.name}</div>
          {record.role && <div className={s.researchDetailRole}>{record.role}</div>}
          {record.company && <div className={s.researchDetailCompany}>{record.company}</div>}
        </div>
        <div className={s.researchDetailBadges}>
          <Badge variant={CONFIDENCE_BADGE[record.confidence] ?? 'default'}>{record.confidence}</Badge>
          {record.stale && <Badge variant="error">stale</Badge>}
        </div>
      </div>

      {/* Summary */}
      <div className={s.researchSection}>
        <div className={s.researchSectionTitle}>{t('dashboard.research.summary')}</div>
        <div className={s.researchSummary}>{record.summary || '—'}</div>
      </div>

      {/* Sources */}
      {record.sources.length > 0 && (
        <div className={s.researchSection}>
          <div className={s.researchSectionTitle}>{t('dashboard.research.sources')}</div>
          <ul className={s.researchSources}>
            {record.sources.map((src, i) => (
              <li key={i} className={s.researchSource}>
                🔗 {src}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Meta */}
      <div className={s.researchMeta}>
        <span>
          {t('dashboard.research.lastRun')}:{' '}
          {new Date(record.lastRunAt).toLocaleString('pl-PL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span>v{record.version}</span>
      </div>

      {/* Actions */}
      <div className={s.researchActions}>
        <button
          className={s.actionBtnPrimary}
          onClick={onRerun}
          disabled={rerunning}
          title={t('dashboard.research.rerun')}
        >
          {rerunning ? <Spinner /> : `🔄 ${t('dashboard.research.rerun')}`}
        </button>
        <button className={s.actionBtnDanger} onClick={onDelete} title={t('dashboard.research.delete')}>
          🗑 {t('dashboard.research.delete')}
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ───

function formatUptime(hours?: number): string {
  if (!hours) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
