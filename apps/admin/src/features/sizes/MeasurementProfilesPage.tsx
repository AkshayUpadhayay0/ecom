import { ChevronDown, ListChecks } from 'lucide-react';
import type { MeasurementProfileDto } from '@urban-ibile/shared';
import { useEffect, useId, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/StateViews';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useMeasurementProfiles } from './sizes.queries';

const SKELETON_ROWS = 6;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function ProfileRow({ profile }: { profile: MeasurementProfileDto }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 px-5 py-4 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ChevronDown
          className={cn(
            'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
        <span className="flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{profile.name}</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {profile.code}
            </code>
            {profile.isActive ? null : <Badge tone="neutral">Inactive</Badge>}
          </span>
          {profile.description ? (
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {profile.description}
            </span>
          ) : null}
        </span>
        <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
          {plural(profile.items.length, 'measurement')}
          <span className="block">{plural(profile.productCount, 'product')}</span>
        </span>
      </button>

      {open ? (
        <div id={panelId} className="grid gap-6 px-5 pb-5 pl-12 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Required measurements
            </h3>
            <ul className="mt-2 divide-y rounded-lg border">
              {profile.items.map((item) => (
                <li
                  key={`${item.chartGroup.id}-${item.measurementType.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span>{item.measurementType.label}</span>
                  <span className="text-xs text-muted-foreground">{item.chartGroup.name}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Products using this profile
            </h3>
            {profile.products.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No products use this profile yet.
              </p>
            ) : (
              <ul className="mt-2 divide-y rounded-lg border">
                {profile.products.map((product) => (
                  // Plain text: the admin panel has no product page yet.
                  <li
                    key={product.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span>{product.name}</span>
                    <Badge tone="neutral" className="capitalize">
                      {product.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {profile.productsTruncated ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing {profile.products.length} of {profile.productCount} products.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function MeasurementProfilesPage() {
  const { data, isPending, isError, refetch } = useMeasurementProfiles();

  useEffect(() => {
    document.title = 'Measurement Profiles · Urban Ibile Admin';
  }, []);

  return (
    <section aria-label="Measurement profiles" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A profile says which body measurements Blueprint asks for and which size chart each one is
        checked against. Profiles are read-only here.
      </p>
      <Card className="overflow-hidden">
        {isPending ? (
          <div className="space-y-3 p-5" aria-busy="true">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
            <span className="sr-only">Loading measurement profiles…</span>
          </div>
        ) : isError ? (
          <ErrorState what="measurement profiles" onRetry={() => void refetch()} />
        ) : data.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No measurement profiles"
            description="Profiles are loaded by the developers together with the size charts."
          />
        ) : (
          <ul>
            {data.map((profile) => (
              <ProfileRow key={profile.id} profile={profile} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
