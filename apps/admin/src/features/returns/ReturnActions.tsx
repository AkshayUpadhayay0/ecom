import { useQueryClient } from '@tanstack/react-query';
import {
  INSPECTION_OUTCOMES,
  RETURN_CAUSES_BY_RESPONSIBILITY,
  RETURN_DEFAULT_PAYER,
  RETURN_PAYERS,
  RETURN_RESPONSIBILITIES,
  type AdminReturnDetailDto,
  type InspectionOutcome,
  type ReturnPayer,
  type ReturnResponsibility,
} from '@urban-ibile/shared';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ApiError } from '@/lib/api/client';
import { returnsApi } from '@/lib/api/returns-api';
import { notify } from '@/lib/notify';
import {
  faultCauseDisplay,
  payerDisplay,
  responsibilityDisplay,
  returnStatusDisplay,
} from '@/lib/status';
import { returnKeys } from './ReturnsListPage';

type Detail = AdminReturnDetailDto;
type Transition = Detail['allowedTransitions'][number];

const EXCHANGE_SENT = 'EXCHANGE_SENT';
const RETURN_RECEIVED = 'RETURN_RECEIVED';
const LOCKED = 'LOCKED_RECOMMENDATION';
const BLUEPRINT_FAILURE = 'BLUEPRINT_FAILURE';

export const RETURN_CONFLICT_MESSAGE =
  'Someone else changed this request while you were looking at it. Reload it to see the latest status, then try again.';

/** Targets handled elsewhere (approve already moves on to AWAITING_RETURN; customers cancel). */
const NOT_OFFERED = new Set(['AWAITING_RETURN', 'CANCELLED']);

const ACTION_LABEL: Partial<Record<string, string>> = {
  APPROVED: 'Approve',
  REJECTED: 'Reject',
  AWAITING_CUSTOMER: 'Request more information',
  UNDER_REVIEW: 'Start review',
  RETURN_IN_TRANSIT: 'Mark return in transit',
  RETURN_RECEIVED: 'Mark item received',
  EXCHANGE_PROCESSING: 'Start exchange',
  EXCHANGE_SENT: 'Mark replacement sent',
  REFUND_PROCESSING: 'Move to refund processing',
  COMPLETED: 'Complete',
};

export function returnActionLabel(toStatus: string): string {
  return ACTION_LABEL[toStatus] ?? `Move to “${returnStatusDisplay(toStatus).label}”`;
}

/** Who pays, as a sentence for confirmations. */
export function payerSentence(payer: string): string {
  if (payer === 'CUSTOMER') return 'The customer will pay for the return delivery.';
  if (payer === 'BRAND') return 'Urban Ibile (the brand) will pay for the return delivery.';
  return 'Who pays for the return delivery is not decided yet.';
}

function useRefreshReturns() {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: returnKeys.all });
    await client.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

/** Re-throws API errors with a friendlier conflict message; flags conflicts for the reload button. */
function friendly(err: unknown, onConflict: () => void): never {
  if (err instanceof ApiError && err.code === 'RETURN_STATUS_CONFLICT') {
    onConflict();
    throw new ApiError(err.code, err.status, RETURN_CONFLICT_MESSAGE, err.details, err.requestId);
  }
  throw err;
}

function noteFor(toStatus: string, requiresReason: boolean) {
  if (toStatus === 'REJECTED')
    return { label: 'Reason (sent to the customer)', required: true } as const;
  if (toStatus === 'AWAITING_CUSTOMER')
    return { label: 'What do you need from the customer?', required: true } as const;
  return { label: 'Note', required: requiresReason } as const;
}

