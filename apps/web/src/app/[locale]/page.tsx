import Link from 'next/link';
import { Hero } from '@/components/hero';
import { ProductCard } from '@/components/product-card';
import { HOME_FEATURED_DESKTOP, HOME_FEATURED_MOBILE, PAGE_REVALIDATE_SECONDS } from '@/config/constants';
import { getProducts, getSiteConfig } from '@/lib/api/public';
import { getTranslator, toLocale } from '@/lib/i18n/server';

export const revalidate = PAGE_REVALIDATE_SECONDS;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = toLocale((await params).locale);
  const t = getTranslator(locale);
  const [config, list] = await Promise.all([
    getSiteConfig().catch(() => null),
    getProducts({ page: 1, pageSize: HOME_FEATURED_DESKTOP }).catch(() => null),
  ]);
  const products = list?.data ?? [];

  return (
    <>
      <Hero hero={config?.hero ?? null} locale={locale} defaultLanguage={config?.defaultLanguage ?? 'en'} />
      {products.length > 0 ? (
        <section aria-labelledby="featured" className="mx-auto max-w-7xl px-4 pt-16 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 id="featured" className="text-2xl font-semibold sm:text-3xl">
              {t('home.featured_heading')}
            </h2>
            <Link href="/shop" className="py-2 underline underline-offset-4">
              {t('home.view_all')}
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {products.slice(0, HOME_FEATURED_DESKTOP).map((product, index) => (
              <li key={product.id} className={index >= HOME_FEATURED_MOBILE ? 'hidden sm:list-item' : undefined}>
                <ProductCard product={product} locale={locale} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
