import type { Locale } from '@urban-ibile/i18n';
import Link from 'next/link';
import { getTranslator } from '@/lib/i18n/server';

/** Pages shown on each side of the current one. */
const WINDOW = 2;

export function pageWindow(current: number, total: number): (number | 'gap')[] {
  const pages = new Set<number>([1, total]);
  for (let p = current - WINDOW; p <= current + WINDOW; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && page - previous > 1) result.push('gap');
    result.push(page);
  });
  return result;
}

/** URL-based pagination: plain links, works without JavaScript. */
export function Pagination({
  current,
  total,
  hrefFor,
  locale,
}: {
  current: number;
  total: number;
  hrefFor: (page: number) => string;
  locale: Locale;
}) {
  if (total <= 1) return null;
  const t = getTranslator(locale);
  const linkClass = 'grid min-h-11 min-w-11 place-items-center border border-ink px-3';
  return (
    <nav aria-label={t('pagination.label')} className="mt-12">
      <p className="mb-3 text-sm text-ink-muted">
        {t('pagination.status', { page: current, total })}
      </p>
      <ul className="flex flex-wrap items-center gap-2">
        {current > 1 ? (
          <li>
            <Link href={hrefFor(current - 1)} rel="prev" className={linkClass}>
              {t('pagination.previous')}
            </Link>
          </li>
        ) : null}
        {pageWindow(current, total).map((item, index) =>
          item === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={hrefFor(item)}
                aria-label={t('pagination.go_to', { page: item })}
                aria-current={item === current ? 'page' : undefined}
                className={`${linkClass} ${item === current ? 'bg-ink text-ivory' : ''}`}
              >
                {item}
              </Link>
            </li>
          ),
        )}
        {current < total ? (
          <li>
            <Link href={hrefFor(current + 1)} rel="next" className={linkClass}>
              {t('pagination.next')}
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
