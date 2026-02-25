import React, { useRef, useCallback, useEffect } from 'react';
import s from './FloatingWidget.module.css';
import { cn } from '../utils/cn';
import { useTranslation } from '../i18n';

interface FloatingWidgetProps {
  emoji: string;
  name: string;
  onClick: () => void;
  hasNotification: boolean;
  controlActive?: boolean;
  hasSuggestion?: boolean;
  wantsToSpeak?: boolean;
}

export function FloatingWidget({ emoji, name, onClick, hasNotification, controlActive, hasSuggestion, wantsToSpeak }: FloatingWidgetProps) {
  const { t } = useTranslation();
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const windowPosRef = useRef<[number, number]>([0, 0]);
  const moveHandlerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);

  // Cleanup drag listeners on unmount + restore click-through
  useEffect(() => {
    return () => {
      if (moveHandlerRef.current) {
        window.removeEventListener('mousemove', moveHandlerRef.current);
      }
      if (upHandlerRef.current) {
        window.removeEventListener('mouseup', upHandlerRef.current);
      }
      // Restore click-through when widget unmounts (e.g. switching to chat view)
      window.kxai.setClickThrough(false);
    };
  }, []);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    isDragging.current = false;
    dragStart.current = { x: e.screenX, y: e.screenY };

    // Get window position once at drag start
    const pos = await window.kxai.getWindowPosition();
    windowPosRef.current = pos;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.screenX - dragStart.current.x;
      const dy = ev.screenY - dragStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        isDragging.current = true;
        const newX = windowPosRef.current[0] + dx;
        const newY = windowPosRef.current[1] + dy;
        window.kxai.setWindowPosition(newX, newY);
        windowPosRef.current = [newX, newY];
        dragStart.current = { x: ev.screenX, y: ev.screenY };
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      moveHandlerRef.current = null;
      upHandlerRef.current = null;
      if (!isDragging.current) {
        onClick();
      }
    };

    // Store refs for cleanup on unmount
    moveHandlerRef.current = onMouseMove;
    upHandlerRef.current = onMouseUp;

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onClick]);

  // Priority: control > suggestion > speak > notify > normal
  const stateClass = controlActive
    ? s.control
    : hasSuggestion
      ? s.suggestion
      : wantsToSpeak
        ? s.speak
        : hasNotification
          ? s.notify
          : undefined;

  const titleText = controlActive
    ? t('widget.titleControl', { name })
    : hasSuggestion
      ? t('widget.titleSuggestion', { name })
      : wantsToSpeak
        ? t('widget.titleWantsToSpeak', { name })
        : t('widget.titleDefault', { name });

  // ─── Click-through toggle: disable when hovering widget, enable when leaving ───
  const handleMouseEnter = useCallback(() => {
    window.kxai.setClickThrough(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    // Don't re-enable click-through during drag — mouse can leave widget area
    if (!isDragging.current) {
      window.kxai.setClickThrough(true);
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }, [onClick]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open KxAI"
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(s.widget, stateClass)}
      title={titleText}
    >
      <span className={s.emoji}>{emoji}</span>
      
      {/* Notification badge */}
      {(hasNotification || hasSuggestion || wantsToSpeak) && (
        <div className={s.badge} aria-hidden="true" />
      )}

      {/* Control active indicator */}
      {controlActive && (
        <div className={s.controlRing} />
      )}
    </div>
  );
}
