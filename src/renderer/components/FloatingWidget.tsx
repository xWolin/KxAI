import React from 'react';

interface FloatingWidgetProps {
  emoji: string;
  name: string;
  onClick: () => void;
  hasNotification: boolean;
}

export function FloatingWidget({ emoji, name, onClick, hasNotification }: FloatingWidgetProps) {
  return (
    <div
      onClick={onClick}
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
