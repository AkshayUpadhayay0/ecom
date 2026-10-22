import { isLocale } from '@urban-ibile/i18n';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BRAND_NAME } from '@/brand/brand';
import { siteOrigin } from '@/config/env';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { allLocales, getTranslator, toLocale } from '@/lib/i18n/server';
import { I18nProvider } from '@/lib/i18n/provider';
import { drafting, inter } from '../fonts';
import '../globals.css';

export function generateStaticParams() {
  return allLocales();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  return {
    metadataBase: new URL(siteOrigin()),
    title: { default: BRAND_NAME, template: `%s | ${BRAND_NAME}` },
    description: t('meta.site_description', { brand: BRAND_NAME }),
    applicationName: BRAND_NAME,
    openGraph: { siteName: BRAND_NAME, type: 'website', locale: 'en_NG' },
  };
}
export const viewport: Viewport = {
  themeColor: '#FFFCEB',
  width: 'device-width',
  initialScale: 1,
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const rawLocale = (await params).locale;
  // Only locales the proxy can produce exist; anything else (e.g. /fr/...) is a 404.
  if (!isLocale(rawLocale)) notFound();
  const locale = toLocale(rawLocale);
  const t = getTranslator(locale);

  return (
    <html
      lang={locale === 'pcm' ? 'pcm' : 'en'}
      className={`${drafting.variable} ${inter.variable}`}
    >
      <body>
        <I18nProvider locale={locale}>
          <a className="skip-link" href="#main">
            {t('a11y.skip_to_content')}
          </a>
          <SiteHeader locale={locale} />
          <main id="main" tabIndex={-1} className="outline-none">
            {children}
          </main>
          <SiteFooter locale={locale} />
        </I18nProvider>
      </body>
    </html>
  );
}
