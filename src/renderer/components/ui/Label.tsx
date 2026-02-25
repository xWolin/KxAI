/**
 * Label — form label with consistent uppercase styling.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Optional — no extra props beyond standard HTML label */
}

export const Label: React.FC<LabelProps> = ({ className, children, ...rest }) => (
  <label className={cn(s.label, className)} {...rest}>
    {children}
  </label>
);

/**
 * Hint — small muted description text below form fields.
 */
export const Hint: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className, children, ...rest }) => (
  <p className={cn(s.hint, className)} {...rest}>
    {children}
  </p>
);

/**
 * FormGroup — wrapper for label + input + hint combos.
 */
export const FormGroup: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div className={cn(s.formGroup, className)} {...rest}>
    {children}
  </div>
);
