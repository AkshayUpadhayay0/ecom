import {
  DEFAULT_LOCALE,
  LOCALES,
  createTranslator,
  isLocale,
  type Locale,
} from '@urban-ibile/i18n';

export type Translate = ReturnType<typeof createTranslator>;

/** Route param -> supported locale (anything else falls back to English). */
export function toLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function getTranslator(locale: Locale): Translate {
  return createTranslator(locale);
}

export function allLocales(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }));
}
