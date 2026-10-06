import { ArrowRight, PackageCheck } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorState } from '@/components/StateViews';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLowStock } from './dashboard.queries';

const SKELETON_ROWS = 4;

export function LowStockCard() {
  const { data, isPending, isError, refetch } = useLowStock();

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Low stock</CardTitle>
          <CardDescription>Sizes at or below their alert level.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link to="/inventory">
            Inventory
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>

      {isPending ? (
        <div className="space-y-3 px-5 pb-5" aria-busy="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
          <span className="sr-only">Loading low-stock items…</span>
        </div>
      ) : isError ? (
        <ErrorState what="low-stock items" onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Stock looks healthy"
          description="No sizes are at or below their low-stock level."
        />
      ) : (
        <ul className="divide-y px-5 pb-2">
          {data.map((item) => (
            <li key={item.variantId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.productName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.sizeLabel} · <span className="font-mono">{item.sku}</span>
                </p>
              </div>
              <Badge tone={item.available === 0 ? 'danger' : 'warning'} className="tabular-nums">
                {item.available === 0 ? 'Out of stock' : `${item.available} left`}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
