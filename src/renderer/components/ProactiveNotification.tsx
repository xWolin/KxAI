import React, { useState } from 'react';
import { speak, stopSpeaking } from '../utils/tts';
import type { ProactiveMessage } from '../types';
import s from './ProactiveNotification.module.css';
import { cn } from '../utils/cn';
import { useTranslation } from '../i18n';

interface ProactiveNotificationProps {
  message: ProactiveMessage;
  onDismiss: () => void;
  onReply: (text: string) => void;
}

export function ProactiveNotification({ message, onDismiss, onReply }: ProactiveNotificationProps) {
  const { t } = useTranslation();
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleSpeak = async () => {
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
    } else {
      setIsSpeaking(true);
      try {
        await speak(message.message);
      } catch (err) {
        console.error('TTS error:', err);
      } finally {
        setIsSpeaking(false);
      }
    }
  };

  return (
    <div className={cn('slide-in', s.root)}>
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerLeft}>
          <span>💡</span>
          <span className={s.label}>
            {t('proactive.label')}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className={s.close}
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className={s.content}>
        {message.message}
      </div>

      {/* Context */}
      {message.context && (
        <div className={s.context}>
          📋 {message.context}
        </div>
      )}

      {/* Actions */}
      <div className={s.actions}>
        <button
          onClick={handleSpeak}
          className={isSpeaking ? s.btnSpeakActive : s.btnSpeak}
          title={t('proactive.speakTitle')}
        >
          {isSpeaking ? '⏹️' : '🔊'}
        </button>
        <button
          onClick={onDismiss}
          className={s.btnDismiss}
        >
          {t('proactive.dismiss')}
        </button>
        <button
          onClick={() => onReply(message.message)}
          className={s.btnReply}
        >
          {t('proactive.reply')}
        </button>
      </div>
    </div>
  );
}
