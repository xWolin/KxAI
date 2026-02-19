import React, { useRef, useCallback } from 'react';

interface FloatingWidgetProps {
  emoji: string;
  name: string;
  onClick: () => void;
  hasNotification: boolean;
}

export function FloatingWidget({ emoji, name, onClick, hasNotification }: FloatingWidgetProps) {
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = false;
    dragStart.current = { x: e.screenX, y: e.screenY };

    const onMouseMove = async (ev: MouseEvent) => {
      const dx = ev.screenX - dragStart.current.x;
      const dy = ev.screenY - dragStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        isDragging.current = true;
        const [wx, wy] = await window.kxai.getWindowPosition();
        window.kxai.setWindowPosition(wx + dx, wy + dy);
        dragStart.current = { x: ev.screenX, y: ev.screenY };
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!isDragging.current) {
        onClick();
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onClick]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`floating-widget${hasNotification ? ' floating-widget--notify' : ''}`}
      title={`${name} — kliknij aby otworzyć`}
    >
      <span className="floating-widget__emoji">{emoji}</span>
      
      {/* Notification badge */}
      {hasNotification && (
        <div className="floating-widget__badge" />
      )}
    </div>
  );
}
