import type { PageMeta } from '@urban-ibile/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  if (meta.totalPages <= 1) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        {meta.total} result{meta.total === 1 ? '' : 's'}
      </p>
    );
  }
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-1">
      <p className="text-xs text-muted-foreground">
        Page {meta.page} of {meta.totalPages} · {meta.total} results
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
