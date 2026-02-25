/**
 * i18n — Lightweight internationalization for KxAI renderer.
 *
 * Uses config.userLanguage as locale source (via useConfigStore).
 * Supports PL (primary) and EN (secondary).
 * Fallback chain: current locale → PL → key itself.
 *
 * Usage:
 *   const { t } = useTranslation();
 *   <button>{t('chat.settings.title')}</button>
 *   <span>{t('chat.empty.title', { name: 'KxAI' })}</span>
 *
 * @module i18n
 * @phase 7.4
 */

import { useConfigStore } from '../stores';
import { pl } from './pl';
import { en } from './en';

// ─── Types ───

export type Locale = 'pl' | 'en';
export type TranslationDict = Record<string, string>;

// ─── Translation dictionaries ───

const dictionaries: Record<Locale, TranslationDict> = { pl, en };

// ─── Core translation function ───

/**
 * Translate a key to a localized string.
 * Supports `{param}` interpolation.
 * Fallback: locale dict → PL dict → raw key.
 */
export function translate(key: string, locale: Locale, params?: Record<string, string | number>): string {
  const dict = dictionaries[locale] ?? dictionaries.pl;
  let text = dict[key] ?? dictionaries.pl[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

// ─── React hook ───

/**
 * Hook providing the `t()` translation function bound to current locale.
 * Re-renders when locale changes in config.
 *
 * @example
 * const { t, locale } = useTranslation();
 * return <h1>{t('settings.title')}</h1>;
 */
export function useTranslation() {
  const locale = (useConfigStore((s) => s.config?.userLanguage) ?? 'pl') as Locale;
  return {
    t: (key: string, params?: Record<string, string | number>) => translate(key, locale, params),
    locale,
  };
}

// ─── Non-hook helper (for use outside React components) ───

/**
 * Get a translation using the current config locale.
 * Use this in utility functions or outside React components.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const state = useConfigStore.getState();
  const locale = (state.config?.userLanguage ?? 'pl') as Locale;
  return translate(key, locale, params);
}
