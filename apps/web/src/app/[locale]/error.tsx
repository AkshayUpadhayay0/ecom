'use client';

import { useI18n } from '@/lib/i18n/provider';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6" role="alert">
      <h1 className="text-3xl font-semibold">{t('error.title')}</h1>
      <p className="mt-4">{t('error.body')}</p>
      <button type="button" onClick={reset} className="mt-8 min-h-11 bg-emerald px-6 text-ivory">
        {t('error.retry')}
      </button>
    </div>
  );
}
