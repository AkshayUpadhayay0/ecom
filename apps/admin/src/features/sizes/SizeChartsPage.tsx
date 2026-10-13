import { ChevronDown, Lock, Ruler } from 'lucide-react';
import type { SizeChartGroupDto, SizeChartSummaryDto } from '@urban-ibile/shared';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState } from '@/components/StateViews';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { formatLongDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ChartGrid } from './ChartGrid';
import { ChartWarningsPanel } from './ChartWarningsPanel';
import {
  CHART_STATUS_DISPLAY,
  buildWarnings,
  cellDomId,
  warningsByCell,
  type ChartWarning,
} from './chart-warnings';
import { useChart, useChartGroups, useChartVersions } from './sizes.queries';

const GRID_SKELETON_ROWS = 6;
const GROUP_PARAM = 'group';
const VERSION_PARAM = 'version';

function activationText(chart: SizeChartSummaryDto): string {
  return chart.effectiveFrom
    ? `Activated ${formatLongDate(new Date(chart.effectiveFrom))}`
    : 'Not activated';
}

function GridSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border bg-card p-5" aria-busy="true">
      {Array.from({ length: GRID_SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
      <span className="sr-only">Loading size chart…</span>
    </div>
  );
}

function GroupSelector({
  groups,
  selectedId,
  onSelect,
}: {
  groups: readonly SizeChartGroupDto[];
  selectedId: string;
  onSelect: (group: SizeChartGroupDto) => void;
}) {
  return (
    <div role="group" aria-label="Chart group" className="-mx-1 overflow-x-auto px-1">
      <div className="inline-flex min-w-max gap-1 rounded-lg border bg-card p-1">
        {groups.map((group) => {
          const selected = group.id === selectedId;
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(group)}
              className={cn(
                'h-8 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {group.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VersionPicker({
  versions,
  selected,
  onSelect,
}: {
  versions: readonly SizeChartSummaryDto[];
  selected: SizeChartSummaryDto;
  onSelect: (chart: SizeChartSummaryDto) => void;
}) {
  const status = CHART_STATUS_DISPLAY[selected.status];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={`Chart version ${selected.version}, ${status.label}`}>
          Version {selected.version}
          <Badge tone={status.tone}>{status.label}</Badge>
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Chart versions
        </DropdownMenuLabel>
        {versions.map((chart) => {
          const display = CHART_STATUS_DISPLAY[chart.status];
          return (
            <DropdownMenuItem key={chart.id} onSelect={() => onSelect(chart)}>
              <span className="flex flex-1 flex-col">
                <span className="font-medium">Version {chart.version}</span>
                <span className="text-xs text-muted-foreground">{activationText(chart)}</span>
              </span>
              <Badge tone={display.tone}>{display.label}</Badge>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChartView({ chartId }: { chartId: string }) {
  const { data: chart, isPending, isError, refetch } = useChart(chartId);
  const [focused, setFocused] = useState<ChartWarning | null>(null);
  const warnings = useMemo(() => (chart ? buildWarnings(chart) : []), [chart]);
  const byCell = useMemo(() => warningsByCell(warnings), [warnings]);

  useEffect(() => {
    if (!focused) return;
    document
      .getElementById(cellDomId(focused.lowerSize, focused.measurementCode))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [focused]);

  if (isPending) return <GridSkeleton />;
  if (isError) return <ErrorState what="this size chart" onRetry={() => void refetch()} />;
  if (chart.rows.length === 0) {
    return (
      <EmptyState
        icon={Ruler}
        title="This chart has no rows"
        description="No sizes have been loaded into this chart version yet."
      />
    );
  }

  return (
    <div className="space-y-4">
      <ChartWarningsPanel
        warnings={warnings}
        focusedId={focused?.id ?? null}
        onSelect={setFocused}
      />
      <ChartGrid chart={chart} warningsByCell={byCell} focused={focused} />
      {chart.sourceNote ? (
        <p className="text-xs text-muted-foreground">Source: {chart.sourceNote}</p>
      ) : null}
    </div>
  );
}

export function SizeChartsPage() {
  const [params, setParams] = useSearchParams();
  const groups = useChartGroups();

  const selectedGroup =
    groups.data?.find((group) => group.code === params.get(GROUP_PARAM)) ?? groups.data?.[0];
  const versions = useChartVersions(selectedGroup?.id);
  const selectedVersion =
    versions.data?.find((chart) => chart.id === params.get(VERSION_PARAM)) ??
    versions.data?.find((chart) => chart.id === selectedGroup?.activeChart?.id) ??
    versions.data?.[0];

  useEffect(() => {
    document.title = 'Size Charts · Urban Ibile Admin';
  }, []);

  function selectGroup(group: SizeChartGroupDto): void {
    setParams({ [GROUP_PARAM]: group.code }, { replace: true });
  }

  function selectVersion(chart: SizeChartSummaryDto): void {
    if (!selectedGroup) return;
    setParams({ [GROUP_PARAM]: selectedGroup.code, [VERSION_PARAM]: chart.id }, { replace: true });
  }

  if (groups.isPending) return <GridSkeleton />;
  if (groups.isError) {
    return <ErrorState what="size chart groups" onRetry={() => void groups.refetch()} />;
  }
  if (!selectedGroup) {
    return (
      <EmptyState
        icon={Ruler}
        title="No size chart groups"
        description="Size charts are loaded by the developers with the client's size data."
      />
    );
  }

  return (
    <section aria-label="Size charts" className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <GroupSelector groups={groups.data} selectedId={selectedGroup.id} onSelect={selectGroup} />
        {selectedVersion && versions.data ? (
          <VersionPicker
            versions={versions.data}
            selected={selectedVersion}
            onSelect={selectVersion}
          />
        ) : null}
      </div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Badge tone="neutral" className="shrink-0">
          <Lock aria-hidden="true" />
          Read-only
        </Badge>
        Active charts cannot be edited. Changes are made by creating a new version.
      </p>

      {versions.isPending ? (
        <GridSkeleton />
      ) : versions.isError ? (
        <ErrorState what="chart versions" onRetry={() => void versions.refetch()} />
      ) : !selectedVersion ? (
        <EmptyState
          icon={Ruler}
          title="No chart found for this group"
          description="No size chart version has been loaded for this group yet."
        />
      ) : (
        // key: a new version starts with no warning highlighted.
        <ChartView key={selectedVersion.id} chartId={selectedVersion.id} />
      )}
    </section>
  );
}
