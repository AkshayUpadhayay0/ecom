import type { Locale } from '@urban-ibile/i18n';
import Link from 'next/link';
import { BRAND_NAME } from '@/brand/brand';
import { getContentBlock } from '@/lib/api/public';
import { getTranslator } from '@/lib/i18n/server';
import { BrandLogo } from './brand-logo';

const FOOTER_BLOCK_KEY = 'footer.about';

/**
 * Footer text comes from the content API (published plain text). While the client has not
 * supplied it ("pending") or the API is unreachable, a quiet empty state shows instead: no copy
 * is invented here.
 */
export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = getTranslator(locale);
  const block = await getContentBlock(FOOTER_BLOCK_KEY).catch(() => null);
  const parts = block?.status === 'available' ? block.parts : [];

  return (
    <footer className="on-dark mt-24 bg-emerald text-ivory">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr] lg:px-8">
        <section aria-labelledby="footer-about">
          <h2 id="footer-about" className="text-lg font-semibold">
            {block?.title ?? t('footer.heading_about')}
          </h2>
          {parts.length > 0 ? (
            <div className="mt-4 max-w-prose space-y-3 font-body leading-relaxed">
              {parts.map((part, index) =>
                part.type === 'heading' ? (
                  <h3 key={index} className="pt-2 text-base font-semibold">
                    {part.text}
                  </h3>
                ) : (
                  <p key={index}>{part.text}</p>
                ),
              )}
            </div>
          ) : (
            <p className="mt-4 text-ivory/90" data-testid="footer-empty">
              {t('footer.about_pending')}
            </p>
          )}
        </section>
        <nav aria-label={t('footer.nav')}>
          <ul className="space-y-2">
            <li>
              <Link href="/shop" className="underline underline-offset-4">
                {t('nav.shop')}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-ivory/25">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5 text-sm sm:px-6 lg:px-8">
          <BrandLogo />
          <p>{t('footer.rights', { year: new Date().getFullYear(), brand: BRAND_NAME })}</p>
        </div>
      </div>
    </footer>
  );
}
