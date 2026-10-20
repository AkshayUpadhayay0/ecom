import { randomUUID } from 'node:crypto';
import type {
  ApiData,
  ApiList,
  ProductDto,
  PublicProductListDto,
  VariantArchiveResultDto,
  VariantDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  errorCode,
  resetAdminApiData,
  resetBlueprintData,
  seededClothingTypeId,
  signInAdmin,
  type AdminClient,
} from '../../../test/admin-fixtures.js';
import {
  createCommerceFixture,
  customerApi,
  placeOrder,
  registerCustomer,
} from '../../../test/commerce-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../../test/helpers.js';
import { deliveredOrder, returnBody } from '../../../test/returns-fixtures.js';

/** Deleting a size = archive (tester fix 6, 20 Oct 2026). Run as a normal admin. */
describe.skipIf(!hasTestDatabase)('variant (size) deletion = archive', () => {
  let ctx: TestContext;
  let admin: AdminClient;
  let sizes: Map<string, string>;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
  const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    await resetAdminApiData(ctx);
    sizes = new Map(
      (await ctx.db.selectFrom('sizes').select(['id', 'code']).execute()).map((s) => [
        s.code,
        s.id,
      ]),
    );
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx);
    await ctx.db.deleteFrom('admin_audit_logs').execute();
    admin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  /** An active product with the given sizes and stock, created through the admin API. */
  async function productWith(stock: Record<string, number>) {
    const slug = `t-va-${randomUUID().slice(0, 8)}`;
    const product = dataOf<ProductDto>(
      await admin.post('/products', {
        name: slug,
        slug,
        clothingTypeId: await seededClothingTypeId(ctx),
        description: 'Test product.',
        priceMinor: 100_000,
        status: 'active',
      }),
    );
    const variants: Record<string, VariantDto> = {};
    for (const [code, onHand] of Object.entries(stock)) {
      const variant = dataOf<VariantDto>(
        await admin.post(`/products/${product.id}/variants`, {
          sizeId: sizes.get(code),
          sku: `${slug}-${code}`,
        }),
      );
      if (onHand > 0) {
        await admin.post(`/variants/${variant.id}/stock-adjustments`, {
          type: 'initial',
          newOnHand: onHand,
          note: 'Opening stock',
        });
      }
      variants[code] = variant;
    }
    return { product, variants, slug };
  }

  async function ledgerSum(variantId: string): Promise<number> {
    const rows = await ctx.db
      .selectFrom('stock_movements')
      .select('quantity_delta')
      .where('variant_id', '=', variantId)
      .where('movement_type', 'in', ['initial', 'restock', 'adjustment', 'sale', 'return'])
      .execute();
    return rows.reduce((sum, row) => sum + row.quantity_delta, 0);
  }

  it('with stock: writes the rest off through the ledger, archives, hides it, audits', async () => {
    const { product, variants } = await productWith({ M: 5, L: 2 });
    const m = variants.M;
    if (!m) throw new Error('missing M');
    const res = await admin.delete(`/variants/${m.id}`).send({ note: 'Discontinued colour' });
    expect(res.status).toBe(200);
    const result = dataOf<VariantArchiveResultDto>(res);
    expect(result).toMatchObject({ variantId: m.id, writtenOff: 5, productStillSellable: true });
    expect(result.movementId).not.toBeNull();

    const row = await ctx.db
      .selectFrom('product_variants')
      .select(['stock_on_hand', 'stock_reserved', 'is_active', 'archived_at'])
      .where('id', '=', m.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ stock_on_hand: 0, stock_reserved: 0, is_active: false });
    expect(row.archived_at).not.toBeNull();
    // Ledger consistency: movements add up to the (zero) stock on hand.
    expect(await ledgerSum(m.id)).toBe(0);
    const writeOff = await ctx.db
      .selectFrom('stock_movements')
      .select(['movement_type', 'quantity_delta', 'note'])
      .where('id', '=', result.movementId ?? '0')
      .executeTakeFirstOrThrow();
    expect(writeOff).toMatchObject({ movement_type: 'adjustment', quantity_delta: -5 });
    expect(writeOff.note).toMatch(/written off.*Discontinued colour/);

    const list = bodyOf<ApiList<VariantDto>>(await admin.get(`/products/${product.id}/variants`));
    expect(list.data.map((v) => v.id)).toEqual([variants.L?.id]);
    expect((await admin.get(`/variants/${m.id}/stock-movements`)).status).toBe(404);
    expect((await admin.patch(`/variants/${m.id}`, { lowStockThreshold: 1 })).status).toBe(404);
    expect(await auditCount(ctx, { action: 'variant.archive', entityId: m.id })).toBe(1);
  });

  it('without stock: no ledger row; deleting the last active size makes the product unsellable', async () => {
    const { variants, slug } = await productWith({ S: 0 });
    const s = variants.S;
    if (!s) throw new Error('missing S');
    const result = dataOf<VariantArchiveResultDto>(await admin.delete(`/variants/${s.id}`));
    expect(result).toMatchObject({ writtenOff: 0, movementId: null, productStillSellable: false });
    expect(await ledgerSum(s.id)).toBe(0);
    const shop = bodyOf<PublicProductListDto>(
      await request(ctx.app).get('/api/v1/catalog/products?pageSize=50'),
    );
    expect(shop.data.map((p) => p.slug)).not.toContain(slug);
  });

  it('the same size can be added again and the SKU reused after deletion', async () => {
    const { product, variants } = await productWith({ M: 0 });
    const m = variants.M;
    if (!m) throw new Error('missing M');
    expect((await admin.delete(`/variants/${m.id}`)).status).toBe(200);
    const again = await admin.post(`/products/${product.id}/variants`, {
      sizeId: sizes.get('M'),
      sku: m.sku,
    });
    expect(again.status).toBe(201);
  });

  it('is blocked while units are reserved by an unpaid checkout', async () => {
    const fixture = await createCommerceFixture(ctx, `t-va-${randomUUID().slice(0, 6)}`);
    const buyer = await registerCustomer(ctx);
    await placeOrder(ctx, fixture, buyer.token, { fitQuantity: 0, plainQuantity: 1 });
    const res = await admin.delete(`/variants/${fixture.variants.plainM}`);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('VARIANT_DELETE_BLOCKED');
    expect(bodyOf<{ error: { message: string } }>(res).error.message).toMatch(/reserved/);
    expect(await auditCount(ctx, { action: 'variant.archive' })).toBe(0);
  });

  it('is blocked while a return / exchange request is open for it', async () => {
    const fixture = await createCommerceFixture(ctx, `t-va-${randomUUID().slice(0, 6)}`);
    const buyer = await registerCustomer(ctx);
    const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token, { mode: 'NONE' });
    expect(
      (
        await customerApi(ctx, buyer.token).post(
          `/me/orders/${order.id}/items/${itemId}/returns`,
          returnBody({ reasonCode: 'changed_mind', explanation: 'Not for me' }),
        )
      ).status,
    ).toBe(201);
    const res = await admin.delete(`/variants/${fixture.variants.plainM}`);
    expect(res.status).toBe(409);
    expect(bodyOf<{ error: { message: string } }>(res).error.message).toMatch(/return or exchange/);
  });

  it('removes the size from customers’ active carts', async () => {
    const fixture = await createCommerceFixture(ctx, `t-va-${randomUUID().slice(0, 6)}`);
    const buyer = await registerCustomer(ctx);
    const cart = customerApi(ctx, buyer.token);
    expect(
      (
        await cart.post('/cart/items', {
          productId: fixture.products.plain,
          sizeId: fixture.sizes.get('M'),
          quantity: 1,
        })
      ).status,
    ).toBe(200);
    const result = dataOf<VariantArchiveResultDto>(
      await admin.delete(`/variants/${fixture.variants.plainM}`),
    );
    expect(result.removedCartLines).toBe(1);
    const after = dataOf<{ lines: unknown[] }>(await cart.get('/cart'));
    expect(after.lines).toEqual([]);
  });
});
