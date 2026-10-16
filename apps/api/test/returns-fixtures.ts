import { randomUUID } from 'node:crypto';
import type {
  AddressDto,
  ApiData,
  CreateUploadResultDto,
  DecisionDto,
  OrderDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { expect } from 'vitest';
import { type CommerceFixture, MALE_TOP_L, customerApi, payOrder } from './commerce-fixtures.js';
import { bodyOf, type TestContext } from './helpers.js';
import { putToUploadUrl, tinyJpeg } from './media-fixtures.js';

/*
 * TEST-ONLY return helpers: delivered orders (paid through the real flow, then marked delivered)
 * with a LOCKED or OVERRIDE Blueprint decision, and customer evidence uploads.
 */

export type FitMode = 'LOCKED' | 'OVERRIDE' | 'NONE';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
const dataOf = <T>(res: request.Response): T => bodyOf<ApiData<T>>(res).data;

/** Adds an XL variant to the Fit Kaftan (exchange target / override size). */
export async function addFitVariant(
  ctx: TestContext,
  fixture: CommerceFixture,
  sizeCode: string,
  onHand: number,
): Promise<string> {
  const row = await ctx.db
    .insertInto('product_variants')
    .values({
      product_id: fixture.products.fit,
      size_id: fixture.sizes.get(sizeCode) ?? '',
      sku: `${fixture.products.fit.slice(0, 8)}-${sizeCode}-${randomUUID().slice(0, 4)}`,
      stock_on_hand: onHand,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Paid + delivered order with one line: Fit Kaftan (LOCKED / OVERRIDE decision) or the plain cap. */
export async function deliveredOrder(
  ctx: TestContext,
  fixture: CommerceFixture,
  token: string,
  options: { mode?: FitMode; quantity?: number; deliveredDaysAgo?: number } = {},
): Promise<{ order: OrderDto; itemId: string }> {
  const api = customerApi(ctx, token);
  const mode = options.mode ?? 'LOCKED';
  const quantity = options.quantity ?? 1;
  if (mode === 'NONE') {
    expect(
      (
        await api.post('/cart/items', {
          productId: fixture.products.plain,
          sizeId: fixture.sizes.get('M'),
          quantity,
        })
      ).status,
    ).toBe(200);
  } else {
    const decision = await api.post('/blueprint/decisions', {
      productId: fixture.products.fit,
      method: 'MANUAL_MEASUREMENTS',
      measurements: MALE_TOP_L,
      fitPreference: 'standard',
      selectionMode: mode === 'LOCKED' ? 'LOCKED_RECOMMENDATION' : 'OVERRIDE',
      ...(mode === 'OVERRIDE' && { chosenSizeId: fixture.sizes.get('XL') }),
    });
    expect(decision.status).toBe(201);
    const added = await api.post('/cart/items', {
      productId: fixture.products.fit,
      blueprintDecisionId: dataOf<DecisionDto>(decision).id,
      quantity,
    });
    expect(added.status).toBe(200);
  }
  const address = dataOf<AddressDto>(
    await api.post('/me/addresses', {
      recipientName: 'Ada Obi',
      phone: '+2348012345678',
      addressLine1: '12 Admiralty Way',
      city: 'Lagos',
      deliveryZoneId: fixture.zoneId,
    }),
  );
  const placed = await api
    .post('/checkout/orders', {
      client: 'web',
      contactEmail: 'ada@example.com',
      contactPhone: '+2348012345678',
      addressId: address.id,
    })
    .set('Idempotency-Key', `ck-${randomUUID()}`);
  expect(placed.status).toBe(201);
  const order = dataOf<OrderDto>(placed);
  await payOrder(ctx, fixture, token, order.id);
  const deliveredAt = new Date(Date.now() - (options.deliveredDaysAgo ?? 0) * 24 * 60 * 60 * 1000);
  await ctx.db
    .updateTable('orders')
    .set({ order_status: 'delivered', delivered_at: deliveredAt })
    .where('id', '=', order.id)
    .execute();
  const item = order.items[0];
  if (!item) throw new Error('order has no items');
  return { order, itemId: item.id };
}

/** Customer uploads a private evidence photo through the real upload flow. Returns its id. */
export async function uploadEvidence(ctx: TestContext, token: string): Promise<string> {
  const bytes = await tinyJpeg();
  const created = await request(ctx.app)
    .post('/api/v1/me/media/uploads')
    .set('Authorization', `Bearer ${token}`)
    .send({ fileName: 'evidence.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length });
  expect(created.status).toBe(201);
  const { asset, upload } = dataOf<CreateUploadResultDto>(created);
  expect((await putToUploadUrl(ctx, upload, bytes)).status).toBe(200);
  const completed = await request(ctx.app)
    .post(`/api/v1/me/media/${asset.id}/complete`)
    .set('Authorization', `Bearer ${token}`);
  expect(completed.status).toBe(200);
  return asset.id;
}

export function returnBody(overrides: Record<string, unknown> = {}) {
  return {
    requestType: 'RETURN',
    reasonCode: 'does_not_fit',
    explanation: 'Too tight on the chest.',
    quantity: 1,
    ...overrides,
  };
}
