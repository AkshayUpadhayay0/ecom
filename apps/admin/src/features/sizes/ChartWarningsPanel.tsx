import { AlertTriangle, CheckCircle2, ChevronDown, Layers } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { describeWarning, warningSummary, type ChartWarning } from './chart-warnings';

interface ChartWarningsPanelProps {
  warnings: readonly ChartWarning[];
  focusedId: string | null;
  onSelect: (warning: ChartWarning) => void;
}

/** Summary of the API's chart check; expands to a clickable list of warnings. */
export function ChartWarningsPanel({ warnings, focusedId, onSelect }: ChartWarningsPanelProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  if (warnings.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl border bg-success-soft px-4 py-3 text-sm text-success">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        No gaps or overlaps between neighbouring sizes in this chart.
      </p>
    );
  }

  return (
    <section aria-label="Chart review warnings" className="rounded-xl border bg-warning-soft/50">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="flex-1">
          <span className="block text-sm font-semibold">{warningSummary(warnings)}</span>
          <span className="block text-sm text-muted-foreground">
            These are for review with the tailor. Nothing has been changed.
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {open ? 'Hide' : 'Show'} details
          <ChevronDown
            className={cn('size-4 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </span>
      </button>

      {open ? (
        <ul id={listId} className="space-y-1 border-t px-2 py-2">
          {warnings.map((warning) => {
            const Icon = warning.kind === 'gap' ? AlertTriangle : Layers;
            return (
              <li key={warning.id}>
                <button
                  type="button"
                  onClick={() => onSelect(warning)}
                  aria-current={focusedId === warning.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring',
                    focusedId === warning.id && 'bg-card ring-1 ring-accent/50',
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                  <span>
                    <span className="mr-1.5 text-xs font-semibold tracking-wide text-warning uppercase">
                      {warning.kind}
                    </span>
                    {describeWarning(warning)}
                    {warning.wholeInchContiguous ? (
                      <span className="block text-xs text-muted-foreground">
                        These sizes touch when the chart is read in whole inches.
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
