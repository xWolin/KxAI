/**
 * Select — styled dropdown component.
 *
 * Custom arrow indicator, consistent dark theme styling.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...rest }, ref) => (
  <select ref={ref} className={cn(s.select, className)} {...rest}>
    {children}
  </select>
));

Select.displayName = 'Select';
