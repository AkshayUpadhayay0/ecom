import { basename } from 'node:path';
import { Writable } from 'node:stream';
import pg from 'pg';
import request from 'supertest';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  resetAdminApiData,
  restoreSettings,
  signInAdmin,
  snapshotSettings,
  type SettingsSnapshot,
} from '../../../test/admin-fixtures.js';
import { assertSafeTestDatabase, hasTestDatabase, testDatabaseUrl } from '../../../test/helpers.js';
import {
  fakeMp4,
  makeMediaTestApp,
  makeProcessor,
  putToUploadUrl,
  stubFfmpeg,
  uploadAndComplete,
  type MediaTestContext,
} from '../../../test/media-fixtures.js';
import { MEDIA_JOBS_CHANNEL } from './media.repository.js';
import { loadUsableMedia } from './public-media.repository.js';

const FULL_HD = { durationMs: 30_000, width: 1920, height: 1080, hasAudio: true };
const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The output file an ffmpeg call writes: its last argument. */
const outputOf = (args: readonly string[]): string => basename(args[args.length - 1] ?? '');

describe.skipIf(!hasTestDatabase)('media pipeline: order, parallelism, wake-up', () => {
  let ctx: MediaTestContext;
  let adminToken: string;
  let settings: SettingsSnapshot;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = await makeMediaTestApp();
    settings = await snapshotSettings(ctx);
  });
  beforeEach(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, settings);
    adminToken = (await signInAdmin(ctx)).token;
  });
  afterAll(async () => {
    await ctx.db.destroy();
    await ctx.cleanup();
  });

  it('encodes the poster first, then the preview, then the renditions smallest first', async () => {
    const ffmpeg = stubFfmpeg({ source: FULL_HD });
    await uploadAndComplete(ctx, adminToken, {
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    await makeProcessor(ctx, ffmpeg).processNext(['video']); // transcodeParallelism defaults to 1
    expect(ffmpeg.calls.map(outputOf)).toEqual([
      'poster.jpg',
      'preview.mp4',
      '480p.mp4',
      '720p.mp4',
      '1080p.mp4',
    ]);
  });

  it('is playable BEFORE every size is complete, then ready; the shop lists only the sizes that exist', async () => {
    const stages: string[] = [];
    const seen: { stage: string; status: string; playable: boolean; labels: string[] }[] = [];
    let assetId = '';
    const snapshot = async (stage: string): Promise<void> => {
      // The playable step runs beside the next encode (it never delays it): wait for it to land.
      for (let i = 0; i < 100 && stage === 'before 720p'; i += 1) {
        const row = await ctx.db
          .selectFrom('media_assets')
          .select('playable_at')
          .where('id', '=', assetId)
          .executeTakeFirstOrThrow();
        if (row.playable_at !== null) break;
        await settle(20);
      }
      const row = await ctx.db
        .selectFrom('media_assets')
        .select(['processing_status', 'playable_at'])
        .where('id', '=', assetId)
        .executeTakeFirstOrThrow();
      const usable = (await loadUsableMedia(ctx.db, [assetId])).get(assetId);
      seen.push({
        stage,
        status: row.processing_status,
        playable: row.playable_at !== null,
        labels: (usable?.renditions ?? []).map((r) => r.label).sort(),
      });
    };
    const ffmpeg = stubFfmpeg({
      source: FULL_HD,
      beforeRun: async (output) => {
        if (output === '720p.mp4') await snapshot('before 720p'); // 480p is stored by now
        if (output === '1080p.mp4') await snapshot('before 1080p');
      },
    });
    assetId = await uploadAndComplete(ctx, adminToken, {
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    await makeProcessor(ctx, ffmpeg, ctx.db, {
      onPublished: (_id, stage) => stages.push(stage),
    }).processNext(['video']);

    // Not 'ready' yet (that still means all sizes), but already shown, with what exists.
    expect(seen[0]).toEqual({
      stage: 'before 720p',
      status: 'processing',
      playable: true,
      labels: ['480p', 'poster', 'preview'].sort(),
    });
    // 720p may still be uploading (it overlaps the next encode): never fewer than before.
    expect(seen[1]?.labels).toEqual(expect.arrayContaining(['480p', 'poster', 'preview']));
    const final = (await loadUsableMedia(ctx.db, [assetId])).get(assetId);
    expect((final?.renditions ?? []).map((r) => r.label).sort()).toEqual(
      ['1080p', '480p', '720p', 'poster', 'preview'].sort(),
    );
    const row = await ctx.db
      .selectFrom('media_assets')
      .select('processing_status')
      .where('id', '=', assetId)
      .executeTakeFirstOrThrow();
    expect(row.processing_status).toBe('ready');
    // The website is told twice: when it becomes playable and when every size is complete.
    expect(stages).toEqual(['playable', 'ready']);
  });

  it('is NOT shown before the poster, preview and smallest size exist', async () => {
    const ffmpeg = stubFfmpeg({ source: FULL_HD, failOutput: /^480p\.mp4$/ });
    const id = await uploadAndComplete(ctx, adminToken, {
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    const stages: string[] = [];
    await makeProcessor(ctx, ffmpeg, ctx.db, {
      onPublished: (_id, stage) => stages.push(stage),
    }).processNext(['video']);
    expect((await loadUsableMedia(ctx.db, [id])).size).toBe(0);
    expect(stages).toEqual([]);
  });

  it('a later size failing keeps the video playable with what exists and shows a warning', async () => {
    const ffmpeg = stubFfmpeg({ source: FULL_HD, failOutput: /^1080p\.mp4$/ });
    const id = await uploadAndComplete(ctx, adminToken, {
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    // Last attempt: the claim makes it attempt 3 of 3, so the failure is final.
    await ctx.db
      .updateTable('media_assets')
      .set({ processing_attempts: 2 })
      .where('id', '=', id)
      .execute();
    const stages: string[] = [];
    await makeProcessor(ctx, ffmpeg, ctx.db, {
      onPublished: (_id, stage) => stages.push(stage),
    }).processNext(['video']);

    const asset = (
      await request(ctx.app)
        .get(`/api/v1/admin/media/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
    ).body as {
      data: { status: string; playableAt: string | null; processingError: string | null };
    };
    expect(asset.data.status).toBe('failed'); // not 'ready': the full set was never completed
    expect(asset.data.playableAt).not.toBeNull();
    expect(asset.data.processingError).toContain('still plays with the sizes that exist');
    const usable = (await loadUsableMedia(ctx.db, [id])).get(id);
    expect((usable?.renditions ?? []).map((r) => r.label).sort()).toEqual(
      ['480p', '720p', 'poster', 'preview'].sort(),
    );
    expect(stages).toEqual(['playable']); // never announced as ready
  });

  it('refuses a video longer than the cap with a friendly reason, without retrying or encoding', async () => {
    const ffmpeg = stubFfmpeg({ source: { ...FULL_HD, durationMs: 150_000 } });
    const id = await uploadAndComplete(ctx, adminToken, {
      fileName: 'long.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    await makeProcessor(ctx, ffmpeg).processNext(['video']);

    const row = await ctx.db
      .selectFrom('media_assets')
      .select(['processing_status', 'processing_error', 'processing_attempts', 'playable_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.processing_status).toBe('failed'); // at once: retrying cannot help
    expect(row.processing_attempts).toBe(1);
    expect(row.processing_error).toBe(
      'This video is 2:30 long; the longest allowed is 2:00. Trim it or upload a shorter clip.',
    );
    expect(row.playable_at).toBeNull();
    expect(ffmpeg.calls).toEqual([]); // nothing was encoded
  });

  it('the length cap is a setting: raising it lets the same video through', async () => {
    await ctx.db
      .updateTable('app_settings')
      .set({ value: JSON.stringify(300) })
      .where('setting_key', '=', 'media.max_video_seconds')
      .execute();
    const id = await uploadAndComplete(ctx, adminToken, {
      fileName: 'long.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    await makeProcessor(
      ctx,
      stubFfmpeg({ source: { ...FULL_HD, durationMs: 150_000 } }),
    ).processNext(['video']);
    const row = await ctx.db
      .selectFrom('media_assets')
      .select('processing_status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.processing_status).toBe('ready');
  });

  it('the size cap is enforced again when the upload is completed (it may have been lowered)', async () => {
    const bytes = fakeMp4(4096);
    const created = await request(ctx.app)
      .post('/api/v1/admin/media/uploads')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fileName: 'a.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    expect(created.status).toBe(201);
    const { asset, upload } = (
      created.body as {
        data: { asset: { id: string }; upload: Parameters<typeof putToUploadUrl>[1] };
      }
    ).data;
    expect((await putToUploadUrl(ctx, upload, bytes)).status).toBe(200);
    await ctx.db
      .updateTable('app_settings')
      .set({ value: JSON.stringify(1000) })
      .where('setting_key', '=', 'media.max_video_bytes')
      .execute();
    const completed = await request(ctx.app)
      .post(`/api/v1/admin/media/${asset.id}/complete`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(completed.status).toBe(413);
    expect((completed.body as { error: { code: string } }).error.code).toBe('FILE_TOO_LARGE');
  });

  it('announces a published asset when it is playable and when it is ready, and never for a failure', async () => {
    const published: string[] = [];
    const ffmpeg = stubFfmpeg({ source: FULL_HD });
    await uploadAndComplete(ctx, adminToken, {
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    const processor = makeProcessor(ctx, ffmpeg, ctx.db, {
      onPublished: (id) => published.push(id),
    });
    await processor.processNext(['video']);
    expect(published).toHaveLength(2); // playable, then ready (same asset)
    expect(new Set(published).size).toBe(1);
    const row = await ctx.db
      .selectFrom('media_assets')
      .select('processing_status')
      .where('id', '=', published[0] ?? '')
      .executeTakeFirstOrThrow();
    expect(row.processing_status).toBe('ready');

    const broken = stubFfmpeg({ source: FULL_HD, fail: true });
    await uploadAndComplete(ctx, adminToken, {
      fileName: 'b.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    await makeProcessor(ctx, broken, ctx.db, { onPublished: (id) => published.push(id) })
      .processNext(['video'])
      .catch(() => undefined);
    expect(published).toHaveLength(2);
  });

  it('runs at most MEDIA_TRANSCODE_PARALLELISM encodes at once, and only renditions overlap', async () => {
    const inner = stubFfmpeg({ source: FULL_HD });
    let running = 0;
    const peaks = new Map<string, number>();
    const slow = {
      ...inner,
      async run(args: readonly string[]) {
        running += 1;
        peaks.set(outputOf(args), running);
        await settle(25);
        await inner.run(args);
        running -= 1;
      },
    };
    await uploadAndComplete(ctx, adminToken, {
      fileName: 'b.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    await makeProcessor(ctx, slow, ctx.db, { transcodeParallelism: 2 }).processNext(['video']);
    expect(peaks.get('poster.jpg')).toBe(1);
    expect(peaks.get('preview.mp4')).toBe(1);
    expect(Math.max(...peaks.values())).toBe(2); // two renditions overlapped, never three
    expect(peaks.get('1080p.mp4')).toBeLessThanOrEqual(2);
  });

  it('logs how long each stage took, so a slow step can be found', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    await uploadAndComplete(ctx, adminToken, {
      fileName: 'c.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    await makeProcessor(ctx, stubFfmpeg({ source: FULL_HD }), ctx.db, {
      logger: pino({ level: 'info' }, sink),
    }).processNext(['video']);
    const ready = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.msg === 'media ready');
    const stages = Object.keys(ready?.stagesMs ?? {});
    expect(stages).toEqual(
      expect.arrayContaining([
        'download original',
        'probe',
        'encode poster',
        'encode preview',
        'encode 480p',
        'encode 1080p',
        'mark ready',
      ]),
    );
  });

  it('wakes a LISTENing worker the moment an upload is completed (Postgres NOTIFY, after commit)', async () => {
    const listener = new pg.Client({ connectionString: ctx.env.DATABASE_URL });
    await listener.connect();
    const received: string[] = [];
    listener.on('notification', (m) => {
      if (m.channel === MEDIA_JOBS_CHANNEL && m.payload) received.push(m.payload);
    });
    await listener.query(`LISTEN ${MEDIA_JOBS_CHANNEL}`);
    try {
      const id = await uploadAndComplete(ctx, adminToken, {
        fileName: 'd.mp4',
        mimeType: 'video/mp4',
        bytes: fakeMp4(),
      });
      await settle(300);
      expect(received).toEqual([id]);
    } finally {
      await listener.end();
    }
  });
});
