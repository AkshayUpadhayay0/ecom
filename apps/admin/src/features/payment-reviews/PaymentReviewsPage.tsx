import { useQuery } from '@tanstack/react-query';
import type { PaymentReviewAction, PaymentReviewDto } from '@urban-ibile/shared';
import { CreditCard } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FilterBar, FilterSelect } from '@/components/FilterBar';
import { InfoBanner, PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { SuperAdminOnly } from '@/components/SuperAdminOnly';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { paymentReviewsApi } from '@/lib/api/payment-reviews-api';
import { formatDateTime, formatNaira } from '@/lib/format';
import { koboToNairaInput, nairaToKobo } from '@/lib/money';
import { humanise, orderStatusDisplay, paymentStatusDisplay } from '@/lib/status';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { useUrlFilters } from '@/lib/use-url-filters';

const FILTERS = ['state'] as const;
const PAYMENT_REVIEW = 'payment_review';

export const REFUND_STATEMENT =
  'Refunds are done manually in the Paystack dashboard. Nothing is refunded automatically by this system — these actions only record what happened.';

const REASON_TEXT: Partial<Record<string, string>> = {
  AMOUNT_MISMATCH: 'The amount received is different from the order total.',
  CURRENCY_MISMATCH: 'The payment was made in a different currency.',
  ORDER_MISMATCH: 'The payment details do not match this order.',
  DUPLICATE_SUCCESS: 'A second successful payment arrived for an order that was already paid.',
  LATE_NO_STOCK:
    'The payment arrived after the stock hold expired, and the stock is no longer available.',
};

const ACTION_TEXT: Record<PaymentReviewAction, { label: string; description: string }> = {
  FULFIL: {
    label: 'Fulfil order',
    description:
      'Accept the payment and send the order to “Being prepared”. Stock is taken now; if it is gone, nothing changes.',
  },
  MARK_REFUND_REQUIRED: {
    label: 'Mark refund required',
    description:
      'Record that a manual refund is owed. The order stays out of fulfilment. Nothing is refunded by this action.',
  },
  MARK_REFUNDED: {
    label: 'Mark refunded',
    description:
      'Record a refund you have already made in the Paystack dashboard. For an unfulfilled order, the order is cancelled and held stock released.',
  },
};

export const reviewKeys = {
  all: ['payment-reviews'] as const,
  list: (state: string, page: number) => [...reviewKeys.all, state, page] as const,
};

function ResolveDialog({
  review,
  action,
  onClose,
}: {
  review: PaymentReviewDto;
  action: PaymentReviewAction;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(() =>
    koboToNairaInput(review.refundOwedMinor ?? review.receivedAmountMinor),
  );
  const [reference, setReference] = useState('');
  const amountMinor = nairaToKobo(amount);
  const amountInvalid =
    action === 'MARK_REFUND_REQUIRED' &&
    (amountMinor === null || amountMinor < 1 || amountMinor > review.receivedAmountMinor);
  const resolve = useAdminMutation(
    (note: string) =>
      paymentReviewsApi.resolve(
        review.paymentId,
        action === 'FULFIL'
          ? { action, note }
          : action === 'MARK_REFUND_REQUIRED'
            ? { action, note, amountMinor: amountMinor ?? 0 }
            : { action, note, refundReference: reference.trim() },
      ),
    {
      success: `${ACTION_TEXT[action].label}: recorded for ${review.order.orderNumber}.`,
      invalidate: [reviewKeys.all, ['orders'], ['dashboard']],
    },
  );
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${ACTION_TEXT[action].label} — ${review.order.orderNumber}`}
      description={ACTION_TEXT[action].description}
      confirmLabel={ACTION_TEXT[action].label}
      destructive={action === 'MARK_REFUNDED'}
      note={{ label: 'Note', required: true, placeholder: 'What was decided and why' }}
      confirmDisabled={amountInvalid || (action === 'MARK_REFUNDED' && reference.trim() === '')}
      onConfirm={(note) => resolve.mutateAsync(note)}
    >
      {action !== 'FULFIL' ? <InfoBanner tone="warning">{REFUND_STATEMENT}</InfoBanner> : null}
      {action === 'MARK_REFUND_REQUIRED' ? (
        <Field
          label="Refund owed (₦)"
          required
          hint={`At most the amount received: ${formatNaira(review.receivedAmountMinor)}`}
          error={amountInvalid ? 'Enter an amount up to the amount received.' : undefined}
        >
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      ) : null}
      {action === 'MARK_REFUNDED' ? (
        <Field label="Paystack refund reference" required hint="From the Paystack dashboard.">
          <Input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
        </Field>
      ) : null}
    </ConfirmDialog>
  );
}

function availableActions(review: PaymentReviewDto): PaymentReviewAction[] {
  if (!review.open) return [];
  const done = new Set(review.resolutions.map((r) => r.action));
  const actions: PaymentReviewAction[] = [];
  if (review.order.orderStatus === PAYMENT_REVIEW && review.resolutions.length === 0)
    actions.push('FULFIL');
  if (!done.has('MARK_REFUND_REQUIRED')) actions.push('MARK_REFUND_REQUIRED');
  if (!done.has('MARK_REFUNDED')) actions.push('MARK_REFUNDED');
  return actions;
}

function ReviewCard({
  review,
  onAction,
}: {
  review: PaymentReviewDto;
  onAction: (action: PaymentReviewAction) => void;
}) {
  const differs =
    review.receivedAmountMinor !== review.order.totalMinor ||
    review.receivedCurrency !== review.order.currency;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>
            <Link to={`/orders/${review.order.id}`} className="underline-offset-4 hover:underline">
              {review.order.orderNumber}
            </Link>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {review.customer.fullName} · {review.customer.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {review.open ? <Badge tone="danger">Open</Badge> : <Badge>Resolved</Badge>}
          <StatusBadge display={orderStatusDisplay(review.order.orderStatus)} />
          <StatusBadge display={paymentStatusDisplay(review.paymentStatus)} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="font-medium">{humanise(review.reason)}:</span>{' '}
          {REASON_TEXT[review.reason] ?? 'Needs a manual check.'}
        </p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Order total</dt>
            <dd className="tabular-nums">
              {formatNaira(review.order.totalMinor)} {review.order.currency}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Received</dt>
            <dd className={differs ? 'font-medium text-destructive tabular-nums' : 'tabular-nums'}>
              {formatNaira(review.receivedAmountMinor)} {review.receivedCurrency}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Refund owed</dt>
            <dd className="tabular-nums">
              {review.refundOwedMinor !== null ? formatNaira(review.refundOwedMinor) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Reference</dt>
            <dd className="font-mono text-xs break-all">{review.reference}</dd>
          </div>
        </dl>
        {review.resolutions.length > 0 ? (
          <ul className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
            {review.resolutions.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{ACTION_TEXT[r.action].label}</span>
                {r.amountMinor !== null ? ` ${formatNaira(r.amountMinor)}` : ''}
                {r.refundReference ? ` (ref ${r.refundReference})` : ''} · {r.admin.name} ·{' '}
                {formatDateTime(new Date(r.createdAt))} — {r.note}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {availableActions(review).map((action) => (
            <SuperAdminOnly key={action}>
              <Button
                size="sm"
                variant={action === 'FULFIL' ? 'default' : 'outline'}
                onClick={() => onAction(action)}
              >
                {ACTION_TEXT[action].label}
              </Button>
            </SuperAdminOnly>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Flagged {formatDateTime(new Date(review.createdAt))}
        </p>
      </CardContent>
    </Card>
  );
}

export function PaymentReviewsPage() {
  const { values, page, setFilter, setPage, clear, active } = useUrlFilters(FILTERS);
  const state = values.state === 'all' ? 'all' : 'open';
  const reviews = useQuery({
    queryKey: reviewKeys.list(state, page),
    queryFn: () => paymentReviewsApi.list({ state, page }),
  });
  const [acting, setActing] = useState<{
    review: PaymentReviewDto;
    action: PaymentReviewAction;
  } | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment review"
        description="Payments where money was received but something did not match (amount, currency, duplicate, or stock gone). Each needs a decision with a note. Only super admins can decide."
      />
      <InfoBanner tone="warning">
        {REFUND_STATEMENT} The refund policy is a pending client decision.
      </InfoBanner>
      <FilterBar active={active} onClear={clear}>
        <FilterSelect
          label="Show"
          value={values.state === 'all' ? 'all' : ''}
          onChange={(v) => setFilter('state', v)}
          allLabel="Open only"
          options={[{ value: 'all', label: 'All (including resolved)' }]}
        />
      </FilterBar>
      <QueryView
        query={reviews}
        what="payment reviews"
        isEmpty={(data) => data.data.length === 0}
        empty={{
          icon: CreditCard,
          title: state === 'open' ? 'Nothing to review' : 'No payment reviews yet',
          description:
            state === 'open'
              ? 'Every received payment matched its order.'
              : 'Mismatched payments will appear here.',
        }}
      >
        {(data) => (
          <div className="space-y-4">
            {data.data.map((review) => (
              <ReviewCard
                key={review.paymentId}
                review={review}
                onAction={(action) => setActing({ review, action })}
              />
            ))}
          </div>
        )}
      </QueryView>
      {reviews.data ? <Pagination meta={reviews.data.meta} onPage={setPage} /> : null}
      {acting ? (
        <ResolveDialog
          key={`${acting.review.paymentId}-${acting.action}`}
          review={acting.review}
          action={acting.action}
          onClose={() => setActing(null)}
        />
      ) : null}
    </div>
  );
}
