import Link from 'next/link';
import { getTranslator } from '@/lib/i18n/server';

// not-found has no params: the language is English here until Pidgin copy exists.
export default function NotFound() {
  const t = getTranslator('en');
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
      <h1 className="text-3xl font-semibold sm:text-4xl">{t('notfound.title')}</h1>
      <p className="mt-4">{t('notfound.body')}</p>
      <Link
        href="/shop"
        className="mt-8 inline-flex min-h-11 items-center bg-emerald px-6 text-ivory"
      >
        {t('notfound.cta')}
      </Link>
    </div>
  );
}
