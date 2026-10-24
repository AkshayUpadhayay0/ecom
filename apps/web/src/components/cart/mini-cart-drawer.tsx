'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { secondaryButtonClass } from '@/components/ui/form';
import { useCart } from '@/lib/cart/hooks';
import { setCartDrawerOpen } from '@/lib/cart/drawer';
import { useI18n } from '@/lib/i18n/provider';
import { CartView } from './cart-view';

/** Right-hand drawer (native <dialog>: focus trap, Esc, focus return). Loaded on first open. */
export default function MiniCartDrawer({ open }: { open: boolean }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const cart = useCart();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const close = (): void => {
    setCartDrawerOpen(false);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="mini-cart-title"
      onClose={close}
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-md bg-ivory p-0 text-ink backdrop:bg-ink/60"
    >
      <div className="flex h-full flex-col overflow-y-auto p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="mini-cart-title" className="text-2xl font-semibold">
            {t('cart.title')}
          </h2>
          <button type="button" onClick={close} className={`${secondaryButtonClass} px-3`}>
            {t('cart.drawer.close')}
          </button>
        </div>
        {cart.isPending ? <p>{t('cart.loading')}</p> : null}
        {cart.isError ? (
          <p role="alert" className="text-red-text">
            {t('cart.load_failed')}
          </p>
        ) : null}
        {cart.data ? <CartView cart={cart.data} onNavigate={close} /> : null}
        <p className="mt-6">
          <Link href="/cart" onClick={close} className="underline underline-offset-4">
            {t('cart.view')}
          </Link>
        </p>
      </div>
    </dialog>
  );
}
