import React from 'react';
import type { ProactiveMessage } from '../types';

interface ProactiveNotificationProps {
  message: ProactiveMessage;
  onDismiss: () => void;
  onReply: (text: string) => void;
}

export function ProactiveNotification({ message, onDismiss, onReply }: ProactiveNotificationProps) {
  return (
    <div
      className="slide-in"
      style={{
        position: 'fixed',
        top: 80,
        right: 20,
        width: 340,
        maxWidth: 'calc(100vw - 40px)',
        background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--border)',
        overflow: 'hidden',
        zIndex: 9998,
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        background: 'var(--accent-light)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span>💡</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
            Obserwacja KxAI
          </span>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 14,
            padding: '2px 6px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{
        padding: '12px 14px',
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--text-primary)',
        maxHeight: 200,
        overflowY: 'auto',
      }}>
        {message.message}
      </div>

      {/* Context */}
      {message.context && (
        <div style={{
          padding: '8px 14px',
          fontSize: 11,
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-primary)',
        }}>
          📋 {message.context}
        </div>
      )}

      {/* Actions */}
      <div style={{
        padding: '8px 14px',
        display: 'flex',
        gap: 6,
        justifyContent: 'flex-end',
        borderTop: '1px solid var(--border)',
      }}>
        <button
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xs)',
            padding: '6px 12px',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Zamknij
        </button>
        <button
          onClick={() => onReply(message.message)}
          style={{
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 'var(--radius-xs)',
            padding: '6px 12px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          Odpowiedz
        </button>
      </div>
    </div>
  );
}
