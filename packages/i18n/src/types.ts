import type { en } from './en.js';

/** Languages the storefront knows. `pcm` = Nigerian Pidgin (copy supplied by the client's writer). */
export const LOCALES = ['en', 'pcm'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export type MessageKey = keyof typeof en;
/** English is complete: every key has a string. */
export type Messages = Record<MessageKey, string>;
/** Other languages may supply any subset; the rest falls back to English. */
export type PartialMessages = Partial<Messages>;
export type MessageParams = Record<string, string | number>;
