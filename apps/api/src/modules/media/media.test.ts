import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ApiData,
  ApiErrorBody,
  ApiList,
  CreateUploadResultDto,
  MediaAssetDto,
  MediaUrlDto,
  ProductDto,
  PurgeRetiredResultDto,
} from '@urban-ibile/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  customerToken,
  errorCode,
  resetAdminApiData,
  restoreSettings,
  seededClothingTypeId,
  signInAdmin,
  snapshotSettings,
  type AdminClient,
  type SettingsSnapshot,
} from '../../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  testDatabaseUrl,
} from '../../../test/helpers.js';
import {
  fakeMp4,
  makeMediaTestApp,
  makeProcessor,
  putToUploadUrl,
  stubFfmpeg,
  tinyJpeg,
  tinyPng,
  uploadAndComplete,
  type MediaTestContext,
} from '../../../test/media-fixtures.js';
import { createMediaRepository } from './media.repository.js';

describe.skipIf(!hasTestDatabase)('media pipeline', () => {
  let ctx: MediaTestContext;
  let api: AdminClient;
  let adminToken: string;
  let superToken: string;
  let superApi: AdminClient;
  let settings: SettingsSnapshot;
  const repo = createMediaRepository();

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = await makeMediaTestApp();
    settings = await snapshotSettings(ctx);
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, settings);
    adminToken = (await signInAdmin(ctx)).token;
    api = adminClient(ctx, adminToken);
    superToken = (await signInAdmin(ctx, 'super_admin')).token;
    superApi = adminClient(ctx, superToken);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, settings);
    await ctx.db.destroy();
    await ctx.cleanup();
  });

  async function createUpload(body: Record<string, unknown>) {
    return api.post('/media/uploads', body);
  }

  async function getAsset(id: string): Promise<MediaAssetDto> {
    const res = await api.get(`/media/${id}`);
    expect(res.status).toBe(200);
    return bodyOf<ApiData<MediaAssetDto>>(res).data;
  }

  async function readyVideo(fileName = 'look.mp4'): Promise<string> {
    const id = await uploadAndComplete(ctx, adminToken, {
      fileName,
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });
    expect(await makeProcessor(ctx, stubFfmpeg()).processNext(['video'])).toBe(true);
    return id;
  }

  describe('upload creation (presign)', () => {
    it('rejects unsupported types and files over the size limit from settings', async () => {
      const badType = await createUpload({
        fileName: 'x.gif',
        mimeType: 'image/gif',
        sizeBytes: 10,
      });
      expect(badType.status).toBe(415);
      expect(errorCode(badType)).toBe('UNSUPPORTED_MEDIA_TYPE');

      await ctx.db
        .updateTable('app_settings')
        .set({ value: JSON.stringify(1000) })
        .where('setting_key', '=', 'media.max_image_bytes')
        .execute();
      const tooBig = await createUpload({
        fileName: 'big.png',
        mimeType: 'image/png',
        sizeBytes: 1001,
      });
      expect(tooBig.status).toBe(413);
      expect(errorCode(tooBig)).toBe('FILE_TOO_LARGE');
      expect(bodyOf<ApiErrorBody>(tooBig).error.details).toEqual({ maxBytes: 1000 });
    });

    it('creates a pending asset with a random key and a short-lived exact-size URL (audited)', async () => {
      const res = await createUpload({
        fileName: '../Agbada <Look>.mp4',
        mimeType: 'video/mp4',
        sizeBytes: 64,
      });
      expect(res.status).toBe(201);
      const { asset, upload } = bodyOf<ApiData<CreateUploadResultDto>>(res).data;
      expect(asset).toMatchObject({
        status: 'pending',
        kind: 'video',
        originalFilename: 'Agbada _Look_.mp4',
        publicUrl: null,
      });
      expect(upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'video/mp4' } });
      const ttlMs = new Date(upload.expiresAt).getTime() - Date.now();
      expect(ttlMs).toBeGreaterThan(0);
      expect(ttlMs).toBeLessThanOrEqual(900_000);
      const row = await repo.findById(ctx.db, asset.id);
      expect(row?.originalKey).toBe(`media/video/${asset.id}/original.mp4`);
      expect(await auditCount(ctx, { action: 'media.upload_create', entityId: asset.id })).toBe(1);
    });

    it('signed upload URL only accepts the declared type and exact size', async () => {
      const res = await createUpload({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 100 });
      const { upload } = bodyOf<ApiData<CreateUploadResultDto>>(res).data;
      expect((await putToUploadUrl(ctx, upload, Buffer.alloc(100), 'image/jpeg')).status).toBe(403);
      expect((await putToUploadUrl(ctx, upload, Buffer.alloc(99))).status).toBe(403);
      const tampered = { ...upload, url: `${upload.url.slice(0, -4)}AAAA` };
      expect((await putToUploadUrl(ctx, tampered, Buffer.alloc(100))).status).toBe(403);
    });
  });

  describe('completion', () => {
    it('verifies the object, queues it, and is idempotent', async () => {
      const png = await tinyPng();
      const id = await uploadAndComplete(ctx, adminToken, {
        fileName: 'look.png',
        mimeType: 'image/png',
        bytes: png,
      });
      expect((await getAsset(id)).status).toBe('uploaded');

      const again = await api.post(`/media/${id}/complete`);
      expect(again.status).toBe(200);
      expect(bodyOf<ApiData<MediaAssetDto>>(again).data.status).toBe('uploaded');
      expect(await auditCount(ctx, { action: 'media.upload_complete', entityId: id })).toBe(1);
    });

    it('rejects unknown ids, missing objects and expired uploads', async () => {
      expect((await api.post('/media/00000000-0000-4000-8000-000000000000/complete')).status).toBe(
        404,
      );

      const res = await createUpload({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 10 });
      const { asset } = bodyOf<ApiData<CreateUploadResultDto>>(res).data;
      const missing = await api.post(`/media/${asset.id}/complete`);
      expect(missing.status).toBe(409);
      expect(errorCode(missing)).toBe('UPLOAD_NOT_FOUND');

      await ctx.db
        .updateTable('media_assets')
        .set({ upload_expires_at: new Date(Date.now() - 1000) })
        .where('id', '=', asset.id)
        .execute();
      const expired = await api.post(`/media/${asset.id}/complete`);
      expect(expired.status).toBe(410);
      expect(errorCode(expired)).toBe('UPLOAD_EXPIRED');
    });

    it('rejects a size or content mismatch, deletes the object and refuses to complete again', async () => {
      const res = await createUpload({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 500 });
      const { asset } = bodyOf<ApiData<CreateUploadResultDto>>(res).data;
      const row = await repo.findById(ctx.db, asset.id);
      // Simulate an object that bypassed the signed URL (wrong size).
      const tmp = join(ctx.storageDir, 'wrong.png');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(tmp, await tinyPng(10, 10));
      await ctx.storage.uploadFile('public', row?.originalKey ?? '', tmp, 'image/png');

      const mismatch = await api.post(`/media/${asset.id}/complete`);
      expect(mismatch.status).toBe(422);
      expect(errorCode(mismatch)).toBe('UPLOAD_MISMATCH');
      expect(await ctx.storage.headObject('public', row?.originalKey ?? '')).toBeUndefined();
      expect((await getAsset(asset.id)).status).toBe('failed');
      const again = await api.post(`/media/${asset.id}/complete`);
      expect(errorCode(again)).toBe('INVALID_STATE');
      expect(await auditCount(ctx, { action: 'media.upload_rejected', entityId: asset.id })).toBe(
        1,
      );
    });

    it('rejects a file whose bytes do not match the declared type (magic bytes)', async () => {
      const jpeg = await tinyJpeg();
      const res = await createUpload({
        fileName: 'fake.png',
        mimeType: 'image/png',
        sizeBytes: jpeg.length,
      });
      const { asset, upload } = bodyOf<ApiData<CreateUploadResultDto>>(res).data;
      expect((await putToUploadUrl(ctx, upload, jpeg)).status).toBe(200);
      const completed = await api.post(`/media/${asset.id}/complete`);
      expect(completed.status).toBe(422);
      expect(bodyOf<ApiErrorBody>(completed).error.message).toMatch(
        /does not match its declared type/,
      );
    });
  });

  describe('processing worker', () => {
    it('never lets two workers claim the same asset', async () => {
      const ids = await Promise.all(
        [1, 2, 3].map((n) =>
          uploadAndComplete(ctx, adminToken, {
            fileName: `v${n}.mp4`,
            mimeType: 'video/mp4',
            bytes: fakeMp4(),
          }),
        ),
      );
      const claims = await Promise.all(
        Array.from({ length: 8 }, () => repo.claimNext(ctx.db, ['video'])),
      );
      const claimed = claims.filter((row) => row !== undefined).map((row) => row.id);
      expect(claimed.sort()).toEqual([...ids].sort());
      expect(new Set(claimed).size).toBe(ids.length);
      const attempts = await ctx.db
        .selectFrom('media_assets')
        .select('processing_attempts')
        .execute();
      expect(attempts.every((row) => row.processing_attempts === 1)).toBe(true);
    });

    it('processes a video into MP4 renditions (no upscaling), a poster and a muted preview', async () => {
      const ffmpeg = stubFfmpeg();
      const id = await uploadAndComplete(ctx, adminToken, {
        fileName: 'look.mp4',
        mimeType: 'video/mp4',
        bytes: fakeMp4(),
      });
      expect(await makeProcessor(ctx, ffmpeg).processNext(['video'])).toBe(true);

      const asset = await getAsset(id);
      expect(asset).toMatchObject({ status: 'ready', durationMs: 4000, width: 1280, height: 720 });
      expect(asset.renditions.map((r) => `${r.label}.${r.format}`).sort()).toEqual([
        '480p.mp4',
        '720p.mp4',
        'poster.jpg',
        'preview.mp4',
      ]);
      expect(
        asset.renditions.every((r) =>
          r.url?.startsWith('http://127.0.0.1/api/v1/media-local/public/'),
        ),
      ).toBe(true);
      // 1080p was skipped: the source is 720p.
      expect(ffmpeg.calls.some((args) => args.includes('scale=-2:1080'))).toBe(false);
      const preview = ffmpeg.calls.find((args) => args[args.length - 1]?.endsWith('preview.mp4'));
      expect(preview).toContain('-an');
      const served = await request(ctx.app).get(new URL(asset.renditions[0]?.url ?? '').pathname);
      expect(served.status).toBe(200);
    });

    it('processes images into WebP variants with a dominant colour (sharp)', async () => {
      const id = await uploadAndComplete(ctx, adminToken, {
        fileName: 'look.png',
        mimeType: 'image/png',
        bytes: await tinyPng(800, 400),
      });
      expect(await makeProcessor(ctx, stubFfmpeg()).processNext(['image'])).toBe(true);
      const asset = await getAsset(id);
      expect(asset.status).toBe('ready');
      expect(asset.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(asset.renditions.map((r) => [r.label, r.format, r.width])).toEqual([
        ['w320', 'webp', 320],
        ['w640', 'webp', 640],
      ]);
    });

    it('retries a failing job with backoff, then marks it failed with the reason', async () => {
      const failing = makeProcessor(ctx, stubFfmpeg({ fail: true }));
      const id = await uploadAndComplete(ctx, adminToken, {
        fileName: 'broken.mp4',
        mimeType: 'video/mp4',
        bytes: fakeMp4(),
      });
      const dueNow = () =>
        ctx.db
          .updateTable('media_assets')
          .set({ next_attempt_at: new Date() })
          .where('id', '=', id)
          .execute();

      expect(await failing.processNext(['video'])).toBe(true);
      let row = await repo.findById(ctx.db, id);
      expect(row).toMatchObject({ status: 'uploaded', processingAttempts: 1 });
      expect(row?.processingError).toMatch(/simulated encoder crash/);
      // Backed off: not claimable again right away.
      expect(await failing.processNext(['video'])).toBe(false);

      await dueNow();
      await failing.processNext(['video']);
      await dueNow();
      await failing.processNext(['video']);
      row = await repo.findById(ctx.db, id);
      expect(row).toMatchObject({ status: 'failed', processingAttempts: 3 });
    });

    it('requeues a job whose worker died (stale lease)', async () => {
      const id = await uploadAndComplete(ctx, adminToken, {
        fileName: 'v.mp4',
        mimeType: 'video/mp4',
        bytes: fakeMp4(),
      });
      await repo.claimNext(ctx.db, ['video']);
      await ctx.db
        .updateTable('media_assets')
        .set({ processing_started_at: sql`now() - interval '2 hours'` })
        .where('id', '=', id)
        .execute();
      expect(await makeProcessor(ctx, stubFfmpeg()).processNext(['video'])).toBe(true);
      expect((await getAsset(id)).status).toBe('ready');
    });
  });

  describe('replace and purge', () => {
    async function createProduct(): Promise<ProductDto> {
      const res = await api.post('/products', {
        name: 'Indigo Kaftan',
        slug: 'indigo-kaftan',
        clothingTypeId: await seededClothingTypeId(ctx),
        description: 'Hand-dyed.',
        priceMinor: 3_500_000,
      });
      expect(res.status).toBe(201);
      return bodyOf<ApiData<ProductDto>>(res).data;
    }

    it('swaps the product video atomically and keeps the old asset retired (audited)', async () => {
      const product = await createProduct();
      const first = await readyVideo('first.mp4');
      const second = await readyVideo('second.mp4');
      expect((await api.put(`/products/${product.id}/video`, { mediaAssetId: first })).status).toBe(
        200,
      );

      const swapped = await api.put(`/products/${product.id}/video`, { mediaAssetId: second });
      expect(bodyOf<ApiData<ProductDto>>(swapped).data.videoAssetId).toBe(second);
      const old = await getAsset(first);
      expect(old.retiredAt).not.toBeNull();
      expect(old.purgedAt).toBeNull();
      expect(old.renditions.length).toBeGreaterThan(0); // history intact, files still there
      expect(await auditCount(ctx, { action: 'media.retire', entityId: first })).toBe(1);
      expect(await auditCount(ctx, { action: 'product.video_replace', entityId: product.id })).toBe(
        2,
      );
      // A retired asset can never be assigned again.
      const reuse = await api.put(`/products/${product.id}/video`, { mediaAssetId: first });
      expect(errorCode(reuse)).toBe('INVALID_STATE');
    });

    it('does not retire a replaced video that is still used elsewhere (hero)', async () => {
      const product = await createProduct();
      const shared = await readyVideo('shared.mp4');
      const other = await readyVideo('other.mp4');
      await api.put(`/products/${product.id}/video`, { mediaAssetId: shared });
      await api.put('/content-blocks/home.hero/media', { mediaAssetId: shared });
      await api.put(`/products/${product.id}/video`, { mediaAssetId: other });
      expect((await getAsset(shared)).retiredAt).toBeNull();
      await api.put('/content-blocks/home.hero/media', { mediaAssetId: null });
    });

    it('purges only retired, unreferenced media (super admin) and deletes the files', async () => {
      const product = await createProduct();
      const first = await readyVideo('first.mp4');
      const second = await readyVideo('second.mp4');
      await api.put(`/products/${product.id}/video`, { mediaAssetId: first });
      await api.put(`/products/${product.id}/video`, { mediaAssetId: second });

      expect((await api.post(`/media/${first}/purge`)).status).toBe(403); // admin, not super
      const notRetired = await superApi.post(`/media/${second}/purge`);
      expect(errorCode(notRetired)).toBe('INVALID_STATE');

      // Force a reference back onto the retired asset: purge must refuse.
      await ctx.db
        .updateTable('content_blocks')
        .set({ media_asset_id: first })
        .where('block_key', '=', 'home.hero')
        .execute();
      const inUse = await superApi.post(`/media/${first}/purge`);
      expect(inUse.status).toBe(409);
      expect(errorCode(inUse)).toBe('MEDIA_IN_USE');
      const bulkSkipped = bodyOf<ApiData<PurgeRetiredResultDto>>(
        await superApi.post('/media/purge-retired'),
      ).data;
      expect(bulkSkipped).toEqual({ purged: [], skippedInUse: [first] });

      await ctx.db
        .updateTable('content_blocks')
        .set({ media_asset_id: null })
        .where('block_key', '=', 'home.hero')
        .execute();
      const before = await getAsset(first);
      const filePaths = before.renditions.map((r) =>
        join(
          ctx.storageDir,
          'public',
          ...new URL(r.url ?? '').pathname.replace('/api/v1/media-local/public/', '').split('/'),
        ),
      );
      expect(filePaths.every((path) => existsSync(path))).toBe(true);

      const bulk = bodyOf<ApiData<PurgeRetiredResultDto>>(
        await superApi.post('/media/purge-retired'),
      ).data;
      expect(bulk.purged).toEqual([first]);
      expect(filePaths.some((path) => existsSync(path))).toBe(false);
      const purged = await getAsset(first);
      expect(purged.purgedAt).not.toBeNull();
      expect(purged.renditions.every((r) => r.url === null)).toBe(true);
      expect(await auditCount(ctx, { action: 'media.purge', entityId: first })).toBe(1);
    });
  });

  describe('normal admin scope (product-form media, 19 Oct 2026)', () => {
    it('uploads public product media only; private uploads are for super admins', async () => {
      const privateUpload = await createUpload({
        fileName: 'x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
        visibility: 'private',
      });
      expect(privateUpload.status).toBe(403);
      const id = await uploadAndComplete(ctx, adminToken, {
        fileName: 'look.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(),
      });
      expect((await getAsset(id)).visibility).toBe('public');
      expect(await auditCount(ctx, { action: 'media.upload_complete', entityId: id })).toBe(1);
    });

    it('cannot list, read, link, purge or retry private media (evidence stays in returns)', async () => {
      const privateId = await uploadAndComplete(ctx, superToken, {
        fileName: 'evidence.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(),
        visibility: 'private',
      });
      expect((await api.get('/media?visibility=private')).status).toBe(403);
      expect((await api.get(`/media/${privateId}`)).status).toBe(404);
      expect((await api.get(`/media/${privateId}/url`)).status).toBe(403);
      expect((await api.post(`/media/${privateId}/complete`)).status).toBe(404);
      expect((await api.post(`/media/${privateId}/retry`)).status).toBe(404);
      expect((await api.post(`/media/${privateId}/purge`)).status).toBe(403);
      expect((await api.post('/media/purge-retired')).status).toBe(403);
      const picker = await api.get('/media/picker');
      expect(JSON.stringify(bodyOf<ApiList<MediaAssetDto>>(picker).data)).not.toContain(privateId);
      // The library still works for super admins.
      expect((await superApi.get(`/media/${privateId}`)).status).toBe(200);
    });

    it('the picker lists only public, ready, non-retired media', async () => {
      const readyImage = await uploadAndComplete(ctx, adminToken, {
        fileName: 'ready.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(),
      });
      await makeProcessor(ctx, stubFfmpeg()).processNext(['image']);
      const retired = await uploadAndComplete(ctx, adminToken, {
        fileName: 'old.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(),
      });
      await makeProcessor(ctx, stubFfmpeg()).processNext(['image']);
      // Queued, never processed: not ready yet.
      const processing = await uploadAndComplete(ctx, adminToken, {
        fileName: 'queued.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(),
      });
      await ctx.db
        .updateTable('media_assets')
        .set({ retired_at: new Date() })
        .where('id', '=', retired)
        .execute();
      const ids = bodyOf<ApiList<MediaAssetDto>>(
        await api.get('/media/picker?kind=image'),
      ).data.map((a) => a.id);
      expect(ids).toContain(readyImage);
      expect(ids).not.toContain(processing);
      expect(ids).not.toContain(retired);
      expect((await api.get('/media/picker?kind=video')).status).toBe(200);
      expect((await api.get('/media/picker?visibility=private')).status).toBe(400);
    });

    it('retries failed processing (audited) and the retried asset becomes ready', async () => {
      const id = await uploadAndComplete(ctx, adminToken, {
        fileName: 'look.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(),
      });
      // Simulate a processing job that used up its attempts.
      await ctx.db
        .updateTable('media_assets')
        .set({
          processing_status: 'failed',
          processing_attempts: 3,
          processing_error: 'ffmpeg exited with code 1',
        })
        .where('id', '=', id)
        .execute();
      const failed = await getAsset(id);
      expect(failed).toMatchObject({
        status: 'failed',
        processingError: 'ffmpeg exited with code 1',
      });

      const retried = await api.post(`/media/${id}/retry`);
      expect(retried.status).toBe(200);
      expect(bodyOf<ApiData<MediaAssetDto>>(retried).data).toMatchObject({
        status: 'uploaded',
        processingAttempts: 0,
        processingError: null,
      });
      expect(await auditCount(ctx, { action: 'media.processing_retry', entityId: id })).toBe(1);
      expect(await makeProcessor(ctx, stubFfmpeg()).processNext(['image'])).toBe(true);
      expect((await getAsset(id)).status).toBe('ready');
      // Only failed media can be retried.
      const again = await api.post(`/media/${id}/retry`);
      expect(again.status).toBe(409);
    });

    it('an upload rejected at verification cannot be retried (its file was not kept)', async () => {
      const rejected = await ctx.db
        .insertInto('media_assets')
        .values({
          kind: 'image',
          original_key: 'test/rejected.jpg',
          mime_type: 'image/jpeg',
          size_bytes: 10,
          processing_status: 'failed',
          processing_error: 'upload rejected: The file content does not match its declared type.',
          visibility: 'public',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const res = await api.post(`/media/${rejected.id}/retry`);
      expect(res.status).toBe(409);
      expect(bodyOf<ApiErrorBody>(res).error.message).toMatch(/Upload the file again/);
    });
  });

  describe('private media', () => {
    it('never gets a public URL; super admins get a short-lived signed URL', async () => {
      // Private uploads and signed URLs are Media Library (super_admin) features.
      const id = await uploadAndComplete(ctx, superToken, {
        fileName: 'evidence.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(400, 300),
        visibility: 'private',
      });
      await makeProcessor(ctx, stubFfmpeg()).processNext(['image']);
      const asset = bodyOf<ApiData<MediaAssetDto>>(await superApi.get(`/media/${id}`)).data;
      expect(asset).toMatchObject({ visibility: 'private', status: 'ready', publicUrl: null });
      expect(asset.renditions.length).toBeGreaterThan(0);
      expect(asset.renditions.every((r) => r.url === null)).toBe(true);
      const list = bodyOf<ApiList<MediaAssetDto>>(
        await superApi.get('/media?visibility=private'),
      ).data;
      expect(JSON.stringify(list)).not.toContain('/public/');

      const signed = await superApi.get(`/media/${id}/url`);
      const url = bodyOf<ApiData<MediaUrlDto>>(signed).data;
      expect(url.url).toContain('/media-local/private/');
      expect(url.expiresAt).not.toBeNull();
      expect(signed.headers['cache-control']).toBe('no-store');
      const fetched = await request(ctx.app).get(new URL(url.url).pathname);
      expect(fetched.status).toBe(200);
      expect(fetched.headers['cache-control']).toBe('private, no-store');
      // The private object is not reachable through the public route.
      const row = await repo.findById(ctx.db, id);
      expect(
        (await request(ctx.app).get(`/api/v1/media-local/public/${row?.originalKey ?? ''}`)).status,
      ).toBe(404);
      expect((await request(ctx.app).get(`${new URL(url.url).pathname}x`)).status).toBe(404);
    });

    it('serves private media to customers only for their own return evidence', async () => {
      const id = await uploadAndComplete(ctx, superToken, {
        fileName: 'evidence.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(),
        visibility: 'private',
      });
      const token = await customerToken(ctx);
      const res = await request(ctx.app)
        .get(`/api/v1/me/media/${id}/url`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404); // not this customer's evidence
      expect((await request(ctx.app).get(`/api/v1/me/media/${id}/url`)).status).toBe(401);
    });

    it('does not list bucket contents', async () => {
      expect((await request(ctx.app).get('/api/v1/media-local/public/')).status).toBe(404);
      expect((await request(ctx.app).get('/api/v1/media-local/public/media')).status).toBe(404);
    });
  });
});
