import type { MediaAssetDto, MediaLibraryItemDto } from '@urban-ibile/shared';
import { catalogApi, putToStorageWithProgress } from '@/lib/api/catalog';

export const VIDEO_TYPES = 'video/mp4,video/quicktime,video/webm';
export const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
/** Asset statuses that will still change on their own (keep polling). */
export const STILL_WORKING = new Set(['pending', 'uploaded', 'processing']);

const BYTES_PER_MB = 1024 * 1024;
/** Give up reading a video's length after this long (the upload does not wait for it). */
const DURATION_READ_TIMEOUT_MS = 4_000;

/* ---------------------------- polling with backoff ---------------------------- */

/** First re-check after an upload, then slower the longer the file has been working. */
export const POLL_MIN_MS = 2_000;
export const POLL_MAX_MS = 10_000;
/** The delay grows by 1 ms for every 8 ms the file has been working (2 s at once, 10 s after ~64 s). */
const POLL_GROWTH_DIVISOR = 8;

/** Delay before the next check for a file that has been working for `ageMs`. */
export function pollDelayMs(ageMs: number): number {
  return Math.min(POLL_MAX_MS, POLL_MIN_MS + Math.max(0, ageMs) / POLL_GROWTH_DIVISOR);
}

interface Timed {
  status: string;
  uploadedAt: string | null;
  createdAt: string;
}

function ageOf(asset: Timed, now: number): number {
  return now - new Date(asset.uploadedAt ?? asset.createdAt).getTime();
}

/**
 * TanStack Query `refetchInterval` for ONE asset: re-check while it is pending, uploaded or
 * processing (2 s growing to 10 s), stop when it is ready, failed, retired or gone. Background tabs
 * do not poll (refetchIntervalInBackground stays false); the page refetches when it is shown again.
 */
export function assetRefetchInterval(
  query: { state: { data?: MediaAssetDto | undefined } },
  now = Date.now(),
): number | false {
  const asset = query.state.data;
  if (!asset) return POLL_MIN_MS;
  if (!STILL_WORKING.has(asset.status)) return false;
  return pollDelayMs(ageOf(asset, now));
}

/** The same for a list of assets (the Media library): poll while any item is still working. */
export function libraryRefetchInterval(
  query: { state: { data?: { data: readonly MediaLibraryItemDto[] } | undefined } },
  now = Date.now(),
): number | false {
  const working = (query.state.data?.data ?? []).filter(
    (item) => STILL_WORKING.has(item.status) && item.retiredAt === null,
  );
  if (working.length === 0) return false;
  // The newest upload decides: a file just uploaded is checked quickly even if others are old.
  return pollDelayMs(Math.min(...working.map((item) => ageOf(item, now))));
}

/* --------------------------------- file checks -------------------------------- */

/** What editors are told to upload so files stay small and fast to process. */
export const RECOMMENDED_VIDEO =
  'MP4 (H.264), 1080p or smaller, about 8 to 10 Mbps, 60 seconds or less. A 30 second clip is then about 30 to 40 MB.';
export const RECOMMENDED_IMAGE = 'JPEG or WebP, about 2000 px wide, under 5 MB.';
export const DEFAULT_MAX_VIDEO_BYTES = 500 * BYTES_PER_MB;
export const DEFAULT_MAX_IMAGE_BYTES = 20 * BYTES_PER_MB;
/** A clip longer than this still uploads, but is flagged (it only makes processing slower). */
export const RECOMMENDED_MAX_VIDEO_SECONDS = 60;
/** A file this large is flagged as bigger than needed. */
export const LARGE_VIDEO_BYTES = 150 * BYTES_PER_MB;

export interface MediaLimits {
  maxVideoBytes: number;
  maxImageBytes: number;
}

export const DEFAULT_LIMITS: MediaLimits = {
  maxVideoBytes: DEFAULT_MAX_VIDEO_BYTES,
  maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
};

