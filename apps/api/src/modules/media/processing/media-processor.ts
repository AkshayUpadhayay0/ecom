import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaKind } from '@urban-ibile/shared';
import { mapLimit } from '../../../lib/map-limit.js';
import type { Logger } from 'pino';
import type { Database } from '../../../db/database.js';
import type { SettingsService } from '../../settings/settings.service.js';
import { bucketOf, renditionKey } from '../media-files.js';
import type {
  MediaRepository,
  MediaRow,
  NewRendition,
  ProcessingResult,
} from '../media.repository.js';
import type { StorageProvider } from '../storage/storage-provider.js';
import type { FfmpegRunner } from './ffmpeg-runner.js';
import type { ImageProcessor } from './image-processor.js';
import {
  planRenditions,
  posterArgs,
  previewArgs,
  renditionArgs,
  type EncodeOptions,
} from './video-plan.js';

const MS_PER_SECOND = 1000;
const BITS_PER_BYTE = 8;
const TEMP_PREFIX = 'ui-media-';

export interface MediaProcessor {
  /**
   * Requeues abandoned jobs, then claims ONE due asset of the given kinds and processes it.
   * Returns false when nothing was waiting.
   */
  processNext(kinds: readonly MediaKind[]): Promise<boolean>;
  /** Processes until the queue is empty (or `max` assets). Returns how many were handled. */
  drain(kinds: readonly MediaKind[], max?: number): Promise<number>;
}

export interface MediaProcessorDeps {
  db: Database;
  repository: MediaRepository;
  storage: StorageProvider;
  settings: SettingsService;
  ffmpeg: FfmpegRunner;
  images: ImageProcessor;
  logger: Logger;
  encode: EncodeOptions;
  /** FFmpeg encodes of one video that may run at the same time (default 1). */
  transcodeParallelism?: number;
  /** Scratch folder; one sub-folder per job, always removed afterwards. */
  tempDir: string;
  /**
   * Runs inside the transaction that marks an asset ready (e.g. apply pending product media
   * replacements). A failure rolls the completion back and the job is retried.
   */
  onReady?: (trx: Database, assetId: string) => Promise<void>;
  /**
   * Called AFTER the transaction that marked an asset ready has committed (never on failure):
   * e.g. tell the website to refresh. Must not throw; its errors are logged and ignored.
   */
  onPublished?: (assetId: string) => void;
}

/** Milliseconds spent in each stage of one job (logged with "media ready"; used to find slow steps). */
export type StageTimings = Record<string, number>;

async function timed<T>(timings: StageTimings, stage: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    timings[stage] = (timings[stage] ?? 0) + (Date.now() - started);
  }
}

/** Exponential backoff: base, 2x base, 4x base, ... */
export function retryDelaySeconds(baseSeconds: number, attempt: number): number {
  return baseSeconds * 2 ** Math.max(0, attempt - 1);
}

