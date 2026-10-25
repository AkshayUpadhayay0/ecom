'use client';

import Link from 'next/link';
import { PIDGIN_ENABLED } from '@/config/env';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useHasSession } from '@/lib/client/session';
import { useI18n } from '@/lib/i18n/provider';
import { listHref } from '@/lib/list-params';
import type { SiteLinks } from '@/lib/site-links';
import { CloseIcon } from './icons';
import { useModalDialog } from './modal-dialog';

const ROW = 'flex min-h-14 items-center justify-between border-b border-line px-5 py-3';

/**
 * Side menu: slides in from the left, full height. Shop, the clothing types, Account / Sign in,
 * the language switcher (only while the Pidgin flag is on) and support / policy links (only the
 * ones that exist). Native dialog: focus trap, Esc, focus return.
 */
export default function SideMenu({
  open,
  onClose,
  links,
}: {
  open: boolean;
  onClose: () => void;
  links: SiteLinks;
}) {
  const { t } = useI18n();
  const hasSession = useHasSession();
  const dialog = useModalDialog(open, onClose);
  const extra = [...links.policies, ...links.support];

  return (
    <dialog
      ref={dialog}
      aria-label={t('menu.title')}
      onClose={onClose}
      className="side-menu m-0 mr-auto h-dvh max-h-none w-[min(24rem,calc(100%-2.5rem))] overflow-y-auto bg-ivory p-0 text-ink backdrop:bg-ink/60"
    >
      <div className="flex min-h-full flex-col">
        <div className={ROW}>
          <span className="text-lg font-bold">{t('menu.title')}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('menu.close')}
            className="grid size-11 place-items-center"
          >
            <CloseIcon />
          </button>
        </div>
        <nav aria-label={t('menu.title')}>
          <ul>
            <li>
              <Link href="/shop" onClick={onClose} className={`${ROW} text-2xl font-bold`}>
                {t('nav.shop')}
              </Link>
            </li>
          </ul>
          {links.clothingTypes.length > 0 ? (
            <ul aria-label={t('shop.filter_label')}>
              {links.clothingTypes.map((type) => (
                <li key={type.slug}>
                  <Link
                    href={listHref('/shop', { type: type.slug })}
                    onClick={onClose}
                    className="flex min-h-12 items-center border-b border-line py-2 pr-5 pl-9 text-lg font-medium"
                  >
                    {type.name ?? type.slug}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <ul>
            <li>
              <Link
                href={hasSession ? '/account' : '/login'}
                onClick={onClose}
                className={`${ROW} text-2xl font-bold`}
              >
                {hasSession ? t('nav.account') : t('nav.sign_in')}
              </Link>
            </li>
          </ul>
        </nav>
        {PIDGIN_ENABLED ? (
          <div className={ROW}>
            <LanguageSwitcher />
          </div>
        ) : null}
        {extra.length > 0 ? (
          <ul className="mt-auto px-5 py-4 text-sm">
            {extra.map((link) => (
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
        ) : null}
      </div>
    </dialog>
  );
}
