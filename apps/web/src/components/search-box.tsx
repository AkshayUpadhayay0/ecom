'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { SEARCH_DEBOUNCE_MS, SEARCH_MAX_LENGTH } from '@/config/constants';
import { useI18n } from '@/lib/i18n/provider';
import { listHref, normalizeQuery } from '@/lib/list-params';

const SEARCH_PATH = '/search';

/**
 * Header search. Typing navigates (debounced) to /search?q=..., Enter navigates at once. The
 * text is trimmed and length-limited before it reaches the URL; the page re-reads it from the URL
 * and renders it as escaped text only.
 */
export function SearchBox() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const inputId = useId();
  const urlQuery = pathname === SEARCH_PATH ? normalizeQuery(params.get('q') ?? undefined) : '';
  const [value, setValue] = useState(urlQuery);
  const [typed, setTyped] = useState(false);
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);

  // Follow the URL (back/forward, links) without fighting what the visitor is typing.
  // Adjusting state while rendering is React's pattern for state derived from changing input.
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery);
    if (normalizeQuery(value) !== urlQuery) {
      setTyped(false);
      setValue(urlQuery);
    }
  }

  useEffect(() => {
    if (!typed) return;
    const query = normalizeQuery(value);
    if (!query || query === urlQuery) return;
    const timer = setTimeout(() => {
      router.replace(listHref(SEARCH_PATH, { q: query }));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed, value, urlQuery, router]);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query = normalizeQuery(value);
    router.push(query ? listHref(SEARCH_PATH, { q: query }) : SEARCH_PATH);
  }

  return (
    <form role="search" action={SEARCH_PATH} method="get" onSubmit={onSubmit} className="w-full">
      <label htmlFor={inputId} className="sr-only">
        {t('header.search_label')}
      </label>
      <div className="flex items-stretch border border-ink bg-white focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-emerald">
        <input
          id={inputId}
          name="q"
          type="search"
          value={value}
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={t('header.search_placeholder')}
          onChange={(event) => {
            setTyped(true);
            setValue(event.target.value);
          }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-ink-muted"
        />
        <button
          type="submit"
          className="grid w-11 place-items-center bg-ink text-ivory"
          aria-label={t('search.submit')}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </form>
  );
}
