'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useCart } from '@/lib/cart/hooks';
import { setCartDrawerOpen, useCartDrawerOpen } from '@/lib/cart/drawer';
import { useHasSession } from '@/lib/client/session';
import { useI18n } from '@/lib/i18n/provider';

// The drawer (and the cart code behind it) is only downloaded the first time it opens.
const MiniCartDrawer = dynamic(() => import('./mini-cart-drawer'), { ssr: false });

/** Header cart button with the item count. Only shown (and only fetches) while signed in. */
export function CartButton() {
  const { t } = useI18n();
  const hasSession = useHasSession();
  const open = useCartDrawerOpen();
  const cart = useCart();
  const [everOpened, setEverOpened] = useState(false);

  if (!hasSession) return null;
  const count = cart.data?.itemCount ?? 0;
  return (
    <>
      <button
        type="button"
        aria-label={t('cart.button', { count })}
        onClick={() => {
          setEverOpened(true);
          setCartDrawerOpen(true);
        }}
        className="relative inline-flex min-h-11 items-center gap-2 px-1 text-base font-medium"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 7h12l-1 12H7L6 7Z" strokeLinejoin="round" />
          <path d="M9 7a3 3 0 0 1 6 0" />
        </svg>
        <span
          data-testid="cart-count"
          className="min-w-5 bg-ink px-1.5 text-center text-sm text-ivory"
        >
          {count}
        </span>
      </button>
      {everOpened || open ? <MiniCartDrawer open={open} /> : null}
    </>
  );
}
