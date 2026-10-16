import { useQueries } from '@tanstack/react-query';
import { PRODUCT_STATUSES, type ProductDto, type ProductStatus } from '@urban-ibile/shared';
import { ArrowLeft, Film, ImagePlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { MediaPicker } from '@/features/media/MediaPicker';
import { MediaThumb } from '@/features/media/MediaThumb';
import { catalogApi } from '@/lib/api/catalog';
import { formatDateTime, formatNaira } from '@/lib/format';
import { humanise, productStatusDisplay } from '@/lib/status';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { ProductFormDialog } from './ProductFormDialog';
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

function MediaSection({ product }: { product: ProductDto }) {
  const [picker, setPicker] = useState<'video' | 'images' | null>(null);
  const ids = [...(product.videoAssetId ? [product.videoAssetId] : []), ...product.imageAssetIds];
  const assets = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['catalog', 'media-asset', id],
      queryFn: () => catalogApi.mediaAsset(id),
    })),
  });
  const byId = new Map(assets.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])));
  const setVideo = useAdminMutation(
    (mediaId: string) => catalogApi.setProductVideo(product.id, mediaId),
    {
      success: 'Video updated.',
      invalidate: [catalogKeys.product(product.id), catalogKeys.preview(product.slug)],
    },
  );
  const setImages = useAdminMutation(
    (mediaIds: string[]) => catalogApi.setProductImages(product.id, mediaIds),
    {
      success: 'Images updated.',
      invalidate: [catalogKeys.product(product.id), catalogKeys.preview(product.slug)],
    },
  );
  const video = product.videoAssetId ? byId.get(product.videoAssetId) : undefined;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Media</CardTitle>
          <CardDescription>
            The product video (shown first) and images, picked from the media library.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPicker('video')}>
            <Film aria-hidden="true" /> {product.videoAssetId ? 'Replace video' : 'Choose video'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPicker('images')}>
            <ImagePlus aria-hidden="true" /> Choose images
          </Button>
        </div>
      </CardHeader>
      <div className="grid grid-cols-3 gap-3 px-5 pb-5 sm:grid-cols-6">
        {video ? (
          <figure>
            <MediaThumb asset={video} />
            <figcaption className="mt-1 text-xs text-muted-foreground">Video</figcaption>
          </figure>
        ) : (
          <p className="col-span-3 text-sm text-muted-foreground">No video yet.</p>
        )}
        {product.imageAssetIds.map((id, index) => {
          const asset = byId.get(id);
          return asset ? (
            <figure key={id}>
              <MediaThumb asset={asset} />
              <figcaption className="mt-1 text-xs text-muted-foreground">
                Image {index + 1}
              </figcaption>
            </figure>
          ) : null;
        })}
      </div>
      <MediaPicker
        open={picker === 'video'}
        onOpenChange={(open) => !open && setPicker(null)}
        kind="video"
        multiple={false}
        initial={product.videoAssetId ? [product.videoAssetId] : []}
        title="Choose the product video"
        onPick={(selected) => (selected[0] ? setVideo.mutateAsync(selected[0]) : Promise.resolve())}
      />
      <MediaPicker
        open={picker === 'images'}
        onOpenChange={(open) => !open && setPicker(null)}
        kind="image"
        multiple
        initial={product.imageAssetIds}
        title="Choose product images"
        onPick={(selected) => setImages.mutateAsync(selected)}
      />
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
                <MediaSection product={p} />
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
