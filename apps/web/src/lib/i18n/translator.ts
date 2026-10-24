import { createTranslator, type Locale, type PartialMessages } from '@urban-ibile/i18n';

/**
 * TEST ONLY: with NEXT_PUBLIC_I18N_TEST_FIXTURE=true (the e2e "flags" build) the Pidgin dictionary
 * gets one clearly fake key, so the per-key fallback and the language switcher can be tested
 * while no real Pidgin copy exists. It is not Pidgin: the text says so. Off everywhere else.
 */
const PCM_TEST_FIXTURE: PartialMessages =
  process.env.NEXT_PUBLIC_I18N_TEST_FIXTURE === 'true' ? { 'nav.shop': '[test fixture] Shop' } : {};

/** The translator for a language, used by server and client components alike. */
export function translatorFor(locale: Locale): ReturnType<typeof createTranslator> {
  return createTranslator(locale, locale === 'pcm' ? PCM_TEST_FIXTURE : undefined);
}
