import { PRODUCT_STATUSES, type ProductDto, type ProductStatus } from '@urban-ibile/shared';
import { ArrowLeft, ImagePlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Badge } from '@/components/ui/badge';
import { MediaThumb } from '@/features/media/MediaThumb';
import { catalogApi } from '@/lib/api/catalog';
import { formatDateTime, formatNaira } from '@/lib/format';
import { humanise, productStatusDisplay } from '@/lib/status';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { ProductFormDialog } from './ProductFormDialog';
import { itemState, useDraftAssets } from './ProductMediaFields';
import { catalogKeys, useProduct } from './products.queries';
import { StorefrontPreview } from './StorefrontPreview';
import { VariantsPanel } from './VariantsPanel';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function MediaSection({ product, onEdit }: { product: ProductDto; onEdit: () => void }) {
  const live = {
    video: product.videoAssetId ? [product.videoAssetId] : [],
    images: product.imageAssetIds,
  };
  const pendingVideo = product.pendingMedia.videoAssetId;
  const pendingImages = product.pendingMedia.imageAssetIds;
  const draft = {
    video: null,
    images: [
      ...live.video,
      ...live.images,
      ...(pendingVideo ? [pendingVideo] : []),
      ...(pendingImages ?? []),
    ].map((id) => ({ key: id, fileName: '', assetId: id, uploading: false, uploadError: null })),
  };
  const assets = useDraftAssets(draft);

  function tile(id: string, caption: string) {
    const asset = assets.get(id);
    const state = itemState(
      { key: id, fileName: '', assetId: id, uploading: false, uploadError: null },
      asset,
    );
    return (
      <figure key={`${caption}-${id}`} className="space-y-1">
        {asset ? (
          <MediaThumb asset={asset} />
        ) : (
          <div className="aspect-square rounded-md bg-muted" />
        )}
        <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
        <Badge tone={state.tone}>{state.label}</Badge>
      </figure>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Media</CardTitle>
          <CardDescription>
            The product video (shown first) and images. The shop shows each file once it is ready.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <ImagePlus aria-hidden="true" /> Edit images and video
        </Button>
      </CardHeader>
      <div className="space-y-4 px-5 pb-5">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {live.video.length === 0 && live.images.length === 0 ? (
            <p className="col-span-3 text-sm text-muted-foreground">No media yet.</p>
          ) : null}
          {live.video.map((id) => tile(id, 'Video'))}
          {live.images.map((id, index) => tile(id, `Image ${index + 1}`))}
        </div>
        {pendingVideo || pendingImages ? (
          <div className="rounded-lg border border-info/25 bg-info-soft p-3">
            <p className="text-sm font-medium">
              {pendingVideo
                ? 'Will replace the current video when ready'
                : 'Will replace the current images when ready'}
            </p>
            <p className="text-xs text-muted-foreground">
              The current media stays in the shop until processing finishes. If processing fails,
              nothing changes; open “Edit images and video” to retry.
            </p>
            <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {pendingVideo ? tile(pendingVideo, 'New video') : null}
              {(pendingImages ?? []).map((id, index) => tile(id, `New image ${index + 1}`))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const product = useProduct(id);
  const [editing, setEditing] = useState(false);
  const [nextStatus, setNextStatus] = useState<ProductStatus | null>(null);
  const changeStatus = useAdminMutation(
    (status: ProductStatus) => catalogApi.changeProductStatus(id, { status }),
    {
      success: (p) => `Product is now ${humanise(p.status).toLowerCase()}.`,
      invalidate: [catalogKeys.all],
    },
  );

  return (
    <div className="space-y-6">
      <Link
        to="/products"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> All products
      </Link>
      <QueryView query={product} what="product">
        {(p) => (
          <>
            <PageHeader
              title={p.name}
              eyebrow={<StatusBadge display={productStatusDisplay(p.status)} />}
              actions={
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <NativeSelect
                      aria-label="Change status"
                      value={p.status}
                      onChange={(e) => setNextStatus(e.target.value as ProductStatus)}
                      className="w-36"
                    >
                      {PRODUCT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {humanise(s)}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Pencil aria-hidden="true" /> Edit details
                  </Button>
                </>
              }
            />
            <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <Card className="p-5">
                  <dl className="grid gap-4 sm:grid-cols-3">
                    <Detail label="Price">{formatNaira(p.priceMinor)}</Detail>
                    <Detail label="Clothing type">
                      {p.clothingType.name ?? p.clothingType.slug}
                    </Detail>
                    <Detail label="Blueprint profile">
                      {p.measurementProfile?.name ?? 'None'}
                    </Detail>
                    <Detail label="Slug">
                      <span className="font-mono text-xs">{p.slug}</span>
                    </Detail>
                    <Detail label="Display order">{p.displayOrder}</Detail>
                    <Detail label="Updated">{formatDateTime(new Date(p.updatedAt))}</Detail>
                    <div className="sm:col-span-3">
                      <Detail label="Description">
                        <span className="whitespace-pre-line">{p.description ?? '—'}</span>
                      </Detail>
                    </div>
                    {p.searchKeywords ? (
                      <div className="sm:col-span-3">
                        <Detail label="Search keywords">{p.searchKeywords}</Detail>
                      </div>
                    ) : null}
                  </dl>
                </Card>
                <VariantsPanel productId={p.id} />
                <MediaSection product={p} onEdit={() => setEditing(true)} />
              </div>
              <StorefrontPreview slug={p.slug} />
            </div>
            <ProductFormDialog open={editing} onOpenChange={setEditing} product={p} />
            <ConfirmDialog
              open={nextStatus !== null}
              onOpenChange={(open) => !open && setNextStatus(null)}
              title={`Change status to ${humanise(nextStatus ?? '')}?`}
              description={
                nextStatus === 'active'
                  ? 'The product becomes visible in the shop.'
                  : nextStatus === 'archived'
                    ? 'Archived products are hidden and kept for order history (products are never deleted).'
                    : 'The product will not be visible in the shop.'
              }
              confirmLabel="Change status"
              destructive={nextStatus === 'archived'}
              onConfirm={() => changeStatus.mutateAsync(nextStatus ?? p.status)}
            />
          </>
        )}
      </QueryView>
    </div>
  );
}
