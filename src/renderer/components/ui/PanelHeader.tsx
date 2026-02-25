/**
 * PanelHeader — standard header for panels/views.
 *
 * Two modes:
 * - With emoji + name + subtitle + actions (ChatPanel, CronPanel style)
 * - With back button + title (SettingsPanel style)
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface PanelHeaderProps {
  /** Emoji displayed before the name */
  emoji?: string;
  /** Panel name / title */
  name?: string;
  /** Small subtitle text below the name */
  subtitle?: string;
  /** Action buttons (rendered in no-drag zone) */
  actions?: React.ReactNode;
  /** Back button callback (renders ← button) */
  onBack?: () => void;
  /** Additional class name */
  className?: string;
  children?: React.ReactNode;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  emoji,
  name,
  subtitle,
  actions,
  onBack,
  className,
  children,
}) => (
  <div className={cn(s.panelHeader, className)}>
    {onBack && (
      <button
        onClick={onBack}
        className={s.btnGhost}
        style={{ fontSize: 16, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        aria-label="Back"
      >
        ←
      </button>
    )}
    {(emoji || name) && (
      <div className={s.panelHeaderInfo}>
        {emoji && <span className={s.panelHeaderEmoji}>{emoji}</span>}
        <div>
          {name && <div className={s.panelHeaderName}>{name}</div>}
          {subtitle && <div className={s.panelHeaderSubtitle}>{subtitle}</div>}
        </div>
      </div>
    )}
    {children}
    {actions && <div className={s.panelHeaderActions}>{actions}</div>}
  </div>
);
