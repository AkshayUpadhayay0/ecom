import type {
  ApiData,
  ApiList,
  ClothingTypeDto,
  ProductDto,
  ProductSummaryDto,
  SizeDto,
} from '@urban-ibile/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  errorCode,
  insertMediaAsset,
  resetAdminApiData,
  restoreSettings,
  seededClothingTypeId,
  seededProfileId,
  signInAdmin,
  snapshotSettings,
  type AdminClient,
  type SettingsSnapshot,
} from '../../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../../test/helpers.js';

/** The old v2.0 cap; the 9 Oct design removed it, so going past it must work. */
const FORMER_PRODUCT_CAP = 100;

describe.skipIf(!hasTestDatabase)('admin catalog API', () => {
  let ctx: TestContext;
  let api: AdminClient;
  let settings: SettingsSnapshot;
  let shirtTypeId: string;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    settings = await snapshotSettings(ctx);
    shirtTypeId = await seededClothingTypeId(ctx);
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, settings);
    api = adminClient(ctx, (await signInAdmin(ctx)).token);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, settings);
    await ctx.db.destroy();
  });

  function productBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'Agbada Linen Shirt',
      slug: 'agbada-linen-shirt',
      clothingTypeId: shirtTypeId,
      description: 'A breathable linen shirt.',
      priceMinor: 2_500_000,
      searchKeywords: 'linen agbada',
      ...overrides,
    };
  }

  async function createProduct(overrides: Record<string, unknown> = {}): Promise<ProductDto> {
    const res = await api.post('/products', productBody(overrides));
    expect(res.status).toBe(201);
    return bodyOf<ApiData<ProductDto>>(res).data;
  }

  /** Fast fixture: `count` active products inserted directly. */
  async function insertActiveProducts(count: number): Promise<void> {
    await sql`
      INSERT INTO products (slug, name, clothing_type_id, price_minor, status)
      SELECT 'bulk-' || n, 'Bulk ' || n, ${shirtTypeId}::uuid, 1000, 'active'
      FROM generate_series(1, ${count}::int) AS n`.execute(ctx.db);
  }

  async function setCap(limit: number | null): Promise<void> {
    await ctx.db
      .updateTable('app_settings')
      .set({ value: limit === null ? null : JSON.stringify(limit) })
      .where('setting_key', '=', 'catalog.max_active_products')
      .execute();
  }

  describe('clothing types', () => {
    it('creates with one canonical name, searches, renames and deactivates (audited)', async () => {
      const created = await api.post('/clothing-types', {
        slug: 't-kaftan',
        name: 'Kaftan',
        searchKeywords: 'boubou robe',
      });
      expect(created.status).toBe(201);
      const type = bodyOf<ApiData<ClothingTypeDto>>(created).data;
      expect(type).toMatchObject({ slug: 't-kaftan', name: 'Kaftan', isActive: true });

      const search = await api.get('/clothing-types?q=boubou');
      expect(bodyOf<ApiList<ClothingTypeDto>>(search).data.map((t) => t.slug)).toEqual([
        't-kaftan',
      ]);

      const updated = await api.patch(`/clothing-types/${type.id}`, {
        name: 'Kaftan Robe',
        isActive: false,
      });
      expect(bodyOf<ApiData<ClothingTypeDto>>(updated).data).toMatchObject({
        name: 'Kaftan Robe',
        isActive: false,
      });
      const reactivated = await api.patch(`/clothing-types/${type.id}`, { isActive: true });
      expect(bodyOf<ApiData<ClothingTypeDto>>(reactivated).data.isActive).toBe(true);

      expect(await auditCount(ctx, { action: 'clothing_type.create', entityId: type.id })).toBe(1);
      expect(await auditCount(ctx, { action: 'clothing_type.update', entityId: type.id })).toBe(2);
    });

    it('rejects duplicate slugs and has no translation input', async () => {
      const duplicate = await api.post('/clothing-types', { slug: 'shirt', name: 'Shirt again' });
      expect(duplicate.status).toBe(409);
      expect(errorCode(duplicate)).toBe('ALREADY_EXISTS');
      const translations = await api.patch(`/clothing-types/${shirtTypeId}`, {
        translations: { pcm: { name: 'Shirt' } },
      });
      expect(translations.status).toBe(400);
    });
  });

  describe('sizes', () => {
    it('lists the seeded sizes and reorders them (audited); no create or edit', async () => {
      const all = bodyOf<ApiList<SizeDto>>(await api.get('/sizes?pageSize=50')).data;
      expect(all.map((s) => s.code)).toEqual(expect.arrayContaining(['S', 'M', 'XS-6', '3XL']));
      const original = all.map((s) => s.id);
      try {
        const reversed = [...original].reverse();
        // Reordering belongs to Sizes & Charts: super_admin only (19 Oct 2026).
        expect((await api.put('/sizes/order', { ids: reversed })).status).toBe(403);
        const superApi = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);
        const reordered = await superApi.put('/sizes/order', { ids: reversed });
        expect(reordered.status).toBe(200);
        expect(bodyOf<ApiData<SizeDto[]>>(reordered).data.map((s) => s.id)).toEqual(reversed);

        const incomplete = await superApi.put('/sizes/order', { ids: reversed.slice(1) });
        expect(incomplete.status).toBe(400);
        expect(await auditCount(ctx, { action: 'size.reorder' })).toBe(1);
      } finally {
        // Restore the seeded order exactly (Blueprint compares sizes.sort_order).
        for (const size of all) {
          await ctx.db
            .updateTable('sizes')
            .set({ sort_order: size.sortOrder })
            .where('id', '=', size.id)
            .execute();
        }
      }
      expect((await api.post('/sizes', { code: 'TQ', label: 'Test' })).status).toBe(404);
      expect((await api.patch(`/sizes/${original[0] ?? ''}`, { label: 'X' })).status).toBe(404);
    });
  });

  describe('products', () => {
    it('creates with description and measurement profile, lists, filters, updates price', async () => {
      const profileId = await seededProfileId(ctx, 'male_top');
      const product = await createProduct({ measurementProfileId: profileId });
      expect(product).toMatchObject({
        status: 'draft',
        priceMinor: 2_500_000,
        currency: 'NGN',
        description: 'A breathable linen shirt.',
        clothingType: { id: shirtTypeId, slug: 'shirt' },
        measurementProfile: { id: profileId, code: 'male_top' },
        imageAssetIds: [],
      });
      const plain = await createProduct({
        name: 'Plain Tee',
        slug: 'plain-tee',
        searchKeywords: '',
      });
      expect(plain.measurementProfile).toBeNull();

      const search = await api.get('/products?q=agbada&status=draft');
      const found = bodyOf<ApiList<ProductSummaryDto>>(search);
      expect(found.data.map((p) => p.slug)).toEqual(['agbada-linen-shirt']);
      expect(found.meta).toMatchObject({ page: 1, total: 1, totalPages: 1 });
      const byProfile = await api.get(`/products?measurementProfileId=${profileId}`);
      expect(bodyOf<ApiList<ProductSummaryDto>>(byProfile).meta.total).toBe(1);

      const updated = await api.patch(`/products/${product.id}`, {
        priceMinor: 2_750_000,
        description: 'Fine linen.',
        measurementProfileId: null,
      });
      expect(updated.status).toBe(200);
      expect(bodyOf<ApiData<ProductDto>>(updated).data).toMatchObject({
        priceMinor: 2_750_000,
        description: 'Fine linen.',
        measurementProfile: null,
      });
      const audit = await ctx.db
        .selectFrom('admin_audit_logs')
        .select(['before_data', 'after_data'])
        .where('action', '=', 'product.update')
        .where('entity_id', '=', product.id)
        .executeTakeFirstOrThrow();
      expect(audit.before_data).toMatchObject({ priceMinor: 2_500_000 });
      expect(audit.after_data).toMatchObject({ priceMinor: 2_750_000 });
    });

    it('rejects unknown profiles, float prices, duplicate slugs and pageSize > 50', async () => {
      const unknownProfile = await api.post(
        '/products',
        productBody({ measurementProfileId: '00000000-0000-4000-8000-000000000000' }),
      );
      expect(unknownProfile.status).toBe(400);
      expect((await api.post('/products', productBody({ priceMinor: 25.5 }))).status).toBe(400);
      expect((await api.post('/products', productBody({ garmentCutId: shirtTypeId }))).status).toBe(
        201,
      ); // unknown keys are ignored; there is no garment cut any more
      const duplicate = await api.post('/products', productBody());
      expect(errorCode(duplicate)).toBe('ALREADY_EXISTS');
      expect((await api.get('/products?pageSize=51')).status).toBe(400);
    });

    it('has NO product cap by default: more than 100 products can be active', async () => {
      await insertActiveProducts(FORMER_PRODUCT_CAP);

      const created = await api.post('/products', productBody({ status: 'active' }));
      expect(created.status).toBe(201);
      const draft = await createProduct({ slug: 'one-more', name: 'One more' });
      const activated = await api.post(`/products/${draft.id}/status`, { status: 'active' });
      expect(activated.status).toBe(200);

      const list = await api.get('/products?status=active&pageSize=20');
      expect(bodyOf<ApiList<ProductSummaryDto>>(list).meta).toMatchObject({
        total: FORMER_PRODUCT_CAP + 2,
        totalPages: 6,
      });
    });

    it('enforces an optional cap only when the setting holds a number, also under concurrency', async () => {
      const limit = 3;
      await setCap(limit);
      await insertActiveProducts(limit - 1);
      const drafts = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => createProduct({ slug: `draft-${n}`, name: `Draft ${n}` })),
      );

      const results = await Promise.all(
        drafts.map((draft) => api.post(`/products/${draft.id}/status`, { status: 'active' })),
      );
      expect(results.filter((res) => res.status === 200)).toHaveLength(1);
      const refused = results.filter((res) => res.status === 409);
      expect(refused).toHaveLength(drafts.length - 1);
      expect(refused.every((res) => errorCode(res) === 'ACTIVE_PRODUCT_LIMIT_REACHED')).toBe(true);

      await setCap(null);
      const free = await api.post(`/products/${drafts[4]?.id ?? ''}/status`, { status: 'active' });
      expect(free.status).toBe(200);
    });

    it('archives instead of deleting; archived products are read-only until restored', async () => {
      const product = await createProduct();

      expect((await api.delete(`/products/${product.id}`)).status).toBe(404);

      const archived = await api.post(`/products/${product.id}/status`, { status: 'archived' });
      expect(bodyOf<ApiData<ProductDto>>(archived).data.status).toBe('archived');
      expect((await api.get(`/products/${product.id}`)).status).toBe(200);

      const edit = await api.patch(`/products/${product.id}`, { priceMinor: 1 });
      expect(edit.status).toBe(409);
      expect(errorCode(edit)).toBe('INVALID_STATE');

      const restored = await api.post(`/products/${product.id}/status`, { status: 'inactive' });
      expect(restored.status).toBe(200);
      expect(await auditCount(ctx, { action: 'product.status_change', entityId: product.id })).toBe(
        2,
      );
    });

    it('assigns only existing PUBLIC, non-retired media that finished uploading (video and images)', async () => {
      const product = await createProduct();
      const video = await insertMediaAsset(ctx, { kind: 'video', status: 'ready' });
      // 19 Oct 2026: processing media may be attached; unfinished uploads and failures may not.
      const unfinished = await insertMediaAsset(ctx, { kind: 'video', status: 'pending' });
      const failed = await insertMediaAsset(ctx, { kind: 'video', status: 'failed' });
      const privateVideo = await insertMediaAsset(ctx, {
        kind: 'video',
        status: 'ready',
        visibility: 'private',
      });
      const retired = await insertMediaAsset(ctx, {
        kind: 'video',
        status: 'ready',
        retired: true,
      });
      const image1 = await insertMediaAsset(ctx, { kind: 'image', status: 'ready' });
      const image2 = await insertMediaAsset(ctx, { kind: 'image', status: 'ready' });

      const putVideo = (mediaAssetId: string) =>
        api.put(`/products/${product.id}/video`, { mediaAssetId });
      expect(errorCode(await putVideo(unfinished))).toBe('MEDIA_NOT_READY');
      expect(errorCode(await putVideo(failed))).toBe('MEDIA_NOT_READY');
      expect((await putVideo(privateVideo)).status).toBe(404);
      expect(errorCode(await putVideo(retired))).toBe('INVALID_STATE');
      expect(errorCode(await putVideo(image1))).toBe('INVALID_MEDIA_TYPE');
      const assigned = await putVideo(video);
      expect(bodyOf<ApiData<ProductDto>>(assigned).data.videoAssetId).toBe(video);

      const images = await api.put(`/products/${product.id}/images`, {
        mediaAssetIds: [image2, image1],
      });
      expect(bodyOf<ApiData<ProductDto>>(images).data.imageAssetIds).toEqual([image2, image1]);
      const withVideo = await api.put(`/products/${product.id}/images`, {
        mediaAssetIds: [image1, video],
      });
      expect(errorCode(withVideo)).toBe('INVALID_MEDIA_TYPE');
      const cleared = await api.put(`/products/${product.id}/images`, { mediaAssetIds: [] });
      expect(bodyOf<ApiData<ProductDto>>(cleared).data.imageAssetIds).toEqual([]);

      expect(await auditCount(ctx, { action: 'product.video_replace', entityId: product.id })).toBe(
        1,
      );
      expect(
        await auditCount(ctx, { action: 'product.images_replace', entityId: product.id }),
      ).toBe(2);
    });
  });
});
