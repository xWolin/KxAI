/**
 * Section — content section with title.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface SectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  danger?: boolean;
}

export const Section: React.FC<SectionProps> = ({ title, danger, className, children, ...rest }) => (
  <div className={cn(s.section, className)} {...rest}>
    {title && <h3 className={danger ? s.sectionTitleDanger : s.sectionTitle}>{title}</h3>}
    {children}
  </div>
);

/**
 * Card — bordered content container.
 */
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn(s.card, className)} {...rest}>
    {children}
  </div>
);

/**
 * StatCard — card with value + label (for dashboards).
 */
export interface StatCardProps {
  value: string | number;
  label: string;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ value, label, className }) => (
  <div className={cn(s.statCard, className)}>
    <div className={s.statCardValue}>{value}</div>
    <div className={s.statCardLabel}>{label}</div>
  </div>
);
