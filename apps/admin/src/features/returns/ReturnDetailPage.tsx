import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminReturnDetailDto, AdminReturnEventDto } from '@urban-ibile/shared';
import { ArrowLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { BlueprintPanel } from '@/components/BlueprintPanel';
import { InfoBanner, PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { returnsApi } from '@/lib/api/returns-api';
import { formatDateTime, formatNaira } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
  faultCauseDisplay,
  humanise,
  orderStatusDisplay,
  payerDisplay,
  responsibilityDisplay,
  returnReasonDisplay,
  returnStatusDisplay,
} from '@/lib/status';
import { EvidenceGallery, evidenceRefreshDelay } from './EvidenceGallery';
import { payerSentence, ReturnActions } from './ReturnActions';
import { RETURNS_BANNER, returnKeys } from './ReturnsListPage';

/** Readable text for the stored classification basis (rules A/B/C); unknown values shown as-is. */
const BASIS_TEXT: Partial<Record<string, string>> = {
  scenario_a_override_does_not_fit:
    'Rule A: the customer overrode the recommended size and it does not fit, so the customer pays.',
  scenario_b_locked_fit_review:
    'Rule B: the customer locked the recommended size; a genuine fit failure, confirmed after review, makes it a brand fault.',
  scenario_c_changed_mind:
    'Rule C: correct size, customer changed their mind, so the customer pays.',
  does_not_fit_no_blueprint_decision:
    'Does not fit, but there is no Blueprint decision: review needed.',
};

function basisText(basis: string | null): string {
  if (basis === null) return '—';
  return (
    BASIS_TEXT[basis] ??
    (basis.endsWith('_review')
      ? `Needs review (${humanise(basis.replace(/_review$/, ''))}).`
      : basis)
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function yesNo(value: boolean | null): string {
  if (value === null) return 'Not asked';
  return value ? 'Yes' : 'No';
}

function EventList({ events, empty }: { events: AdminReturnEventDto[]; empty: string }) {
  if (events.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li key={e.id} className="border-l-2 pl-3">
          <p className="font-medium">
            {e.toStatus
              ? `${e.fromStatus ? `${returnStatusDisplay(e.fromStatus).label} → ` : ''}${returnStatusDisplay(e.toStatus).label}`
              : humanise(e.type)}
          </p>
          {e.note ? <p className="whitespace-pre-line">{e.note}</p> : null}
          <p className="text-xs text-muted-foreground">
            {e.actor.type === 'SYSTEM' ? 'System' : (e.actor.name ?? humanise(e.actor.type))} ·{' '}
            {formatDateTime(new Date(e.createdAt))}
          </p>
        </li>
      ))}
    </ol>
  );
}

function NotesForm({ id }: { id: string }) {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try {
      await returnsApi.addNote(id, text.trim());
      setText('');
      notify.success('Internal note added.');
      await client.invalidateQueries({ queryKey: returnKeys.detail(id) });
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Field label="New internal note" hint="Admins only. Notes cannot be edited or deleted.">
        <Textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Button size="sm" disabled={busy || text.trim() === ''} onClick={() => void add()}>
        {busy ? 'Saving…' : 'Add note'}
      </Button>
    </div>
  );
}

