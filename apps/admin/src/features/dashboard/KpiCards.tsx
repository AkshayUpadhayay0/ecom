import { AlertTriangle, Banknote, Clock, ShoppingBag, type LucideIcon } from 'lucide-react';
import { ErrorState } from '@/components/StateViews';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNaira } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDashboardSummary } from './dashboard.queries';

interface Kpi {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  highlight?: boolean;
}

function KpiCard({ label, value, hint, icon: Icon, highlight }: Kpi) {
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span
          className={cn(
            'flex size-9 items-center justify-center rounded-lg bg-muted',
            highlight && 'bg-warning-soft text-warning',
          )}
        >
          <Icon className="size-[1.125rem]" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 font-display text-[1.75rem] leading-none tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-9 rounded-lg" />
      </div>
      <Skeleton className="mt-3 h-7 w-28" />
      <Skeleton className="mt-3 h-3 w-32" />
    </Card>
  );
}

export function KpiCards() {
  const { data, isPending, isError, refetch } = useDashboardSummary();

  if (isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
        {Array.from({ length: 4 }, (_, index) => (
          <KpiSkeleton key={index} />
        ))}
        <span className="sr-only">Loading summary…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <ErrorState what="today’s summary" onRetry={() => void refetch()} />
      </Card>
    );
  }

  const kpis: Kpi[] = [
    {
      label: 'Orders today',
      value: String(data.ordersToday),
      hint: 'Website and app combined',
      icon: ShoppingBag,
    },
    {
      label: 'Paid revenue today',
      value: formatNaira(data.paidRevenueTodayMinor),
      hint: 'Confirmed Paystack payments',
      icon: Banknote,
    },
    {
      label: 'Awaiting processing',
      value: String(data.awaitingProcessing),
      hint: 'Paid, still being prepared',
      icon: Clock,
      highlight: data.awaitingProcessing > 0,
    },
    {
      label: 'Low-stock variants',
      value: String(data.lowStockVariants),
      hint: 'At or below their threshold',
      icon: AlertTriangle,
      highlight: data.lowStockVariants > 0,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiCard key={kpi.label} {...kpi} />
      ))}
    </div>
  );
}
