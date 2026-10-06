import { ArrowLeft, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import type { NavItem } from '@/layout/nav-items';

export function ComingSoonPage({ item }: { item: NavItem }) {
  const Icon = item.icon;

  useEffect(() => {
    document.title = `${item.label} · Urban Ibile Admin`;
  }, [item.label]);

  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="font-display text-3xl tracking-tight">
        {item.label}
      </h1>
      <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed bg-card px-6 py-20 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft ring-1 ring-accent/40">
          <Icon className="size-6" aria-hidden="true" />
        </span>
        <p className="mt-6 inline-flex items-center gap-1.5 text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          <Sparkles className="size-3.5" aria-hidden="true" />
          Coming soon
        </p>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          {item.label} management is being built and will appear here in an upcoming update.
        </p>
        <Button asChild variant="outline" className="mt-8">
          <Link to="/dashboard">
            <ArrowLeft aria-hidden="true" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </section>
  );
}
