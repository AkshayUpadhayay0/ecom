'use client';

import Link from 'next/link';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form';
import { loginHref } from '@/lib/auth/safe-redirect';
import { useCart } from '@/lib/cart/hooks';
import { describeError } from '@/lib/client/error-messages';
import { useHasSession } from '@/lib/client/session';
import { useI18n } from '@/lib/i18n/provider';
import { CartView } from './cart-view';

export function CartPage() {
  const { t } = useI18n();
  const hasSession = useHasSession();
  const cart = useCart();

  if (!hasSession) {
    return (
      <div className="space-y-4">
        <p>{t('cart.signin')}</p>
        <Link href={loginHref('/cart')} className={primaryButtonClass}>
          {t('nav.sign_in')}
        </Link>
      </div>
    );
  }
  if (cart.isPending) return <p>{t('cart.loading')}</p>;
  if (cart.isError) {
    const described = describeError(cart.error);
    return (
      <div className="space-y-3" role="alert">
        <p className="text-red-text">
          {t('cart.load_failed')} {t(described.key, described.params)}
        </p>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => {
            void cart.refetch();
          }}
        >
          {t('cart.retry')}
        </button>
      </div>
    );
  }
  return <CartView cart={cart.data} />;
}
