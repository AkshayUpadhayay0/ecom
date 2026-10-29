import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { MediaAssetDto, MediaKind, ProductDto } from '@urban-ibile/shared';
import { Film, ImagePlus, Library, RotateCw, Upload, X } from 'lucide-react';
import { useId, useState, type ChangeEvent } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MediaPicker } from '@/features/media/MediaPicker';
import { MediaThumb } from '@/features/media/MediaThumb';
import { catalogApi } from '@/lib/api/catalog';
import {
  IMAGE_TYPES,
  RECOMMENDED_VIDEO,
  assetRefetchInterval,
  checkFile,
  VIDEO_TYPES,
  uploadPublicFile,
} from '@/lib/media-upload';
import { errorMessage } from '@/lib/notify';
import { useMediaLimits } from '@/lib/use-media-limits';

/** One file in the form: being uploaded, failed to upload, or an asset on the server. */
export interface MediaItem {
  key: string;
  fileName: string;
  assetId: string | null;
  /** Upload in progress (before the asset is completed on the server). */
  uploading: boolean;
  /** Upload error (the file never reached processing). */
  uploadError: string | null;
  /** Upload progress in percent while `uploading` (real progress from the browser). */
  progress?: number | null;
}

export interface MediaDraft {
  video: MediaItem | null;
  images: MediaItem[];
}

function savedItem(assetId: string): MediaItem {
  return { key: assetId, fileName: '', assetId, uploading: false, uploadError: null };
}

/** Starts from what the product shows now (a pending replacement wins over the live media). */
export function initialDraft(product: ProductDto | undefined): MediaDraft {
  const video = product?.pendingMedia.videoAssetId ?? product?.videoAssetId ?? null;
  const images = product?.pendingMedia.imageAssetIds ?? product?.imageAssetIds ?? [];
  return { video: video ? savedItem(video) : null, images: images.map(savedItem) };
}

export function draftVideoId(draft: MediaDraft): string | null {
  return draft.video?.assetId ?? null;
}

export function draftImageIds(draft: MediaDraft): string[] {
  return draft.images.flatMap((item) => (item.assetId ? [item.assetId] : []));
}

/** Polls GET /admin/media/:id for every asset in the draft until it is ready or failed. */
export function useDraftAssets(draft: MediaDraft): Map<string, MediaAssetDto> {
  const ids = [draftVideoId(draft), ...draftImageIds(draft)].filter(
    (id): id is string => id !== null,
  );
  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['catalog', 'media-asset', id],
      queryFn: () => catalogApi.mediaAsset(id),
      refetchInterval: assetRefetchInterval,
    })),
  });
  return new Map(queries.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])));
}

interface ItemState {
  label: 'Pending' | 'Processing' | 'Ready' | 'Failed';
  tone: BadgeTone;
  detail: string | null;
}

/** Pending / Processing / Ready / Failed as the admin sees it. */
export function itemState(item: MediaItem, asset: MediaAssetDto | undefined): ItemState {
  if (item.uploadError) return { label: 'Failed', tone: 'danger', detail: item.uploadError };
  if (item.uploading) {
    return {
      label: 'Pending',
      tone: 'neutral',
      detail: item.progress == null ? 'Uploading…' : `Uploading… ${item.progress}%`,
    };
  }
  if (!asset) return { label: 'Pending', tone: 'neutral', detail: null };
  if (asset.status === 'ready') return { label: 'Ready', tone: 'success', detail: null };
  if (asset.status === 'failed') {
    return {
      label: 'Failed',
      tone: 'danger',
      detail: asset.processingError ?? 'Processing failed.',
    };
  }
  if (asset.status === 'processing') return { label: 'Processing', tone: 'warning', detail: null };
  return { label: 'Pending', tone: 'neutral', detail: 'Waiting to be processed' };
}

