import type { AdminMeasurementDto } from '@urban-ibile/shared';
import { Ruler } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { fitMethodDisplay, humanise, selectionModeDisplay } from '@/lib/status';

export interface BlueprintFit {
  decisionId: string;
  method: string;
  selectionMode: string;
  fitPreference: string;
  recommendedSize: string;
  selectedSize: string;
  charts: { group: string; version: number }[];
}

/**
 * Read-only Blueprint decision recorded at purchase (never recalculated). Used on order items and
 * return requests. Fit preference is shown but never changes the chart-derived size.
 */
export function BlueprintPanel({
  fit,
  measurements,
}: {
  fit: BlueprintFit | null;
  measurements: readonly AdminMeasurementDto[];
}) {
  if (!fit) {
    return (
      <p className="text-xs text-muted-foreground">
        No Blueprint for this product (it has no measurement profile).
      </p>
    );
  }
  const differs = fit.selectedSize !== fit.recommendedSize;
  return (
    <section aria-label="Blueprint decision" className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Ruler className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">Blueprint</span>
        <StatusBadge display={selectionModeDisplay(fit.selectionMode)} />
        <span className="text-muted-foreground">{fitMethodDisplay(fit.method).label}</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Recommended</dt>
          <dd className="font-medium">{fit.recommendedSize}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Chosen</dt>
          <dd className={differs ? 'font-medium text-warning' : 'font-medium'}>
            {fit.selectedSize}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Fit preference</dt>
          <dd>{humanise(fit.fitPreference)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Size chart</dt>
          <dd>
            {fit.charts.length > 0
              ? fit.charts.map((c) => `${humanise(c.group)} v${c.version}`).join(', ')
              : '—'}
          </dd>
        </div>
      </dl>
      {measurements.length > 0 ? (
        <table className="mt-3 w-full text-xs">
          <caption className="sr-only">Body measurements (inches)</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 font-medium">
                Measurement
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Inches
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Needs size
              </th>
            </tr>
          </thead>
          <tbody>
            {measurements.map((m) => (
              <tr key={m.code} className="border-t">
                <td className="py-1">{m.label}</td>
                <td className="py-1 text-right tabular-nums">{m.valueInches}</td>
                <td className="py-1 text-right">{m.requiredSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">Decision {fit.decisionId}</p>
    </section>
  );
}
