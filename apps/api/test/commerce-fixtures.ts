import { randomUUID } from 'node:crypto';
import type {
  AddressDto,
  ApiData,
  CustomerAuthDto,
  DecisionDto,
  OrderDto,
  PaymentInitDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { expect } from 'vitest';
import { webhookSigningSecret } from '../src/modules/payments/provider/create-provider.js';
import {
  createMockPaymentProvider,
  type MockOutcome,
  type MockPaymentProvider,
} from '../src/modules/payments/provider/mock-provider.js';
import { seededClothingTypeId, seededProfileId } from './admin-fixtures.js';
import { bodyOf, type TestContext } from './helpers.js';

/*
 * TEST-ONLY commerce helpers: real API flow (register -> cart -> checkout -> MOCK payment ->
 * verify), so admin tests start from orders exactly as customers create them.
 */

export const API = '/api/v1';
export const PRICE = 1_500_000;
export const FEE = 250_000;
/** Blueprint male_top measurements that map to size L on the seeded chart. */
export const MALE_TOP_L = { chest: 42, shoulder: 17.5, sleeve: 24, top_length: 32 };

export interface CommerceFixture {
  zoneId: string;
  products: { plain: string; fit: string };
  variants: { plainM: string; fitL: string };
  sizes: Map<string, string>;
  mock: MockPaymentProvider;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
const dataOf = <T>(res: request.Response): T => bodyOf<ApiData<T>>(res).data;

export async function createCommerceFixture(
  ctx: TestContext,
  prefix: string,
): Promise<CommerceFixture> {
  const sizes = new Map<string, string>();
  for (const row of await ctx.db.selectFrom('sizes').select(['id', 'code']).execute())
    sizes.set(row.code, row.id);
  const typeId = await seededClothingTypeId(ctx);
  const product = async (
    slug: string,
    profile: string | null,
    sizeCode: string,
    onHand: number,
  ) => {
    const p = await ctx.db
      .insertInto('products')
      .values({
        slug,
        name: slug,
        clothing_type_id: typeId,
        price_minor: PRICE,
        status: 'active',
        measurement_profile_id: profile === null ? null : await seededProfileId(ctx, profile),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const v = await ctx.db
      .insertInto('product_variants')
      .values({
        product_id: p.id,
        size_id: sizes.get(sizeCode) ?? '',
        sku: `${slug}-${sizeCode}`,
        stock_on_hand: onHand,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return [p.id, v.id] as const;
  };
  const [plain, plainM] = await product(`${prefix}-cap`, null, 'M', 10);
  const [fit, fitL] = await product(`${prefix}-fit-kaftan`, 'male_top', 'L', 10);
  const zone = await ctx.db
    .insertInto('delivery_zones')
    .values({
      code: `${prefix.toUpperCase()}_ZONE`.replace(/[^A-Z0-9_]/g, '_'),
      name: `Zone ${prefix}`,
      fee_minor: FEE,
      is_active: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return {
    zoneId: zone.id,
    products: { plain, fit },
    variants: { plainM, fitL },
    sizes,
    mock: createMockPaymentProvider({
      dir: ctx.env.MOCK_PAYMENTS_DIR,
      checkoutBaseUrl: `${ctx.env.API_PUBLIC_URL}${API}`,
      webhookSecret: webhookSigningSecret(ctx.env),
    }),
  };
}

export async function resetFixtureStock(
  ctx: TestContext,
  fixture: CommerceFixture,
  onHand = 10,
): Promise<void> {
  await ctx.db
    .updateTable('product_variants')
    .set({ stock_on_hand: onHand, stock_reserved: 0 })
    .where('id', 'in', [fixture.variants.plainM, fixture.variants.fitL])
    .execute();
}

export async function registerCustomer(
  ctx: TestContext,
  fullName = 'Ada Obi',
): Promise<{ token: string; id: string; email: string }> {
  const email = `buyer-${randomUUID().slice(0, 8)}@example.com`;
  const res = await request(ctx.app)
    .post(`${API}/auth/register`)
    .send({ email, password: 'Ankara-Velvet-2026!', fullName, acceptTerms: true, client: 'web' });
  expect(res.status).toBe(201);
  const auth = dataOf<CustomerAuthDto>(res);
  return { token: auth.tokens.accessToken, id: auth.customer.id, email };
}

export function customerApi(ctx: TestContext, token: string) {
  const auth = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(ctx.app).get(`${API}${path}`)),
    post: (path: string, body: object = {}) =>
      auth(request(ctx.app).post(`${API}${path}`)).send(body),
  };
}

/** Cart (Fit Kaftan with a Blueprint decision + plain cap) -> address -> checkout. */
export async function placeOrder(
  ctx: TestContext,
  fixture: CommerceFixture,
  token: string,
  options: { fitQuantity?: number; plainQuantity?: number; phone?: string } = {},
): Promise<OrderDto> {
  const api = customerApi(ctx, token);
  const fitQuantity = options.fitQuantity ?? 1;
  const plainQuantity = options.plainQuantity ?? 1;
  if (fitQuantity > 0) {
    const decision = await api.post('/blueprint/decisions', {
      productId: fixture.products.fit,
      method: 'MANUAL_MEASUREMENTS',
      measurements: MALE_TOP_L,
      fitPreference: 'tailored',
      selectionMode: 'LOCKED_RECOMMENDATION',
    });
    expect(decision.status).toBe(201);
    const added = await api.post('/cart/items', {
      productId: fixture.products.fit,
      blueprintDecisionId: dataOf<DecisionDto>(decision).id,
      quantity: fitQuantity,
    });
    expect(added.status).toBe(200);
  }
  if (plainQuantity > 0) {
    const added = await api.post('/cart/items', {
      productId: fixture.products.plain,
      sizeId: fixture.sizes.get('M'),
      quantity: plainQuantity,
    });
    expect(added.status).toBe(200);
  }
  const address = dataOf<AddressDto>(
    await api.post('/me/addresses', {
      recipientName: 'Ada Obi',
      phone: options.phone ?? '+2348012345678',
      addressLine1: '12 Admiralty Way',
      city: 'Lagos',
      deliveryZoneId: fixture.zoneId,
    }),
  );
  const res = await api
    .post('/checkout/orders', {
      client: 'web',
      contactEmail: 'ada@example.com',
      contactPhone: options.phone ?? '+2348012345678',
      addressId: address.id,
    })
    .set('Idempotency-Key', `ck-${randomUUID()}`);
  expect(res.status).toBe(201);
  return dataOf<OrderDto>(res);
}

/** Initialize + MOCK provider outcome + verify. Returns the payment reference. */
export async function payOrder(
  ctx: TestContext,
  fixture: CommerceFixture,
  token: string,
  orderId: string,
  outcome: MockOutcome = { status: 'success' },
): Promise<string> {
  const api = customerApi(ctx, token);
  const init = await api.post('/payments/initialize', { orderId });
  expect(init.status).toBe(201);
  const { reference } = dataOf<PaymentInitDto>(init);
  await fixture.mock.setOutcome(reference, outcome);
  expect((await api.get(`/payments/verify?reference=${reference}`)).status).toBe(200);
  return reference;
}
