/**
 * Select — styled dropdown component.
 *
 * Custom arrow indicator, consistent dark theme styling.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Optional — no extra props beyond standard HTML select */
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...rest }, ref) => (
  <select ref={ref} className={cn(s.select, className)} {...rest}>
    {children}
  </select>
));

Select.displayName = 'Select';
