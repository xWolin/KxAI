/**
 * EmojiPicker — grid of selectable emoji buttons.
 */

import React from 'react';
import s from './ui.module.css';
import { cn } from '../../utils/cn';

export interface EmojiPickerProps {
  emojis: string[];
  selected: string;
  onChange: (emoji: string) => void;
  className?: string;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ emojis, selected, onChange, className }) => (
  <div className={cn(s.emojiGrid, className)}>
    {emojis.map((emoji) => (
      <button
        key={emoji}
        type="button"
        className={selected === emoji ? s.emojiBtnSelected : s.emojiBtn}
        onClick={() => onChange(emoji)}
      >
        {emoji}
      </button>
    ))}
  </div>
);
