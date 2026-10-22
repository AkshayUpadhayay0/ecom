'use client';

import Link from 'next/link';
import { useHasSession } from '@/lib/client/session';
import { useI18n } from '@/lib/i18n/provider';

/** Account / sign-in link in the header (cart button joins it with the cart step). */
export function HeaderActions() {
  const { t } = useI18n();
  const hasSession = useHasSession();
  return (
    <nav aria-label={t('nav.account')} className="flex items-center gap-5">
      {hasSession ? (
        <Link
          href="/account"
          className="py-2 text-base font-medium underline-offset-4 hover:underline"
        >
          {t('nav.account')}
        </Link>
      ) : (
        <Link
          href="/login"
          className="py-2 text-base font-medium underline-offset-4 hover:underline"
        >
          {t('nav.sign_in')}
        </Link>
      )}
    </nav>
  );
}
