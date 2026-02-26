/**
 * Input — atomic text input component.
 *
 * Standardizes the dark theme input styling across all panels.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...rest }, ref) => (
  <input ref={ref} className={cn(s.input, className)} {...rest} />
));

Input.displayName = 'Input';
