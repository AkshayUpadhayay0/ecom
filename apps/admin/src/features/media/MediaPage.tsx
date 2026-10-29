import { useQuery } from '@tanstack/react-query';
import { MEDIA_KINDS, MEDIA_STATUSES, type MediaLibraryItemDto } from '@urban-ibile/shared';
import { ImageIcon, RotateCw, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FilterBar, FilterSelect } from '@/components/FilterBar';
import { InfoBanner, PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ListCard, LoadingBlock, QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { SuperAdminOnly } from '@/components/SuperAdminOnly';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { catalogKeys } from '@/features/products/products.queries';
import { catalogApi } from '@/lib/api/catalog';
import { libraryRefetchInterval } from '@/lib/media-upload';
import { formatDateTime } from '@/lib/format';
import { notify } from '@/lib/notify';
import { humanise, mediaStatusDisplay } from '@/lib/status';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { useUrlFilters } from '@/lib/use-url-filters';
import { DeleteMediaDialog, type MediaToDelete } from './DeleteMediaDialog';
import { UploadDialog } from './UploadDialog';
import { MediaThumb } from './MediaThumb';

const FILTERS = ['kind', 'status', 'retired', 'unused'] as const;
const BYTES_PER_MB = 1024 * 1024;

/** "Indigo Kaftan (product video), the homepage hero" or null when unused. */
export function usedByText(item: MediaLibraryItemDto): string | null {
  const places = [
    ...item.usedBy.products.map((p) => `${p.name} (product ${p.as})`),
    ...item.usedBy.contentBlocks.map((b) =>
      b.key === 'home.hero' ? 'the homepage hero' : `the ${b.key} content block`,
    ),
  ];
  if (item.usedBy.pendingReplacements > 0) places.push('a pending product replacement');
  return places.length > 0 ? places.join(', ') : null;
}

function RetryButton({ asset }: { asset: MediaLibraryItemDto }) {
  const retry = useAdminMutation(() => catalogApi.retryMedia(asset.id), {
    success: 'Processing restarted.',
    invalidate: [catalogKeys.all],
  });
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={retry.isPending}
      onClick={() => retry.mutate(undefined, { onError: (err) => notify.error(err) })}
    >
      <RotateCw aria-hidden="true" /> Retry
    </Button>
  );
}

