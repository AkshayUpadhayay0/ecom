import { useQueryClient } from '@tanstack/react-query';
import type { AdminOrderDetailDto } from '@urban-ibile/shared';
import { ArrowLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { BlueprintPanel } from '@/components/BlueprintPanel';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ordersApi } from '@/lib/api/orders-api';
import { formatDateTime, formatNaira } from '@/lib/format';
import { notify } from '@/lib/notify';
import { humanise, orderStatusDisplay, paymentStatusDisplay } from '@/lib/status';
import { OrderStatusActions } from './OrderStatusActions';
import { orderKeys, useOrder } from './orders.queries';

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

function ItemsSection({ order }: { order: AdminOrderDetailDto }) {
  return (
    <Section title={`Items (${order.items.length})`}>
      <ul className="space-y-4">
        {order.items.map((item) => (
          <li key={item.id} className="space-y-2 border-b pb-4 last:border-0 last:pb-0">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <Link
                  to={`/products/${item.productId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {item.productName}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {item.clothingTypeName} · Size {item.sizeLabel} ·{' '}
                  <span className="font-mono">{item.sku}</span>
                </p>
              </div>
              <p className="text-right tabular-nums">
                {item.quantity} × {formatNaira(item.unitPriceMinor)}
                <span className="block font-medium">{formatNaira(item.lineTotalMinor)}</span>
              </p>
            </div>
            <BlueprintPanel fit={item.fit} measurements={item.measurements} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PaymentsSection({ order }: { order: AdminOrderDetailDto }) {
  return (
    <Section title="Payment attempts">
      {order.payments.length === 0 ? (
        <p className="text-muted-foreground">No payment attempts yet.</p>
      ) : (
        <ul className="divide-y">
          {order.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div>
                <p className="font-mono text-xs">{p.reference}</p>
                <p className="text-xs text-muted-foreground">
                  {humanise(p.provider)} · {p.channel ?? 'channel unknown'} · started{' '}
                  {formatDateTime(new Date(p.createdAt))}
                </p>
                {p.failureReason ? (
                  <p className="text-xs text-destructive">{p.failureReason}</p>
                ) : null}
              </div>
              <div className="text-right">
                <StatusBadge display={paymentStatusDisplay(p.status)} />
                <p className="tabular-nums">
                  {formatNaira(p.amountMinor)} {p.currency !== order.currency ? p.currency : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {order.reviewResolutions.length > 0 ? (
        <div>
          <p className="font-medium">Payment review decisions</p>
          <ul className="mt-1 space-y-1 text-xs">
            {order.reviewResolutions.map((r) => (
              <li key={r.id}>
                {humanise(r.action)}
                {r.amountMinor !== null ? ` (${formatNaira(r.amountMinor)})` : ''} by {r.admin.name}{' '}
                · {formatDateTime(new Date(r.createdAt))}: {r.note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function HistorySection({ order }: { order: AdminOrderDetailDto }) {
  return (
    <Section title="Status history">
      <ol className="space-y-2">
        {order.history.map((h) => (
          <li key={h.id} className="border-l-2 pl-3">
            <p>
              {h.fromStatus ? `${orderStatusDisplay(h.fromStatus).label} → ` : ''}
              <span className="font-medium">{orderStatusDisplay(h.toStatus).label}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {h.actor.type === 'system' ? 'System' : (h.actor.name ?? 'Admin')} ·{' '}
              {formatDateTime(new Date(h.createdAt))}
              {h.note ? ` · ${h.note}` : ''}
            </p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function NotesSection({ order }: { order: AdminOrderDetailDto }) {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await ordersApi.addNote(order.id, text.trim());
      setText('');
      notify.success('Note added.');
      await client.invalidateQueries({ queryKey: orderKeys.detail(order.id) });
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Internal notes">
      <p className="text-xs text-muted-foreground">
        Notes are visible to admins only and cannot be edited or deleted.
      </p>
      {order.notes.length > 0 ? (
        <ul className="space-y-2">
          {order.notes.map((n) => (
            <li key={n.id} className="rounded-md bg-muted/40 p-2">
              <p className="whitespace-pre-line">{n.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {n.author.name} · {formatDateTime(new Date(n.createdAt))}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <Field label="New note">
        <Textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Button size="sm" disabled={busy || text.trim() === ''} onClick={() => void add()}>
        {busy ? 'Saving…' : 'Add note'}
      </Button>
    </Section>
  );
}

function OrderDetail({ order }: { order: AdminOrderDetailDto }) {
  const d = order.delivery;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link to="/orders" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Orders
          </Link>
        }
        title={`Order ${order.orderNumber}`}
        description={`Placed ${formatDateTime(new Date(order.placedAt))} on the ${humanise(order.sourceClient)}`}
        actions={
          <div className="flex gap-2">
            <StatusBadge display={orderStatusDisplay(order.orderStatus)} />
            <StatusBadge display={paymentStatusDisplay(order.paymentStatus)} />
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ItemsSection order={order} />
          <PaymentsSection order={order} />
          <HistorySection order={order} />
          <NotesSection order={order} />
        </div>
        <div className="space-y-6">
          <Section title="Status">
            <OrderStatusActions order={order} />
            {order.carrier || order.trackingReference ? (
              <dl className="space-y-1">
                <Row label="Carrier">{order.carrier ?? '—'}</Row>
                <Row label="Tracking">{order.trackingReference ?? '—'}</Row>
              </dl>
            ) : null}
            {order.cancelReason ? (
              <p className="text-xs text-muted-foreground">Cancelled: {order.cancelReason}</p>
            ) : null}
          </Section>
          <Section title="Customer">
            <Link
              to={`/customers/${order.customer.id}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {order.customer.fullName}
            </Link>
            <dl className="space-y-1">
              <Row label="Email">{order.contact.email}</Row>
              <Row label="Phone">{order.contact.phone}</Row>
            </dl>
          </Section>
          <Section title="Delivery">
            <address className="not-italic">
              {d.recipientName}
              <br />
              {d.addressLine1}
              {d.addressLine2 ? (
                <>
                  <br />
                  {d.addressLine2}
                </>
              ) : null}
              <br />
              {[d.city, d.state].filter(Boolean).join(', ')}
              {d.landmark ? (
                <>
                  <br />
                  <span className="text-muted-foreground">Landmark: {d.landmark}</span>
                </>
              ) : null}
            </address>
            <dl className="space-y-1">
              <Row label="Zone">{d.zoneName}</Row>
              {order.deliveredAt ? (
                <Row label="Delivered">{formatDateTime(new Date(order.deliveredAt))}</Row>
              ) : null}
            </dl>
          </Section>
          <Section title="Totals">
            <dl className="space-y-1 tabular-nums">
              <Row label="Subtotal">{formatNaira(order.subtotalMinor)}</Row>
              <Row label="Delivery fee">{formatNaira(order.deliveryFeeMinor)}</Row>
              <div className="flex justify-between gap-4 border-t pt-2 font-medium">
                <dt>Total</dt>
                <dd>{formatNaira(order.totalMinor)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Computed by the server at checkout ({order.currency}).
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const order = useOrder(id);
  return (
    <QueryView query={order} what="order">
      {(data) => <OrderDetail order={data} />}
    </QueryView>
  );
}
