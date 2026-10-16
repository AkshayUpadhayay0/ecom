import { useQuery } from '@tanstack/react-query';
import { RETURN_REQUEST_TYPES, RETURN_RESPONSIBILITIES } from '@urban-ibile/shared';
import { RotateCcw } from 'lucide-react';
import { Link } from 'react-router';
import { FilterBar, FilterSelect, SearchInput } from '@/components/FilterBar';
import { InfoBanner, PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ListCard, QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { returnsApi, type ReturnListParams } from '@/lib/api/returns-api';
import { formatDateTime } from '@/lib/format';
import {
  RETURN_REASON_CODES,
  RETURN_STATUS_CODES,
  humanise,
  payerDisplay,
  responsibilityDisplay,
  returnReasonDisplay,
  returnStatusDisplay,
} from '@/lib/status';
import { useUrlFilters } from '@/lib/use-url-filters';

const FILTERS = ['q', 'status', 'requestType', 'responsibility', 'reasonCode', 'open'] as const;

export const RETURNS_BANNER =
  'Refunds are not processed by this system yet. Return policy values are pending client confirmation.';

export const returnKeys = {
  all: ['returns'] as const,
  list: (params: ReturnListParams) => [...returnKeys.all, 'list', params] as const,
  detail: (id: string) => [...returnKeys.all, 'detail', id] as const,
};

export function ReturnsListPage() {
  const { values, page, setFilter, setPage, clear, active } = useUrlFilters(FILTERS);
  const params: ReturnListParams = { ...values, page };
  const returns = useQuery({
    queryKey: returnKeys.list(params),
    queryFn: () => returnsApi.list(params),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Returns"
        description="Return and exchange requests, each tied to the exact order item and its Blueprint decision. Who pays is decided by the rules, not by the customer."
      />
      <InfoBanner tone="warning">{RETURNS_BANNER}</InfoBanner>
      <FilterBar active={active} onClear={clear}>
        <SearchInput
          label="Search returns"
          placeholder="Request or order number, customer, email, phone"
          value={values.q}
          onChange={(v) => setFilter('q', v)}
        />
        <FilterSelect
          label="Status"
          value={values.status}
          onChange={(v) => setFilter('status', v)}
          options={RETURN_STATUS_CODES.map((s) => ({
            value: s,
            label: returnStatusDisplay(s).label,
          }))}
        />
        <FilterSelect
          label="Type"
          value={values.requestType}
          onChange={(v) => setFilter('requestType', v)}
          options={RETURN_REQUEST_TYPES.map((t) => ({ value: t, label: humanise(t) }))}
        />
        <FilterSelect
          label="Responsibility"
          value={values.responsibility}
          onChange={(v) => setFilter('responsibility', v)}
          options={RETURN_RESPONSIBILITIES.map((r) => ({
            value: r,
            label: responsibilityDisplay(r).label,
          }))}
        />
        <FilterSelect
          label="Reason"
          value={values.reasonCode}
          onChange={(v) => setFilter('reasonCode', v)}
          options={RETURN_REASON_CODES.map((r) => ({
            value: r,
            label: returnReasonDisplay(r).label,
          }))}
        />
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={values.open === 'true'}
            onChange={(event) => setFilter('open', event.target.checked ? 'true' : '')}
          />
          Open only
        </label>
      </FilterBar>
      <ListCard>
        <QueryView
          query={returns}
          what="returns"
          isEmpty={(data) => data.data.length === 0}
          empty={{
            icon: RotateCcw,
            title: active ? 'No requests match these filters' : 'No return requests yet',
            description: active
              ? 'Try other filters.'
              : 'Customers start returns from a delivered order item.',
          }}
        >
          {(data) => (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col">Request</TableHead>
                    <TableHead scope="col">Item</TableHead>
                    <TableHead scope="col">Customer</TableHead>
                    <TableHead scope="col">Reason</TableHead>
                    <TableHead scope="col">Responsibility</TableHead>
                    <TableHead scope="col">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          to={`/returns/${r.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {r.requestNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          <Badge tone={r.requestType === 'EXCHANGE' ? 'accent' : 'neutral'}>
                            {humanise(r.requestType)}
                          </Badge>{' '}
                          {formatDateTime(new Date(r.submittedAt))}
                        </p>
                      </TableCell>
                      <TableCell>
                        {r.product.name}
                        <p className="text-xs text-muted-foreground">
                          Size {r.product.sizeLabel} × {r.quantity} · {r.order.orderNumber}
                        </p>
                      </TableCell>
                      <TableCell>
                        {r.customer.fullName}
                        <p className="text-xs text-muted-foreground">{r.customer.email}</p>
                      </TableCell>
                      <TableCell>{returnReasonDisplay(r.reasonCode).label}</TableCell>
                      <TableCell>
                        <StatusBadge display={responsibilityDisplay(r.responsibility)} />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {payerDisplay(r.payer).label}
                        </p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge display={returnStatusDisplay(r.status)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </QueryView>
      </ListCard>
      {returns.data ? <Pagination meta={returns.data.meta} onPage={setPage} /> : null}
    </div>
  );
}
