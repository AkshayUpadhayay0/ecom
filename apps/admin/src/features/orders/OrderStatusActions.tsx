import { useQueryClient } from '@tanstack/react-query';
import type { AdminOrderDetailDto } from '@urban-ibile/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InfoBanner } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { ordersApi } from '@/lib/api/orders-api';
import { notify } from '@/lib/notify';
import { orderStatusDisplay } from '@/lib/status';
import { orderKeys } from './orders.queries';

type Transition = AdminOrderDetailDto['allowedTransitions'][number];

const SENT_OUT = 'sent_out';
const CANCELLED = 'cancelled';
const PAID = 'paid';

export const CONFLICT_MESSAGE =
  'Someone else changed this order while you were looking at it. Reload the order to see the latest status, then try again.';

const ACTION_LABEL: Partial<Record<string, string>> = {
  being_prepared: 'Mark being prepared',
  sent_out: 'Mark sent out',
  delivered: 'Mark delivered',
  cancelled: 'Cancel order',
};

export function actionLabel(toStatus: string): string {
  return ACTION_LABEL[toStatus] ?? `Move to “${orderStatusDisplay(toStatus).label}”`;
}

function StatusChangeDialog({
  order,
  transition,
  onClose,
}: {
  order: AdminOrderDetailDto;
  transition: Transition;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [conflict, setConflict] = useState(false);
  const cancelling = transition.toStatus === CANCELLED;
  const sendingOut = transition.toStatus === SENT_OUT;
  const target = orderStatusDisplay(transition.toStatus).label;

  async function refresh() {
    await client.invalidateQueries({ queryKey: orderKeys.all });
    await client.invalidateQueries({ queryKey: ['dashboard'] });
  }

  async function submit(reason: string) {
    try {
      await ordersApi.updateStatus(order.id, {
        toStatus: transition.toStatus,
        expectedStatus: order.orderStatus,
        ...(reason !== '' && { reason }),
        ...(sendingOut && carrier.trim() !== '' && { carrier: carrier.trim() }),
        ...(sendingOut && tracking.trim() !== '' && { trackingReference: tracking.trim() }),
        ...(inFlight && { confirmInFlight: true }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ORDER_STATUS_CONFLICT') {
        setConflict(true);
        throw new ApiError(err.code, err.status, CONFLICT_MESSAGE, err.details, err.requestId);
      }
      if (err instanceof ApiError && err.code === 'PAYMENT_IN_PROGRESS') {
        setInFlight(true);
        throw new ApiError(
          err.code,
          err.status,
          'The customer started paying for this order a few minutes ago and the payment is not settled yet. If you cancel now and the payment succeeds, the order will need a manual refund. Press “Cancel anyway” to continue.',
          err.details,
          err.requestId,
        );
      }
      throw err;
    }
    notify.success(`Order ${order.orderNumber}: ${target}.`);
    await refresh();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${actionLabel(transition.toStatus)}?`}
      description={
        cancelling
          ? `Order ${order.orderNumber} will be cancelled and any held stock released. This cannot be undone.`
          : `Order ${order.orderNumber} moves from “${orderStatusDisplay(order.orderStatus).label}” to “${target}”. The customer is emailed where a status email exists.`
      }
      confirmLabel={inFlight ? 'Cancel anyway' : actionLabel(transition.toStatus)}
      destructive={cancelling}
      confirmDisabled={conflict}
      {...(transition.requiresReason && {
        note: {
          label: 'Reason',
          required: true,
          placeholder: 'Why is this order being cancelled?',
        },
      })}
      onConfirm={submit}
    >
      {sendingOut ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Carrier" hint="Optional">
            <Input value={carrier} maxLength={100} onChange={(e) => setCarrier(e.target.value)} />
          </Field>
          <Field label="Tracking reference" hint="Optional">
            <Input value={tracking} maxLength={200} onChange={(e) => setTracking(e.target.value)} />
          </Field>
        </div>
      ) : null}
      {conflict ? (
        <Button
          variant="outline"
          onClick={() => {
            void refresh();
            onClose();
          }}
        >
          Reload order
        </Button>
      ) : null}
    </ConfirmDialog>
  );
}

/** Buttons for the status changes the API allows right now (nothing else is offered). */
export function OrderStatusActions({ order }: { order: AdminOrderDetailDto }) {
  const [active, setActive] = useState<Transition | null>(null);
  const transitions = order.allowedTransitions;
  return (
    <div className="space-y-3">
      {transitions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No status change is possible from “{orderStatusDisplay(order.orderStatus).label}”.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {transitions.map((t) => {
            const blocked = t.requiresPaid && order.paymentStatus !== PAID;
            return (
              <Button
                key={t.toStatus}
                variant={t.toStatus === CANCELLED ? 'outline' : 'default'}
                disabled={blocked}
                title={blocked ? 'Only possible once the order is paid.' : undefined}
                onClick={() => setActive(t)}
              >
                {actionLabel(t.toStatus)}
              </Button>
            );
          })}
        </div>
      )}
      {order.needsAttention ? (
        <InfoBanner tone="warning">
          Money was received but the order needs attention. Resolve it in{' '}
          <Link to="/payment-reviews" className="font-medium underline underline-offset-4">
            Payment review
          </Link>
          .
        </InfoBanner>
      ) : null}
      {active ? (
        <StatusChangeDialog
          key={active.toStatus}
          order={order}
          transition={active}
          onClose={() => setActive(null)}
        />
      ) : null}
    </div>
  );
}
