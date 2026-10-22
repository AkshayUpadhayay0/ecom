'use client';

import { LOCALES, type Locale } from '@urban-ibile/i18n';
import { useRouter } from 'next/navigation';
import { PIDGIN_ENABLED } from '@/config/env';
import { setLanguageCookie } from '@/lib/i18n/language-cookie';
import { useI18n } from '@/lib/i18n/provider';

/**
 * English | Pidgin. Behind NEXT_PUBLIC_ENABLE_PIDGIN (off by default) until the client's approved
 * Pidgin copy exists. Stores the choice in a cookie and refreshes the current route in place, so
 * the URL, query and page state stay as they are.
 */
export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const router = useRouter();

  if (!PIDGIN_ENABLED) return null;

  function choose(next: Locale): void {
    if (next === locale) return;
    setLanguageCookie(next);
    router.refresh();
  }

  return (
    <div role="group" aria-label={t('language.label')} className="flex items-center gap-1 text-sm">
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === locale}
          onClick={() => {
            choose(code);
          }}
          className={`px-2 py-1.5 ${code === locale ? 'bg-ink text-ivory' : 'underline underline-offset-4'}`}
        >
          {t(`language.${code}`)}
        </button>
      ))}
    </div>
  );
}
