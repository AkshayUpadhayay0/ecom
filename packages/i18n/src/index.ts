import { en } from './en.js';
import { pcm } from './pcm.js';
import type { Locale, MessageKey, Messages, MessageParams, PartialMessages } from './types.js';

export { en, pcm };
export type { Locale, MessageKey, Messages, MessageParams, PartialMessages };
export { DEFAULT_LOCALE, LOCALES, isLocale } from './types.js';

const dictionaries: Record<Locale, PartialMessages> = { en, pcm };

/**
 * Message lookup with a per-key fallback: a key missing (or empty) in the chosen language is
 * answered in English, so an incomplete language file never shows a blank or a raw key.
 */
export function createTranslator(locale: Locale): (key: MessageKey, params?: MessageParams) => string {
  const chosen = dictionaries[locale];
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
