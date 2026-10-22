import type { Metadata } from 'next';
import { ListControls } from '@/components/list-controls';
import { Pagination } from '@/components/pagination';
import { ProductGrid } from '@/components/product-grid';
import { getClothingTypes, getProducts } from '@/lib/api/public';
import { getTranslator, toLocale } from '@/lib/i18n/server';
import { listHref, parseListState, type RawSearchParams } from '@/lib/list-params';

const BASE_PATH = '/shop';

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  const state = parseListState(await searchParams);
  // Filtered and paged variants canonicalise to their own URL; sort-only changes to the base.
  return {
    title: t('shop.title'),
    alternates: { canonical: listHref(BASE_PATH, { page: state.page, type: state.type }) },
  };
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}

/**
 * Rendered per request (the URL carries page, sort and type) but every API call goes through the
 * Next data cache with a 60 s revalidate, matching the API's own caching.
 */
export default async function ShopPage({ params, searchParams }: PageProps) {
  const locale = toLocale((await params).locale);
  const t = getTranslator(locale);
  const state = parseListState(await searchParams);

  const [list, types] = await Promise.all([
    getProducts({ page: state.page, sort: state.sort, ...(state.type ? { clothingType: state.type } : {}) }),
    getClothingTypes().catch(() => []),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold sm:text-4xl">{t('shop.title')}</h1>
      <p className="mt-2 text-ink-muted">{t('shop.results_count', { total: list.meta.total })}</p>
      <div className="mt-6">
        <ListControls basePath={BASE_PATH} state={state} types={types} locale={locale} />
      </div>
      <div className="mt-10">
        {list.data.length > 0 ? (
          <ProductGrid products={list.data} locale={locale} label={t('shop.title')} />
        ) : (
          <p>{t('shop.empty')}</p>
        )}
      </div>
      <Pagination
        current={list.meta.page}
        total={list.meta.totalPages}
        locale={locale}
        hrefFor={(page) => listHref(BASE_PATH, { ...state, page })}
      />
    </div>
  );
}
