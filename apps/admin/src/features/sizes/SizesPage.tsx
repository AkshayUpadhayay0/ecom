import { Ruler } from 'lucide-react';
import { useEffect } from 'react';
import { EmptyState, ErrorState } from '@/components/StateViews';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSizes } from './sizes.queries';

const SKELETON_ROWS = 8;

export function SizesPage() {
  const { data, isPending, isError, refetch } = useSizes();

  useEffect(() => {
    document.title = 'Sizes · Urban Ibile Admin';
  }, []);

  return (
    <section aria-label="Sizes" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sizes come with the size charts. Blueprint uses the sort order to pick the largest size an
        outfit needs.
      </p>
      <Card className="overflow-hidden">
        {isPending ? (
          <div className="space-y-3 p-5" aria-busy="true">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
            <span className="sr-only">Loading sizes…</span>
          </div>
        ) : isError ? (
          <ErrorState what="sizes" onRetry={() => void refetch()} />
        ) : data.length === 0 ? (
          <EmptyState
            icon={Ruler}
            title="No sizes"
            description="Sizes are loaded with the size charts."
          />
        ) : (
          <Table>
            <TableCaption>Sizes in sort order</TableCaption>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">Code</TableHead>
                <TableHead scope="col">Label</TableHead>
                <TableHead scope="col" className="text-right">
                  Sort order
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((size) => (
                <TableRow key={size.id}>
                  <TableCell className="font-mono text-xs font-semibold">
                    {size.code}
                    {size.isActive ? null : (
                      <Badge tone="neutral" className="ml-2 font-sans">
                        Inactive
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{size.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{size.sortOrder}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </section>
  );
}