/** Save is blocked while a file is uploading, failed, or never finished uploading. */
export function draftProblem(draft: MediaDraft, assets: Map<string, MediaAssetDto>): string | null {
  const items = [...(draft.video ? [draft.video] : []), ...draft.images];
  if (items.some((i) => i.uploading)) return 'Wait for the uploads to finish.';
  const failed = items.some(
    (i) => i.uploadError !== null || (i.assetId && assets.get(i.assetId)?.status === 'failed'),
  );
  if (failed) return 'Retry or remove the files that failed before saving.';
  return null;
}

export function UploadButton({
  label,
  accept,
  multiple,
  onFiles,
}: {
  label: string;
  accept: string;
  multiple: boolean;
  onFiles: (files: File[]) => void;
}) {
  const id = useId();
  return (
    <>
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        aria-label={label}
        className="sr-only"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onFiles([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />
      <Button asChild variant="outline" size="sm">
        <label htmlFor={id} className="cursor-pointer">
          <Upload aria-hidden="true" /> {label}
        </label>
      </Button>
    </>
  );
}

function ItemCard({
  item,
  asset,
  caption,
  note,
  onRemove,
}: {
  item: MediaItem;
  asset: MediaAssetDto | undefined;
  caption: string;
  note?: string | null;
  onRemove?: () => void;
}) {
  const client = useQueryClient();
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const state = itemState(item, asset);

  async function retry() {
    if (!item.assetId) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const updated = await catalogApi.retryMedia(item.assetId);
      client.setQueryData(['catalog', 'media-asset', updated.id], updated);
    } catch (err) {
      setRetryError(errorMessage(err));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="space-y-1.5 rounded-lg border p-2 text-xs">
      {asset ? (
        <MediaThumb asset={asset} />
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-md bg-muted">
          <Upload className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <p className="truncate font-medium" title={item.fileName || asset?.originalFilename || ''}>
        {caption}
        {item.fileName || asset?.originalFilename
          ? `: ${item.fileName || asset?.originalFilename}`
          : ''}
      </p>
      <Badge tone={state.tone}>{state.label}</Badge>
      {state.detail ? <p className="text-muted-foreground">{state.detail}</p> : null}
      {note ? <p className="font-medium text-info">{note}</p> : null}
      {retryError ? (
        <p role="alert" className="text-destructive">
          {retryError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {asset?.status === 'failed' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={retrying}
            onClick={() => void retry()}
          >
            <RotateCw aria-hidden="true" /> {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        ) : null}
        {onRemove ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRemove}
            aria-label={`Remove ${caption.toLowerCase()}`}
          >
            <X aria-hidden="true" /> Remove
          </Button>
        ) : null}
      </div>
    </li>
  );
}

let nextKey = 0;
const newKey = () => `upload-${(nextKey += 1)}`;

/**
 * Product images and video inside the product form (19 Oct 2026): upload new files (public, sent
 * straight to storage) or choose existing ready media. Asset ids stay in the form and are saved
 * with the product; files still processing are attached and appear in the shop once ready.
 */
export function ProductMediaFields({
  draft,
  onChange,
  assets,
  product,
}: {
  draft: MediaDraft;
  onChange: (update: (current: MediaDraft) => MediaDraft) => void;
  assets: Map<string, MediaAssetDto>;
  product: ProductDto | undefined;
}) {
  const [picker, setPicker] = useState<MediaKind | null>(null);
  const limits = useMediaLimits();

  function start(kind: MediaKind, file: File) {
    const item: MediaItem = {
      key: newKey(),
      fileName: file.name,
      assetId: null,
      uploading: true,
      uploadError: null,
    };
    const patch = (changes: Partial<MediaItem>) => {
      onChange((current) =>
        kind === 'video'
          ? current.video?.key === item.key
            ? { ...current, video: { ...current.video, ...changes } }
            : current
          : {
              ...current,
              images: current.images.map((i) => (i.key === item.key ? { ...i, ...changes } : i)),
            },
      );
    };
    onChange((current) =>
      kind === 'video'
        ? { ...current, video: item }
        : { ...current, images: [...current.images, item] },
    );
    // Refuse a wrong or too large file at once, with the real limit and a recommendation.
    const problem = checkFile(file, limits).problem;
    if (problem) {
      patch({ uploading: false, uploadError: problem });
      return;
    }
    uploadPublicFile(file, {
      onProgress: (sent, total) =>
        patch({ progress: total > 0 ? Math.round((sent / total) * 100) : null }),
    }).then(
      (asset) => patch({ assetId: asset.id, uploading: false, progress: null }),
      (err: unknown) => patch({ uploading: false, uploadError: errorMessage(err) }),
    );
  }

  // The saved video is live (ready) and the form now holds a different one that is not ready.
  const liveVideo = product?.videoAssetId ?? null;
  const videoId = draftVideoId(draft);
  const replacesLive =
    product !== undefined &&
    liveVideo !== null &&
    videoId !== null &&
    videoId !== liveVideo &&
    assets.get(videoId)?.status !== 'ready';
  const keepsSavedVideo = product !== undefined && liveVideo !== null && videoId === liveVideo;

  return (
    <fieldset className="space-y-4 sm:col-span-2">
      <legend className="text-sm font-medium">Images and video</legend>
      <p className="text-xs text-muted-foreground">
        Files are public product media. They upload straight away; you can save while they are still
        processing. The shop shows each file once it is ready. Recommended video:{' '}
        {RECOMMENDED_VIDEO}
      </p>

      <section aria-label="Product video" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Film className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm">Video</span>
          <UploadButton
            label="Upload new video"
            accept={VIDEO_TYPES}
            multiple={false}
            onFiles={(files) => files[0] && start('video', files[0])}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicker('video')}>
            <Library aria-hidden="true" /> Choose existing video
          </Button>
        </div>
        {draft.video ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ItemCard
              item={draft.video}
              asset={draft.video.assetId ? assets.get(draft.video.assetId) : undefined}
              caption="Video"
              note={replacesLive ? 'Will replace the current video when ready' : null}
              // A saved video can be replaced but not removed (the API has no "clear video").
              {...(!keepsSavedVideo && {
                onRemove: () =>
                  onChange((current) => ({
                    ...current,
                    video: liveVideo ? savedItem(liveVideo) : null,
                  })),
              })}
            />
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No video yet.</p>
        )}
      </section>

      <section aria-label="Product images" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ImagePlus className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm">Images</span>
          <UploadButton
            label="Upload new image"
            accept={IMAGE_TYPES}
            multiple
            onFiles={(files) => {
              for (const file of files) start('image', file);
            }}
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setPicker('image')}>
            <Library aria-hidden="true" /> Choose existing images
          </Button>
        </div>
        {draft.images.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {draft.images.map((item, index) => (
              <ItemCard
                key={item.key}
                item={item}
                asset={item.assetId ? assets.get(item.assetId) : undefined}
                caption={`Image ${index + 1}`}
                onRemove={() =>
                  onChange((current) => ({
                    ...current,
                    images: current.images.filter((i) => i.key !== item.key),
                  }))
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No images yet.</p>
        )}
      </section>

      <MediaPicker
        open={picker === 'video'}
        onOpenChange={(open) => !open && setPicker(null)}
        kind="video"
        multiple={false}
        initial={videoId ? [videoId] : []}
        title="Choose an existing video"
        onPick={(ids) => {
          const [id] = ids;
          if (id) onChange((current) => ({ ...current, video: savedItem(id) }));
          return Promise.resolve();
        }}
      />
      <MediaPicker
        open={picker === 'image'}
        onOpenChange={(open) => !open && setPicker(null)}
        kind="image"
        multiple
        initial={draftImageIds(draft)}
        title="Choose existing images"
        onPick={(ids) => {
          onChange((current) => {
            // Keep uploads in the form; the picked set replaces the previously chosen ones.
            const uploads = current.images.filter((i) => i.assetId === null);
            return { ...current, images: [...ids.map(savedItem), ...uploads] };
          });
          return Promise.resolve();
        }}
      />
    </fieldset>
  );
}
