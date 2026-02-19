import React, { useState, useEffect } from 'react';
import type { CronJob } from '../types';

interface CronPanelProps {
  onBack: () => void;
}

export function CronPanel({ onBack }: CronPanelProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSchedule, setNewSchedule] = useState('30m');
  const [newAction, setNewAction] = useState('');
  const [newCategory, setNewCategory] = useState<CronJob['category']>('custom');
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    loadJobs();
  }, []);

  async function loadJobs() {
    const list = await window.kxai.getCronJobs();
    setJobs(list);
  }

  async function addJob() {
    if (!newName.trim() || !newAction.trim()) return;
    await window.kxai.addCronJob({
      name: newName.trim(),
      schedule: newSchedule.trim(),
      action: newAction.trim(),
      category: newCategory,
      autoCreated: false,
      enabled: true,
    });
    setNewName('');
    setNewSchedule('30m');
    setNewAction('');
    setShowAdd(false);
    await loadJobs();
  }

  async function toggleJob(id: string, enabled: boolean) {
    await window.kxai.updateCronJob(id, { enabled: !enabled });
    await loadJobs();
  }

  async function removeJob(id: string) {
    await window.kxai.removeCronJob(id);
    await loadJobs();
  }

  function formatSchedule(schedule: string): string {
    if (schedule.endsWith('s')) return `Co ${schedule.slice(0, -1)} sek.`;
    if (schedule.endsWith('m')) return `Co ${schedule.slice(0, -1)} min.`;
    if (schedule.endsWith('h')) return `Co ${schedule.slice(0, -1)} godz.`;
    if (schedule.startsWith('every')) return schedule;
    return schedule;
  }

  function formatTime(timestamp?: number): string {
    if (!timestamp) return 'nigdy';
    return new Date(timestamp).toLocaleString('pl-PL', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const categoryIcons: Record<string, string> = {
    routine: '🔄',
    workflow: '⚡',
    reminder: '🔔',
    cleanup: '🧹',
    'health-check': '💚',
    custom: '⚙️',
  };

  return (
    <div className="cron-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header__info">
          <span className="chat-header__emoji">⏰</span>
          <div>
            <div className="chat-header__name">Cron Jobs</div>
            <div className="chat-header__model">{jobs.length} zadań</div>
          </div>
        </div>
        <div className="chat-header__actions">
          <button onClick={() => setShowAdd(true)} className="chat-btn" title="Dodaj zadanie">
            ➕
          </button>
          <button onClick={onBack} className="chat-btn" title="Wróć">
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="cron-content">
        {/* Add form */}
        {showAdd && (
          <div className="cron-add-form fade-in">
            <h3 className="cron-form__title">Nowe zadanie</h3>
            <input
              type="text"
              placeholder="Nazwa zadania"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="cron-input"
            />
            <div className="cron-form__row">
              <input
                type="text"
                placeholder="Harmonogram (np. 30m, 1h, */5 * * * *)"
                value={newSchedule}
                onChange={(e) => setNewSchedule(e.target.value)}
                className="cron-input cron-input--schedule"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as CronJob['category'])}
                className="cron-select"
              >
                <option value="custom">⚙️ Custom</option>
                <option value="routine">🔄 Rutyna</option>
                <option value="workflow">⚡ Workflow</option>
                <option value="reminder">🔔 Przypomnienie</option>
                <option value="cleanup">🧹 Porządki</option>
                <option value="health-check">💚 Health Check</option>
              </select>
            </div>
            <textarea
              placeholder="Co agent ma robić? (np. Sprawdź moje maile i podsumuj najważniejsze)"
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              className="cron-textarea"
              rows={3}
            />
            <div className="cron-form__actions">
              <button onClick={addJob} className="cron-btn cron-btn--primary" disabled={!newName.trim() || !newAction.trim()}>
                Dodaj
              </button>
              <button onClick={() => setShowAdd(false)} className="cron-btn cron-btn--secondary">
                Anuluj
              </button>
            </div>
          </div>
        )}

        {/* Jobs list */}
        {jobs.length === 0 && !showAdd && (
          <div className="cron-empty">
            <div className="cron-empty__icon">⏰</div>
            <div className="cron-empty__title">Brak zadań cron</div>
            <div className="cron-empty__subtitle">
              Dodaj zadanie lub poproś agenta w czacie o stworzenie automatycznego zadania.
            </div>
          </div>
        )}

        {jobs.map((job) => (
          <div key={job.id} className={`cron-job fade-in${!job.enabled ? ' cron-job--disabled' : ''}`}>
            <div className="cron-job__header">
              <div className="cron-job__title">
                <span className="cron-job__icon">{categoryIcons[job.category] || '⚙️'}</span>
                <span className="cron-job__name">{job.name}</span>
                {job.autoCreated && <span className="cron-job__badge">🤖 auto</span>}
              </div>
              <div className="cron-job__controls">
                <button
                  onClick={() => toggleJob(job.id, job.enabled)}
                  className={`cron-toggle${job.enabled ? ' cron-toggle--on' : ''}`}
                  title={job.enabled ? 'Wyłącz' : 'Włącz'}
                >
                  {job.enabled ? '✓' : '○'}
                </button>
                <button onClick={() => removeJob(job.id)} className="cron-delete" title="Usuń">
                  🗑️
                </button>
              </div>
            </div>
            <div className="cron-job__schedule">{formatSchedule(job.schedule)}</div>
            <div className="cron-job__action">{job.action}</div>
            <div className="cron-job__meta">
              <span>Uruchomień: {job.runCount}</span>
              <span>Ostatnio: {formatTime(job.lastRun)}</span>
            </div>
            {job.lastResult && (
              <div className="cron-job__result">
                {job.lastResult.slice(0, 150)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
