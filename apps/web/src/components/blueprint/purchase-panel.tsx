'use client';

import type { DecisionDto, PublicSizeOptionDto } from '@urban-ibile/shared';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { primaryButtonClass, secondaryButtonClass, StatusMessage } from '@/components/ui/form';
import { loginHref } from '@/lib/auth/safe-redirect';
import { useAddToCart } from '@/lib/cart/hooks';
import { setCartDrawerOpen } from '@/lib/cart/drawer';
import { clampQuantity } from '@/lib/cart/model';
import { describeError } from '@/lib/client/error-messages';
import { useHasSession } from '@/lib/client/session';
import { useI18n } from '@/lib/i18n/provider';
import type { SupportContacts } from './find-my-size-dialog';

// Blueprint code is only downloaded when a shopper asks for it (not on catalog pages).
const FindMySizeDialog = dynamic(() => import('./find-my-size-dialog'), { ssr: false });

type Selection =
  | { kind: 'none' }
  | { kind: 'direct'; size: PublicSizeOptionDto }
  | { kind: 'decision'; decision: DecisionDto };

interface Props {
  productId: string;
  slug: string;
  sizes: PublicSizeOptionDto[];
  blueprintRequired: boolean;
  maxQuantity: number;
  support: SupportContacts;
}

const INTENT_PARAMS = ['intent', 'size'] as const;

/**
 * Size choice + Find My Size + Add to cart for one product.
 *  - No measurement profile: the shopper picks a size directly.
 *  - With a profile: a size only comes from a Find My Size decision (the API requires one).
 * Add to cart stays disabled until a size is confirmed. Signed-out shoppers are sent to login and
 * brought back to this product with the same action (?intent=fit | ?intent=add&size=CODE).
 */
