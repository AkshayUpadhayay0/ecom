import { Plus, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { formatLongDate, greetingFor } from '@/lib/format';
import { KpiCards } from './KpiCards';
import { LowStockCard } from './LowStockCard';
import { RecentOrdersCard } from './RecentOrdersCard';

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

export function DashboardPage() {
  const { admin } = useAuth();
  const [now] = useState(() => new Date());

  useEffect(() => {
    document.title = 'Dashboard · Urban Ibile Admin';
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
              {greetingFor(now)}, {admin ? firstName(admin.displayName) : 'there'}
            </h1>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{formatLongDate(now)}</p>
        </div>

        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/orders">
              <ShoppingBag aria-hidden="true" />
              View orders
            </Link>
          </Button>
          <Button asChild>
            <Link to="/products">
              <Plus aria-hidden="true" />
              Add product
            </Link>
          </Button>
        </div>
      </div>

      <section aria-label="Today at a glance">
        <KpiCards />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentOrdersCard />
        <LowStockCard />
      </div>
    </div>
  );
}
