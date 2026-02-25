/**
 * Label — form label with consistent uppercase styling.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Associates label with a form control by id */
  htmlFor?: string;
}

export const Label: React.FC<LabelProps> = ({ className, htmlFor, children, ...rest }) => (
  <label className={cn(s.label, className)} htmlFor={htmlFor} {...rest}>
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
  <div className={cn(s.formGroup, className)} role="group" {...rest}>
    {children}
  </div>
);
