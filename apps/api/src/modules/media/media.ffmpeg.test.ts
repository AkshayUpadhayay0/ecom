import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiData, MediaAssetDto } from '@urban-ibile/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, resetAdminApiData, signInAdmin } from '../../../test/admin-fixtures.js';
import { bodyOf, hasTestDatabase } from '../../../test/helpers.js';
import {
  makeMediaTestApp,
  makeProcessor,
  uploadAndComplete,
  type MediaTestContext,
} from '../../../test/media-fixtures.js';
import { createFfmpegRunner } from './processing/ffmpeg-runner.js';

/** Real FFmpeg end-to-end on a 2-second generated clip; skipped when ffmpeg is not installed. */
const ffmpeg = createFfmpegRunner({
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
});
const ffmpegAvailable = (await ffmpeg.check()).ok;

describe.skipIf(!hasTestDatabase || !ffmpegAvailable)('media pipeline with real ffmpeg', () => {
  let ctx: MediaTestContext;
  let workDir: string;

  beforeAll(async () => {
    ctx = await makeMediaTestApp();
    workDir = await mkdtemp(join(tmpdir(), 'ui-ffmpeg-test-'));
    await resetAdminApiData(ctx);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
    await ctx.cleanup();
    await rm(workDir, { recursive: true, force: true });
  });

  it(
    'encodes renditions, a poster and a preview from a tiny clip',
    { timeout: 60_000 },
    async () => {
      const clip = join(workDir, 'clip.mp4');
      await ffmpeg.run([
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=640x360:rate=24:duration=2',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-shortest',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        clip,
      ]);
      const token = (await signInAdmin(ctx)).token;
      const id = await uploadAndComplete(ctx, token, {
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        bytes: await readFile(clip),
      });
      expect(await makeProcessor(ctx, ffmpeg).processNext(['video'])).toBe(true);

      const res = await adminClient(ctx, token).get(`/media/${id}`);
      const asset = bodyOf<ApiData<MediaAssetDto>>(res).data;
      expect(asset).toMatchObject({ status: 'ready', width: 640, height: 360 });
      expect(asset.durationMs).toBeGreaterThan(1500);
      // 360p source: no 480/720/1080 (never upscaled) -> one rendition at its own size.
      expect(asset.renditions.map((r) => `${r.label}.${r.format}`).sort()).toEqual([
        '360p.mp4',
        'poster.jpg',
        'preview.mp4',
      ]);
      expect(asset.renditions.every((r) => (r.sizeBytes ?? 0) > 0)).toBe(true);
    },
  );
});
