import { buildPendingMediaApplier } from '../src/modules/catalog/pending-media.module.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ApiData, CreateUploadResultDto } from '@urban-ibile/shared';
import { pino } from 'pino';
import sharp from 'sharp';
import request from 'supertest';
import { expect } from 'vitest';
import { API_BASE_PATH, createApp } from '../src/app.js';
import { createDatabase, type Database } from '../src/db/database.js';
import type { FfmpegRunner, VideoProbe } from '../src/modules/media/processing/ffmpeg-runner.js';
import { createImageProcessor } from '../src/modules/media/processing/image-processor.js';
import {
  createMediaProcessor,
  type MediaProcessor,
  type MediaProcessorDeps,
} from '../src/modules/media/processing/media-processor.js';
import { createMediaRepository } from '../src/modules/media/media.repository.js';
import {
  createLocalStorage,
  type LocalStorage,
} from '../src/modules/media/storage/local-storage.js';
import { createSettingsRepository } from '../src/modules/settings/settings.repository.js';
import { createSettingsService } from '../src/modules/settings/settings.service.js';
import type { Env } from '../src/config/env.js';
import { ADMIN } from './admin-fixtures.js';
import { bodyOf, makeTestEnv, type TestContext } from './helpers.js';

/** Bytes that pass the MP4 magic check ("ftyp" at offset 4, brand isom). */
export function fakeMp4(size = 64): Buffer {
  const buffer = Buffer.alloc(size, 0);
  buffer.write('ftypisom', 4, 'latin1');
  return buffer;
}

export async function tinyPng(width = 800, height = 400): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#b0703a' } })
    .png()
    .toBuffer();
}

export async function tinyJpeg(width = 64, height = 36): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#2a4d69' } })
    .jpeg()
    .toBuffer();
}

export interface MediaTestContext extends TestContext {
  storage: LocalStorage;
  storageDir: string;
  /** Removes the temporary storage folder. */
  cleanup: () => Promise<void>;
}

/** App wired to a LocalMock storage in a temp folder (no keys, no network). */
export async function makeMediaTestApp(overrides: Partial<Record<keyof Env, string>> = {}) {
  const env = makeTestEnv({ RATE_LIMIT_MAX: '100000', ...overrides });
  const logger = pino({ level: 'silent' });
  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: env.DB_POOL_MAX,
    logger,
  });
  const storageDir = await mkdtemp(join(tmpdir(), 'ui-media-test-'));
  const storage = createLocalStorage({
    rootDir: storageDir,
    apiPublicUrl: 'http://127.0.0.1',
    secret: 'test-media-local-secret-0123456789-abcdefgh',
    basePath: API_BASE_PATH,
  });
  const app = createApp({ env, logger, db, storage });
  const ctx: MediaTestContext = {
    app,
    db,
    env,
    storage,
    storageDir,
    cleanup: () => rm(storageDir, { recursive: true, force: true }),
  };
  return ctx;
}

/** Sends the PUT a browser would send to the presigned URL (local mock route). */
export function putToUploadUrl(
  ctx: TestContext,
  upload: CreateUploadResultDto['upload'],
  body: Buffer,
  contentType = upload.headers['Content-Type'] ?? '',
) {
  const path = new URL(upload.url).pathname;
  return request(ctx.app).put(path).set('Content-Type', contentType).send(body);
}

/** Admin creates an upload, uploads the bytes and completes it. */
export async function uploadAndComplete(
  ctx: TestContext,
  token: string,
  input: { fileName: string; mimeType: string; bytes: Buffer; visibility?: 'public' | 'private' },
): Promise<string> {
  const created = await request(ctx.app)
    .post(`${ADMIN}/media/uploads`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      visibility: input.visibility ?? 'public',
    });
  expect(created.status).toBe(201);
  const { asset, upload } = bodyOf<ApiData<CreateUploadResultDto>>(created).data;
  expect((await putToUploadUrl(ctx, upload, input.bytes)).status).toBe(200);
  const completed = await request(ctx.app)
    .post(`${ADMIN}/media/${asset.id}/complete`)
    .set('Authorization', `Bearer ${token}`);
  expect(completed.status).toBe(200);
  return asset.id;
}

const STUB_SOURCE: VideoProbe = { durationMs: 4000, width: 1280, height: 720, hasAudio: true };

/**
 * Stub FFmpeg (unit/integration tests without ffmpeg): `run` writes the output file named by the
 * last argument (a real tiny JPEG for posters), `probe` reports sizes from the file name.
 */
export function stubFfmpeg(
  options: {
    fail?: boolean;
    source?: VideoProbe;
    /** Fails only the encodes whose output file name matches (e.g. a single rendition). */
    failOutput?: RegExp;
    /** Called just before each encode starts, with the output file name (inspect mid-job state). */
    beforeRun?: (output: string) => Promise<void>;
  } = {},
): FfmpegRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  const source = options.source ?? STUB_SOURCE;
  return {
    calls,
    check: () => Promise.resolve({ ok: true, version: 'stub' }),
    probe(path) {
      const match = /(\d+)p\.mp4$/.exec(path);
      if (match?.[1]) {
        const shortSide = Number(match[1]);
        return Promise.resolve({
          ...source,
          width: Math.round((source.width / source.height) * shortSide),
          height: shortSide,
        });
      }
      if (path.endsWith('preview.mp4')) {
        return Promise.resolve({ ...source, width: 854, height: 480, hasAudio: false });
      }
      return Promise.resolve(source);
    },
    async run(args) {
      calls.push([...args]);
      const output = args[args.length - 1] ?? '';
      await options.beforeRun?.(basename(output));
      if (options.fail || options.failOutput?.test(basename(output))) {
        throw new Error('stub ffmpeg: simulated encoder crash');
      }
      await writeFile(output, output.endsWith('.jpg') ? await tinyJpeg() : fakeMp4(256));
    },
  };
}

export function makeProcessor(
  ctx: MediaTestContext,
  ffmpeg: FfmpegRunner,
  db: Database = ctx.db,
  overrides: Partial<MediaProcessorDeps> = {},
): MediaProcessor {
  return createMediaProcessor({
    db,
    repository: createMediaRepository(),
    storage: ctx.storage,
    settings: createSettingsService({ db, repository: createSettingsRepository() }),
    ffmpeg,
    images: createImageProcessor(),
    logger: pino({ level: 'silent' }),
    encode: { preset: 'ultrafast', crf: 30 },
    tempDir: tmpdir(),
    onReady: buildPendingMediaApplier(pino({ level: 'silent' })),
    ...overrides,
  });
}
