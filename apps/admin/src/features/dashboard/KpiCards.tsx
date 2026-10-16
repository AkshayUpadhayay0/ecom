import {
  AlertTriangle,
  Banknote,
  Clock,
  CreditCard,
  ImageOff,
  PackageX,
  RotateCcw,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { ErrorState } from '@/components/StateViews';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNaira } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDashboardStats } from './dashboard.queries';

interface Kpi {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  to: string;
  highlight?: boolean;
}

function KpiCard({ label, value, hint, icon: Icon, highlight, to }: Kpi) {
  return (
    <Link
      to={to}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      aria-label={`${label}: ${value}. ${hint}`}
    >
      <Card className="relative h-full overflow-hidden p-5 transition-colors group-hover:border-foreground/20">
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
    </Link>
  );
}

const TILE_COUNT = 8;

export function KpiCards() {
  const { data, isPending, isError, refetch } = useDashboardStats();

  if (isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
        {Array.from({ length: TILE_COUNT }, (_, index) => (
          <Card key={index} className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Card>
        ))}
        <span className="sr-only">Loading summary…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <ErrorState what="the dashboard numbers" onRetry={() => void refetch()} />
      </Card>
    );
  }

  const preparing = data.ordersByStatus.being_prepared ?? 0;
  const kpis: Kpi[] = [
    {
      label: 'Paid today',
      value: formatNaira(data.paid.today.revenueMinor),
      hint: `${data.paid.today.orders} paid order${data.paid.today.orders === 1 ? '' : 's'} today`,
      icon: Banknote,
      to: '/orders?paymentStatus=paid',
    },
    {
      label: 'Last 7 days',
      value: formatNaira(data.paid.last7Days.revenueMinor),
      hint: `${data.paid.last7Days.orders} paid orders · 30 days: ${formatNaira(data.paid.last30Days.revenueMinor)}`,
      icon: TrendingUp,
      to: '/orders?paymentStatus=paid',
    },
    {
      label: 'Being prepared',
      value: String(preparing),
      hint: 'Paid, waiting to be sent out',
      icon: Clock,
      to: '/orders?orderStatus=being_prepared',
      highlight: preparing > 0,
    },
    {
      label: 'Orders needing attention',
      value: String(data.ordersNeedingAttention),
      hint: 'Payment received but needs a decision',
      icon: AlertTriangle,
      to: '/orders?needsAttention=true',
      highlight: data.ordersNeedingAttention > 0,
    },
    {
      label: 'Payments to review',
      value: String(data.paymentsNeedingReview),
      hint: 'Mismatches, late or duplicate payments',
      icon: CreditCard,
      to: '/payment-reviews',
      highlight: data.paymentsNeedingReview > 0,
    },
    {
      label: 'Open returns',
      value: String(data.openReturns),
      hint: `${data.returnsAwaitingAction} waiting for an admin`,
      icon: RotateCcw,
      to: '/returns?open=true',
      highlight: data.returnsAwaitingAction > 0,
    },
    {
      label: 'Low / out of stock',
      value: `${data.lowStockVariants} / ${data.outOfStockVariants}`,
      hint: 'Sizes at or below their alert level',
      icon: PackageX,
      to: '/inventory',
      highlight: data.outOfStockVariants > 0,
    },
    {
      label: 'Failed media jobs',
      value: String(data.failedMediaJobs),
      hint: 'Uploads that could not be processed',
      icon: ImageOff,
      to: '/media?status=failed',
      highlight: data.failedMediaJobs > 0,
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
