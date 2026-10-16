import { useQuery } from '@tanstack/react-query';
import type { AdminCustomerDetailDto } from '@urban-ibile/shared';
import { ArrowLeft } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InfoBanner, PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { SuperAdminOnly } from '@/components/SuperAdminOnly';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { customersApi } from '@/lib/api/customers-api';
import { formatDateTime, formatNaira } from '@/lib/format';
import { customerStatusDisplay, orderStatusDisplay, paymentStatusDisplay } from '@/lib/status';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { customerKeys } from './CustomersListPage';

const ACTIVE = 'active';
const SUSPENDED = 'suspended';

export const SUSPEND_WARNING =
  'Suspending signs the customer out everywhere at once (all their sessions end) and blocks sign-in until they are enabled again. Their orders are not changed.';

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

function StatusAction({ customer }: { customer: AdminCustomerDetailDto }) {
  const [open, setOpen] = useState(false);
  const suspending = customer.status === ACTIVE;
  const change = useAdminMutation(
    (reason: string) =>
      customersApi.setStatus(customer.id, { status: suspending ? SUSPENDED : ACTIVE, reason }),
    {
      success: suspending ? 'Customer suspended and signed out.' : 'Customer enabled.',
      invalidate: [customerKeys.all],
    },
  );
  if (customer.status !== ACTIVE && customer.status !== SUSPENDED) return null;
  return (
    <>
      <SuperAdminOnly>
        <Button variant={suspending ? 'outline' : 'default'} onClick={() => setOpen(true)}>
          {suspending ? 'Suspend customer' : 'Enable customer'}
        </Button>
      </SuperAdminOnly>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={suspending ? `Suspend ${customer.fullName}?` : `Enable ${customer.fullName}?`}
        description={suspending ? SUSPEND_WARNING : 'The customer will be able to sign in again.'}
        confirmLabel={suspending ? 'Suspend' : 'Enable'}
        destructive={suspending}
        note={{ label: 'Reason', required: true }}
        onConfirm={(reason) => change.mutateAsync(reason)}
      />
    </>
  );
}

function CustomerDetail({ customer }: { customer: AdminCustomerDetailDto }) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Link to="/customers" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" /> Customers
          </Link>
        }
        title={customer.fullName}
        description={customer.email}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge display={customerStatusDisplay(customer.status)} />
            <StatusAction customer={customer} />
          </div>
        }
      />
      {customer.status === SUSPENDED ? (
        <InfoBanner tone="warning">This customer is suspended and cannot sign in.</InfoBanner>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title={`Orders (${customer.orderCount})`}>
            {customer.orders.length === 0 ? (
              <p className="text-muted-foreground">No orders yet.</p>
            ) : (
              <ul className="divide-y">
                {customer.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <Link
                        to={`/orders/${o.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {o.orderNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(new Date(o.placedAt))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">{formatNaira(o.totalMinor)}</span>
                      <StatusBadge display={paymentStatusDisplay(o.paymentStatus)} />
                      <StatusBadge display={orderStatusDisplay(o.orderStatus)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Addresses">
            {customer.addresses.length === 0 ? (
              <p className="text-muted-foreground">No saved addresses.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {customer.addresses.map((a) => (
                  <li key={a.id} className="rounded-lg border p-3">
                    <p className="font-medium">
                      {a.label ?? a.recipientName} {a.isDefault ? <Badge>Default</Badge> : null}
                    </p>
                    <address className="mt-1 text-muted-foreground not-italic">
                      {a.recipientName} · {a.phone}
                      <br />
                      {a.addressLine1}
                      {a.addressLine2 ? `, ${a.addressLine2}` : ''}
                      <br />
                      {[a.city, a.state].filter(Boolean).join(', ')} · {a.zoneName}
                      {a.landmark ? (
                        <>
                          <br />
                          Landmark: {a.landmark}
                        </>
                      ) : null}
                    </address>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <Section title="Profile">
          <dl className="space-y-2">
            {(
              [
                ['Phone', customer.phone ?? '—'],
                ['Email verified', customer.emailVerified ? 'Yes' : 'No'],
                ['Language', customer.preferredLanguage],
                ['Paid total', formatNaira(customer.paidTotalMinor)],
                ['Joined', formatDateTime(new Date(customer.createdAt))],
                [
                  'Last sign-in',
                  customer.lastLoginAt ? formatDateTime(new Date(customer.lastLoginAt)) : 'Never',
                ],
                [
                  'Sign-in locked until',
                  customer.lockedUntil ? formatDateTime(new Date(customer.lockedUntil)) : '—',
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </div>
  );
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const customer = useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: () => customersApi.get(id),
  });
  return (
    <QueryView query={customer} what="customer">
      {(data) => <CustomerDetail customer={data} />}
    </QueryView>
  );
}
