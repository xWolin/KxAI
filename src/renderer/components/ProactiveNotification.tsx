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

  // Icon and label depend on the message type so the user knows the source
  const typeConfig: Record<string, { icon: string; labelKey: string }> = {
    heartbeat: { icon: '🤖', labelKey: 'proactive.labelAutonomous' },
    reflection: { icon: '🪞', labelKey: 'proactive.labelReflection' },
    'screen-analysis': { icon: '💡', labelKey: 'proactive.labelObservation' },
    'meeting-reminder': { icon: '📅', labelKey: 'proactive.labelReminder' },
    'low-battery': { icon: '🔋', labelKey: 'proactive.labelSystem' },
    'disk-full': { icon: '💾', labelKey: 'proactive.labelSystem' },
    'high-cpu': { icon: '⚡', labelKey: 'proactive.labelSystem' },
    'no-network': { icon: '📡', labelKey: 'proactive.labelSystem' },
    'high-memory': { icon: '🧠', labelKey: 'proactive.labelSystem' },
    'daily-briefing': { icon: '☀️', labelKey: 'proactive.labelBriefing' },
    'evening-summary': { icon: '🌙', labelKey: 'proactive.labelBriefing' },
  };
  // Rule-based notifications have type='proactive' + ruleId='daily-briefing' etc.
  // Use ruleId for the config lookup when available, fall back to type.
  const configKey = message.type === 'proactive' && message.ruleId ? message.ruleId : message.type;
  const { icon, labelKey } = typeConfig[configKey] || { icon: '💡', labelKey: 'proactive.label' };

  const sendFeedback = (action: 'accepted' | 'dismissed' | 'replied') => {
    if (message.ruleId) {
      // Send to both Cortex and legacy proactive engines
      window.kxai?.cortexFeedback?.(message.ruleId, action).catch(() => {});
      window.kxai?.sendProactiveFeedback(message.ruleId, action).catch(() => {});
    }
  };

  const handleDismiss = () => {
    sendFeedback('dismissed');
    onDismiss();
  };

  const handleReply = () => {
    sendFeedback('replied');
    onReply(message.message);
  };

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
    <div className={cn('slide-in', s.root)} role="alertdialog" aria-live="assertive">
      {/* Header */}
      <div className={s.header}>
        <div className={s.headerLeft}>
          <span>{icon}</span>
          <span className={s.label}>{t(labelKey)}</span>
        </div>
        <button onClick={handleDismiss} className={s.close} aria-label="Close">
          ✕
        </button>
      </div>

      {/* Content */}
      <div className={s.content}>{message.message}</div>

      {/* Actions */}
      <div className={s.actions}>
        <button
          onClick={handleSpeak}
          className={isSpeaking ? s.btnSpeakActive : s.btnSpeak}
          title={t('proactive.speakTitle')}
          aria-label={t('proactive.speakTitle')}
        >
          {isSpeaking ? '⏹️' : '🔊'}
        </button>
        <button onClick={handleDismiss} className={s.btnDismiss}>
          {t('proactive.dismiss')}
        </button>
        <button onClick={handleReply} className={s.btnReply}>
          {t('proactive.reply')}
        </button>
      </div>
    </div>
  );
}
