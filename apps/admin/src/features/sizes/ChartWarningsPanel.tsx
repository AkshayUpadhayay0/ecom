import { AlertTriangle, CheckCircle2, ChevronDown, Equal, Info } from 'lucide-react';
import type { SizeChartCheckSeverity, SizeChartDto } from '@urban-ibile/shared';
import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  CODE_LABEL,
  EXPLANATION,
  SEVERITY_LABEL,
  findingSummary,
  type ChartFinding,
} from './chart-warnings';

interface ChartWarningsPanelProps {
  check: SizeChartDto['check'];
  findings: readonly ChartFinding[];
  focusedId: string | null;
  onSelect: (finding: ChartFinding) => void;
}

const SEVERITY_ICON = { warning: AlertTriangle, notice: Equal, info: Info } as const;
const SEVERITY_TEXT: Record<SizeChartCheckSeverity, string> = {
  warning: 'text-warning',
  notice: 'text-info',
  info: 'text-muted-foreground',
};

/**
 * Summary of the API's chart check ("2 warnings, 3 notices"); expands to every finding,
 * including info items (which are listed but never counted).
 */
export function ChartWarningsPanel({
  check,
  findings,
  focusedId,
  onSelect,
}: ChartWarningsPanelProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const clean = check.warningCount === 0 && check.noticeCount === 0;
  const SummaryIcon = clean ? CheckCircle2 : AlertTriangle;

  return (
    <section
      aria-label="Chart review checks"
      className={cn('rounded-xl border', clean ? 'bg-success-soft/60' : 'bg-warning-soft/50')}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SummaryIcon
          className={cn('mt-0.5 size-4 shrink-0', clean ? 'text-success' : 'text-warning')}
          aria-hidden="true"
        />
        <span className="flex-1">
          <span className="block text-sm font-semibold">{findingSummary(check)}</span>
          <span className="block text-sm text-muted-foreground">{EXPLANATION}</span>
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
          {findings.map((finding) => {
            const Icon = SEVERITY_ICON[finding.severity];
            return (
              <li key={finding.id}>
                <button
                  type="button"
                  onClick={() => onSelect(finding)}
                  aria-current={focusedId === finding.id ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring',
                    focusedId === finding.id && 'bg-card ring-1 ring-accent/50',
                  )}
                >
                  <Icon
                    className={cn('mt-0.5 size-4 shrink-0', SEVERITY_TEXT[finding.severity])}
                    aria-hidden="true"
                  />
                  <span>
                    <span
                      className={cn(
                        'mr-1.5 text-xs font-semibold tracking-wide uppercase',
                        SEVERITY_TEXT[finding.severity],
                      )}
                    >
                      {SEVERITY_LABEL[finding.severity]} · {CODE_LABEL[finding.code]}
                    </span>
                    <span className="font-medium">{finding.measurementLabel}:</span>{' '}
                    {finding.message}
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
