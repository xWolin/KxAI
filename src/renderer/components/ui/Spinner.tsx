/**
 * Spinner — three-dot typing/loading indicator.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface SpinnerProps {
  className?: string;
  /** Accessible label for screen readers */
  label?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ className, label = 'Loading' }) => (
  <span className={cn(s.spinner, className)} role="status" aria-label={label}>
    <span className={s.spinnerDot} />
    <span className={s.spinnerDot} />
    <span className={s.spinnerDot} />
  </span>
);
