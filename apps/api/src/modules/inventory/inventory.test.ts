import type {
  ApiData,
  ApiList,
  LowStockVariantDto,
  ProductDto,
  StockAdjustmentResultDto,
  StockMovementDto,
  VariantDto,
} from '@urban-ibile/shared';
import { sql } from 'kysely';
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
  type AdminSession,
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
import type { Database } from '../../db/database.js';

/**
 * The checkout reservation recipe (Phase 5) used here to simulate customers holding stock while
 * admins adjust it: ONE conditional UPDATE, zero rows = insufficient stock.
 */
async function reserve(db: Database, variantId: string, quantity: number): Promise<boolean> {
  const result = await db
    .updateTable('product_variants')
    .set((eb) => ({ stock_reserved: eb('stock_reserved', '+', quantity) }))
    .where('id', '=', variantId)
    .where(sql<number>`stock_on_hand - stock_reserved`, '>=', quantity)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

describe.skipIf(!hasTestDatabase)('admin inventory API', () => {
  let ctx: TestContext;
  let admin: AdminSession;
  let api: AdminClient;
  let product: ProductDto;
  let sizeM: string;

  beforeAll(() => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    admin = await signInAdmin(ctx);
    api = adminClient(ctx, admin.token);
    sizeM = await seededSizeId(ctx, 'M');
    const res = await api.post('/products', {
      name: 'Adire Trouser',
      slug: 'adire-trouser',
      clothingTypeId: await seededClothingTypeId(ctx, 'trouser'),
      priceMinor: 1_800_000,
      translations: { en: { description: 'Hand-dyed adire trouser.' } },
    });
    expect(res.status).toBe(201);
    product = bodyOf<ApiData<ProductDto>>(res).data;
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  async function createVariant(sku = 'ADT-M', sizeId = sizeM): Promise<VariantDto> {
    const res = await api.post(`/products/${product.id}/variants`, { sizeId, sku });
    expect(res.status).toBe(201);
    return bodyOf<ApiData<VariantDto>>(res).data;
  }

  function adjust(variantId: string, body: Record<string, unknown>) {
    return api.post(`/variants/${variantId}/stock-adjustments`, body);
  }

  async function ledgerSum(variantId: string): Promise<number> {
    const row = await ctx.db
      .selectFrom('stock_movements')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('quantity_delta'), sql`0`).as('total'))
      .where('variant_id', '=', variantId)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async function stockOf(variantId: string) {
    return ctx.db
      .selectFrom('product_variants')
      .select(['stock_on_hand as onHand', 'stock_reserved as reserved'])
      .where('id', '=', variantId)
      .executeTakeFirstOrThrow();
  }

  describe('variants', () => {
    it('creates one variant per size with a unique SKU, then updates threshold/active', async () => {
      const variant = await createVariant();
      expect(variant).toMatchObject({
        productId: product.id,
        size: { code: 'M' },
        stockOnHand: 0,
        stockAvailable: 0,
      });

      const sameSize = await api.post(`/products/${product.id}/variants`, {
        sizeId: sizeM,
        sku: 'OTHER',
      });
      expect(sameSize.status).toBe(409);
      expect(bodyOf<{ error: { details: unknown } }>(sameSize).error.details).toEqual({
        field: 'sizeId',
      });
      const sameSku = await api.post(`/products/${product.id}/variants`, {
        sizeId: await seededSizeId(ctx, 'L'),
        sku: 'ADT-M',
      });
      expect(bodyOf<{ error: { details: unknown } }>(sameSku).error.details).toEqual({
        field: 'sku',
      });

      const updated = await api.patch(`/variants/${variant.id}`, {
        lowStockThreshold: 5,
        isActive: false,
      });
      expect(bodyOf<ApiData<VariantDto>>(updated).data).toMatchObject({
        lowStockThreshold: 5,
        isActive: false,
      });
      const list = await api.get(`/products/${product.id}/variants`);
      expect(bodyOf<ApiList<VariantDto>>(list).meta.total).toBe(1);
      expect(await auditCount(ctx, { action: 'variant.create', entityId: variant.id })).toBe(1);
      expect(await auditCount(ctx, { action: 'variant.update', entityId: variant.id })).toBe(1);
    });

    it('does not accept stock fields on variant update', async () => {
      const variant = await createVariant();
      const res = await api.patch(`/variants/${variant.id}`, { stockOnHand: 99 });
      expect(res.status).toBe(400);
      expect((await stockOf(variant.id)).onHand).toBe(0);
    });
  });

  describe('stock adjustments', () => {
    it('writes a ledger row (with the admin) and an audit row for each change', async () => {
      const variant = await createVariant();

      const initial = await adjust(variant.id, { type: 'initial', newOnHand: 10 });
      expect(initial.status).toBe(201);
      const result = bodyOf<ApiData<StockAdjustmentResultDto>>(initial).data;
      expect(result.variant.stockOnHand).toBe(10);
      expect(result.movement).toMatchObject({
        type: 'initial',
        quantityDelta: 10,
        admin: { id: admin.id },
      });

      await adjust(variant.id, { type: 'restock', quantity: 5, note: 'Supplier delivery' });
      await adjust(variant.id, { type: 'adjustment', quantity: -2, note: 'Damaged in store' });
      const counted = await adjust(variant.id, {
        type: 'adjustment',
        newOnHand: 12,
        note: 'Stock count',
      });
      expect(bodyOf<ApiData<StockAdjustmentResultDto>>(counted).data.movement.quantityDelta).toBe(
        -1,
      );

      expect((await stockOf(variant.id)).onHand).toBe(12);
      expect(await ledgerSum(variant.id)).toBe(12);
      const movements = await ctx.db
        .selectFrom('stock_movements')
        .select(['admin_id', 'movement_type'])
        .where('variant_id', '=', variant.id)
        .execute();
      expect(movements).toHaveLength(4);
      expect(movements.every((m) => m.admin_id === admin.id)).toBe(true);
      expect(await auditCount(ctx, { action: 'variant.stock_adjust', entityId: variant.id })).toBe(
        4,
      );

      const page = await api.get(`/variants/${variant.id}/stock-movements?pageSize=2`);
      const listed = bodyOf<ApiList<StockMovementDto>>(page);
      expect(listed.meta).toMatchObject({ total: 4, totalPages: 2 });
      expect(listed.data[0]?.type).toBe('adjustment');
    });

    it('allows "initial" only before any movement and requires a note for adjustments', async () => {
      const variant = await createVariant();
      await adjust(variant.id, { type: 'restock', quantity: 3 });
      const initial = await adjust(variant.id, { type: 'initial', newOnHand: 10 });
      expect(initial.status).toBe(409);
      expect(errorCode(initial)).toBe('INVALID_STATE');
      expect((await adjust(variant.id, { type: 'adjustment', quantity: 1 })).status).toBe(400);
      expect(
        (await adjust(variant.id, { type: 'adjustment', quantity: 1, newOnHand: 2, note: 'x' }))
          .status,
      ).toBe(400);
      expect((await stockOf(variant.id)).onHand).toBe(3);
    });

    it('refuses to go below reserved units (STOCK_BELOW_RESERVED) and writes nothing', async () => {
      const variant = await createVariant();
      await adjust(variant.id, { type: 'initial', newOnHand: 10 });
      expect(await reserve(ctx.db, variant.id, 4)).toBe(true);

      const tooLow = await adjust(variant.id, { type: 'adjustment', newOnHand: 3, note: 'Count' });
      expect(tooLow.status).toBe(409);
      expect(errorCode(tooLow)).toBe('STOCK_BELOW_RESERVED');
      const delta = await adjust(variant.id, { type: 'adjustment', quantity: -7, note: 'Loss' });
      expect(errorCode(delta)).toBe('STOCK_BELOW_RESERVED');

      expect(await stockOf(variant.id)).toEqual({ onHand: 10, reserved: 4 });
      expect(await ledgerSum(variant.id)).toBe(10);
      expect(await auditCount(ctx, { action: 'variant.stock_adjust', entityId: variant.id })).toBe(
        1,
      );
      // Exactly down to the reserved units is allowed.
      expect(
        (await adjust(variant.id, { type: 'adjustment', newOnHand: 4, note: 'Count' })).status,
      ).toBe(201);
    });

    it('never produces negative available stock under concurrent adjustments and reservations', async () => {
      const variant = await createVariant();
      await adjust(variant.id, { type: 'initial', newOnHand: 20 });

      const adjustments = Array.from({ length: 12 }, (_, i) =>
        i % 3 === 0
          ? adjust(variant.id, { type: 'restock', quantity: 2 })
          : adjust(variant.id, { type: 'adjustment', quantity: -3, note: `Loss ${i}` }),
      );
      const reservations = Array.from({ length: 15 }, () => reserve(ctx.db, variant.id, 2));
      const [adjustResults, reserveResults] = await Promise.all([
        Promise.all(adjustments),
        Promise.all(reservations),
      ]);

      for (const res of adjustResults) {
        expect([201, 409]).toContain(res.status);
        if (res.status === 409) expect(errorCode(res)).toBe('STOCK_BELOW_RESERVED');
      }
      const { onHand, reserved } = await stockOf(variant.id);
      expect(onHand - reserved).toBeGreaterThanOrEqual(0);
      expect(reserved).toBe(reserveResults.filter(Boolean).length * 2);
      // Every successful on-hand change is in the ledger, and nothing else is.
      expect(await ledgerSum(variant.id)).toBe(onHand);
    });
  });

  it('lists low-stock variants (available <= threshold) of non-archived products', async () => {
    const low = await createVariant('ADT-M');
    const healthy = await createVariant('ADT-L', await seededSizeId(ctx, 'L'));
    await adjust(low.id, { type: 'initial', newOnHand: 2 });
    await adjust(healthy.id, { type: 'initial', newOnHand: 50 });

    const res = await api.get('/inventory/low-stock');
    const list = bodyOf<ApiList<LowStockVariantDto>>(res);
    expect(list.data.map((v) => v.id)).toEqual([low.id]);
    expect(list.data[0]).toMatchObject({
      isLowStock: true,
      stockAvailable: 2,
      product: { id: product.id, name: 'Adire Trouser' },
    });

    await api.post(`/products/${product.id}/status`, { status: 'archived' });
    expect(bodyOf<ApiList<LowStockVariantDto>>(await api.get('/inventory/low-stock')).data).toEqual(
      [],
    );
  });
});
