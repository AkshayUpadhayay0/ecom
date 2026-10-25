import type { Locale } from '@urban-ibile/i18n';
import { BRAND_NAME } from '@/brand/brand';
import { getTranslator } from '@/lib/i18n/server';
import { getSiteLinks } from '@/lib/site-links';

/**
 * One line: the rights notice, plus contact and policy links only when the client supplied them.
 * The "About" content block still exists in the admin but is no longer shown on the site.
 */
export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = getTranslator(locale);
  const links = await getSiteLinks(locale);
  const items = [...links.policies, ...links.support];

  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-6 text-sm sm:px-6 lg:px-8">
        <p>{t('footer.rights', { year: new Date().getFullYear(), brand: BRAND_NAME })}</p>
        {items.length > 0 ? (
          <nav aria-label={t('footer.nav')}>
            <ul className="flex flex-wrap gap-x-6">
              {items.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    {...(link.external ? { rel: 'noopener' } : {})}
                    className="inline-flex min-h-11 items-center underline underline-offset-4"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </footer>
  );
}
