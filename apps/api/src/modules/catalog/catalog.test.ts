import type {
  ApiData,
  ApiList,
  ClothingTypeDto,
  GarmentCutDto,
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

const DEFAULT_ACTIVE_CAP = 100;

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
      priceMinor: 2_500_000,
      searchKeywords: 'linen agbada',
      translations: { en: { description: 'A breathable linen shirt.' } },
      ...overrides,
    };
  }

  async function createProduct(overrides: Record<string, unknown> = {}): Promise<ProductDto> {
    const res = await api.post('/products', productBody(overrides));
    expect(res.status).toBe(201);
    return bodyOf<ApiData<ProductDto>>(res).data;
  }

  /** Fast fixture: `count` active products inserted directly (the cap test needs 100). */
  async function insertActiveProducts(count: number): Promise<void> {
    await sql`
      INSERT INTO products (slug, name, clothing_type_id, price_minor, status)
      SELECT 'bulk-' || n, 'Bulk ' || n, ${shirtTypeId}::uuid, 1000, 'active'
      FROM generate_series(1, ${count}::int) AS n`.execute(ctx.db);
  }

  describe('clothing types', () => {
    it('creates with translations, searches, updates and deactivates (audited)', async () => {
      const created = await api.post('/clothing-types', {
        slug: 't-kaftan',
        searchKeywords: 'boubou robe',
        translations: { en: { name: 'Kaftan' }, pcm: { name: 'Kaftan (pcm)' } },
      });
      expect(created.status).toBe(201);
      const type = bodyOf<ApiData<ClothingTypeDto>>(created).data;
      expect(type.translations).toEqual({ en: { name: 'Kaftan' }, pcm: { name: 'Kaftan (pcm)' } });

      const search = await api.get('/clothing-types?q=boubou');
      expect(bodyOf<ApiList<ClothingTypeDto>>(search).data.map((t) => t.slug)).toEqual([
        't-kaftan',
      ]);

      const updated = await api.patch(`/clothing-types/${type.id}`, {
        isActive: false,
        translations: { pcm: null },
      });
      expect(updated.status).toBe(200);
      expect(bodyOf<ApiData<ClothingTypeDto>>(updated).data).toMatchObject({
        isActive: false,
        translations: { en: { name: 'Kaftan' } },
      });
      expect(await auditCount(ctx, { action: 'clothing_type.create', entityId: type.id })).toBe(1);
      expect(await auditCount(ctx, { action: 'clothing_type.update', entityId: type.id })).toBe(1);
    });

    it('requires English, rejects unknown languages, duplicate slugs and removing English', async () => {
      const noEnglish = await api.post('/clothing-types', {
        slug: 't-a',
        translations: { pcm: { name: 'A' } },
      });
      expect(noEnglish.status).toBe(400);

      const unknownLanguage = await api.post('/clothing-types', {
        slug: 't-b',
        translations: { en: { name: 'B' }, fr: { name: 'B' } },
      });
      expect(unknownLanguage.status).toBe(400);

      const duplicate = await api.post('/clothing-types', {
        slug: 'shirt',
        translations: { en: { name: 'Shirt again' } },
      });
      expect(duplicate.status).toBe(409);
      expect(errorCode(duplicate)).toBe('ALREADY_EXISTS');

      const removeEnglish = await api.patch(`/clothing-types/${shirtTypeId}`, {
        translations: { en: null },
      });
      expect(removeEnglish.status).toBe(400);
    });
  });

  describe('sizes', () => {
    it('creates, rejects duplicate codes, deactivates and reorders', async () => {
      const created = await api.post('/sizes', { code: 'T3XL', label: '3X Large' });
      expect(created.status).toBe(201);
      const size = bodyOf<ApiData<SizeDto>>(created).data;
      expect(size.sortOrder).toBe(6);

      expect((await api.post('/sizes', { code: 'M', label: 'Medium' })).status).toBe(409);

      const deactivated = await api.patch(`/sizes/${size.id}`, { isActive: false });
      expect(bodyOf<ApiData<SizeDto>>(deactivated).data.isActive).toBe(false);

      const all = bodyOf<ApiList<SizeDto>>(await api.get('/sizes?pageSize=50')).data;
      const reversed = all.map((s) => s.id).reverse();
      const reordered = await api.put('/sizes/order', { ids: reversed });
      expect(reordered.status).toBe(200);
      expect(bodyOf<ApiData<SizeDto[]>>(reordered).data.map((s) => s.id)).toEqual(reversed);

      const incomplete = await api.put('/sizes/order', { ids: reversed.slice(1) });
      expect(incomplete.status).toBe(400);
      expect(await auditCount(ctx, { action: 'size.reorder' })).toBe(1);
    });
  });

  describe('garment cuts', () => {
    it('creates, updates notes and deactivates; products may reference an active cut', async () => {
      const created = await api.post('/garment-cuts', { code: 'slim', name: 'Slim fit' });
      expect(created.status).toBe(201);
      const cut = bodyOf<ApiData<GarmentCutDto>>(created).data;

      const product = await createProduct({ garmentCutId: cut.id });
      expect(product.garmentCut).toEqual({ id: cut.id, code: 'slim', name: 'Slim fit' });

      await api.patch(`/garment-cuts/${cut.id}`, { notes: 'Tailor notes', isActive: false });
      const rejected = await api.post(
        '/products',
        productBody({ slug: 'second', garmentCutId: cut.id }),
      );
      expect(rejected.status).toBe(400);
      expect(await auditCount(ctx, { action: 'garment_cut.update', entityId: cut.id })).toBe(1);
    });
  });

  describe('products', () => {
    it('creates a draft, lists with search/filter, updates price and translations', async () => {
      const product = await createProduct();
      expect(product).toMatchObject({
        status: 'draft',
        priceMinor: 2_500_000,
        currency: 'NGN',
        clothingType: { id: shirtTypeId, slug: 'shirt' },
        translations: { en: { description: 'A breathable linen shirt.' } },
      });
      await createProduct({ name: 'Plain Tee', slug: 'plain-tee', searchKeywords: '' });

      const search = await api.get('/products?q=agbada&status=draft');
      const found = bodyOf<ApiList<ProductSummaryDto>>(search);
      expect(found.data.map((p) => p.slug)).toEqual(['agbada-linen-shirt']);
      expect(found.meta).toMatchObject({ page: 1, total: 1, totalPages: 1 });

      const updated = await api.patch(`/products/${product.id}`, {
        priceMinor: 2_750_000,
        translations: { pcm: { description: 'Fine linen shirt (pcm).' } },
      });
      expect(updated.status).toBe(200);
      expect(bodyOf<ApiData<ProductDto>>(updated).data).toMatchObject({
        priceMinor: 2_750_000,
        translations: { en: {}, pcm: { description: 'Fine linen shirt (pcm).' } },
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

    it('rejects float prices, duplicate slugs and caps pageSize at 50', async () => {
      expect((await api.post('/products', productBody({ priceMinor: 25.5 }))).status).toBe(400);
      await createProduct();
      const duplicate = await api.post('/products', productBody());
      expect(duplicate.status).toBe(409);
      expect(errorCode(duplicate)).toBe('ALREADY_EXISTS');
      expect((await api.get('/products?pageSize=51')).status).toBe(400);
    });

    it('rejects the 101st active product (catalog.max_active_products default 100)', async () => {
      await insertActiveProducts(DEFAULT_ACTIVE_CAP);

      const created = await api.post('/products', productBody({ status: 'active' }));
      expect(created.status).toBe(409);
      expect(errorCode(created)).toBe('ACTIVE_PRODUCT_LIMIT_REACHED');

      // Activating an existing draft is refused the same way.
      const draft = await createProduct();
      const activate = await api.post(`/products/${draft.id}/status`, { status: 'active' });
      expect(activate.status).toBe(409);
      expect(errorCode(activate)).toBe('ACTIVE_PRODUCT_LIMIT_REACHED');
    });

    it('reads the cap from settings and never exceeds it under concurrent activations', async () => {
      const limit = 3;
      await ctx.db
        .updateTable('app_settings')
        .set({ value: JSON.stringify(limit) })
        .where('setting_key', '=', 'catalog.max_active_products')
        .execute();
      await insertActiveProducts(limit - 1);
      const drafts = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => createProduct({ slug: `draft-${n}`, name: `Draft ${n}` })),
      );

      const results = await Promise.all(
        drafts.map((draft) => api.post(`/products/${draft.id}/status`, { status: 'active' })),
      );
      expect(results.filter((res) => res.status === 200)).toHaveLength(1);
      expect(results.filter((res) => res.status === 409)).toHaveLength(drafts.length - 1);
      const active = await ctx.db
        .selectFrom('products')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();
      expect(Number(active.n)).toBe(limit);
    });

    it('archives instead of deleting; archived products are read-only until restored', async () => {
      const product = await createProduct();

      const deleted = await api.delete(`/products/${product.id}`);
      expect(deleted.status).toBe(404);

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

    it('assigns only an existing READY video asset', async () => {
      const product = await createProduct();
      const ready = await insertMediaAsset(ctx, { kind: 'video', status: 'ready' });
      const processing = await insertMediaAsset(ctx, { kind: 'video', status: 'processing' });
      const image = await insertMediaAsset(ctx, { kind: 'image', status: 'ready' });

      const notReady = await api.put(`/products/${product.id}/video`, { mediaAssetId: processing });
      expect(notReady.status).toBe(409);
      expect(errorCode(notReady)).toBe('MEDIA_NOT_READY');
      const notVideo = await api.put(`/products/${product.id}/video`, { mediaAssetId: image });
      expect(errorCode(notVideo)).toBe('INVALID_MEDIA_TYPE');

      const assigned = await api.put(`/products/${product.id}/video`, { mediaAssetId: ready });
      expect(assigned.status).toBe(200);
      expect(bodyOf<ApiData<ProductDto>>(assigned).data.videoAssetId).toBe(ready);
      expect(await auditCount(ctx, { action: 'product.video_replace', entityId: product.id })).toBe(
        1,
      );
    });
  });
});
