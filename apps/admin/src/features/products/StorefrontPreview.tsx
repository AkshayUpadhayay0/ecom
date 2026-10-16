import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { EmptyState } from '@/components/StateViews';
import { LoadingBlock } from '@/components/QueryStates';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api/client';
import { catalogApi } from '@/lib/api/catalog';
import { formatNaira } from '@/lib/format';
import { catalogKeys } from './products.queries';

const HTTP_NOT_FOUND = 404;
const AVAILABILITY = {
  in_stock: { label: 'In stock', tone: 'success' },
  low_stock: { label: 'Low stock', tone: 'warning' },
  out_of_stock: { label: 'Out of stock', tone: 'danger' },
} as const;

/**
 * Storefront preview (decision 16 Oct 2026): exactly what the public catalogue API returns for
 * this product. Read-only; there is no storefront app yet.
 */
export function StorefrontPreview({ slug }: { slug: string }) {
  const preview = useQuery({
    queryKey: catalogKeys.preview(slug),
    queryFn: () => catalogApi.storefrontPreview(slug),
    retry: false,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storefront preview</CardTitle>
        <CardDescription>
          What customers get from the public catalogue API (GET /catalog/products/{slug}).
        </CardDescription>
      </CardHeader>
      <div className="px-5 pb-5">
        {preview.isPending ? (
          <LoadingBlock rows={3} label="storefront preview" />
        ) : preview.isError ? (
          preview.error instanceof ApiError && preview.error.status === HTTP_NOT_FOUND ? (
            <EmptyState
              icon={EyeOff}
              title="Not visible in the shop"
              description="Only active products are public. Activate this product to show it to customers."
            />
          ) : (
            <EmptyState
              icon={EyeOff}
              title="Preview unavailable"
              description="The public catalogue could not be reached."
            />
          )
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-success">
              <Eye className="size-4" aria-hidden="true" /> Visible in the shop
            </div>
            <p className="font-display text-xl">{preview.data.name}</p>
            <p className="tabular-nums">{formatNaira(preview.data.priceMinor)}</p>
            <p className="text-muted-foreground">
              {preview.data.videos.length} video(s), {preview.data.images.length} image(s) ·{' '}
              {preview.data.blueprint.required
                ? `Find My Size: ${preview.data.blueprint.profile?.name ?? ''}`
                : 'No Blueprint'}
            </p>
            <ul className="flex flex-wrap gap-2" aria-label="Sizes customers can choose">
              {preview.data.sizes.map((size) => (
                <li key={size.sizeCode}>
                  <Badge tone={AVAILABILITY[size.availability].tone}>
                    {size.label}: {AVAILABILITY[size.availability].label}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
