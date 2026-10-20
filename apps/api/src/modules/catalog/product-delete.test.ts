import { randomUUID } from 'node:crypto';
import type {
  AdminOrderDetailDto,
  ApiData,
  ApiList,
  OrderDto,
  ProductDeletionResultDto,
  ProductSummaryDto,
  PublicProductListDto,
  PublicSearchResultDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  errorCode,
  resetAdminApiData,
  resetBlueprintData,
  signInAdmin,
  type AdminClient,
} from '../../../test/admin-fixtures.js';
import {
  createCommerceFixture,
  customerApi,
  payOrder,
  placeOrder,
  registerCustomer,
  type CommerceFixture,
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

/** Product deletion = soft delete (tester fix 5, 20 Oct 2026). Run as a normal admin. */
describe.skipIf(!hasTestDatabase)('product deletion (soft delete)', () => {
  let ctx: TestContext;
  let admin: AdminClient;
  let adminId: string;
  let fixture: CommerceFixture;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
  const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;
  const del = (id: string) => admin.delete(`/products/${id}`);

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    await resetAdminApiData(ctx);
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx);
    await ctx.db.deleteFrom('admin_audit_logs').execute();
    // A fresh pair of products per test (the deleted ones stay as history rows).
    fixture = await createCommerceFixture(ctx, `t-del-${randomUUID().slice(0, 6)}`);
    const session = await signInAdmin(ctx, 'admin');
    admin = adminClient(ctx, session.token);
    adminId = session.id;
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  async function slugOf(productId: string): Promise<string> {
    const row = await ctx.db
      .selectFrom('products')
      .select('slug')
      .where('id', '=', productId)
      .executeTakeFirstOrThrow();
    return row.slug;
  }

  it('deletes an unreferenced product: hidden everywhere, variants off, audited', async () => {
    const id = fixture.products.plain;
    const slug = await slugOf(id);
    const res = await del(id);
    expect(res.status).toBe(200);
    expect(dataOf<ProductDeletionResultDto>(res)).toMatchObject({
      id,
      removedCartLines: 0,
      detachedMediaIds: [],
      deactivatedVariants: 1,
    });
    expect((await admin.get(`/products/${id}`)).status).toBe(404);
    const list = bodyOf<ApiList<ProductSummaryDto>>(await admin.get('/products?pageSize=50'));
    expect(list.data.map((p) => p.id)).not.toContain(id);
    expect((await admin.get(`/products/${id}/variants`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/v1/catalog/products/${slug}`)).status).toBe(404);
    const shop = bodyOf<PublicProductListDto>(
      await request(ctx.app).get('/api/v1/catalog/products?pageSize=50'),
    );
    expect(shop.data.map((p) => p.id)).not.toContain(id);
    const search = bodyOf<PublicSearchResultDto>(
      await request(ctx.app).get(`/api/v1/catalog/search?q=${encodeURIComponent(slug)}`),
    );
    expect(search.data.map((p) => p.id)).not.toContain(id);
    const row = await ctx.db
      .selectFrom('products')
      .select(['status', 'deleted_at', 'deleted_by'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'archived', deleted_by: adminId });
    expect(row.deleted_at).not.toBeNull();
    const variants = await ctx.db
      .selectFrom('product_variants')
      .select('is_active')
      .where('product_id', '=', id)
      .execute();
    expect(variants.every((v) => !v.is_active)).toBe(true);
    expect(await auditCount(ctx, { action: 'product.delete', entityId: id })).toBe(1);
    // Deleting again: it no longer exists for the admin.
    expect((await del(id)).status).toBe(404);
  });

  it('a product with PAID orders can be deleted; order history stays intact', async () => {
    const buyer = await registerCustomer(ctx);
    const order = await placeOrder(ctx, fixture, buyer.token, { fitQuantity: 0, plainQuantity: 1 });
    await payOrder(ctx, fixture, buyer.token, order.id);
    const id = fixture.products.plain;
    const name = (
      await ctx.db
        .selectFrom('products')
        .select('name')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).name;

    expect((await del(id)).status).toBe(200);

    const detail = dataOf<AdminOrderDetailDto>(await admin.get(`/orders/${order.id}`));
    expect(detail.items[0]).toMatchObject({ productId: id, productName: name, quantity: 1 });
    expect(detail.paymentStatus).toBe('paid');
    const mine = dataOf<OrderDto>(
      await customerApi(ctx, buyer.token).get(`/me/orders/${order.id}`),
    );
    expect(mine.items[0]?.productName).toBe(name);
    // Order items and the stock ledger still reference the product.
    const items = await ctx.db
      .selectFrom('order_items')
      .select('id')
      .where('product_id', '=', id)
      .execute();
    expect(items).toHaveLength(1);
  });

  it('is blocked while an unpaid order holds the product (reservation too)', async () => {
    const buyer = await registerCustomer(ctx);
    await placeOrder(ctx, fixture, buyer.token, { fitQuantity: 0, plainQuantity: 1 });
    const res = await del(fixture.products.plain);
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('PRODUCT_DELETE_BLOCKED');
    const body = bodyOf<{
      error: { message: string; details: { unpaidOrders: number; activeReservations: number } };
    }>(res);
    expect(body.error.details).toMatchObject({ unpaidOrders: 1, activeReservations: 1 });
    expect(body.error.message).toMatch(/unpaid order/);
    // Nothing changed.
    expect((await admin.get(`/products/${fixture.products.plain}`)).status).toBe(200);
    expect(await auditCount(ctx, { action: 'product.delete' })).toBe(0);
  });

  it('is blocked while a return / exchange request is open for it', async () => {
    const buyer = await registerCustomer(ctx);
    const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token, { mode: 'NONE' });
    const created = await customerApi(ctx, buyer.token).post(
      `/me/orders/${order.id}/items/${itemId}/returns`,
      returnBody({ reasonCode: 'changed_mind', explanation: 'Not for me' }),
    );
    expect(created.status).toBe(201);
    const res = await del(fixture.products.plain);
    expect(res.status).toBe(409);
    expect(
      bodyOf<{ error: { details: { openReturns: number } } }>(res).error.details.openReturns,
    ).toBe(1);
  });

  it('is blocked while a media replacement is pending', async () => {
    await ctx.db
      .insertInto('product_pending_media')
      .values({
        product_id: fixture.products.plain,
        slot: 'video',
        asset_ids: [randomUUID()],
        requested_by: adminId,
      })
      .execute();
    const res = await del(fixture.products.plain);
    expect(res.status).toBe(409);
    expect(bodyOf<{ error: { message: string } }>(res).error.message).toMatch(/waiting to replace/);
  });

  it('removes its lines from customers’ active carts and frees the slug for reuse', async () => {
    const buyer = await registerCustomer(ctx);
    const cart = customerApi(ctx, buyer.token);
    expect(
      (
        await cart.post('/cart/items', {
          productId: fixture.products.plain,
          sizeId: fixture.sizes.get('M'),
          quantity: 2,
        })
      ).status,
    ).toBe(200);
    const id = fixture.products.plain;
    const slug = await slugOf(id);
    const res = await del(id);
    expect(dataOf<ProductDeletionResultDto>(res).removedCartLines).toBe(1);
    const after = dataOf<{ lines: { productId: string }[] }>(await cart.get('/cart'));
    expect(after.lines.map((l) => l.productId)).not.toContain(id);
    // Adding it again is refused (no longer available).
    expect(
      (
        await cart.post('/cart/items', {
          productId: id,
          sizeId: fixture.sizes.get('M'),
          quantity: 1,
        })
      ).status,
    ).not.toBe(200);

    const typeId = (
      await ctx.db
        .selectFrom('products')
        .select('clothing_type_id')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).clothing_type_id;
    const reused = await admin.post('/products', {
      name: 'Reused slug',
      slug,
      clothingTypeId: typeId,
      description: 'New product with the old slug.',
      priceMinor: 100_000,
    });
    expect(reused.status).toBe(201);
  });

  it('detaches its media, which stays in the library unused', async () => {
    const video = await ctx.db
      .insertInto('media_assets')
      .values({
        kind: 'video',
        original_key: `test/${randomUUID()}`,
        mime_type: 'video/mp4',
        size_bytes: 10,
        processing_status: 'ready',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await ctx.db
      .updateTable('products')
      .set({ video_asset_id: video.id })
      .where('id', '=', fixture.products.plain)
      .execute();
    const res = await del(fixture.products.plain);
    expect(dataOf<ProductDeletionResultDto>(res).detachedMediaIds).toEqual([video.id]);
    const asset = await ctx.db
      .selectFrom('media_assets')
      .select(['retired_at', 'purged_at'])
      .where('id', '=', video.id)
      .executeTakeFirstOrThrow();
    expect(asset).toEqual({ retired_at: null, purged_at: null });
  });
});