export function PurchasePanel({
  productId,
  slug,
  sizes,
  blueprintRequired,
  maxQuantity,
  support,
}: Props) {
  const { t } = useI18n();
  const hasSession = useHasSession();
  const addToCart = useAddToCart();
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [quantity, setQuantity] = useState(1);
  const [dialogRequested, setDialogRequested] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const intentHandled = useRef(false);
  const fitButton = useRef<HTMLButtonElement>(null);

  const productPath = `/products/${slug}`;

  const openDialog = useCallback(() => {
    setDialogRequested(true);
    setDialogOpen(true);
  }, []);
  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    fitButton.current?.focus();
  }, []);
  const onDecided = useCallback((decision: DecisionDto) => {
    setSelection({ kind: 'decision', decision });
    setAdded(false);
  }, []);

  // Come back from login with the same action: ?intent=fit opens the dialog, ?intent=add&size=CODE
  // pre-selects the size. The parameters are removed from the address afterwards.
  useEffect(() => {
    if (!hasSession || intentHandled.current) return;
    const url = new URL(window.location.href);
    const intent = url.searchParams.get('intent');
    if (!intent) return;
    intentHandled.current = true;
    // Restoring the shopper's earlier action from the address after login.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (intent === 'fit' && blueprintRequired) openDialog();
    if (intent === 'add' && !blueprintRequired) {
      const size = sizes.find((candidate) => candidate.sizeCode === url.searchParams.get('size'));
      if (size && size.availability !== 'out_of_stock') setSelection({ kind: 'direct', size });
    }
    for (const key of INTENT_PARAMS) url.searchParams.delete(key);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [hasSession, blueprintRequired, sizes, openDialog]);

  const selectedSize: { id: string; code: string } | null =
    selection.kind === 'direct'
      ? { id: selection.size.id, code: selection.size.sizeCode }
      : selection.kind === 'decision'
        ? { id: selection.decision.selectedSize.id, code: selection.decision.selectedSize.code }
        : null;
  const selectedAvailability = selectedSize
    ? (sizes.find((size) => size.sizeCode === selectedSize.code)?.availability ?? 'in_stock')
    : null;
  const outOfStock = selectedAvailability === 'out_of_stock';
  const canAdd = selectedSize !== null && !outOfStock && !addToCart.isPending;

  function add(): void {
    if (!selectedSize) return;
    setAdded(false);
    addToCart.mutate(
      {
        productId,
        quantity,
        ...(selection.kind === 'decision'
          ? { blueprintDecisionId: selection.decision.id }
          : { sizeId: selectedSize.id }),
      },
      {
        onSuccess: () => {
          setAdded(true);
          setCartDrawerOpen(true);
        },
      },
    );
  }

  const error = addToCart.error ? describeError(addToCart.error) : null;
  const signedOutAddHref = loginHref(
    `${productPath}?intent=add${selection.kind === 'direct' ? `&size=${encodeURIComponent(selection.size.sizeCode)}` : ''}`,
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="sizes">
        <h2 id="sizes" className="text-lg font-semibold">
          {t('product.sizes')}
        </h2>

        {blueprintRequired ? (
          <>
            <ul className="mt-3 flex flex-wrap gap-2">
              {sizes.map((size) => (
                <li
                  key={size.id}
                  className={`border px-3 py-2 text-sm ${size.availability === 'out_of_stock' ? 'border-line text-ink-muted' : 'border-ink'}`}
                >
                  <span className="font-semibold">{size.sizeCode}</span>
                  <span className="sr-only"> ({size.label}): </span>
                  <span className="ml-2 text-ink-muted">{t(`size.${size.availability}`)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3">{t('fms.profile.note')}</p>
          </>
        ) : (
          <fieldset className="mt-3">
            <legend className="sr-only">{t('product.sizes')}</legend>
            <p className="mb-2 text-sm text-ink-muted">{t('fms.direct.note')}</p>
            <div className="flex flex-wrap gap-2">
              {sizes.map((size) => {
                const disabled = size.availability === 'out_of_stock';
                const checked = selection.kind === 'direct' && selection.size.id === size.id;
                return (
                  <label
                    key={size.id}
                    className={`flex min-h-11 items-center gap-2 border px-3 ${
                      disabled ? 'border-line text-ink-muted' : 'cursor-pointer border-ink'
                    } ${checked ? 'border-2 border-emerald bg-white' : ''}`}
                  >
                    <input
                      type="radio"
                      name="size"
                      value={size.id}
                      disabled={disabled}
                      checked={checked}
                      onChange={() => {
                        setSelection({ kind: 'direct', size });
                        setAdded(false);
                      }}
                      className="h-5 w-5 accent-emerald"
                    />
                    <span className="font-semibold">{size.sizeCode}</span>
                    <span className="sr-only"> ({size.label}): </span>
                    <span className="text-sm text-ink-muted">{t(`size.${size.availability}`)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
      </section>

      {selection.kind === 'decision' ? (
        <section aria-labelledby="your-size" className="border-l-4 border-emerald bg-white p-4">
          <h3 id="your-size" className="text-sm font-semibold text-ink-muted">
            {t('fms.selected.heading')}
          </h3>
          <p data-testid="selected-size" className="text-lg font-semibold">
            {selection.decision.selectionMode === 'LOCKED_RECOMMENDATION'
              ? t('fms.selected.recommended', { size: selection.decision.selectedSize.code })
              : t('fms.selected.override', { size: selection.decision.selectedSize.code })}
          </p>
        </section>
      ) : null}

      {blueprintRequired ? (
        hasSession ? (
          <button
            ref={fitButton}
            type="button"
            className={secondaryButtonClass}
            onClick={openDialog}
          >
            {selection.kind === 'decision' ? t('fms.reopen') : t('fms.open')}
          </button>
        ) : (
          <div className="space-y-2">
            <p>{t('fms.signin_prompt')}</p>
            <Link href={loginHref(`${productPath}?intent=fit`)} className={secondaryButtonClass}>
              {t('fms.signin_cta')}
            </Link>
          </div>
        )
      ) : null}

      {hasSession ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label htmlFor="qty" className="text-sm font-medium">
              {t('cart.qty')}
            </label>
            <input
              id="qty"
              name="quantity"
              type="number"
              min={1}
              max={maxQuantity}
              inputMode="numeric"
              value={quantity}
              onChange={(event) => {
                const next = Number(event.target.value);
                setQuantity(Number.isFinite(next) ? clampQuantity(next, maxQuantity) : 1);
              }}
              className="w-20 border border-ink bg-white px-3 py-2"
            />
          </div>
          <button type="button" className={primaryButtonClass} disabled={!canAdd} onClick={add}>
            {addToCart.isPending ? t('cart.adding') : t('cart.add')}
          </button>
          {selection.kind === 'none' ? (
            <p className="text-sm text-ink-muted">{t('fms.choose_size_first')}</p>
          ) : null}
          {outOfStock ? <p className="text-sm text-red-text">{t('size.out_of_stock')}</p> : null}
        </div>
      ) : !blueprintRequired ? (
        <Link href={signedOutAddHref} className={primaryButtonClass}>
          {t('cart.add')}
        </Link>
      ) : null}

      {error ? (
        <p role="alert" className="font-medium text-red-text">
          {t(error.key, error.params)}
        </p>
      ) : null}
      {added ? (
        <StatusMessage>
          {t('cart.added')}{' '}
          <Link href="/cart" className="underline underline-offset-4">
            {t('cart.view')}
          </Link>
        </StatusMessage>
      ) : null}

      {dialogRequested ? (
        <FindMySizeDialog
          productId={productId}
          open={dialogOpen}
          support={support}
          onClose={closeDialog}
          onDecided={onDecided}
        />
      ) : null}
    </div>
  );
}
