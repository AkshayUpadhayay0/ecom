import { useQuery } from '@tanstack/react-query';
import { ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import { FilterBar, FilterSelect, SearchInput } from '@/components/FilterBar';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ListCard, QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { configApi } from '@/lib/api/config-api';
import { formatDateTime, formatNaira } from '@/lib/format';
import {
  ORDER_PAYMENT_STATUS_CODES,
  ORDER_STATUS_CODES,
  orderStatusDisplay,
  paymentStatusDisplay,
} from '@/lib/status';
import { useUrlFilters } from '@/lib/use-url-filters';
import { useOrders } from './orders.queries';

const FILTERS = [
  'q',
  'orderStatus',
  'paymentStatus',
  'from',
  'to',
  'deliveryZoneId',
  'needsAttention',
] as const;

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10"
      />
    </label>
  );
}

export function OrdersListPage() {
  const { values, page, setFilter, setPage, clear, active } = useUrlFilters(FILTERS);
  const orders = useOrders({ ...values, page });
  const zones = useQuery({
    queryKey: ['config', 'zones', 'filter'],
    queryFn: async () => (await configApi.zones({})).data,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Every order across the website and the app. Totals were computed by the server at checkout; orders are never deleted."
      />
      <FilterBar active={active} onClear={clear}>
        <SearchInput
          label="Search orders"
          placeholder="Order number, customer, email or phone"
          value={values.q}
          onChange={(v) => setFilter('q', v)}
        />
        <FilterSelect
          label="Order status"
          value={values.orderStatus}
          onChange={(v) => setFilter('orderStatus', v)}
          options={ORDER_STATUS_CODES.map((s) => ({
            value: s,
            label: orderStatusDisplay(s).label,
          }))}
        />
        <FilterSelect
          label="Payment"
          value={values.paymentStatus}
          onChange={(v) => setFilter('paymentStatus', v)}
          options={ORDER_PAYMENT_STATUS_CODES.map((s) => ({
            value: s,
            label: paymentStatusDisplay(s).label,
          }))}
        />
        <FilterSelect
          label="Delivery zone"
          value={values.deliveryZoneId}
          onChange={(v) => setFilter('deliveryZoneId', v)}
          options={(zones.data ?? []).map((z) => ({ value: z.id, label: z.name }))}
        />
        <DateFilter
          label="Placed from"
          value={values.from}
          onChange={(v) => setFilter('from', v)}
        />
        <DateFilter label="Placed to" value={values.to} onChange={(v) => setFilter('to', v)} />
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={values.needsAttention === 'true'}
            onChange={(event) => setFilter('needsAttention', event.target.checked ? 'true' : '')}
          />
          Needs attention only
        </label>
      </FilterBar>
      <ListCard>
        <QueryView
          query={orders}
          what="orders"
          isEmpty={(data) => data.data.length === 0}
          empty={{
            icon: ShoppingBag,
            title: active ? 'No orders match these filters' : 'No orders yet',
            description: active
              ? 'Try other filters or a different search.'
              : 'Orders appear here once customers check out.',
          }}
        >
          {(data) => (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col">Order</TableHead>
                    <TableHead scope="col">Customer</TableHead>
                    <TableHead scope="col">Zone</TableHead>
                    <TableHead scope="col" className="text-right">
                      Items
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Total
                    </TableHead>
                    <TableHead scope="col">Payment</TableHead>
                    <TableHead scope="col">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link
                          to={`/orders/${order.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {order.orderNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(new Date(order.placedAt))}
                        </p>
                      </TableCell>
                      <TableCell>
                        {order.customer.fullName}
                        <p className="text-xs text-muted-foreground">{order.customer.email}</p>
                      </TableCell>
                      <TableCell>{order.deliveryZoneName}</TableCell>
                      <TableCell className="text-right tabular-nums">{order.itemCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNaira(order.totalMinor)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge display={paymentStatusDisplay(order.paymentStatus)} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge display={orderStatusDisplay(order.orderStatus)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </QueryView>
      </ListCard>
      {orders.data ? <Pagination meta={orders.data.meta} onPage={setPage} /> : null}
    </div>
  );
}