const ACCEPTED: Record<string, 'video' | 'image'> = {
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
};

const mb = (bytes: number): string =>
  `${(bytes / BYTES_PER_MB).toFixed(bytes >= 10 * BYTES_PER_MB ? 0 : 1)} MB`;

export interface FileCheck {
  /** false = do not upload: `problem` says why in plain words. */
  ok: boolean;
  problem: string | null;
  /** Things worth knowing that do not block the upload. */
  warnings: string[];
}

/** Checks a chosen file before anything is sent, so the editor hears the problem at once. */
export function checkFile(
  file: { name: string; type: string; size: number },
  limits: MediaLimits = DEFAULT_LIMITS,
  durationSeconds: number | null = null,
): FileCheck {
  const kind = ACCEPTED[file.type];
  if (!kind) {
    return {
      ok: false,
      problem: `${file.name} is not a type we accept${file.type ? ` (${file.type})` : ''}. Use an MP4, MOV or WebM video, or a JPEG, PNG or WebP image.`,
      warnings: [],
    };
  }
  const max = kind === 'video' ? limits.maxVideoBytes : limits.maxImageBytes;
  if (file.size > max) {
    return {
      ok: false,
      problem: `This ${kind} is ${mb(file.size)}; the largest we accept is ${mb(max)}. ${
        kind === 'video'
          ? `Export it again at 1080p and about 8 to 10 Mbps. ${RECOMMENDED_VIDEO}`
          : `Export it at about 2000 px wide. ${RECOMMENDED_IMAGE}`
      }`,
      warnings: [],
    };
  }
  if (file.size === 0) return { ok: false, problem: 'This file is empty.', warnings: [] };
  const warnings: string[] = [];
  if (kind === 'video' && file.size > LARGE_VIDEO_BYTES) {
    warnings.push(
      `${mb(file.size)} is bigger than needed. It will upload and work, but it takes longer to upload and to process. ${RECOMMENDED_VIDEO}`,
    );
  }
  if (
    kind === 'video' &&
    durationSeconds !== null &&
    durationSeconds > RECOMMENDED_MAX_VIDEO_SECONDS
  ) {
    warnings.push(
      `This clip is ${Math.round(durationSeconds)} seconds. Product and hero videos work best at ${RECOMMENDED_MAX_VIDEO_SECONDS} seconds or less; longer clips take longer to process.`,
    );
  }
  return { ok: true, problem: null, warnings };
}

/** Video length read in the browser (null if it cannot be read: not a problem, just no warning). */
export function readVideoDuration(file: File): Promise<number | null> {
  if (!file.type.startsWith('video/') || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let finished = false;
    const done = (value: number | null): void => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    window.setTimeout(() => {
      done(null);
    }, DURATION_READ_TIMEOUT_MS);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      done(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      done(null);
    };
    video.src = url;
  });
}

/* ---------------------------------- uploading --------------------------------- */

export type UploadStage = 'preparing' | 'uploading' | 'verifying';

export interface UploadHandlers {
  onStage?: (stage: UploadStage) => void;
  /** Bytes sent so far and in total (real progress from the browser). */
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Uploads one PUBLIC file (product / site media): create the asset, PUT the bytes straight to
 * storage with the presigned URL (the API never proxies files) while reporting real progress, then
 * verify and queue processing.
 */
export async function uploadPublicFile(
  file: File,
  handlers: UploadHandlers = {},
  options: { temporary?: boolean } = {},
): Promise<MediaAssetDto> {
  handlers.onStage?.('preparing');
  const created = await catalogApi.createUpload({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    visibility: 'public',
    isTemporary: options.temporary ?? false,
  });
  handlers.onStage?.('uploading');
  await putToStorageWithProgress(created.upload, file, handlers.onProgress, handlers.signal);
  handlers.onStage?.('verifying');
  return catalogApi.completeUpload(created.asset.id);
}
