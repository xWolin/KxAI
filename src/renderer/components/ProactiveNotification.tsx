import React from 'react';
import type { ProactiveMessage } from '../types';

interface ProactiveNotificationProps {
  message: ProactiveMessage;
  onDismiss: () => void;
  onReply: (text: string) => void;
}

export function ProactiveNotification({ message, onDismiss, onReply }: ProactiveNotificationProps) {
  return (
    <div className="slide-in proactive-notification">
      {/* Header */}
      <div className="proactive-notification__header">
        <div className="proactive-notification__header-left">
          <span>💡</span>
          <span className="proactive-notification__label">
            Obserwacja KxAI
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="proactive-notification__close"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="proactive-notification__content">
        {message.message}
      </div>

      {/* Context */}
      {message.context && (
        <div className="proactive-notification__context">
          📋 {message.context}
        </div>
      )}

      {/* Actions */}
      <div className="proactive-notification__actions">
        <button
          onClick={onDismiss}
          className="proactive-notification__btn-dismiss"
        >
          Zamknij
        </button>
        <button
          onClick={() => onReply(message.message)}
          className="proactive-notification__btn-reply"
        >
          Odpowiedz
        </button>
      </div>
    </div>
  );
}