export function createMediaProcessor(deps: MediaProcessorDeps): MediaProcessor {
  const { db, repository, storage, settings, ffmpeg, images, logger } = deps;
  const parallelism = Math.max(1, deps.transcodeParallelism ?? 1);

  async function sizeOf(path: string): Promise<number> {
    return (await stat(path)).size;
  }

  async function processVideo(
    row: MediaRow,
    input: string,
    dir: string,
    timings: StageTimings,
  ): Promise<ProcessingResult> {
    const bucket = bucketOf(row.visibility);
    const probe = await timed(timings, 'probe', () => ffmpeg.probe(input));
    const heights = await settings.getDimensionList(db, 'media.video_heights');
    const previewSeconds = await settings.getLimit(db, 'media.preview_seconds');
    const renditions: NewRendition[] = [];

    const store = async (
      path: string,
      label: string,
      format: string,
      contentType: string,
      size: { width: number; height: number },
    ): Promise<number> => {
      const key = renditionKey(row.kind, row.id, row.processingAttempts, label, format);
      await timed(timings, `upload ${label}`, () =>
        storage.uploadFile(bucket, key, path, contentType),
      );
      const bytes = await sizeOf(path);
      renditions.push({
        label,
        format,
        storageKey: key,
        width: size.width,
        height: size.height,
        bitrateKbps:
          probe.durationMs && format === 'mp4'
            ? Math.round((bytes * BITS_PER_BYTE) / probe.durationMs)
            : null,
        sizeBytes: bytes,
      });
      return bytes;
    };

    // Order: the poster first (cheap; it is the first thing a visitor sees), then the grid preview,
    // then the full renditions, smallest first, a few at a time (the machine's transcode limit).
    const posterPath = join(dir, 'poster.jpg');
    await timed(timings, 'encode poster', () => ffmpeg.run(posterArgs(input, posterPath, probe)));
    const poster = await images.inspect(posterPath);
    await store(posterPath, 'poster', 'jpg', 'image/jpeg', poster);

    const previewPath = join(dir, 'preview.mp4');
    await timed(timings, 'encode preview', () =>
      ffmpeg.run(previewArgs(input, previewPath, probe, previewSeconds, deps.encode)),
    );
    await store(previewPath, 'preview', 'mp4', 'video/mp4', await ffmpeg.probe(previewPath));

    // Encoding is CPU-bound, so encodes normally run one after another (each uses every core);
    // the UPLOAD of a finished rendition overlaps with the encode of the next one.
    const targets = [...planRenditions(probe, heights)].sort((x, y) => x.shortSide - y.shortSide);
    const uploads: Promise<number>[] = [];
    try {
      await mapLimit(targets, parallelism, async (target) => {
        const output = join(dir, `${target.label}.mp4`);
        await timed(timings, `encode ${target.label}`, () =>
          ffmpeg.run(renditionArgs(input, output, probe, target, deps.encode)),
        );
        const encoded = await ffmpeg.probe(output);
        uploads.push(store(output, target.label, 'mp4', 'video/mp4', encoded));
      });
    } finally {
      // Never leave an upload running behind a failed job (its temp folder is removed next).
      await Promise.allSettled(uploads);
    }
    await Promise.all(uploads);

    return {
      durationMs: probe.durationMs,
      width: probe.width,
      height: probe.height,
      dominantColor: poster.dominantColor,
      renditions,
    };
  }

  async function processImage(
    row: MediaRow,
    input: string,
    dir: string,
    timings: StageTimings,
  ): Promise<ProcessingResult> {
    const bucket = bucketOf(row.visibility);
    const info = await timed(timings, 'inspect', () => images.inspect(input));
    const widths = await settings.getDimensionList(db, 'media.image_widths');
    const fitting = widths.filter((width) => width <= info.width);
    const renditions: NewRendition[] = [];
    for (const width of fitting.length > 0 ? fitting : [info.width]) {
      const variant = await timed(timings, `encode w${width}`, () =>
        images.toWebp(input, width, join(dir, `w${width}.webp`)),
      );
      const label = `w${variant.width}`;
      const key = renditionKey(row.kind, row.id, row.processingAttempts, label, 'webp');
      await timed(timings, `upload w${width}`, () =>
        storage.uploadFile(bucket, key, variant.path, 'image/webp'),
      );
      renditions.push({
        label,
        format: 'webp',
        storageKey: key,
        width: variant.width,
        height: variant.height,
        bitrateKbps: null,
        sizeBytes: await sizeOf(variant.path),
      });
    }
    return {
      durationMs: null,
      width: info.width,
      height: info.height,
      dominantColor: info.dominantColor,
      renditions,
    };
  }

  async function handleFailure(row: MediaRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const maxAttempts = await settings.getLimit(db, 'media.processing_max_attempts');
    if (row.processingAttempts >= maxAttempts) {
      await repository.failProcessing(db, row.id, message);
      logger.error(
        { mediaAssetId: row.id, attempt: row.processingAttempts, err },
        'media processing failed permanently',
      );
      return;
    }
    const base = await settings.getLimit(db, 'media.processing_backoff_seconds');
    const delay = retryDelaySeconds(base, row.processingAttempts);
    await repository.scheduleRetry(
      db,
      row.id,
      message,
      new Date(Date.now() + delay * MS_PER_SECOND),
    );
    logger.warn(
      { mediaAssetId: row.id, attempt: row.processingAttempts, retryInSeconds: delay, err },
      'media processing failed; will retry',
    );
  }

  async function processNext(kinds: readonly MediaKind[]): Promise<boolean> {
    const lease = await settings.getLimit(db, 'media.processing_lease_seconds');
    const maxAttempts = await settings.getLimit(db, 'media.processing_max_attempts');
    const recovered = await repository.recoverStale(db, lease, maxAttempts);
    if (recovered > 0) logger.warn({ recovered }, 'requeued abandoned media jobs');

    const row = await repository.claimNext(db, kinds);
    if (!row) return false;

    const dir = await mkdtemp(join(deps.tempDir, TEMP_PREFIX));
    const startedAt = Date.now();
    const timings: StageTimings = {};
    try {
      const input = join(dir, 'original');
      await timed(timings, 'download original', () =>
        storage.downloadToFile(bucketOf(row.visibility), row.originalKey, input),
      );
      const result =
        row.kind === 'video'
          ? await processVideo(row, input, dir, timings)
          : await processImage(row, input, dir, timings);
      await timed(timings, 'mark ready', () =>
        db.transaction().execute(async (trx) => {
          await repository.completeProcessing(trx, row.id, result);
          await deps.onReady?.(trx, row.id);
        }),
      );
      try {
        deps.onPublished?.(row.id);
      } catch (err) {
        logger.warn({ err, mediaAssetId: row.id }, 'media ready hook failed');
      }
      logger.info(
        {
          mediaAssetId: row.id,
          kind: row.kind,
          renditions: result.renditions.length,
          ms: Date.now() - startedAt,
          stagesMs: timings,
        },
        'media ready',
      );
    } catch (err) {
      await handleFailure(row, err);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return true;
  }

  return {
    processNext,
    async drain(kinds, max = Number.POSITIVE_INFINITY) {
      let handled = 0;
      while (handled < max && (await processNext(kinds))) handled += 1;
      return handled;
    },
  };
}