function AssetDialog({
  asset,
  onClose,
}: {
  asset: MediaLibraryItemDto | null;
  onClose: () => void;
}) {
  const stored =
    asset !== null &&
    asset.purgedAt === null &&
    ['uploaded', 'processing', 'ready'].includes(asset.status);
  // Preview link (the library only holds public media, so this is its CDN URL).
  const url = useQuery({
    queryKey: ['catalog', 'media-url', asset?.id],
    queryFn: () => catalogApi.mediaUrl(asset?.id ?? ''),
    enabled: stored,
    staleTime: 0,
  });
  const [purging, setPurging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const purge = useAdminMutation(() => catalogApi.purge(asset?.id ?? ''), {
    success: 'Stored files deleted.',
    invalidate: [catalogKeys.all],
  });

  return (
    <Dialog open={asset !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {asset ? (
          <>
            <DialogHeader>
              <DialogTitle className="truncate">{asset.originalFilename ?? asset.id}</DialogTitle>
              <DialogDescription>
                {humanise(asset.kind)} · {asset.mimeType} ·{' '}
                {(asset.sizeBytes / BYTES_PER_MB).toFixed(1)} MB · {asset.visibility}
              </DialogDescription>
            </DialogHeader>
            {stored ? (
              url.isPending ? (
                <LoadingBlock rows={1} label="preview" />
              ) : url.data ? (
                asset.kind === 'video' ? (
                  <video
                    src={url.data.url}
                    controls
                    className="max-h-96 w-full rounded-lg bg-black"
                  >
                    <track kind="captions" />
                  </video>
                ) : (
                  <img
                    src={url.data.url}
                    alt={asset.originalFilename ?? 'Media preview'}
                    className="max-h-96 w-full rounded-lg object-contain"
                  />
                )
              ) : (
                <p className="text-sm text-muted-foreground">Preview unavailable.</p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                No stored file to preview ({mediaStatusDisplay(asset.status).label}).
              </p>
            )}
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge display={mediaStatusDisplay(asset.status)} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Uploaded</dt>
                <dd>{asset.uploadedAt ? formatDateTime(new Date(asset.uploadedAt)) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Size</dt>
                <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Renditions</dt>
                <dd>{asset.renditions.map((r) => r.label).join(', ') || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Used by</dt>
                <dd>{usedByText(asset) ?? 'Unused'}</dd>
              </div>
              {asset.processingError ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Processing error</dt>
                  <dd className="text-destructive">{asset.processingError}</dd>
                </div>
              ) : null}
            </dl>
            {asset.retiredAt === null ? (
              <DialogFooter>
                {asset.status === 'failed' ? <RetryButton asset={asset} /> : null}
                <Button variant="outline" onClick={() => setDeleting(true)}>
                  <Trash2 aria-hidden="true" /> Delete
                </Button>
              </DialogFooter>
            ) : null}
            <DeleteMediaDialog
              media={
                deleting
                  ? { id: asset.id, kind: asset.kind, name: asset.originalFilename ?? asset.id }
                  : null
              }
              onClose={() => setDeleting(false)}
              onDeleted={() => onClose()}
            />
            {asset.retiredAt && !asset.purgedAt ? (
              <DialogFooter>
                <SuperAdminOnly>
                  <Button variant="destructive" onClick={() => setPurging(true)}>
                    <Trash2 aria-hidden="true" /> Delete stored files
                  </Button>
                </SuperAdminOnly>
              </DialogFooter>
            ) : null}
            <ConfirmDialog
              open={purging}
              onOpenChange={setPurging}
              title="Delete the stored files?"
              description="The file and its renditions are removed from storage. The record stays for history. This cannot be undone."
              confirmLabel="Delete files"
              destructive
              onConfirm={async () => {
                await purge.mutateAsync(undefined);
                onClose();
              }}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function MediaPage() {
  const { values, page, setFilter, setPage, clear, active } = useUrlFilters(FILTERS);
  const params = { ...values, page, pageSize: 24 };
  const media = useQuery({
    queryKey: catalogKeys.media(params),
    queryFn: () => catalogApi.media(params),
    // Files still being processed update by themselves (2 s slowing to 10 s); no refresh needed.
    refetchInterval: libraryRefetchInterval,
  });
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<MediaLibraryItemDto | null>(null);
  const [deleting, setDeleting] = useState<MediaToDelete | null>(null);
  const [purgeAll, setPurgeAll] = useState(false);
  const purgeRetired = useAdminMutation(() => catalogApi.purgeRetired(), {
    success: (r) =>
      `Deleted files of ${r.purged.length} retired item(s); ${r.skippedInUse.length} still in use were kept.`,
    invalidate: [catalogKeys.all],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media"
        description="Product and site videos and images. Uploads are processed by the background worker (renditions, posters). Private files such as return evidence are never shown here; they stay with their return request."
        actions={
          <>
            <SuperAdminOnly>
              <Button variant="outline" onClick={() => setPurgeAll(true)}>
                <Trash2 aria-hidden="true" /> Clean up retired
              </Button>
            </SuperAdminOnly>
            <Button onClick={() => setUploading(true)}>
              <Upload aria-hidden="true" /> Upload
            </Button>
          </>
        }
      />
      {values.status === 'failed' ? (
        <InfoBanner tone="warning">
          Showing uploads that could not be processed. Open one to see why, then upload a new file.
        </InfoBanner>
      ) : null}
      <FilterBar active={active} onClear={clear}>
        <FilterSelect
          label="Kind"
          value={values.kind}
          onChange={(v) => setFilter('kind', v)}
          options={MEDIA_KINDS.map((k) => ({ value: k, label: humanise(k) }))}
        />
        <FilterSelect
          label="Status"
          value={values.status}
          onChange={(v) => setFilter('status', v)}
          options={MEDIA_STATUSES.map((s) => ({ value: s, label: mediaStatusDisplay(s).label }))}
        />
        <FilterSelect
          label="Usage"
          value={values.unused}
          onChange={(v) => setFilter('unused', v)}
          options={[{ value: 'true', label: 'Unused' }]}
          allLabel="All"
        />
        <FilterSelect
          label="Retired"
          value={values.retired}
          onChange={(v) => setFilter('retired', v)}
          options={[
            { value: 'false', label: 'In use' },
            { value: 'true', label: 'Retired' },
          ]}
          allLabel="Any"
        />
      </FilterBar>
      <ListCard>
        <QueryView
          query={media}
          what="media"
          isEmpty={(d) => d.data.length === 0}
          empty={{
            icon: ImageIcon,
            title: active ? 'No media match these filters' : 'No media yet',
            description: active ? 'Try other filters.' : 'Upload the first video or image.',
          }}
        >
          {(data) => (
            <ul className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-5">
              {data.data.map((asset) => (
                <li key={asset.id} className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setSelected(asset)}
                    className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                  >
                    <MediaThumb asset={asset} />
                    <span className="mt-2 block truncate text-sm font-medium">
                      {asset.originalFilename ?? asset.id.slice(0, 8)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <StatusBadge display={mediaStatusDisplay(asset.status)} />
                      {asset.retiredAt ? <Badge>Retired</Badge> : null}
                      {asset.isTemporary ? <Badge tone="accent">Temporary</Badge> : null}
                    </span>
                  </button>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Used by: </span>
                    {usedByText(asset) ?? 'Unused'}
                  </p>
                  {asset.retiredAt === null ? (
                    <div className="flex flex-wrap gap-1">
                      {asset.status === 'failed' ? <RetryButton asset={asset} /> : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${asset.originalFilename ?? asset.id}`}
                        onClick={() =>
                          setDeleting({
                            id: asset.id,
                            kind: asset.kind,
                            name: asset.originalFilename ?? asset.id,
                          })
                        }
                      >
                        <Trash2 aria-hidden="true" /> Delete
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </ListCard>
      {media.data ? <Pagination meta={media.data.meta} onPage={setPage} /> : null}
      <UploadDialog open={uploading} onOpenChange={setUploading} />
      <AssetDialog
        asset={
          selected ? (media.data?.data.find((item) => item.id === selected.id) ?? selected) : null
        }
        onClose={() => setSelected(null)}
      />
      <DeleteMediaDialog media={deleting} onClose={() => setDeleting(null)} />
      <ConfirmDialog
        open={purgeAll}
        onOpenChange={setPurgeAll}
        title="Delete files of all retired media?"
        description="Removes stored files of retired media that nothing uses any more. Records stay for history. This cannot be undone."
        confirmLabel="Delete files"
        destructive
        onConfirm={() => purgeRetired.mutateAsync(undefined)}
      />
    </div>
  );
}
