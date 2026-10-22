import type { Locale } from '@urban-ibile/i18n';
import { LANGUAGE_COOKIE } from '@/config/constants';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Remembers the language choice (read by proxy.ts on the next request). */
export function setLanguageCookie(locale: Locale): void {
  document.cookie = `${LANGUAGE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}
