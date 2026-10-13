import { AlertTriangle, Layers } from 'lucide-react';
import type { SizeChartDto } from '@urban-ibile/shared';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  cellDomId,
  cellKey,
  formatRange,
  type ChartWarning,
  type WarningKind,
} from './chart-warnings';

interface ChartGridProps {
  chart: SizeChartDto;
  warningsByCell: ReadonlyMap<string, ReadonlySet<WarningKind>>;
  /** Warning picked from the list: its cells get a strong highlight. */
  focused: ChartWarning | null;
}

const KIND_LABEL: Record<WarningKind, string> = { gap: 'Gap', overlap: 'Overlap' };

function CellWarning({ kinds }: { kinds: ReadonlySet<WarningKind> }) {
  return (
    <span className="mt-1 flex items-center gap-1 text-[0.6875rem] font-medium text-warning">
      {kinds.has('gap') ? <AlertTriangle className="size-3" aria-hidden="true" /> : null}
      {kinds.has('overlap') ? <Layers className="size-3" aria-hidden="true" /> : null}
      {[...kinds].map((kind) => KIND_LABEL[kind]).join(' · ')}
    </span>
  );
}

/**
 * Read-only size chart grid: rows = sizes (already in sizes.sort_order from the API), columns =
 * the group's measurements. Sticky header and first column inside its own scroll box.
 */
export function ChartGrid({ chart, warningsByCell, focused }: ChartGridProps) {
  const focusedCells = new Set(
    focused
      ? [
          cellKey(focused.lowerSize, focused.measurementCode),
          cellKey(focused.upperSize, focused.measurementCode),
        ]
      : [],
  );

  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border bg-card">
      <table className="w-full caption-bottom border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          {chart.name}: size ranges in inches by size and measurement
        </caption>
        <TableHeader className="[&_tr]:border-b-0">
          <TableRow className="hover:bg-transparent">
            <TableHead
              scope="col"
              className="sticky top-0 left-0 z-30 border-b bg-card shadow-[1px_0_0_var(--border)]"
            >
              Size
            </TableHead>
            {chart.measurementTypes.map((measurement) => (
              <TableHead
                key={measurement.code}
                scope="col"
                className="sticky top-0 z-20 border-b bg-card"
              >
                {measurement.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {chart.rows.map((row) => (
            <TableRow key={row.size.id} className="hover:bg-transparent">
              <TableHead
                scope="row"
                className="sticky left-0 z-10 border-b bg-card py-3 shadow-[1px_0_0_var(--border)] normal-case tracking-normal"
              >
                <span className="font-mono text-xs font-semibold text-foreground">
                  {row.size.code}
                </span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {row.size.label}
                </span>
              </TableHead>
              {chart.measurementTypes.map((measurement) => {
                const cell = row.cells[measurement.code];
                const key = cellKey(row.size.code, measurement.code);
                const kinds = warningsByCell.get(key);
                const isFocused = focusedCells.has(key);
                return (
                  <TableCell
                    key={measurement.code}
                    id={cellDomId(row.size.code, measurement.code)}
                    data-warning={kinds ? [...kinds].join(' ') : undefined}
                    data-focused={isFocused || undefined}
                    className={cn(
                      'border-b align-top tabular-nums transition-shadow',
                      kinds && 'bg-warning-soft/60',
                      isFocused && 'bg-warning-soft ring-2 ring-accent ring-inset',
                    )}
                  >
                    {cell ? (
                      formatRange(cell.minInches, cell.maxInches)
                    ) : (
                      <span className="text-muted-foreground">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">No value</span>
                      </span>
                    )}
                    {kinds ? <CellWarning kinds={kinds} /> : null}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}
