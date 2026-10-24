import type { createTranslator } from '@urban-ibile/i18n';
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from '@urban-ibile/i18n';

import { translatorFor } from './translator';

export type Translate = ReturnType<typeof createTranslator>;

/** Route param -> supported locale (anything else falls back to English). */
export function toLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function getTranslator(locale: Locale): Translate {
  return translatorFor(locale);
}

export function allLocales(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }));
}
