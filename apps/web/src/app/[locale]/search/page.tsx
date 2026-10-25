import { SEARCH_NO_RESULTS } from '@urban-ibile/shared';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchBox } from '@/components/search-box';
import { ListControls } from '@/components/list-controls';
import { Pagination } from '@/components/pagination';
import { ProductGrid } from '@/components/product-grid';
import { searchProducts } from '@/lib/api/public';
import { getTranslator, toLocale } from '@/lib/i18n/server';
import {
  listHref,
  parseListState,
  parseSearchQuery,
  type RawSearchParams,
} from '@/lib/list-params';

const BASE_PATH = '/search';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = getTranslator(toLocale((await params).locale));
  // Result pages for arbitrary text are not worth indexing.
  return { title: t('search.title'), robots: { index: false, follow: true } };
}

/** Never cached: arbitrary search text would only fill the cache. User text renders escaped. */
export default async function SearchPage({ params, searchParams }: PageProps) {
  const locale = toLocale((await params).locale);
  const t = getTranslator(locale);
  const raw = await searchParams;
  const q = parseSearchQuery(raw);
  const state = parseListState(raw);

  if (!q) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold sm:text-4xl">{t('search.title')}</h1>
        <div className="mt-6 max-w-xl">
          <Suspense fallback={<div className="h-11 border border-ink bg-white" />}>
            <SearchBox />
          </Suspense>
        </div>
        <p className="mt-4">{t('search.prompt')}</p>
      </div>
    );
  }

  const result = await searchProducts(q, { page: state.page, sort: state.sort });
  const empty = result.data.length === 0 || result.code === SEARCH_NO_RESULTS;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold sm:text-4xl">
        {t('search.heading_for', { query: q })}
      </h1>
      <div className="mt-6 max-w-xl">
        <Suspense fallback={<div className="h-11 border border-ink bg-white" />}>
          <SearchBox />
        </Suspense>
      </div>
      {!empty ? (
        <>
          <p className="mt-2 text-ink-muted">
            {t('search.results_count', { total: result.meta.total })}
          </p>
          <div className="mt-6">
            <ListControls basePath={BASE_PATH} state={state} q={q} types={[]} locale={locale} />
          </div>
          <div className="mt-10">
            <ProductGrid products={result.data} locale={locale} label={t('search.title')} />
          </div>
          <Pagination
            current={result.meta.page}
            total={result.meta.totalPages}
            locale={locale}
            hrefFor={(page) => listHref(BASE_PATH, { ...state, q, page })}
          />
        </>
      ) : (
        <p role="status" className="mt-6 text-lg">
          {t('search.no_results')}
        </p>
      )}
    </div>
  );
}
