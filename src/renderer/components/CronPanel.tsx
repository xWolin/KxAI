import React, { useState, useEffect } from 'react';
import type { CronJob } from '../types';
import s from './CronPanel.module.css';
import { cn } from '../utils/cn';
import { useTranslation } from '../i18n';

interface CronPanelProps {
  onBack: () => void;
}

export function CronPanel({ onBack }: CronPanelProps) {
  const { t } = useTranslation();
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
    if (schedule.endsWith('s')) return t('cron.format.seconds', { n: schedule.slice(0, -1) });
    if (schedule.endsWith('m')) return t('cron.format.minutes', { n: schedule.slice(0, -1) });
    if (schedule.endsWith('h')) return t('cron.format.hours', { n: schedule.slice(0, -1) });
    if (schedule.startsWith('every')) return schedule;
    return schedule;
  }

  function formatTime(timestamp?: number): string {
    if (!timestamp) return t('cron.never');
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
    <div className={s.panel}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerInfo}>
          <span className={s.headerEmoji}>⏰</span>
          <div>
            <div className={s.headerName}>{t('cron.title')}</div>
            <div className={s.headerModel}>{t('cron.jobCount', { count: jobs.length })}</div>
          </div>
        </div>
        <div className={s.headerActions}>
          <button onClick={() => setShowAdd(true)} className={s.btn} title={t('cron.addJob')} aria-label={t('cron.addJob')}>
            ➕
          </button>
          <button onClick={onBack} className={s.btn} title={t('cron.back')} aria-label={t('cron.back')}>
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className={s.content}>
        {/* Add form */}
        {showAdd && (
          <div className={cn('fade-in', s.addForm)}>
            <h3 className={s.formTitle}>{t('cron.newJob')}</h3>
            <input
              type="text"
              placeholder={t('cron.namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={s.input}
            />
            <div className={s.formRow}>
              <input
                type="text"
                placeholder={t('cron.schedulePlaceholder')}
                value={newSchedule}
                onChange={(e) => setNewSchedule(e.target.value)}
                className={s.inputSchedule}
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as CronJob['category'])}
                className={s.select}
              >
                <option value="custom">{t('cron.category.custom')}</option>
                <option value="routine">{t('cron.category.routine')}</option>
                <option value="workflow">{t('cron.category.workflow')}</option>
                <option value="reminder">{t('cron.category.reminder')}</option>
                <option value="cleanup">{t('cron.category.cleanup')}</option>
                <option value="health-check">{t('cron.category.healthCheck')}</option>
              </select>
            </div>
            <textarea
              placeholder={t('cron.actionPlaceholder')}
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              className={s.textarea}
              rows={3}
            />
            <div className={s.formActions}>
              <button onClick={addJob} className={s.btnPrimary} disabled={!newName.trim() || !newAction.trim()}>
                {t('cron.add')}
              </button>
              <button onClick={() => setShowAdd(false)} className={s.btnSecondary}>
                {t('cron.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Jobs list */}
        {jobs.length === 0 && !showAdd && (
          <div className={s.empty}>
            <div className={s.emptyIcon}>⏰</div>
            <div className={s.emptyTitle}>{t('cron.empty.title')}</div>
            <div className={s.emptySubtitle}>
              {t('cron.empty.subtitle')}
            </div>
          </div>
        )}

        {jobs.map((job) => (
          <div key={job.id} className={cn('fade-in', job.enabled ? s.job : s.jobDisabled)}>
            <div className={s.jobHeader}>
              <div className={s.jobTitle}>
                <span className={s.jobIcon}>{categoryIcons[job.category] || '⚙️'}</span>
                <span className={s.jobName}>{job.name}</span>
                {job.autoCreated && <span className={s.jobBadge}>{t('cron.badge.auto')}</span>}
              </div>
              <div className={s.jobControls}>
                <button
                  onClick={() => toggleJob(job.id, job.enabled)}
                  className={job.enabled ? s.toggleOn : s.toggle}
                  title={job.enabled ? t('cron.disable') : t('cron.enable')}
                  role="switch"
                  aria-checked={job.enabled}
                  aria-label={job.enabled ? t('cron.disable') : t('cron.enable')}
                >
                  {job.enabled ? '✓' : '○'}
                </button>
                <button onClick={() => removeJob(job.id)} className={s.delete} title={t('cron.delete')} aria-label={t('cron.delete')}>
                  🗑️
                </button>
              </div>
            </div>
            <div className={s.jobSchedule}>{formatSchedule(job.schedule)}</div>
            <div className={s.jobAction}>{job.action}</div>
            <div className={s.jobMeta}>
              <span>{t('cron.runCount', { count: job.runCount })}</span>
              <span>{t('cron.lastRun', { time: formatTime(job.lastRun) })}</span>
            </div>
            {job.lastResult && (
              <div className={s.jobResult}>
                {job.lastResult.slice(0, 150)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
