import React, { useRef, useCallback, useEffect } from 'react';

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
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const windowPosRef = useRef<[number, number]>([0, 0]);
  const moveHandlerRef = useRef<((ev: MouseEvent) => void) | null>(null);
  const upHandlerRef = useRef<(() => void) | null>(null);

  // Cleanup drag listeners on unmount
  useEffect(() => {
    return () => {
      if (moveHandlerRef.current) {
        window.removeEventListener('mousemove', moveHandlerRef.current);
      }
      if (upHandlerRef.current) {
        window.removeEventListener('mouseup', upHandlerRef.current);
      }
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
    ? ' floating-widget--control'
    : hasSuggestion
      ? ' floating-widget--suggestion'
      : wantsToSpeak
        ? ' floating-widget--speak'
        : hasNotification
          ? ' floating-widget--notify'
          : '';

  const titleText = controlActive
    ? `${name} — sterowanie aktywne (Ctrl+Shift+K aby zatrzymać)`
    : hasSuggestion
      ? `${name} — mam sugestię! Kliknij aby zobaczyć`
      : wantsToSpeak
        ? `${name} — chcę coś powiedzieć (Ctrl+Shift+P)`
        : `${name} — kliknij aby otworzyć`;

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`floating-widget${stateClass}`}
      title={titleText}
    >
      <span className="floating-widget__emoji">{emoji}</span>
      
      {/* Notification badge */}
      {(hasNotification || hasSuggestion || wantsToSpeak) && (
        <div className="floating-widget__badge" />
      )}

      {/* Control active indicator */}
      {controlActive && (
        <div className="floating-widget__control-ring" />
      )}
    </div>
  );
}
