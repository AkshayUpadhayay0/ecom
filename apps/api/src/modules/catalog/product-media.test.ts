import { randomUUID } from 'node:crypto';
import type {
  ApiData,
  ApiList,
  MediaAssetDto,
  ProductDto,
  PublicProductCardDto,
  PublicProductDetailDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  errorCode,
  resetAdminApiData,
  seededClothingTypeId,
  seededSizeId,
  signInAdmin,
  type AdminClient,
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
  stubFfmpeg,
  tinyJpeg,
  uploadAndComplete,
  type MediaTestContext,
} from '../../../test/media-fixtures.js';

const CATALOG = '/api/v1/catalog';

/**
 * Product-form media (decision 19 Oct 2026), run as a NORMAL admin (the client's staff):
 * upload inside the form, attach while processing, pending replacement of live media swapped in
 * atomically by the worker, failed processing keeps the old media and can be retried, and the
 * public catalogue only ever shows ready media (image fallback while a video processes).
 */
describe.skipIf(!hasTestDatabase)('product-form media', () => {
  let ctx: MediaTestContext;
  let api: AdminClient;
  let token: string;
  let shirtId: string;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = await makeMediaTestApp();
    shirtId = await seededClothingTypeId(ctx, 'shirt');
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    token = (await signInAdmin(ctx, 'admin')).token;
    api = adminClient(ctx, token);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
    await ctx.cleanup();
  });

  /** Runs the media worker until the queue is empty (applies pending replacements too). */
  async function drain(): Promise<void> {
    const processor = makeProcessor(ctx, stubFfmpeg());
    while (await processor.processNext(['video', 'image'])) {
      // keep processing
    }
  }

  const queuedVideo = () =>
    uploadAndComplete(ctx, token, {
      fileName: 'look.mp4',
      mimeType: 'video/mp4',
      bytes: fakeMp4(),
    });

  async function queuedImage(): Promise<string> {
    return uploadAndComplete(ctx, token, {
      fileName: 'look.jpg',
      mimeType: 'image/jpeg',
      bytes: await tinyJpeg(),
    });
  }

  async function ready(id: Promise<string>): Promise<string> {
    const assetId = await id;
    await drain();
    return assetId;
  }

  async function createProduct(media: { videoAssetId?: string; imageAssetIds?: string[] }) {
    const res = await api.post('/products', {
      name: 'Adire Kaftan',
      slug: `t-kaftan-${randomUUID().slice(0, 8)}`,
      clothingTypeId: shirtId,
      description: 'Hand-dyed.',
      priceMinor: 2_500_000,
      status: 'active',
      ...media,
    });
    return res;
  }

  async function sellable(productId: string): Promise<void> {
    await ctx.db
      .insertInto('product_variants')
      .values({
        product_id: productId,
        size_id: await seededSizeId(ctx, 'M'),
        sku: `SKU-${randomUUID().slice(0, 10)}`,
        stock_on_hand: 5,
      })
      .execute();
  }

  async function product(id: string): Promise<ProductDto> {
    return bodyOf<ApiData<ProductDto>>(await api.get(`/products/${id}`)).data;
  }

  async function isRetired(assetId: string): Promise<boolean> {
    const row = await ctx.db
      .selectFrom('media_assets')
      .select('retired_at')
      .where('id', '=', assetId)
      .executeTakeFirstOrThrow();
    return row.retired_at !== null;
  }

  async function card(productId: string): Promise<PublicProductCardDto | undefined> {
    const res = await request(ctx.app).get(`${CATALOG}/products?pageSize=50`);
    return bodyOf<ApiList<PublicProductCardDto>>(res).data.find((c) => c.id === productId);
  }

  it('creates a NEW product with media still processing in one transaction; the catalogue shows only ready media', async () => {
    const image = await ready(queuedImage());
    const video = await queuedVideo(); // queued last: stays unprocessed until drain()
    const res = await createProduct({ videoAssetId: video, imageAssetIds: [image] });
    expect(res.status).toBe(201);
    const created = bodyOf<ApiData<ProductDto>>(res).data;
    expect(created).toMatchObject({
      videoAssetId: video,
      imageAssetIds: [image],
      pendingMedia: { videoAssetId: null, imageAssetIds: null },
    });
    expect(await auditCount(ctx, { action: 'product.create', entityId: created.id })).toBe(1);
    await sellable(created.id);

    // Video still processing: no player, the ready image is the fallback.
    const before = await card(created.id);
    expect(before?.media).toBeNull();
    expect(before?.image?.variants.length).toBeGreaterThan(0);
    const detail = bodyOf<ApiData<PublicProductDetailDto>>(
      await request(ctx.app).get(`${CATALOG}/products/${created.slug}`),
    ).data;
    expect(detail.videos).toEqual([]);
    expect(detail.images).toHaveLength(1);

    await drain();
    expect((await card(created.id))?.media?.mp4.length).toBeGreaterThan(0);
  });

  it('an active product with no ready media at all shows neither player nor image', async () => {
    const created = bodyOf<ApiData<ProductDto>>(
      await createProduct({ videoAssetId: await queuedVideo() }),
    ).data;
    await sellable(created.id);
    expect(await card(created.id)).toMatchObject({ media: null, image: null });
  });

  it('refuses unfinished and failed uploads; the product is not created', async () => {
    const unfinished = await api.post('/media/uploads', {
      fileName: 'x.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 10,
    });
    const pendingId = bodyOf<ApiData<{ asset: MediaAssetDto }>>(unfinished).data.asset.id;
    const refused = await createProduct({ videoAssetId: pendingId });
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe('MEDIA_NOT_READY');

    const failed = await queuedVideo();
    await ctx.db
      .updateTable('media_assets')
      .set({ processing_status: 'failed', processing_attempts: 3 })
      .where('id', '=', failed)
      .execute();
    expect(errorCode(await createProduct({ videoAssetId: failed }))).toBe('MEDIA_NOT_READY');
    expect(await ctx.db.selectFrom('products').select('id').execute()).toEqual([]);
  });

  it('replacing a LIVE video keeps it live until the new one is ready, then swaps atomically (audited)', async () => {
    const live = await ready(queuedVideo());
    const created = bodyOf<ApiData<ProductDto>>(await createProduct({ videoAssetId: live })).data;
    await sellable(created.id);

    const replacement = await queuedVideo();
    const res = await api.put(`/products/${created.id}/video`, { mediaAssetId: replacement });
    expect(res.status).toBe(200);
    expect(bodyOf<ApiData<ProductDto>>(res).data).toMatchObject({
      videoAssetId: live,
      pendingMedia: { videoAssetId: replacement },
    });
    expect(
      await auditCount(ctx, { action: 'product.video_replace_pending', entityId: created.id }),
    ).toBe(1);
    expect((await card(created.id))?.media).not.toBeNull(); // old video still shown
    expect(await isRetired(live)).toBe(false);

    await drain();
    expect(await product(created.id)).toMatchObject({
      videoAssetId: replacement,
      pendingMedia: { videoAssetId: null },
    });
    expect(await isRetired(live)).toBe(true);
    const audit = await ctx.db
      .selectFrom('admin_audit_logs')
      .select(['after_data'])
      .where('action', '=', 'product.video_replace')
      .where('entity_id', '=', created.id)
      .executeTakeFirstOrThrow();
    expect(audit.after_data).toMatchObject({
      videoAssetId: replacement,
      appliedBy: 'media_worker',
    });
  });

  it('a replacement that fails BEFORE it is playable never removes the live video', async () => {
    const live = await ready(queuedVideo());
    const created = bodyOf<ApiData<ProductDto>>(await createProduct({ videoAssetId: live })).data;
    await sellable(created.id);
    const replacement = await queuedVideo();
    await api.put(`/products/${created.id}/video`, { mediaAssetId: replacement });

    // The poster (the first step) crashes: the new video never becomes playable.
    const processor = makeProcessor(ctx, stubFfmpeg({ failOutput: /^poster\.jpg$/ }));
    await processor.processNext(['video']);

    expect(await product(created.id)).toMatchObject({
      videoAssetId: live,
      pendingMedia: { videoAssetId: replacement },
    });
    expect(await isRetired(live)).toBe(false);
    expect((await card(created.id))?.media).not.toBeNull(); // the live video is still shown
  });

  it('a replacement is swapped in as soon as it is playable; a later size failing only warns, and the video keeps playing', async () => {
    const live = await ready(queuedVideo());
    const created = bodyOf<ApiData<ProductDto>>(await createProduct({ videoAssetId: live })).data;
    await sellable(created.id);
    const replacement = await queuedVideo();
    await api.put(`/products/${created.id}/video`, { mediaAssetId: replacement });

    // The stub clip is 720p, so the sizes are 480p then 720p: the 720p encode crashes.
    const processor = makeProcessor(ctx, stubFfmpeg({ failOutput: /^720p\.mp4$/ }));
    await processor.processNext(['video']);

    expect(await product(created.id)).toMatchObject({
      videoAssetId: replacement,
      pendingMedia: { videoAssetId: null },
    });
    expect(await isRetired(live)).toBe(true);
    const shown = (await card(created.id))?.media;
    expect(shown).not.toBeNull();
    expect(shown?.mp4.map((source) => source.label)).toEqual(['480p']);
    const asset = bodyOf<ApiData<MediaAssetDto>>(await api.get(`/media/${replacement}`)).data;
    expect(asset.status).not.toBe('ready'); // 'ready' still means every size is complete
    expect(asset.playableAt).not.toBeNull();
    expect(asset.processingError).toContain('still plays with the sizes that exist');
  });

  it('failed processing keeps the old media live and retires nothing; a retry then swaps it in', async () => {
    const live = await ready(queuedVideo());
    const created = bodyOf<ApiData<ProductDto>>(await createProduct({ videoAssetId: live })).data;
    const replacement = await queuedVideo();
    await api.put(`/products/${created.id}/video`, { mediaAssetId: replacement });
    await ctx.db
      .updateTable('media_assets')
      .set({ processing_status: 'failed', processing_attempts: 3, processing_error: 'bad file' })
      .where('id', '=', replacement)
      .execute();
    await drain(); // nothing to do: the failed asset is not queued

    expect(await product(created.id)).toMatchObject({
      videoAssetId: live,
      pendingMedia: { videoAssetId: replacement },
    });
    expect(await isRetired(live)).toBe(false);
    const asset = bodyOf<ApiData<MediaAssetDto>>(await api.get(`/media/${replacement}`)).data;
    expect(asset).toMatchObject({ status: 'failed', processingError: 'bad file' });

    expect((await api.post(`/media/${replacement}/retry`)).status).toBe(200);
    await drain();
    expect((await product(created.id)).videoAssetId).toBe(replacement);
    expect(await isRetired(live)).toBe(true);
  });

  it('images: live images get a pending replacement; choosing ready media applies at once and clears it', async () => {
    const live = await ready(queuedImage());
    const created = bodyOf<ApiData<ProductDto>>(
      await createProduct({ imageAssetIds: [live] }),
    ).data;
    const processing = await queuedImage();
    const pending = bodyOf<ApiData<ProductDto>>(
      await api.put(`/products/${created.id}/images`, { mediaAssetIds: [live, processing] }),
    ).data;
    expect(pending).toMatchObject({
      imageAssetIds: [live],
      pendingMedia: { imageAssetIds: [live, processing] },
    });
    expect(
      await auditCount(ctx, { action: 'product.images_replace_pending', entityId: created.id }),
    ).toBe(1);

    // Running the worker makes `processing` ready, which applies the pending set atomically.
    const other = await ready(queuedImage());
    expect((await product(created.id)).imageAssetIds).toEqual([live, processing]);
    const applied = bodyOf<ApiData<ProductDto>>(
      await api.put(`/products/${created.id}/images`, { mediaAssetIds: [other] }),
    ).data;
    expect(applied).toMatchObject({
      imageAssetIds: [other],
      pendingMedia: { imageAssetIds: null },
    });
    expect(await isRetired(live)).toBe(true);
  });

  it('a slot without live media attaches immediately (the replaced non-live asset is retired)', async () => {
    const first = await queuedVideo();
    const created = bodyOf<ApiData<ProductDto>>(await createProduct({ videoAssetId: first })).data;
    const second = await queuedVideo();
    const res = bodyOf<ApiData<ProductDto>>(
      await api.put(`/products/${created.id}/video`, { mediaAssetId: second }),
    ).data;
    expect(res).toMatchObject({ videoAssetId: second, pendingMedia: { videoAssetId: null } });
    expect(await isRetired(first)).toBe(true);
    expect(await auditCount(ctx, { action: 'product.video_replace', entityId: created.id })).toBe(
      1,
    );
  });
});
