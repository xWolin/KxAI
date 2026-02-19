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
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #6c63ff 0%, #4834d4 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 4px 20px rgba(108, 99, 255, 0.4)',
        transition: 'all 0.3s ease',
        animation: hasNotification ? 'breathe 2s infinite' : undefined,
        WebkitAppRegion: 'drag',
        zIndex: 9999,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
      }}
      title={`${name} — kliknij aby otworzyć`}
    >
      <span style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</span>
      
      {/* Notification badge */}
      {hasNotification && (
        <div style={{
          position: 'absolute',
          top: -2,
          right: -2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#f44336',
          border: '2px solid #1a1b2e',
          animation: 'pulse 1.5s infinite',
        }} />
      )}
    </div>
  );
}