function TransitionDialog({
  detail,
  transition,
  onClose,
}: {
  detail: Detail;
  transition: Transition;
  onClose: () => void;
}) {
  const refresh = useRefreshReturns();
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [conflict, setConflict] = useState(false);
  const to = transition.toStatus;
  const expectedStatus = detail.status;
  const label = returnActionLabel(to);

  async function submit(text: string) {
    const note = text === '' ? {} : { note: text };
    try {
      if (to === 'APPROVED') await returnsApi.approve(detail.id, { expectedStatus, ...note });
      else if (to === 'REJECTED')
        await returnsApi.reject(detail.id, { expectedStatus, reason: text });
      else if (to === 'AWAITING_CUSTOMER')
        await returnsApi.requestInfo(detail.id, { expectedStatus, message: text });
      else if (to === RETURN_RECEIVED)
        await returnsApi.markReceived(detail.id, { expectedStatus, ...note });
      else
        await returnsApi.advance(detail.id, {
          expectedStatus,
          toStatus: to,
          ...note,
          ...(to === EXCHANGE_SENT && carrier.trim() !== '' && { carrier: carrier.trim() }),
          ...(to === EXCHANGE_SENT &&
            tracking.trim() !== '' && { trackingReference: tracking.trim() }),
        });
    } catch (err) {
      friendly(err, () => setConflict(true));
    }
    notify.success(`${detail.requestNumber}: ${label} done.`);
    await refresh();
  }

  const exchange = detail.exchange;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${label}?`}
      description={`${detail.requestNumber} moves from “${returnStatusDisplay(detail.status).label}” to “${returnStatusDisplay(to).label}”.`}
      confirmLabel={label}
      destructive={to === 'REJECTED'}
      confirmDisabled={conflict}
      note={noteFor(to, transition.requiresReason)}
      onConfirm={submit}
    >
      {to === 'APPROVED' ? (
        <div className="space-y-1 rounded-md border p-3 text-sm">
          <p>{payerSentence(detail.payer)}</p>
          {detail.requestType === 'EXCHANGE' && exchange ? (
            <p>
              The replacement (size {exchange.sizeLabel ?? '—'}
              {exchange.replacementSku ? `, ${exchange.replacementSku}` : ''}) is reserved now. If
              it is out of stock, the request is not approved.
            </p>
          ) : null}
          <p className="text-muted-foreground">The customer is emailed the return instructions.</p>
        </div>
      ) : null}
      {to === EXCHANGE_SENT ? (
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
          Reload request
        </Button>
      ) : null}
    </ConfirmDialog>
  );
}

function InspectDialog({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const refresh = useRefreshReturns();
  const [outcome, setOutcome] = useState<InspectionOutcome>('RESELLABLE');
  const [quantity, setQuantity] = useState(String(detail.quantity));
  const restock = Number(quantity);
  const quantityInvalid =
    outcome === 'RESELLABLE' &&
    (!Number.isInteger(restock) || restock < 1 || restock > detail.quantity);

  async function submit(notes: string) {
    const result = await returnsApi.inspect(detail.id, {
      outcome,
      ...(notes !== '' && { notes }),
      ...(outcome === 'RESELLABLE' && { restockQuantity: restock }),
    });
    const restocked = result.inspection?.restockedQuantity ?? 0;
    notify.success(
      restocked > 0
        ? `Inspection recorded: ${restocked} item(s) back in stock.`
        : 'Inspection recorded: not resellable, stock unchanged.',
    );
    await refresh();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Record inspection"
      description="A returned item is not sellable until inspected. Only resellable items go back into stock. This is recorded once."
      confirmLabel="Record inspection"
      confirmDisabled={quantityInvalid}
      note={{ label: 'Inspection notes', required: false }}
      onConfirm={submit}
    >
      <Field label="Outcome" required>
        <NativeSelect
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as InspectionOutcome)}
        >
          {INSPECTION_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {o === 'RESELLABLE' ? 'Resellable (restock)' : 'Not resellable (do not restock)'}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {outcome === 'RESELLABLE' ? (
        <Field
          label="Quantity to restock"
          hint={`At most ${detail.quantity} (the returned quantity).`}
          error={quantityInvalid ? `Enter 1 to ${detail.quantity}.` : undefined}
        >
          <Input
            type="number"
            min={1}
            max={detail.quantity}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
      ) : null}
    </ConfirmDialog>
  );
}

function ResponsibilityDialog({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const refresh = useRefreshReturns();
  const [responsibility, setResponsibility] = useState<ReturnResponsibility>(detail.responsibility);
  const [cause, setCause] = useState<string>(detail.faultCause ?? '');
  const [payer, setPayer] = useState<ReturnPayer>(detail.payer);
  const causes = RETURN_CAUSES_BY_RESPONSIBILITY[responsibility];
  const locked = detail.blueprint?.selectionMode === LOCKED;
  const causeMissing = causes.length > 0 && !causes.includes(cause);

  function pickResponsibility(next: ReturnResponsibility) {
    setResponsibility(next);
    setPayer(RETURN_DEFAULT_PAYER[next]);
    setCause('');
  }

  async function submit(note: string) {
    await returnsApi.setResponsibility(detail.id, {
      responsibility,
      faultCause: causes.length === 0 ? null : cause,
      ...(payer !== RETURN_DEFAULT_PAYER[responsibility] && { payer }),
      note,
    });
    notify.success(`Responsibility updated. ${payerSentence(payer)}`);
    await refresh();
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Change responsibility"
      description="Decides who carries the cost of this return. Responsibility is separate from the workflow status."
      confirmLabel="Save responsibility"
      confirmDisabled={causeMissing}
      note={{ label: 'Note (why)', required: true }}
      onConfirm={submit}
    >
      <Field label="Responsibility" required>
        <NativeSelect
          value={responsibility}
          onChange={(e) => pickResponsibility(e.target.value as ReturnResponsibility)}
        >
          {RETURN_RESPONSIBILITIES.map((r) => (
            <option key={r} value={r}>
              {responsibilityDisplay(r).label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {causes.length > 0 ? (
        <Field
          label="Cause"
          required
          hint={
            causes.includes(BLUEPRINT_FAILURE) && !locked
              ? 'Blueprint failure is only possible when the customer locked the recommended size.'
              : undefined
          }
        >
          <NativeSelect value={cause} onChange={(e) => setCause(e.target.value)}>
            <option value="">Choose a cause</option>
            {causes.map((c) => (
              <option key={c} value={c} disabled={c === BLUEPRINT_FAILURE && !locked}>
                {faultCauseDisplay(c).label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}
      <Field
        label="Who pays the return delivery"
        hint="Defaults to the rule for this responsibility."
      >
        <NativeSelect value={payer} onChange={(e) => setPayer(e.target.value as ReturnPayer)}>
          {RETURN_PAYERS.map((p) => (
            <option key={p} value={p}>
              {payerDisplay(p).label}
              {p === RETURN_DEFAULT_PAYER[responsibility] ? ' (default)' : ''}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm">
        {payerSentence(payer)}
      </p>
    </ConfirmDialog>
  );
}

type Open =
  | { kind: 'transition'; transition: Transition }
  | { kind: 'inspect' }
  | { kind: 'responsibility' }
  | null;

/** Only the moves the API allows now, plus inspection when the item is back. */
export function ReturnActions({ detail }: { detail: Detail }) {
  const [open, setOpen] = useState<Open>(null);
  const transitions = detail.allowedTransitions.filter((t) => !NOT_OFFERED.has(t.toStatus));
  const canInspect = detail.status === RETURN_RECEIVED && detail.inspection === null;
  return (
    <div className="space-y-3">
      {transitions.length === 0 && !canInspect ? (
        <p className="text-sm text-muted-foreground">
          No action is possible at “{returnStatusDisplay(detail.status).label}”.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canInspect ? (
            <Button onClick={() => setOpen({ kind: 'inspect' })}>Record inspection</Button>
          ) : null}
          {transitions.map((t) => {
            const needsInspection = t.requiresInspection && detail.inspection === null;
            return (
              <Button
                key={t.toStatus}
                variant={t.toStatus === 'REJECTED' ? 'outline' : 'default'}
                disabled={needsInspection}
                title={needsInspection ? 'Record the inspection first.' : undefined}
                onClick={() => setOpen({ kind: 'transition', transition: t })}
              >
                {returnActionLabel(t.toStatus)}
              </Button>
            );
          })}
        </div>
      )}
      <Button variant="outline" size="sm" onClick={() => setOpen({ kind: 'responsibility' })}>
        Change responsibility
      </Button>
      {open?.kind === 'transition' ? (
        <TransitionDialog
          key={open.transition.toStatus}
          detail={detail}
          transition={open.transition}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === 'inspect' ? (
        <InspectDialog detail={detail} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === 'responsibility' ? (
        <ResponsibilityDialog detail={detail} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
