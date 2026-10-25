'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type SyntheticEvent } from 'react';
import { SEARCH_MAX_LENGTH } from '@/config/constants';
import { useI18n } from '@/lib/i18n/provider';
import { listHref, normalizeQuery } from '@/lib/list-params';
import { CloseIcon, SearchIcon } from './icons';
import { useModalDialog } from './modal-dialog';

const SEARCH_PATH = '/search';

/**
 * Full-screen search. Enter (or the button) opens /search?q=..., the results page that covers the
 * whole catalogue (name, clothing type, keywords) and shows the exact empty message. The text is
 * trimmed and length-limited before it reaches the URL.
 */
export default function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const inputId = useId();
  const [value, setValue] = useState('');
  const dialog = useModalDialog(open, onClose);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query = normalizeQuery(value);
    router.push(query ? listHref(SEARCH_PATH, { q: query }) : SEARCH_PATH);
    onClose();
  }

  return (
    <dialog
      ref={dialog}
      aria-label={t('nav.search')}
      onClose={onClose}
      className="search-overlay m-0 h-dvh max-h-none w-full max-w-none bg-ivory p-0 text-ink"
    >
      <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('header.close_search')}
            className="grid size-11 place-items-center"
          >
            <CloseIcon />
          </button>
        </div>
        <form role="search" action={SEARCH_PATH} method="get" onSubmit={onSubmit} className="mt-6">
          <label htmlFor={inputId} className="sr-only">
            {t('header.search_label')}
          </label>
          <div className="flex items-center gap-3 border-b-2 border-ink">
            <span className="text-ink">
              <SearchIcon />
            </span>
            <input
              id={inputId}
              name="q"
              type="search"
              value={value}
              maxLength={SEARCH_MAX_LENGTH}
              data-autofocus
              autoComplete="off"
              enterKeyHint="search"
              placeholder={t('header.search_placeholder')}
              onChange={(event) => {
                setValue(event.target.value);
              }}
              className="min-h-16 min-w-0 flex-1 bg-transparent text-2xl outline-none placeholder:text-ink-muted sm:text-4xl"
            />
          </div>
          <p className="mt-4 text-ink-muted">{t('search.prompt')}</p>
        </form>
      </div>
    </dialog>
  );
}
