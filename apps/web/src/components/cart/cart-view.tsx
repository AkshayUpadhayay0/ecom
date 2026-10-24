'use client';

import type { CartDto, CartLineDto, DecisionDto } from '@urban-ibile/shared';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import type { SupportContacts } from '@/components/blueprint/find-my-size-dialog';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form';
import { useRemoveLine, useReplaceDecision, useSetQuantity } from '@/lib/cart/hooks';
import { blockingWarnings, clampQuantity } from '@/lib/cart/model';
import { describeError } from '@/lib/client/error-messages';
import { formatPrice } from '@/lib/format/price';
import { useI18n } from '@/lib/i18n/provider';

const FindMySizeDialog = dynamic(() => import('@/components/blueprint/find-my-size-dialog'), {
  ssr: false,
});

const NO_SUPPORT: SupportContacts = { email: null, phone: null, whatsapp: null };

function LineItem({
  line,
  currency,
  maxQuantity,
  onQuantity,
  onRemove,
  onRefit,
}: {
  line: CartLineDto;
  currency: string;
  maxQuantity: number;
  onQuantity: (line: CartLineDto, quantity: number) => void;
  onRemove: (line: CartLineDto) => void;
  onRefit: (line: CartLineDto) => void;
}) {
  const { t } = useI18n();
  const name = line.product.name;
  const blocked = blockingWarnings(line);
  return (
    <li
      data-testid="cart-line"
      className={`space-y-2 border p-4 ${blocked.length > 0 ? 'border-2 border-red-text' : 'border-line'} bg-white`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/products/${line.product.slug}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {name}
        </Link>
        <p className="price font-semibold">{formatPrice(line.lineTotalMinor, currency)}</p>
      </div>
      <p>
        <span className="font-semibold" data-testid="line-size">
          {t('cart.line.size', { size: line.size.code })}
        </span>
        {line.decision ? (
          <span className="ml-2 text-sm text-ink-muted">
            {line.decision.selectionMode === 'LOCKED_RECOMMENDATION'
              ? t('cart.line.fit_recommended')
              : t('cart.line.fit_override', { size: line.decision.recommendedSizeCode })}
          </span>
        ) : null}
      </p>
      <p className="text-sm text-ink-muted">
        {t('cart.line.unit', { price: formatPrice(line.unitPriceMinor, currency) })}
      </p>

      {line.warnings.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {line.warnings.map((warning) => (
            <li
              key={warning}
              className={
                warning === 'PRICE_CHANGED'
                  ? 'border-l-4 border-marigold pl-2'
                  : 'font-medium text-red-text'
              }
            >
              {t(
                `cart.warn.${warning}`,
                warning === 'PRICE_CHANGED'
                  ? { was: formatPrice(line.addedUnitPriceMinor ?? line.unitPriceMinor, currency) }
                  : undefined,
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t('cart.line.quantity', { name })}
          className="flex items-center"
        >
          <button
            type="button"
            aria-label={t('cart.line.decrease', { name })}
            disabled={line.quantity <= 1}
            onClick={() => {
              onQuantity(line, clampQuantity(line.quantity - 1, maxQuantity));
            }}
            className="grid h-11 w-11 place-items-center border border-ink disabled:opacity-40"
          >
            <span aria-hidden="true">−</span>
          </button>
          <span
            aria-live="polite"
            data-testid="line-qty"
            className="grid h-11 min-w-12 place-items-center border-y border-ink px-2"
          >
            {line.quantity}
          </span>
          <button
            type="button"
            aria-label={t('cart.line.increase', { name })}
            onClick={() => {
              onQuantity(line, line.quantity + 1);
            }}
            className="grid h-11 w-11 place-items-center border border-ink"
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
        {line.decision ? (
          <button
            type="button"
            className={`${secondaryButtonClass} text-sm`}
            onClick={() => {
              onRefit(line);
            }}
          >
            {t('cart.line.refit')}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={t('cart.line.remove', { name })}
          className="min-h-11 px-2 text-sm underline underline-offset-4"
          onClick={() => {
            onRemove(line);
          }}
        >
          {t('form.delete')}
        </button>
      </div>
    </li>
  );
}

/** Lines, subtotal and the (disabled) checkout button: shared by the drawer and the cart page. */
export function CartView({ cart, onNavigate }: { cart: CartDto; onNavigate?: () => void }) {
  const { t } = useI18n();
  const setQuantity = useSetQuantity();
  const removeLine = useRemoveLine();
  const replaceDecision = useReplaceDecision();
  const [refit, setRefit] = useState<CartLineDto | null>(null);
  const [refitOpen, setRefitOpen] = useState(false);

  const failure = setQuantity.error ?? removeLine.error ?? replaceDecision.error;
  const described = failure ? describeError(failure) : null;

  if (cart.lines.length === 0) {
    return (
      <div className="space-y-4">
        <p>{t('cart.empty')}</p>
        <Link
          href="/shop"
          {...(onNavigate ? { onClick: onNavigate } : {})}
          className={primaryButtonClass}
        >
          {t('cart.continue')}
        </Link>
      </div>
    );
  }

  const hasBlocker = cart.lines.some((line) => blockingWarnings(line).length > 0);
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">{t('cart.review')}</p>
      {described ? (
        <p role="alert" className="font-medium text-red-text">
          {t(described.key, described.params)}
        </p>
      ) : null}
      <ul className="space-y-3">
        {cart.lines.map((line) => (
          <LineItem
            key={line.id}
            line={line}
            currency={cart.currency}
            maxQuantity={cart.maxQuantityPerLine}
            onQuantity={(target, quantity) => {
              setQuantity.reset();
              setQuantity.mutate({ lineId: target.id, quantity });
            }}
            onRemove={(target) => {
              removeLine.reset();
              removeLine.mutate({ lineId: target.id });
            }}
            onRefit={(target) => {
              setRefit(target);
              setRefitOpen(true);
            }}
          />
        ))}
      </ul>
      <div className="space-y-3 border-t border-line pt-4">
        <p className="flex justify-between text-lg font-semibold">
          <span>{t('cart.subtotal')}</span>
          <span className="price" data-testid="cart-subtotal">
            {formatPrice(cart.subtotalMinor, cart.currency)}
          </span>
        </p>
        <p className="text-sm text-ink-muted">{t('cart.delivery_note')}</p>
        {/* W3 EXTENSION POINT: replace this disabled button by the link to checkout (only when cart.canCheckout). */}
        <button type="button" disabled className={`${primaryButtonClass} w-full`}>
          {t('cart.checkout_next')}
        </button>
        {hasBlocker ? (
          <p className="text-sm font-medium text-red-text">{t('cart.blocked')}</p>
        ) : null}
      </div>

      {refit ? (
        <FindMySizeDialog
          productId={refit.product.id}
          open={refitOpen}
          support={NO_SUPPORT}
          onClose={() => {
            setRefitOpen(false);
          }}
          onDecided={(decision: DecisionDto) => {
            replaceDecision.reset();
            replaceDecision.mutate({ lineId: refit.id, blueprintDecisionId: decision.id });
          }}
        />
      ) : null}
    </div>
  );
}
