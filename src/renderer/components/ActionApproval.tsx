import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../stores';
import { useTranslation } from '../i18n';
import s from './ActionApproval.module.css';
import { cn } from '../utils/cn';
import type { ActionApprovalRequest } from '../types';

const RISK_CONFIG: Record<string, { icon: string; labelKey: string }> = {
  dangerous: { icon: '🔴', labelKey: 'action.dangerousTitle' },
  moderate: { icon: '🟡', labelKey: 'action.moderateTitle' },
  safe: { icon: '🟢', labelKey: 'action.safeTitle' },
};

const TIMEOUT_MS = 60_000; // must match CortexEngine timeout

function formatParams(params: Record<string, unknown>): string {
  try {
    const str = JSON.stringify(params, null, 2);
    return str.length > 300 ? str.slice(0, 300) + '…' : str;
  } catch {
    return String(params);
  }
}

function SingleApproval({
  request,
  onRespond,
}: {
  request: ActionApprovalRequest;
  onRespond: (approved: boolean) => void;
}) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(
    Math.max(0, Math.ceil((TIMEOUT_MS - (Date.now() - request.timestamp)) / 1000)),
  );
  const config = RISK_CONFIG[request.risk] || RISK_CONFIG.moderate;
  const dialogRef = useRef<HTMLDivElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const denyRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Focus approve button on mount
    approveRef.current?.focus();
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      const left = Math.max(0, Math.ceil((TIMEOUT_MS - (Date.now() - request.timestamp)) / 1000));
      if (left <= 0) {
        onRespond(false);
      } else {
        setRemaining(left);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [request.timestamp, onRespond]);

  // Keyboard: Escape to deny, Tab trap within dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onRespond(false);
        return;
      }
      if (e.key === 'Tab') {
        const focusable = [denyRef.current, approveRef.current].filter(Boolean) as HTMLElement[];
        if (focusable.length === 0) return;
        const idx = focusable.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey) {
          if (idx <= 0) {
            e.preventDefault();
            focusable[focusable.length - 1].focus();
          }
        } else {
          if (idx >= focusable.length - 1) {
            e.preventDefault();
            focusable[0].focus();
          }
        }
      }
    },
    [onRespond],
  );

  return (
    <div
      className={s.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-label={t(config.labelKey)}
      onKeyDown={handleKeyDown}
    >
      <div ref={dialogRef} className={cn(s.dialog, request.risk === 'dangerous' ? s.dangerous : '')}>
        <div className={s.header}>
          <span className={s.riskBadge}>{config.icon}</span>
          <span className={s.title}>{t(config.labelKey)}</span>
        </div>

        <div className={s.reason}>{request.reason}</div>

        <div className={s.toolInfo}>
          <div className={s.toolName}>{request.toolName}</div>
          {Object.keys(request.params).length > 0 && <div className={s.params}>{formatParams(request.params)}</div>}
        </div>

        <div className={s.actions}>
          <button ref={denyRef} className={s.btnDeny} onClick={() => onRespond(false)} aria-label={t('action.deny')}>
            {t('action.deny')}
          </button>
          <button
            ref={approveRef}
            className={s.btnApprove}
            onClick={() => onRespond(true)}
            aria-label={t('action.approve')}
          >
            {t('action.approve')}
          </button>
        </div>

        <div className={s.timer}>{t('action.timeout', { seconds: String(remaining) })}</div>
      </div>
    </div>
  );
}

export function ActionApproval() {
  const requests = useAgentStore((s) => s.pendingActionRequests);
  const removeActionRequest = useAgentStore((s) => s.removeActionRequest);

  if (requests.length === 0) return null;

  // Show the oldest pending request first
  const current = requests[0];

  const handleRespond = (approved: boolean) => {
    removeActionRequest(current.requestId);
    window.kxai
      ?.cortexActionRespond?.({
        requestId: current.requestId,
        approved,
      })
      .catch((err: unknown) => {
        console.error(`[ActionApproval] Failed to respond to ${current.requestId}:`, err);
      });
  };

  return <SingleApproval key={current.requestId} request={current} onRespond={handleRespond} />;
}
