/**
 * Button — atomic UI component.
 *
 * Variants: primary, secondary, danger, ghost, icon
 * Sizes: sm, md (default), lg
 * States: loading, disabled, active (for icon variant), fullWidth
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  active?: boolean;
  fullWidth?: boolean;
}

const variantMap: Record<ButtonVariant, string> = {
  primary: s.btnPrimary,
  secondary: s.btnSecondary,
  danger: s.btnDanger,
  ghost: s.btnGhost,
  icon: s.btnIcon,
};

const sizeMap: Record<ButtonSize, string | undefined> = {
  sm: s.btnSm,
  md: undefined,
  lg: s.btnLg,
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, active, fullWidth, className, disabled, children, ...rest }, ref) => {
    const cls = cn(
      active && variant === 'icon' ? s.btnIconActive : variantMap[variant],
      sizeMap[size],
      fullWidth && s.btnFull,
      loading && s.btnLoading,
      className,
    );

    return (
      <button ref={ref} className={cls} disabled={disabled || loading} {...rest}>
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
