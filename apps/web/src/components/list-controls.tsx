import type { Locale } from '@urban-ibile/i18n';
import { CATALOG_SORTS, type CatalogSort, type PublicClothingTypeDto } from '@urban-ibile/shared';
import Link from 'next/link';
import { getTranslator } from '@/lib/i18n/server';
import { listHref, type ListState } from '@/lib/list-params';

const SORT_LABEL_KEY = {
  newest: 'shop.sort_newest',
  price_asc: 'shop.sort_price_asc',
  price_desc: 'shop.sort_price_desc',
  name: 'shop.sort_name',
} as const satisfies Record<CatalogSort, string>;

const chip = 'inline-flex min-h-11 items-center border border-ink px-3 text-sm';

/** Clothing-type filter and sort as plain links: the state lives in the URL. */
export function ListControls({
  basePath,
  state,
  q,
  types,
  locale,
}: {
  basePath: string;
  state: ListState;
  q?: string;
  types: PublicClothingTypeDto[];
  locale: Locale;
}) {
  const t = getTranslator(locale);
  const href = (change: Partial<ListState>) => listHref(basePath, { ...state, ...change, page: 1, q });
  return (
    <div className="space-y-4">
      {types.length > 0 ? (
        <nav aria-label={t('shop.filter_label')}>
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href={href({ type: undefined })}
                aria-current={state.type === undefined ? 'true' : undefined}
                className={`${chip} ${state.type === undefined ? 'bg-ink text-ivory' : ''}`}
              >
                {t('shop.filter_all')}
              </Link>
            </li>
            {types.map((type) => (
              <li key={type.slug}>
                <Link
                  href={href({ type: type.slug })}
                  aria-current={state.type === type.slug ? 'true' : undefined}
                  className={`${chip} ${state.type === type.slug ? 'bg-ink text-ivory' : ''}`}
                >
                  {type.name ?? type.slug}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <nav aria-label={t('shop.sort_label')} className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-muted">{t('shop.sort_label')}</span>
        <ul className="flex flex-wrap gap-2">
          {CATALOG_SORTS.map((sort) => (
            <li key={sort}>
              <Link
                href={href({ sort })}
                aria-current={state.sort === sort ? 'true' : undefined}
                className={`inline-flex min-h-11 items-center px-1 underline-offset-4 ${
                  state.sort === sort ? 'font-semibold underline' : 'hover:underline'
                }`}
              >
                {t(SORT_LABEL_KEY[sort])}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
