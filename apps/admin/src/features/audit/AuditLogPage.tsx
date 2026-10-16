import { useQuery } from '@tanstack/react-query';
import { Lock, ScrollText } from 'lucide-react';
import { FilterBar, SearchInput } from '@/components/FilterBar';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ListCard, QueryView } from '@/components/QueryStates';
import { EmptyState } from '@/components/StateViews';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsSuperAdmin } from '@/features/auth/roles';
import { configApi } from '@/lib/api/config-api';
import { formatDateTime } from '@/lib/format';
import { useUrlFilters } from '@/lib/use-url-filters';

const FILTERS = ['action', 'entityType', 'entityId'] as const;

function Snapshot({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">{label}</summary>
      <pre className="mt-1 max-w-md overflow-x-auto rounded bg-muted p-2 whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

const DESCRIPTION =
  'Every change made by admins, with before and after values. No passwords or secrets are ever recorded.';

/** Every admin write (who, what, before/after). Super admins only (403 for others). */
export function AuditLogPage() {
  const isSuper = useIsSuperAdmin();
  if (!isSuper) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit log" description={DESCRIPTION} />
        <ListCard>
          <EmptyState
            icon={Lock}
            title="Not available for your role"
            description="Only a super admin can see the audit log. Ask a super admin if you need access."
          />
        </ListCard>
      </div>
    );
  }
  return <AuditLogView />;
}

function AuditLogView() {
  const { values, page, setFilter, setPage, clear, active } = useUrlFilters(FILTERS);
  const logs = useQuery({
    queryKey: ['config', 'audit', values, page],
    queryFn: () => configApi.auditLogs({ ...values, page }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Audit log" description={DESCRIPTION} />
      <FilterBar active={active} onClear={clear}>
        <SearchInput
          label="Action"
          placeholder="Action, e.g. order.status_change"
          value={values.action}
          onChange={(v) => setFilter('action', v)}
          minLength={1}
        />
        <SearchInput
          label="Entity type"
          placeholder="Entity type, e.g. order"
          value={values.entityType}
          onChange={(v) => setFilter('entityType', v)}
          minLength={1}
        />
        <SearchInput
          label="Entity id"
          placeholder="Entity id"
          value={values.entityId}
          onChange={(v) => setFilter('entityId', v)}
          minLength={1}
        />
      </FilterBar>
      <ListCard>
        <QueryView
          query={logs}
          what="audit log"
          isEmpty={(d) => d.data.length === 0}
          empty={{
            icon: ScrollText,
            title: 'No audit entries',
            description: active ? 'Try other filters.' : 'Admin changes will appear here.',
          }}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">When</TableHead>
                  <TableHead scope="col">Admin</TableHead>
                  <TableHead scope="col">Action</TableHead>
                  <TableHead scope="col">Entity</TableHead>
                  <TableHead scope="col">Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((log) => (
                  <TableRow key={log.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(new Date(log.createdAt))}
                    </TableCell>
                    <TableCell>
                      {log.admin.displayName}
                      <span className="block text-xs text-muted-foreground">{log.admin.email}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell className="text-xs">
                      {log.entityType}
                      <span className="block font-mono text-muted-foreground">{log.entityId}</span>
                    </TableCell>
                    <TableCell>
                      <Snapshot label="Before" value={log.before} />
                      <Snapshot label="After" value={log.after} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryView>
      </ListCard>
      {logs.data ? <Pagination meta={logs.data.meta} onPage={setPage} /> : null}
    </div>
  );
}
