import { AlertTriangle, Equal } from 'lucide-react';
import type { SizeChartCheckCode, SizeChartDto } from '@urban-ibile/shared';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  CODE_LABEL,
  cellDomId,
  cellKey,
  formatInches,
  formatRange,
  type ChartFinding,
} from './chart-warnings';

interface ChartGridProps {
  chart: SizeChartDto;
  /** Warnings/notices per cell; cells without findings stay unhighlighted. */
  findingsByCell: ReadonlyMap<string, ReadonlySet<SizeChartCheckCode>>;
  /** Finding picked from the list: its cells get a strong outline. */
  focused: ChartFinding | null;
}

function CellFindings({ codes }: { codes: ReadonlySet<SizeChartCheckCode> }) {
  const hasWarning = codes.has('MAX_NOT_INCREASING') || codes.has('MISSING_CELL');
  const Icon = hasWarning ? AlertTriangle : Equal;
  return (
    <span
      className={cn(
        'mt-1 flex items-center gap-1 text-[0.6875rem] font-medium',
        hasWarning ? 'text-warning' : 'text-info',
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {[...codes].map((code) => CODE_LABEL[code]).join(' · ')}
    </span>
  );
}

/**
 * Read-only size chart grid: rows = sizes (in sizes.sort_order from the API), columns = the
 * group's measurements. Only max_inches is used for matching; min is shown for reference.
 */
export function ChartGrid({ chart, findingsByCell, focused }: ChartGridProps) {
  const focusedCells = new Set(
    focused ? focused.sizes.map((size) => cellKey(size, focused.measurementType)) : [],
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
                className="sticky left-0 z-10 border-b bg-card py-3 tracking-normal normal-case shadow-[1px_0_0_var(--border)]"
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
                const codes = findingsByCell.get(key);
                const isFocused = focusedCells.has(key);
                return (
                  <TableCell
                    key={measurement.code}
                    id={cellDomId(row.size.code, measurement.code)}
                    data-findings={codes ? [...codes].join(' ') : undefined}
                    data-focused={isFocused || undefined}
                    className={cn(
                      'border-b align-top tabular-nums transition-shadow',
                      codes && 'bg-warning-soft/60',
                      isFocused && 'ring-2 ring-accent ring-inset',
                    )}
                  >
                    {cell ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="cursor-help rounded-sm text-left tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {formatRange(cell.minInches, cell.maxInches)}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Max used for matching: {formatInches(cell.maxInches)} in
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">No value</span>
                      </span>
                    )}
                    {codes ? <CellFindings codes={codes} /> : null}
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
