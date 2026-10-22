import { randomUUID } from 'node:crypto';
import type {
  ApiErrorBody,
  PublicClothingTypeDto,
  PublicProductCardDto,
  PublicProductDetailDto,
  PublicProductListDto,
  PublicSearchResultDto,
  PublicSiteConfigDto,
} from '@urban-ibile/shared';
import { PUBLIC_SETTING_KEYS } from '@urban-ibile/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  resetAdminApiData,
  seededClothingTypeId,
  seededProfileId,
} from '../../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  testDatabaseUrl,
} from '../../../test/helpers.js';
import { makeMediaTestApp, type MediaTestContext } from '../../../test/media-fixtures.js';

const CATALOG = '/api/v1/catalog';
const BULK = 105;
const PAGE_SIZE = 20;

/** Keys that must never appear in any public response. */
const FORBIDDEN_KEYS = new Set([
  'stockOnHand',
  'stockReserved',
  'stock_on_hand',
  'available',
  'quantity',
  'lowStockThreshold',
  'cost',
  'costMinor',
  'adminId',
  'updatedBy',
  'uploadedBy',
  'note',
  'notes',
  'originalKey',
  'storageKey',
  'processingStatus',
  'processingError',
  'visibility',
  'retiredAt',
  'purgedAt',
  'isSampleData',
  'videoAssetId',
  'measurementProfileId',
  'searchKeywords',
  'isActive',
  'sortOrder',
  'status',
]);

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) collectKeys(item, keys);
  else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe.skipIf(!hasTestDatabase)('public storefront API', () => {
  let ctx: MediaTestContext;
  let shirtId: string;
  let trouserId: string;
  const ids = {} as Record<
    'zanzibar' | 'inactive' | 'noVariant' | 'withMedia' | 'retiredMedia' | 'sized' | 'wildcard',
    string
  >;
  let retiredAssetId: string;
  const get = (path: string) => request(ctx.app).get(path);

  async function insertProduct(input: {
    slug: string;
    name: string;
    typeId: string;
    price: number;
    status?: string;
    ageSeconds?: number;
    keywords?: string;
    videoAssetId?: string | null;
    profileId?: string | null;
  }): Promise<string> {
    const row = await ctx.db
      .insertInto('products')
      .values({
        slug: input.slug,
        name: input.name,
        clothing_type_id: input.typeId,
        price_minor: input.price,
        status: input.status ?? 'active',
        search_keywords: input.keywords ?? '',
        video_asset_id: input.videoAssetId ?? null,
        measurement_profile_id: input.profileId ?? null,
        created_at: sql`now() - make_interval(secs => ${input.ageSeconds ?? 0})`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function sizeId(code: string): Promise<string> {
    return (
      await ctx.db
        .selectFrom('sizes')
        .select('id')
        .where('code', '=', code)
        .executeTakeFirstOrThrow()
    ).id;
  }

  async function addVariant(
    productId: string,
    size: string,
    stock: number,
    active = true,
    threshold = 3,
  ) {
    await ctx.db
      .insertInto('product_variants')
      .values({
        product_id: productId,
        size_id: await sizeId(size),
        sku: `SKU-${randomUUID().slice(0, 12)}`,
        stock_on_hand: stock,
        is_active: active,
        low_stock_threshold: threshold,
      })
      .execute();
  }

  async function insertVideo(retired = false): Promise<string> {
    const asset = await ctx.db
      .insertInto('media_assets')
      .values({
        kind: 'video',
        original_key: `media/video/${randomUUID()}/original.mp4`,
        mime_type: 'video/mp4',
        size_bytes: 1000,
        processing_status: 'ready',
        visibility: 'public',
        width: 1280,
        height: 720,
        duration_ms: 4000,
        dominant_color: '#112233',
        retired_at: retired ? new Date() : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const key = (label: string, format: string) => `media/video/${asset.id}/a1/${label}.${format}`;
    await ctx.db
      .insertInto('media_renditions')
      .values(
        [
          ['480p', 'mp4', 854, 480],
          ['720p', 'mp4', 1280, 720],
          ['1080p', 'mp4', 1920, 1080],
          ['preview', 'mp4', 854, 480],
          ['poster', 'jpg', 1280, 720],
        ].map(([label, format, width, height]) => ({
          asset_id: asset.id,
          label: String(label),
          format: String(format),
          storage_key: key(String(label), String(format)),
          width: Number(width),
          height: Number(height),
          size_bytes: 100,
        })),
      )
      .execute();
    return asset.id;
  }

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = await makeMediaTestApp();
    await resetAdminApiData(ctx);
    shirtId = await seededClothingTypeId(ctx, 'shirt');
    trouserId = await seededClothingTypeId(ctx, 'trouser');
    const mSize = await sizeId('M');

    // 105 active products, each with one active, in-stock variant (newest = smallest age).
    await sql`
      WITH p AS (
        INSERT INTO products (slug, name, clothing_type_id, price_minor, status, created_at)
        SELECT 'bulk-' || n, 'Bulk Outfit ' || lpad(n::text, 3, '0'), ${shirtId}::uuid,
               100000 + n * 100, 'active', now() - make_interval(secs => n)
        FROM generate_series(1, ${BULK}::int) AS n
        RETURNING id, slug)
      INSERT INTO product_variants (product_id, size_id, sku, stock_on_hand)
      SELECT id, ${mSize}::uuid, 'SKU-' || slug, 5 FROM p`.execute(ctx.db);

    // The oldest product: lands beyond page 1 in "newest" order.
    ids.zanzibar = await insertProduct({
      slug: 'zanzibar-linen-agbada',
      name: 'Zanzibar Linen Agbada',
      typeId: trouserId,
      price: 990000,
      ageSeconds: 100_000,
    });
    await addVariant(ids.zanzibar, 'L', 4);
    ids.wildcard = await insertProduct({
      slug: 'hundred-percent',
      name: '100% Cotton_Set',
      typeId: trouserId,
      price: 50000,
      ageSeconds: 90_000,
    });
    await addVariant(ids.wildcard, 'M', 1);

    ids.inactive = await insertProduct({
      slug: 'hidden-inactive',
      name: 'Hidden Inactive',
      typeId: shirtId,
      price: 1,
      status: 'inactive',
    });
    await addVariant(ids.inactive, 'M', 5);
    ids.noVariant = await insertProduct({
      slug: 'only-inactive-variant',
      name: 'Only Inactive Variant',
      typeId: shirtId,
      price: 1,
    });
    await addVariant(ids.noVariant, 'M', 5, false);

    ids.withMedia = await insertProduct({
      slug: 'with-media',
      name: 'With Media',
      typeId: shirtId,
      price: 200000,
      ageSeconds: 50_000,
      videoAssetId: await insertVideo(),
    });
    await addVariant(ids.withMedia, 'M', 0); // sold out
    retiredAssetId = await insertVideo(true);
    ids.retiredMedia = await insertProduct({
      slug: 'retired-media',
      name: 'Retired Media',
      typeId: shirtId,
      price: 200000,
      ageSeconds: 50_001,
      videoAssetId: retiredAssetId,
    });
    await addVariant(ids.retiredMedia, 'M', 3);

    ids.sized = await insertProduct({
      slug: 'sized-kaftan',
      name: 'Sized Kaftan',
      typeId: shirtId,
      price: 300000,
      ageSeconds: 60_000,
      profileId: await seededProfileId(ctx, 'male_top'),
    });
    await addVariant(ids.sized, 'M', 0);
    await addVariant(ids.sized, 'L', 2, true, 3);
    await addVariant(ids.sized, 'XL', 10, true, 3);
    await addVariant(ids.sized, 'XXL', 10, false);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
    await ctx.cleanup();
  });

  const VISIBLE = BULK + 5; // bulk + zanzibar + wildcard + withMedia + retiredMedia + sized

  describe('GET /catalog/products', () => {
    it('pages 20 at a time with the right total across more than 100 products', async () => {
      const first = bodyOf<PublicProductListDto>(await get(`${CATALOG}/products`));
      expect(first.data).toHaveLength(PAGE_SIZE);
      expect(first.meta).toEqual({
        page: 1,
        pageSize: PAGE_SIZE,
        total: VISIBLE,
        totalPages: Math.ceil(VISIBLE / PAGE_SIZE),
      });
      const last = bodyOf<PublicProductListDto>(
        await get(`${CATALOG}/products?page=${first.meta.totalPages}`),
      );
      expect(last.data).toHaveLength(VISIBLE - PAGE_SIZE * (first.meta.totalPages - 1));
      const seen = new Set<string>();
      for (let page = 1; page <= first.meta.totalPages; page += 1) {
        const res = bodyOf<PublicProductListDto>(await get(`${CATALOG}/products?page=${page}`));
        for (const item of res.data) seen.add(item.id);
      }
      expect(seen.size).toBe(VISIBLE);
      expect((await get(`${CATALOG}/products?pageSize=51`)).status).toBe(400);
      expect((await get(`${CATALOG}/products?sort=cheapest`)).status).toBe(400);
    });

    it('hides inactive products and products without an active variant', async () => {
      const all: PublicProductCardDto[] = [];
      for (let page = 1; page <= 6; page += 1) {
        all.push(
          ...bodyOf<PublicProductListDto>(await get(`${CATALOG}/products?page=${page}`)).data,
        );
      }
      const slugs = all.map((p) => p.slug);
      expect(slugs).not.toContain('hidden-inactive');
      expect(slugs).not.toContain('only-inactive-variant');
      expect(slugs).toContain('zanzibar-linen-agbada');
    });

    it('sorts by newest (default), price and name, and filters by clothing type', async () => {
      const newest = bodyOf<PublicProductListDto>(await get(`${CATALOG}/products`)).data;
      expect(newest[0]?.slug).toBe('bulk-1');
      const cheap = bodyOf<PublicProductListDto>(
        await get(`${CATALOG}/products?sort=price_asc`),
      ).data;
      expect(cheap[0]?.slug).toBe('hundred-percent');
      const dear = bodyOf<PublicProductListDto>(
        await get(`${CATALOG}/products?sort=price_desc`),
      ).data;
      expect(dear[0]?.slug).toBe('zanzibar-linen-agbada');
      const byName = bodyOf<PublicProductListDto>(await get(`${CATALOG}/products?sort=name`)).data;
      expect(byName[0]?.name).toBe('100% Cotton_Set');
      const trousers = bodyOf<PublicProductListDto>(
        await get(`${CATALOG}/products?clothingType=trouser`),
      );
      expect(trousers.data.map((p) => p.slug).sort()).toEqual([
        'hundred-percent',
        'zanzibar-linen-agbada',
      ]);
      expect(trousers.data[0]?.clothingType).toEqual({ slug: 'trouser', name: 'Trouser' });
    });

    it('returns grid media (poster, loop, 480p/720p only) and an in-stock flag, never retired media', async () => {
      const list = bodyOf<PublicProductListDto>(
        await get(`${CATALOG}/products?pageSize=50&page=2`),
      ).data;
      const all = [
        ...list,
        ...bodyOf<PublicProductListDto>(await get(`${CATALOG}/products?pageSize=50&page=3`)).data,
      ];
      const media = all.find((p) => p.slug === 'with-media');
      expect(media?.inStock).toBe(false);
      expect(media?.media?.dominantColor).toBe('#112233');
      expect(media?.media?.posterUrl).toMatch(
        /\/media-local\/public\/media\/video\/.+\/poster\.jpg$/,
      );
      expect(media?.media?.previewUrl).toMatch(/preview\.mp4$/);
      expect(media?.media?.mp4.map((s) => s.label)).toEqual(['480p', '720p']);
      const retired = all.find((p) => p.slug === 'retired-media');
      expect(retired?.media).toBeNull();
      expect(retired?.inStock).toBe(true);
    });

    it('supports ETag revalidation (304) with short public caching', async () => {
      const first = await get(`${CATALOG}/products?page=2`);
      expect(first.headers['cache-control']).toBe('public, max-age=60');
      const etag = String(first.headers.etag);
      expect(etag).toMatch(/^W\//);
      const again = await get(`${CATALOG}/products?page=2`).set('If-None-Match', etag);
      expect(again.status).toBe(304);
      const otherPage = await get(`${CATALOG}/products?page=3`).set('If-None-Match', etag);
      expect(otherPage.status).toBe(200);
    });
  });

  describe('GET /catalog/search', () => {
    it('searches the whole catalogue (beyond page 1), case-insensitive and trimmed', async () => {
      const res = bodyOf<PublicSearchResultDto>(await get(`${CATALOG}/search?q=%20%20ZANZIBAR%20`));
      expect(res.data.map((p) => p.slug)).toEqual(['zanzibar-linen-agbada']);
      expect(res).toMatchObject({ query: 'ZANZIBAR', meta: { total: 1 } });
      expect(res.code).toBeUndefined();
    });

    it('matches the clothing type name and keywords', async () => {
      const byName = bodyOf<PublicSearchResultDto>(await get(`${CATALOG}/search?q=trouser`));
      expect(byName.data.map((p) => p.slug).sort()).toEqual([
        'hundred-percent',
        'zanzibar-linen-agbada',
      ]);
      const byKeyword = bodyOf<PublicSearchResultDto>(await get(`${CATALOG}/search?q=slacks`));
      expect(byKeyword.meta.total).toBe(2);
      const paged = bodyOf<PublicSearchResultDto>(
        await get(`${CATALOG}/search?q=bulk%20outfit&page=6`),
      );
      expect(paged.meta).toMatchObject({ total: BULK, totalPages: 6 });
      expect(paged.data).toHaveLength(BULK - PAGE_SIZE * 5);
    });

    it('treats % and _ literally and refuses empty or over-long input', async () => {
      const percent = bodyOf<PublicSearchResultDto>(
        await get(`${CATALOG}/search?q=${encodeURIComponent('100%')}`),
      );
      expect(percent.data.map((p) => p.slug)).toEqual(['hundred-percent']);
      const underscore = bodyOf<PublicSearchResultDto>(await get(`${CATALOG}/search?q=n_s`));
      expect(underscore.data.map((p) => p.slug)).toEqual(['hundred-percent']); // "Cotton_Set"
      const onlyWildcard = bodyOf<PublicSearchResultDto>(await get(`${CATALOG}/search?q=%25%25`));
      expect(onlyWildcard.data).toEqual([]);
      const injection = await get(
        `${CATALOG}/search?q=${encodeURIComponent("'; DROP TABLE products; --")}`,
      );
      expect(injection.status).toBe(200);
      expect((await get(`${CATALOG}/search?q=${'a'.repeat(101)}`)).status).toBe(400);
      expect((await get(`${CATALOG}/search?q=%20%20`)).status).toBe(400);
      expect((await get(`${CATALOG}/search`)).status).toBe(400);
    });

    it('returns an empty list with a stable code when nothing matches', async () => {
      const res = await get(`${CATALOG}/search?q=velvet-unicorn`);
      expect(res.status).toBe(200);
      expect(bodyOf<PublicSearchResultDto>(res)).toEqual({
        data: [],
        meta: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 },
        query: 'velvet-unicorn',
        code: 'NO_RESULTS',
      });
    });
  });

  describe('GET /catalog/products/:idOrSlug', () => {
    it('returns detail with size availability and the Blueprint measurement list', async () => {
      const res = await get(`${CATALOG}/products/sized-kaftan`);
      expect(res.status).toBe(200);
      const detail = bodyOf<{ data: PublicProductDetailDto }>(res).data;
      expect(detail.sizes).toEqual([
        { id: expect.any(String) as string, sizeCode: 'M', label: 'Medium', availability: 'out_of_stock' },
        { id: expect.any(String) as string, sizeCode: 'L', label: 'Large', availability: 'low_stock' },
        { id: expect.any(String) as string, sizeCode: 'XL', label: 'Extra Large', availability: 'in_stock' },
      ]);
      expect(detail.blueprint.required).toBe(true);
      expect(detail.blueprint.profile?.measurements.map((m) => m.code)).toEqual([
        'chest',
        'shoulder',
        'sleeve',
        'top_length',
      ]);
      const byId = bodyOf<{ data: PublicProductDetailDto }>(
        await get(`${CATALOG}/products/${ids.sized}`),
      ).data;
      expect(byId.slug).toBe('sized-kaftan');
    });

    it('lists every video size on the detail page; no Blueprint for products without a profile', async () => {
      const detail = bodyOf<{ data: PublicProductDetailDto }>(
        await get(`${CATALOG}/products/with-media`),
      ).data;
      expect(detail.videos[0]?.mp4.map((s) => s.label)).toEqual(['480p', '720p', '1080p']);
      expect(detail.blueprint).toEqual({ required: false, profile: null });
      const retired = bodyOf<{ data: PublicProductDetailDto }>(
        await get(`${CATALOG}/products/retired-media`),
      ).data;
      expect(retired.videos).toEqual([]);
    });

    it('answers 404 for inactive, unsellable and unknown products', async () => {
      for (const ref of [
        'hidden-inactive',
        'only-inactive-variant',
        'nope',
        ids.inactive,
        randomUUID(),
      ]) {
        const res = await get(`${CATALOG}/products/${ref}`);
        expect(res.status).toBe(404);
        expect(bodyOf<ApiErrorBody>(res).error.code).toBe('NOT_FOUND');
      }
      expect((await get(`${CATALOG}/products/Bad%20Slug!`)).status).toBe(400);
    });
  });

  it('lists active clothing types', async () => {
    const res = bodyOf<{ data: PublicClothingTypeDto[] }>(await get(`${CATALOG}/clothing-types`));
    expect(res.data).toEqual([
      { slug: 'shirt', name: 'Shirt' },
      { slug: 'trouser', name: 'Trouser' },
    ]);
  });

  it('GET /site/config exposes only allow-listed settings and active delivery zones', async () => {
    await ctx.db
      .insertInto('delivery_zones')
      .values([
        {
          code: 'lagos',
          name: 'Lagos',
          fee_minor: 250000,
          is_active: true,
          est_days_min: 1,
          est_days_max: 2,
        },
        { code: 'kano-later', name: 'Kano', fee_minor: null, is_active: false },
      ])
      .execute();
    const res = await get('/api/v1/site/config');
    expect(res.status).toBe(200);
    const config = bodyOf<{ data: PublicSiteConfigDto }>(res).data;
    expect(Object.keys(config.settings).sort()).toEqual([...PUBLIC_SETTING_KEYS].sort());
    expect(config.settings).not.toHaveProperty('media.max_video_bytes');
    expect(config.deliveryZones).toEqual([
      { code: 'lagos', name: 'Lagos', feeMinor: 250000, estDaysMin: 1, estDaysMax: 2 },
    ]);
    expect(config).toMatchObject({ defaultLanguage: 'en', languages: ['en', 'pcm'] });
    expect(config.hero?.video).toBeNull();
  });

  it('never leaks internal fields, stock counts or retired media in any public response', async () => {
    const bodies = await Promise.all(
      [
        `${CATALOG}/products?pageSize=50`,
        `${CATALOG}/products?pageSize=50&page=3`,
        `${CATALOG}/search?q=media`,
        `${CATALOG}/products/sized-kaftan`,
        `${CATALOG}/products/with-media`,
        `${CATALOG}/clothing-types`,
        '/api/v1/site/config',
      ].map(async (path) => (await get(path)).body as unknown),
    );
    const keys = collectKeys(bodies);
    expect([...keys].filter((key) => FORBIDDEN_KEYS.has(key))).toEqual([]);
    const text = JSON.stringify(bodies);
    expect(text).not.toContain(retiredAssetId);
    expect(text).not.toContain('original.mp4');
  });

  it('applies a stricter per-IP rate limit to public routes', async () => {
    const limited = await makeMediaTestApp({ PUBLIC_RATE_LIMIT_MAX: '3' });
    try {
      for (let i = 0; i < 3; i += 1) {
        expect((await request(limited.app).get(`${CATALOG}/clothing-types`)).status).toBe(200);
      }
      const blocked = await request(limited.app).get(`${CATALOG}/clothing-types`);
      expect(blocked.status).toBe(429);
      expect(bodyOf<ApiErrorBody>(blocked).error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.db.destroy();
      await limited.cleanup();
    }
  });
});
