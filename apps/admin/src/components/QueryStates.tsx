import type { UseQueryResult } from '@tanstack/react-query';
import { Lock, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState } from '@/components/StateViews';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

export function LoadingBlock({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div className="space-y-3 p-5" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
      <span className="sr-only">Loading {label}…</span>
    </div>
  );
}

/**
 * Loading / 403 / 404 / error / empty handling for one query; renders `children(data)` otherwise.
 */
export function QueryView<T>({
  query,
  what,
  isEmpty,
  empty,
  children,
  rows,
}: {
  query: UseQueryResult<T>;
  what: string;
  isEmpty?: (data: T) => boolean;
  empty?: { icon: LucideIcon; title: string; description: string };
  children: (data: T) => ReactNode;
  rows?: number;
}) {
  if (query.isPending) return <LoadingBlock label={what} {...(rows !== undefined && { rows })} />;
  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.status === HTTP_FORBIDDEN) {
      return (
        <EmptyState
          icon={Lock}
          title="Not available for your role"
          description="Only a super admin can see this. Ask a super admin if you need access."
        />
      );
    }
    if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) {
      return (
        <EmptyState
          icon={Lock}
          title="Not found"
          description={`This ${what} does not exist or was removed.`}
        />
      );
    }
    return <ErrorState what={what} onRetry={() => void query.refetch()} />;
  }
  if (empty && isEmpty?.(query.data)) return <EmptyState {...empty} />;
  return <>{children(query.data)}</>;
}

/** Card wrapper used around list tables. */
export function ListCard({ children }: { children: ReactNode }) {
  return <Card className="overflow-hidden">{children}</Card>;
}
