/**
 * Contract tests for i18n keys introduced in fix/ui-consistency PR.
 *
 * Verifies that:
 * - New keys exist in both EN and PL locale dictionaries.
 * - The settings.common.error template interpolates {message} correctly.
 * - No key silently falls through to the raw key string (which would show
 *   "settings.common.saved" in the UI instead of the translated text).
 */

import { describe, it, expect } from 'vitest';
import { en } from '../src/renderer/i18n/en';
import { pl } from '../src/renderer/i18n/pl';

// Keys added / required by fix/ui-consistency
const NEW_KEYS = [
  'settings.common.saved',
  'settings.common.success',
  'settings.common.error',
  'settings.telegram.saveToken',
  'settings.general.ttsProviderElevenLabs',
  'settings.general.ttsProviderOpenAI',
  'settings.general.ttsProviderWeb',
  'settings.general.ttsModelMultilingual',
  'settings.general.ttsModelFlash',
  'settings.general.ttsModelTurbo',
  'settings.general.ttsModelMonolingual',
];

describe('i18n — settings.common keys (fix/ui-consistency)', () => {
  it.each(NEW_KEYS)('key "%s" exists in EN locale', (key) => {
    expect(en[key]).toBeDefined();
    expect(en[key]).not.toBe('');
    expect(en[key]).not.toBe(key); // must not fall through to raw key
  });

  it.each(NEW_KEYS)('key "%s" exists in PL locale', (key) => {
    expect(pl[key]).toBeDefined();
    expect(pl[key]).not.toBe('');
    expect(pl[key]).not.toBe(key);
  });

  it('settings.common.error contains {message} placeholder', () => {
    expect(en['settings.common.error']).toContain('{message}');
    expect(pl['settings.common.error']).toContain('{message}');
  });

  it('settings.common.success contains {message} placeholder', () => {
    expect(en['settings.common.success']).toContain('{message}');
    expect(pl['settings.common.success']).toContain('{message}');
  });

  it('settings.common.error interpolates correctly', () => {
    const template = en['settings.common.error']!;
    const result = template.replaceAll('{message}', 'network timeout');
    expect(result).toContain('network timeout');
    expect(result).not.toContain('{message}');
  });

  it('settings.common.success interpolates correctly', () => {
    const template = en['settings.common.success']!;
    const result = template.replaceAll('{message}', 'saved successfully');
    expect(result).toContain('saved successfully');
    expect(result).toContain('✅');
    expect(result).not.toContain('{message}');
  });
});
