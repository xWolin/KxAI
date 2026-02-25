/**
 * Toggle — on/off switch control.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface ToggleProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, className, ...rest }) => (
  <button
    type="button"
    className={cn(checked ? s.toggleOn : s.toggle, className)}
    onClick={() => !disabled && onChange(!checked)}
    disabled={disabled}
    role="switch"
    aria-checked={checked}
    {...rest}
  />
);
