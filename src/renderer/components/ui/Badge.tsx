/**
 * Badge — small status/info tag.
 *
 * Variants: default, accent, success, warning, error
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'error';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantMap: Record<BadgeVariant, string> = {
  default: s.badgeDefault,
  accent: s.badgeAccent,
  success: s.badgeSuccess,
  warning: s.badgeWarning,
  error: s.badgeError,
};

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', className, children, ...rest }) => (
  <span className={cn(variantMap[variant], className)} {...rest}>
    {children}
  </span>
);
