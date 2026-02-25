/**
 * ProgressBar — horizontal progress indicator.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface ProgressBarProps {
  /** Progress value 0-100 */
  value: number;
  className?: string;
  /** Accessible label for screen readers */
  'aria-label'?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, className, 'aria-label': ariaLabel }) => (
  <div
    className={cn(s.progressBar, className)}
    role="progressbar"
    aria-valuenow={Math.min(100, Math.max(0, value))}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-label={ariaLabel}
  >
    <div className={s.progressFill} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);
