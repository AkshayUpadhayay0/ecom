import { basename } from 'node:path';
import { Writable } from 'node:stream';
import pg from 'pg';
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
  stubFfmpeg,
  uploadAndComplete,
  type MediaTestContext,
} from '../../../test/media-fixtures.js';
import { MEDIA_JOBS_CHANNEL } from './media.repository.js';

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
