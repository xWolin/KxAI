/**
 * Spinner — three-dot typing/loading indicator.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface SpinnerProps {
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({ className }) => (
  <span className={cn(s.spinner, className)}>
    <span className={s.spinnerDot} />
    <span className={s.spinnerDot} />
    <span className={s.spinnerDot} />
  </span>
);
