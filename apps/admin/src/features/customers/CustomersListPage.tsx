import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { Link } from 'react-router';
import { FilterBar, FilterSelect, SearchInput } from '@/components/FilterBar';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ListCard, QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { customersApi } from '@/lib/api/customers-api';
import { formatDateTime, formatNaira } from '@/lib/format';
import { CUSTOMER_STATUS_CODES, customerStatusDisplay } from '@/lib/status';
import { useUrlFilters } from '@/lib/use-url-filters';

const FILTERS = ['q', 'status'] as const;

export const customerKeys = {
  all: ['customers'] as const,
  list: (params: Record<string, unknown>) => [...customerKeys.all, 'list', params] as const,
  detail: (id: string) => [...customerKeys.all, 'detail', id] as const,
};

export function CustomersListPage() {
  const { values, page, setFilter, setPage, clear, active } = useUrlFilters(FILTERS);
  const params = { ...values, page };
  const customers = useQuery({
    queryKey: customerKeys.list(params),
    queryFn: () => customersApi.list(params),
    placeholderData: (previous) => previous,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Customer accounts from the website and the app. Passwords and sign-in tokens are never shown."
      />
      <FilterBar active={active} onClear={clear}>
        <SearchInput
          label="Search customers"
          placeholder="Name, email or phone"
          value={values.q}
          onChange={(v) => setFilter('q', v)}
        />
        <FilterSelect
          label="Status"
          value={values.status}
          onChange={(v) => setFilter('status', v)}
          options={CUSTOMER_STATUS_CODES.map((s) => ({
            value: s,
            label: customerStatusDisplay(s).label,
          }))}
        />
      </FilterBar>
      <ListCard>
        <QueryView
          query={customers}
          what="customers"
          isEmpty={(data) => data.data.length === 0}
          empty={{
            icon: Users,
            title: active ? 'No customers match' : 'No customers yet',
            description: active ? 'Try another search.' : 'Customers appear once they register.',
          }}
        >
          {(data) => (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col">Customer</TableHead>
                    <TableHead scope="col">Phone</TableHead>
                    <TableHead scope="col" className="text-right">
                      Orders
                    </TableHead>
                    <TableHead scope="col" className="text-right">
                      Paid total
                    </TableHead>
                    <TableHead scope="col">Joined</TableHead>
                    <TableHead scope="col">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          to={`/customers/${c.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {c.fullName}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {c.email}
                          {c.emailVerified ? '' : ' · not verified'}
                        </p>
                      </TableCell>
                      <TableCell>{c.phone ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.orderCount}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNaira(c.paidTotalMinor)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(new Date(c.createdAt))}
                      </TableCell>
                      <TableCell>
                        <StatusBadge display={customerStatusDisplay(c.status)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </QueryView>
      </ListCard>
      {customers.data ? <Pagination meta={customers.data.meta} onPage={setPage} /> : null}
    </div>
  );
}
