/**
 * EmptyState — placeholder for empty lists/panels.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  className?: string;
  children?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, subtitle, className, children }) => (
  <div className={cn(s.empty, className)}>
    {icon && <div className={s.emptyIcon} aria-hidden="true">{icon}</div>}
    <div className={s.emptyTitle}>{title}</div>
    {subtitle && <div className={s.emptySubtitle}>{subtitle}</div>}
    {children}
  </div>
);
