import type { Locale } from '@urban-ibile/i18n';
import Link from 'next/link';
import { Suspense } from 'react';
import { BRAND_NAME } from '@/brand/brand';
import { PIDGIN_ENABLED } from '@/config/env';
import { getTranslator } from '@/lib/i18n/server';
import { BrandLogo } from './brand-logo';
import { LanguageSwitcher } from './language-switcher';
import { SearchBox } from './search-box';

/** Only links that work today: home (logo), Shop and search. Account and cart come later. */
export function SiteHeader({ locale }: { locale: Locale }) {
  const t = getTranslator(locale);
  return (
    <header className="border-b border-line bg-ivory">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" aria-label={t('a11y.logo_home', { brand: BRAND_NAME })} className="mr-auto md:mr-0">
          <BrandLogo />
        </Link>
        <nav aria-label={t('nav.primary')} className="flex items-center gap-5">
          <Link href="/shop" className="py-2 text-base font-medium underline-offset-4 hover:underline">
            {t('nav.shop')}
          </Link>
        </nav>
        {PIDGIN_ENABLED ? <LanguageSwitcher /> : null}
        <div className="order-last w-full md:order-none md:ml-auto md:w-80">
          <Suspense fallback={<div className="h-11 border border-ink bg-white" />}>
            <SearchBox />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