function ReturnDetail({
  detail,
  onEvidenceExpired,
}: {
  detail: AdminReturnDetailDto;
  onEvidenceExpired: () => void;
}) {
  const customerEvents = detail.timeline.filter((e) => e.visibility === 'CUSTOMER');
  const internalEvents = detail.timeline.filter((e) => e.visibility === 'INTERNAL');
  const blueprint = detail.blueprint;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link to="/returns" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Returns
          </Link>
        }
        title={`${humanise(detail.requestType)} ${detail.requestNumber}`}
        description={`Submitted ${formatDateTime(new Date(detail.submittedAt))} by ${detail.customer.fullName}`}
        actions={<StatusBadge display={returnStatusDisplay(detail.status)} />}
      />
      <InfoBanner tone="warning">{RETURNS_BANNER}</InfoBanner>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Request">
            <dl className="space-y-1">
              <Row label="Reason">{returnReasonDisplay(detail.reasonCode).label}</Row>
              <Row label="Quantity">{detail.quantity}</Row>
              <Row label="Original tags attached">
                {yesNo(detail.conditionConfirmations.originalTags)}
              </Row>
              <Row label="Unworn and unwashed">
                {yesNo(detail.conditionConfirmations.unwornUnwashed)}
              </Row>
              <Row label="Policy">
                {detail.policy ? `${detail.policy.name} v${detail.policy.version}` : 'None'}
              </Row>
            </dl>
            {detail.explanation ? (
              <blockquote className="rounded-md bg-muted/40 p-3 whitespace-pre-line">
                {detail.explanation}
              </blockquote>
            ) : null}
          </Section>
          <Section title="Item">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <Link
                  to={`/products/${detail.item.productId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {detail.item.productName}
                </Link>
                <p className="text-xs text-muted-foreground">
                  Size {detail.item.sizeLabel} ·{' '}
                  <span className="font-mono">{detail.item.sku}</span> · bought{' '}
                  {detail.item.purchasedQuantity} × {formatNaira(detail.item.unitPriceMinor)}
                </p>
              </div>
              <Link
                to={`/orders/${detail.order.id}`}
                className="text-sm underline-offset-4 hover:underline"
              >
                Order {detail.order.orderNumber}
              </Link>
            </div>
            <BlueprintPanel fit={blueprint} measurements={blueprint?.measurements ?? []} />
          </Section>
          <Section title="Evidence">
            <p className="text-xs text-muted-foreground">
              Private photos shown through short-lived links; they refresh automatically.
            </p>
            <EvidenceGallery evidence={detail.evidence} onExpired={onEvidenceExpired} />
          </Section>
          <div className="grid gap-6 md:grid-cols-2">
            <Section title="Seen by the customer">
              <EventList events={customerEvents} empty="No customer-visible events." />
            </Section>
            <Section title="Internal only">
              <EventList events={internalEvents} empty="No internal events yet." />
              <NotesForm id={detail.id} />
            </Section>
          </div>
        </div>
        <div className="space-y-6">
          <Section title="Actions">
            <ReturnActions detail={detail} />
          </Section>
          <Section title="Fault-Line">
            <dl className="space-y-1">
              <Row label="Responsibility">
                <StatusBadge display={responsibilityDisplay(detail.responsibility)} />
              </Row>
              <Row label="Cause">
                {detail.faultCause ? faultCauseDisplay(detail.faultCause).label : '—'}
              </Row>
              <Row label="Return delivery">{payerDisplay(detail.payer).label}</Row>
              <Row label="Set by">
                {detail.responsibilityDetails.setBy === 'SYSTEM' ? 'Rules (system)' : 'Admin'}
                {detail.responsibilityDetails.setAt
                  ? ` · ${formatDateTime(new Date(detail.responsibilityDetails.setAt))}`
                  : ''}
              </Row>
            </dl>
            <p className="text-xs text-muted-foreground">
              {basisText(detail.responsibilityDetails.basis)}
            </p>
            <p className="font-medium">{payerSentence(detail.payer)}</p>
            <p className="text-xs text-muted-foreground">
              Decision: {humanise(detail.adminDecision)}
              {detail.reviewedBy ? ` by ${detail.reviewedBy.name}` : ''}
              {detail.reviewedAt ? ` · ${formatDateTime(new Date(detail.reviewedAt))}` : ''}
            </p>
          </Section>
          {detail.exchange ? (
            <Section title="Exchange">
              <dl className="space-y-1">
                <Row label="Replacement size">{detail.exchange.sizeLabel ?? '—'}</Row>
                <Row label="SKU">{detail.exchange.replacementSku ?? '—'}</Row>
                <Row label="Stock hold">
                  {detail.exchange.reservationStatus
                    ? humanise(detail.exchange.reservationStatus)
                    : 'Not reserved yet'}
                </Row>
                <Row label="Carrier">{detail.exchange.carrier ?? '—'}</Row>
                <Row label="Tracking">{detail.exchange.trackingReference ?? '—'}</Row>
                {detail.exchange.sentAt ? (
                  <Row label="Sent">{formatDateTime(new Date(detail.exchange.sentAt))}</Row>
                ) : null}
              </dl>
            </Section>
          ) : null}
          <Section title="Inspection">
            {detail.inspection ? (
              <dl className="space-y-1">
                <Row label="Outcome">
                  <Badge tone={detail.inspection.outcome === 'RESELLABLE' ? 'success' : 'neutral'}>
                    {humanise(detail.inspection.outcome)}
                  </Badge>
                </Row>
                <Row label="Restocked">{detail.inspection.restockedQuantity}</Row>
                <Row label="By">{detail.inspection.inspectedBy.name}</Row>
                <Row label="When">{formatDateTime(new Date(detail.inspection.inspectedAt))}</Row>
                {detail.inspection.notes ? <p className="pt-1">{detail.inspection.notes}</p> : null}
              </dl>
            ) : (
              <p className="text-muted-foreground">
                Not inspected yet. The item is not sellable until it is inspected.
              </p>
            )}
          </Section>
          <Section title="Order">
            <dl className="space-y-1">
              <Row label="Status">
                <StatusBadge display={orderStatusDisplay(detail.orderDetails.status)} />
              </Row>
              <Row label="Delivered">
                {detail.orderDetails.deliveredAt
                  ? formatDateTime(new Date(detail.orderDetails.deliveredAt))
                  : '—'}
              </Row>
              <Row label="Customer">
                <Link
                  to={`/customers/${detail.customer.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {detail.customer.fullName}
                </Link>
              </Row>
            </dl>
            <p className="text-xs text-muted-foreground">
              Refund: not executed by the system (policy pending client decision).
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

export function ReturnDetailPage() {
  const { id = '' } = useParams();
  const query = useQuery({
    queryKey: returnKeys.detail(id),
    queryFn: () => returnsApi.get(id),
    // Signed evidence URLs are short-lived: refetch shortly before the earliest expires.
    refetchInterval: (q) => evidenceRefreshDelay(q.state.data?.evidence),
  });
  return (
    <QueryView query={query} what="return request">
      {(data) => <ReturnDetail detail={data} onEvidenceExpired={() => void query.refetch()} />}
    </QueryView>
  );
}
