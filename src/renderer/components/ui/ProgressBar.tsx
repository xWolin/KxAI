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
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, className }) => (
  <div className={cn(s.progressBar, className)}>
    <div className={s.progressFill} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
);
