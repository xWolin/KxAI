/**
 * Textarea — styled multiline text input.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...rest }, ref) => (
  <textarea ref={ref} className={cn(s.textarea, className)} {...rest} />
));

Textarea.displayName = 'Textarea';
