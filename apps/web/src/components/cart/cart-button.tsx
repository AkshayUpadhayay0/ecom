'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { BagIcon } from '@/components/header/icons';
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
        className="relative grid size-11 place-items-center"
      >
        <BagIcon />
        <span
          data-testid="cart-count"
          className="absolute top-1 right-0 min-w-5 bg-ink px-1 text-center text-xs font-bold text-ivory ring-1 ring-ivory"
        >
          {count}
        </span>
      </button>
      {everOpened || open ? <MiniCartDrawer open={open} /> : null}
    </>
  );
}
