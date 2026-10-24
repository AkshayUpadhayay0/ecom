import { en } from './en';
import { pcm } from './pcm';
import type { Locale, MessageKey, Messages, MessageParams, PartialMessages } from './types';

export { en, pcm };
export type { Locale, MessageKey, Messages, MessageParams, PartialMessages };
export { DEFAULT_LOCALE, LOCALES, isLocale } from './types';

const dictionaries: Record<Locale, PartialMessages> = { en, pcm };

/**
 * Message lookup with a per-key fallback: a key missing (or empty) in the chosen language is
 * answered in English, so an incomplete language file never shows a blank or a raw key.
 */
export function createTranslator(
  locale: Locale,
  /** Extra keys for this language (tests only: lets a fixture stand in for real copy). */
  overrides?: PartialMessages,
): (key: MessageKey, params?: MessageParams) => string {
  const chosen = overrides ? { ...dictionaries[locale], ...overrides } : dictionaries[locale];
  return (key, params) => {
    const raw = chosen[key] ?? en[key];
    const template = raw === '' ? en[key] : raw;
    return params ? interpolate(template, params) : template;
  };
}

export function interpolate(template: string, params: MessageParams): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** Test/diagnostic helper: the keys a language has not supplied yet. */
export function missingKeys(locale: Locale): MessageKey[] {
  const chosen = dictionaries[locale];
  return (Object.keys(en) as MessageKey[]).filter((key) => !chosen[key]);
}
