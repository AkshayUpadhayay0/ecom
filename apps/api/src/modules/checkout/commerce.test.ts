import { randomUUID } from 'node:crypto';
import type {
  AddressDto,
  ApiData,
  ApiErrorBody,
  ApiList,
  CartDto,
  CustomerAuthDto,
  CustomerDeliveryZoneDto,
  DecisionDto,
  OrderDto,
  OrderSummaryDto,
  QuoteDto,
} from '@urban-ibile/shared';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  resetAdminApiData,
  resetBlueprintData,
  restoreSettings,
  seededClothingTypeId,
  seededProfileId,
  snapshotSettings,
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
import { createReservationsRepository } from '../inventory/reservations.repository.js';
import { createOrdersRepository } from '../orders/orders.repository.js';
import { releaseExpiredReservations } from './reservation-expiry.js';

const API = '/api/v1';
const MALE_TOP = { chest: 42, shoulder: 17.5, sleeve: 24, top_length: 32 }; // -> L
const PRICE = 1_500_000;
const FEE = 250_000;
const KAFTAN_STOCK = { M: 5, L: 3, XL: 3 };

describe.skipIf(!hasTestDatabase)('Cart, delivery quote, checkout and orders', () => {
  let ctx: TestContext;
  let settingsSnapshot: SettingsSnapshot;
  let token: string;
  let otherToken: string;
  const sizeIds = new Map<string, string>();
  const products = {} as Record<'kaftan' | 'cap' | 'limited', string>;
  const zones = {} as Record<'active' | 'inactive' | 'unpriced', string>;

  const errorOf = (res: request.Response) => bodyOf<ApiErrorBody>(res).error;
  // The type parameter only names the expected response DTO (same pattern as bodyOf).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;

  async function register(): Promise<string> {
    const res = await request(ctx.app)
      .post(`${API}/auth/register`)
      .send({
        email: `buyer-${randomUUID().slice(0, 8)}@example.com`,
        password: 'Ankara-Velvet-2026!',
        fullName: 'Checkout Tester',
        acceptTerms: true,
        client: 'web',
      });
    expect(res.status).toBe(201);
    return dataOf<CustomerAuthDto>(res).tokens.accessToken;
  }

  const as = (bearer: string) => {
    const auth = (test: request.Test) => test.set('Authorization', `Bearer ${bearer}`);
    return {
      get: (path: string) => auth(request(ctx.app).get(`${API}${path}`)),
      post: (path: string, body: object = {}) =>
        auth(request(ctx.app).post(`${API}${path}`)).send(body),
      patch: (path: string, body: object) =>
        auth(request(ctx.app).patch(`${API}${path}`)).send(body),
      put: (path: string, body: object) => auth(request(ctx.app).put(`${API}${path}`)).send(body),
      delete: (path: string) => auth(request(ctx.app).delete(`${API}${path}`)),
    };
  };
  const me = () => as(token);

  async function createProduct(
    slug: string,
    profileCode: string | null,
    stock: Record<string, number>,
  ) {
    const product = await ctx.db
      .insertInto('products')
      .values({
        slug,
        name: slug,
        clothing_type_id: await seededClothingTypeId(ctx),
        price_minor: PRICE,
        status: 'active',
        measurement_profile_id: profileCode ? await seededProfileId(ctx, profileCode) : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const [code, onHand] of Object.entries(stock)) {
      await ctx.db
        .insertInto('product_variants')
        .values({
          product_id: product.id,
          size_id: sizeIds.get(code) ?? '',
          sku: `${slug}-${code}`,
          stock_on_hand: onHand,
        })
        .execute();
    }
    return product.id;
  }

  async function setStock(productId: string, stock: Record<string, number>): Promise<void> {
    for (const [code, onHand] of Object.entries(stock)) {
      await ctx.db
        .updateTable('product_variants')
        .set({ stock_on_hand: onHand, stock_reserved: 0, is_active: true })
        .where('product_id', '=', productId)
        .where('size_id', '=', sizeIds.get(code) ?? '')
        .execute();
    }
  }

  async function variant(productId: string, code: string) {
    return ctx.db
      .selectFrom('product_variants')
      .select(['id', 'stock_on_hand as onHand', 'stock_reserved as reserved'])
      .where('product_id', '=', productId)
      .where('size_id', '=', sizeIds.get(code) ?? '')
      .executeTakeFirstOrThrow();
  }

  async function lockedDecision(bearer = token, measurements = MALE_TOP): Promise<DecisionDto> {
    const res = await as(bearer).post('/blueprint/decisions', {
      productId: products.kaftan,
      method: 'MANUAL_MEASUREMENTS',
      measurements,
      fitPreference: 'tailored',
      selectionMode: 'LOCKED_RECOMMENDATION',
    });
    expect(res.status).toBe(201);
    return dataOf<DecisionDto>(res);
  }

  async function addKaftan(bearer = token, quantity = 1): Promise<CartDto> {
    const decision = await lockedDecision(bearer);
    const res = await as(bearer).post('/cart/items', {
      productId: products.kaftan,
      blueprintDecisionId: decision.id,
      quantity,
    });
    expect(res.status).toBe(200);
    return dataOf<CartDto>(res);
  }

  async function addCap(
    bearer = token,
    quantity = 1,
    productId = products.cap,
  ): Promise<request.Response> {
    return as(bearer).post('/cart/items', { productId, sizeId: sizeIds.get('M'), quantity });
  }

  async function createAddress(bearer = token, zoneId = zones.active): Promise<AddressDto> {
    const res = await as(bearer).post('/me/addresses', {
      recipientName: 'Ada Obi',
      phone: '+2348012345678',
      addressLine1: '12 Admiralty Way',
      city: 'Lagos',
      state: 'Lagos',
      deliveryZoneId: zoneId,
    });
    expect(res.status).toBe(201);
    return dataOf<AddressDto>(res);
  }

  function checkoutBody(addressId: string) {
    return {
      client: 'web',
      contactEmail: 'ada@example.com',
      contactPhone: '+2348012345678',
      addressId,
    };
  }

  function checkout(bearer: string, key: string | null, body: object): request.Test {
    const test = as(bearer).post('/checkout/orders', body);
    return key === null ? test : test.set('Idempotency-Key', key);
  }

  const key = () => `ck-${randomUUID()}`;
  const expiryDeps = () => ({
    db: ctx.db,
    orders: createOrdersRepository(),
    reservations: createReservationsRepository(),
    logger: pino({ level: 'silent' }),
  });

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    await resetAdminApiData(ctx);
    settingsSnapshot = await snapshotSettings(ctx);
    for (const row of await ctx.db.selectFrom('sizes').select(['id', 'code']).execute()) {
      sizeIds.set(row.code, row.id);
    }
    products.kaftan = await createProduct('t-co-fit-kaftan', 'male_top', KAFTAN_STOCK);
    products.cap = await createProduct('t-co-cap', null, { M: 10 });
    products.limited = await createProduct('t-co-limited', null, { M: 3 });
    // SAMPLE delivery zones for tests only.
    const zone = (code: string, fee: number | null, active: boolean) =>
      ctx.db
        .insertInto('delivery_zones')
        .values({
          code,
          name: `Zone ${code}`,
          fee_minor: fee,
          is_active: active,
          est_days_min: 1,
          est_days_max: 3,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id);
    zones.active = await zone('T_LAGOS', FEE, true);
    zones.inactive = await zone('T_CLOSED', FEE, false);
    zones.unpriced = await zone('T_UNPRICED', null, false);
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx); // also clears carts, orders, reservations, addresses
    await restoreSettings(ctx, settingsSnapshot);
    await ctx.db.updateTable('products').set({ status: 'active', price_minor: PRICE }).execute();
    await ctx.db
      .updateTable('products')
      .set({ name: 't-co-fit-kaftan' })
      .where('id', '=', products.kaftan)
      .execute();
    await setStock(products.kaftan, KAFTAN_STOCK);
    await setStock(products.cap, { M: 10 });
    await setStock(products.limited, { M: 3 });
    token = await register();
    otherToken = await register();
  });

  afterAll(async () => {
    await restoreSettings(ctx, settingsSnapshot);
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  it('requires a customer login on every commerce route', async () => {
    const id = randomUUID();
    for (const [method, path] of [
      ['get', '/me/addresses'],
      ['post', '/me/addresses'],
      ['get', '/cart'],
      ['post', '/cart/items'],
      ['patch', `/cart/items/${id}`],
      ['delete', `/cart/items/${id}`],
      ['put', `/cart/items/${id}/decision`],
      ['get', '/delivery/zones'],
      ['post', '/checkout/quote'],
      ['post', '/checkout/orders'],
      ['get', '/me/orders'],
      ['get', `/me/orders/${id}`],
    ] as const) {
      expect(
        (await request(ctx.app)[method](`${API}${path}`).send({})).status,
        `${method} ${path}`,
      ).toBe(401);
    }
  });

  describe('addresses', () => {
    it('makes the first address the default, scopes to the owner and promotes on delete', async () => {
      const first = await createAddress();
      expect(first).toMatchObject({
        isDefault: true,
        deliveryZone: { id: zones.active, code: 'T_LAGOS' },
      });
      const second = await createAddress();
      expect(second.isDefault).toBe(false);

      const promoted = await me().patch(`/me/addresses/${second.id}`, { isDefault: true });
      expect(dataOf<AddressDto>(promoted).isDefault).toBe(true);
      const list = dataOf<AddressDto[]>(await me().get('/me/addresses'));
      expect(list.map((a) => [a.id, a.isDefault])).toEqual([
        [second.id, true],
        [first.id, false],
      ]);

      expect(
        (await as(otherToken).patch(`/me/addresses/${first.id}`, { city: 'Abuja' })).status,
      ).toBe(404);
      expect((await as(otherToken).delete(`/me/addresses/${first.id}`)).status).toBe(404);
      expect(dataOf<AddressDto[]>(await as(otherToken).get('/me/addresses'))).toEqual([]);

      expect((await me().delete(`/me/addresses/${second.id}`)).status).toBe(204);
      expect(dataOf<AddressDto[]>(await me().get('/me/addresses'))).toMatchObject([
        { id: first.id, isDefault: true },
      ]);
    });

    it('rejects an inactive or unknown delivery zone', async () => {
      for (const zoneId of [zones.inactive, zones.unpriced, randomUUID()]) {
        const res = await me().post('/me/addresses', {
          recipientName: 'Ada',
          phone: '+2348012345678',
          addressLine1: '1 Road',
          city: 'Lagos',
          deliveryZoneId: zoneId,
        });
        expect(res.status).toBe(400);
        expect(errorOf(res).code).toBe('INVALID_DELIVERY_ZONE');
      }
    });
  });

  describe('cart rules', () => {
    it('requires a fitting decision for Blueprint products and a size for others', async () => {
      const noDecision = await me().post('/cart/items', {
        productId: products.kaftan,
        sizeId: sizeIds.get('L'),
        quantity: 1,
      });
      expect(noDecision.status).toBe(409);
      expect(errorOf(noDecision).code).toBe('BLUEPRINT_DECISION_REQUIRED');

      const noSize = await me().post('/cart/items', { productId: products.cap, quantity: 1 });
      expect(errorOf(noSize).code).toBe('VALIDATION_ERROR');

      const othersDecision = await lockedDecision(otherToken);
      const stolen = await me().post('/cart/items', {
        productId: products.kaftan,
        blueprintDecisionId: othersDecision.id,
        quantity: 1,
      });
      expect(errorOf(stolen).code).toBe('BLUEPRINT_DECISION_INVALID');

      const cart = await addKaftan();
      expect(cart.lines).toMatchObject([
        {
          product: { id: products.kaftan },
          size: { code: 'L' },
          quantity: 1,
          unitPriceMinor: PRICE,
          warnings: [],
        },
      ]);
      expect(cart.lines[0]?.decision).toMatchObject({
        selectionMode: 'LOCKED_RECOMMENDATION',
        recommendedSizeCode: 'L',
      });
    });

    it('refuses sizes not offered, inactive products, quantities over the limit or the stock', async () => {
      const notOffered = await me().post('/cart/items', {
        productId: products.cap,
        sizeId: sizeIds.get('XXL'),
        quantity: 1,
      });
      expect(errorOf(notOffered).code).toBe('SIZE_NOT_OFFERED');

      const tooMany = await addCap(token, 11);
      expect(errorOf(tooMany)).toMatchObject({
        code: 'QUANTITY_LIMIT_EXCEEDED',
        details: { maxQuantity: 10 },
      });

      const overStock = await addCap(token, 4, products.limited);
      expect(errorOf(overStock).code).toBe('INSUFFICIENT_STOCK');

      await ctx.db
        .updateTable('products')
        .set({ status: 'archived' })
        .where('id', '=', products.cap)
        .execute();
      expect(errorOf(await addCap()).code).toBe('PRODUCT_UNAVAILABLE');
    });

    it('merges the same product + size into one line and edits / removes lines', async () => {
      await addCap(token, 2);
      const merged = dataOf<CartDto>(await addCap(token, 3));
      expect(merged.lines).toHaveLength(1);
      expect(merged).toMatchObject({ itemCount: 5, subtotalMinor: 5 * PRICE, canCheckout: true });
      const lineId = merged.lines[0]?.id ?? '';

      expect(errorOf(await addCap(token, 6)).code).toBe('QUANTITY_LIMIT_EXCEEDED');
      const updated = dataOf<CartDto>(await me().patch(`/cart/items/${lineId}`, { quantity: 1 }));
      expect(updated.itemCount).toBe(1);
      expect((await as(otherToken).patch(`/cart/items/${lineId}`, { quantity: 2 })).status).toBe(
        404,
      );
      expect((await as(otherToken).delete(`/cart/items/${lineId}`)).status).toBe(404);

      const emptied = dataOf<CartDto>(await me().delete(`/cart/items/${lineId}`));
      expect(emptied).toMatchObject({ lines: [], itemCount: 0, canCheckout: false });
    });

    it('moves a line to the size of a replacement decision', async () => {
      const cart = await addKaftan();
      const bigger = await lockedDecision(token, { ...MALE_TOP, chest: 44 });
      const res = await me().put(`/cart/items/${cart.lines[0]?.id ?? ''}/decision`, {
        blueprintDecisionId: bigger.id,
      });
      expect(res.status).toBe(200);
      expect(dataOf<CartDto>(res).lines).toMatchObject([
        { size: { code: bigger.selectedSize.code }, decision: { id: bigger.id } },
      ]);
    });

    it('shows PRICE_CHANGED, STOCK_LOW, OUT_OF_STOCK and UNAVAILABLE warnings with current prices', async () => {
      await addCap(token, 3, products.limited);
      await ctx.db
        .updateTable('products')
        .set({ price_minor: PRICE + 1000 })
        .where('id', '=', products.limited)
        .execute();
      let cart = dataOf<CartDto>(await me().get('/cart'));
      expect(cart.lines[0]).toMatchObject({
        unitPriceMinor: PRICE + 1000,
        addedUnitPriceMinor: PRICE,
        warnings: ['PRICE_CHANGED'],
      });
      expect(cart.canCheckout).toBe(true);

      await setStock(products.limited, { M: 2 });
      cart = dataOf<CartDto>(await me().get('/cart'));
      expect(cart.lines[0]?.warnings).toEqual(['PRICE_CHANGED', 'STOCK_LOW']);
      expect(cart.canCheckout).toBe(false);

      await setStock(products.limited, { M: 0 });
      expect(dataOf<CartDto>(await me().get('/cart')).lines[0]?.warnings).toContain('OUT_OF_STOCK');

      await ctx.db
        .updateTable('products')
        .set({ status: 'archived' })
        .where('id', '=', products.limited)
        .execute();
      cart = dataOf<CartDto>(await me().get('/cart'));
      expect(cart.lines[0]?.warnings).toContain('UNAVAILABLE');
      expect(cart.subtotalMinor).toBe(0);
    });
  });

  describe('delivery zones and quote', () => {
    it('lists only active, priced zones', async () => {
      const list = dataOf<CustomerDeliveryZoneDto[]>(await me().get('/delivery/zones'));
      expect(list.map((z) => z.code)).toEqual(['T_LAGOS']);
      expect(list[0]).toMatchObject({ feeMinor: FEE, estDaysMin: 1, estDaysMax: 3 });
    });

    it('quotes subtotal + zone fee = total by zone or by saved address', async () => {
      await addCap(token, 2);
      const byZone = dataOf<QuoteDto>(await me().post('/checkout/quote', { zoneId: zones.active }));
      expect(byZone).toMatchObject({
        currency: 'NGN',
        subtotalMinor: 2 * PRICE,
        deliveryFeeMinor: FEE,
        totalMinor: 2 * PRICE + FEE,
        zone: { code: 'T_LAGOS' },
        canCheckout: true,
      });
      const address = await createAddress();
      const byAddress = dataOf<QuoteDto>(
        await me().post('/checkout/quote', { addressId: address.id }),
      );
      expect(byAddress.totalMinor).toBe(byZone.totalMinor);
      expect((await as(otherToken).post('/checkout/quote', { addressId: address.id })).status).toBe(
        404,
      );
    });

    it('rejects inactive zones and zones without a fee', async () => {
      const inactive = await me().post('/checkout/quote', { zoneId: zones.inactive });
      expect(inactive.status).toBe(400);
      expect(errorOf(inactive).code).toBe('INVALID_DELIVERY_ZONE');
      const unpriced = await me().post('/checkout/quote', { zoneId: zones.unpriced });
      expect(unpriced.status).toBe(409);
      expect(errorOf(unpriced).code).toBe('DELIVERY_FEE_NOT_CONFIGURED');
      expect(
        errorOf(
          await me().post('/checkout/quote', { zoneId: zones.active, addressId: randomUUID() }),
        ).code,
      ).toBe('VALIDATION_ERROR');
    });
  });

  describe('checkout', () => {
    it('creates a pending, unpaid order with snapshots, server totals and held stock', async () => {
      await addKaftan(token, 2);
      await addCap(token, 1);
      const address = await createAddress();
      const res = await checkout(token, key(), checkoutBody(address.id));
      expect(res.status).toBe(201);
      const order = dataOf<OrderDto>(res);
      expect(order).toMatchObject({
        orderStatus: 'pending_payment',
        paymentStatus: 'unpaid',
        currency: 'NGN',
        subtotalMinor: 3 * PRICE,
        deliveryFeeMinor: FEE,
        totalMinor: 3 * PRICE + FEE,
        contact: { email: 'ada@example.com' },
        delivery: { recipientName: 'Ada Obi', city: 'Lagos', zoneName: 'Zone T_LAGOS' },
        cancelReason: null,
      });
      expect(order.orderNumber).toMatch(/^UI-\d+$/);
      expect(new Date(order.reservationExpiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());
      const kaftanLine = order.items.find((i) => i.productId === products.kaftan);
      expect(kaftanLine).toMatchObject({
        sizeLabel: expect.any(String) as string,
        sku: 't-co-fit-kaftan-L',
        quantity: 2,
        lineTotalMinor: 2 * PRICE,
        fit: {
          method: 'MANUAL_MEASUREMENTS',
          selectionMode: 'LOCKED_RECOMMENDATION',
          fitPreference: 'tailored',
        },
      });
      expect(order.items.find((i) => i.productId === products.cap)?.fit).toBeNull();

      expect((await variant(products.kaftan, 'L')).reserved).toBe(2);
      expect((await variant(products.cap, 'M')).reserved).toBe(1);
      const history = await ctx.db
        .selectFrom('order_status_history')
        .selectAll()
        .where('order_id', '=', order.id)
        .execute();
      expect(history).toMatchObject([
        { from_status: null, to_status: 'pending_payment', changed_by_admin: null },
      ]);
      const stored = await ctx.db
        .selectFrom('order_items')
        .select('blueprint_decision_id')
        .where('order_id', '=', order.id)
        .execute();
      expect(stored.filter((r) => r.blueprint_decision_id !== null)).toHaveLength(1);

      // The cart is kept until payment succeeds (Phase 6).
      expect(dataOf<CartDto>(await me().get('/cart')).itemCount).toBe(3);
    });

    it('requires a valid Idempotency-Key header and a non-empty cart', async () => {
      const address = await createAddress();
      const missing = await checkout(token, null, checkoutBody(address.id));
      expect(missing.status).toBe(400);
      expect(errorOf(missing).code).toBe('VALIDATION_ERROR');
      expect(errorOf(await checkout(token, 'short', checkoutBody(address.id))).code).toBe(
        'VALIDATION_ERROR',
      );
      const empty = await checkout(token, key(), checkoutBody(address.id));
      expect(empty.status).toBe(409);
      expect(errorOf(empty).code).toBe('CART_EMPTY');
    });

    it('accepts a new address in the checkout body and saves it to the account', async () => {
      await addCap();
      const res = await checkout(token, key(), {
        client: 'android',
        contactEmail: 'ada@example.com',
        contactPhone: '+2348012345678',
        address: {
          recipientName: 'Ngozi',
          phone: '+2348000000000',
          addressLine1: '5 Allen Ave',
          city: 'Ikeja',
          deliveryZoneId: zones.active,
        },
      });
      expect(res.status).toBe(201);
      expect(dataOf<OrderDto>(res).delivery.recipientName).toBe('Ngozi');
      expect(dataOf<AddressDto[]>(await me().get('/me/addresses'))).toMatchObject([
        { recipientName: 'Ngozi', isDefault: true },
      ]);
    });

    it('is idempotent: same key + payload returns the same order, a different payload conflicts', async () => {
      await addCap(token, 2);
      const address = await createAddress();
      const k = key();
      const first = await checkout(token, k, checkoutBody(address.id));
      expect(first.status).toBe(201);
      const again = await checkout(token, k, checkoutBody(address.id));
      expect(again.status).toBe(200);
      expect(dataOf<OrderDto>(again).id).toBe(dataOf<OrderDto>(first).id);

      const changed = await checkout(token, k, {
        ...checkoutBody(address.id),
        contactEmail: 'other@example.com',
      });
      expect(changed.status).toBe(409);
      expect(errorOf(changed).code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await variant(products.cap, 'M')).reserved).toBe(2);
    });

    it('handles a double click (parallel requests with one key) as one order', async () => {
      await addCap(token, 1);
      const address = await createAddress();
      const k = key();
      const results = await Promise.all(
        [0, 1, 2].map(() => checkout(token, k, checkoutBody(address.id))),
      );
      const ids = new Set(results.map((r) => dataOf<OrderDto>(r).id));
      expect(ids.size).toBe(1);
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(await ctx.db.selectFrom('orders').select('id').execute()).toHaveLength(1);
      expect((await variant(products.cap, 'M')).reserved).toBe(1);
    });

    it('reuses the unchanged open order (extending the hold) and replaces a changed one', async () => {
      await addCap(token, 1);
      const address = await createAddress();
      const first = dataOf<OrderDto>(await checkout(token, key(), checkoutBody(address.id)));
      await ctx.db
        .updateTable('orders')
        .set({ reservation_expires_at: new Date(Date.now() + 60_000) })
        .where('id', '=', first.id)
        .execute();

      const reused = await checkout(token, key(), checkoutBody(address.id));
      expect(reused.status).toBe(200);
      const reusedOrder = dataOf<OrderDto>(reused);
      expect(reusedOrder.id).toBe(first.id);
      expect(new Date(reusedOrder.reservationExpiresAt ?? 0).getTime()).toBeGreaterThan(
        Date.now() + 120_000,
      );
      expect((await variant(products.cap, 'M')).reserved).toBe(1);

      await addCap(token, 1); // cart changed -> old order cancelled, stock released, new order
      const replaced = await checkout(token, key(), checkoutBody(address.id));
      expect(replaced.status).toBe(201);
      expect(dataOf<OrderDto>(replaced).id).not.toBe(first.id);
      const old = dataOf<OrderDto>(await me().get(`/me/orders/${first.id}`));
      expect(old).toMatchObject({
        orderStatus: 'cancelled',
        cancelReason: 'superseded_by_new_checkout',
        reservationExpiresAt: null,
      });
      expect((await variant(products.cap, 'M')).reserved).toBe(2);
      const released = await ctx.db
        .selectFrom('stock_reservations')
        .select('status')
        .where('order_id', '=', first.id)
        .execute();
      expect(released).toEqual([{ status: 'released' }]);
    });

    it('caps hold extensions at checkout.reservation_max_total_minutes from placement', async () => {
      await addCap(token, 1);
      const address = await createAddress();
      const first = dataOf<OrderDto>(await checkout(token, key(), checkoutBody(address.id)));
      // Placed 44 of the 45 allowed minutes ago, 20 s of hold left: it may only run to minute 45.
      await ctx.db
        .updateTable('orders')
        .set({
          placed_at: new Date(Date.now() - 44 * 60_000),
          reservation_expires_at: new Date(Date.now() + 20_000),
        })
        .where('id', '=', first.id)
        .execute();
      const reused = dataOf<OrderDto>(await checkout(token, key(), checkoutBody(address.id)));
      expect(reused.id).toBe(first.id);
      const expiresAt = new Date(reused.reservationExpiresAt ?? 0).getTime();
      expect(expiresAt).toBeGreaterThan(Date.now() + 30_000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 61_000);
    });

    it('snapshots survive later product name and price changes', async () => {
      await addKaftan();
      const address = await createAddress();
      const order = dataOf<OrderDto>(await checkout(token, key(), checkoutBody(address.id)));
      await ctx.db
        .updateTable('products')
        .set({ name: 'Renamed Kaftan', price_minor: 99 })
        .where('id', '=', products.kaftan)
        .execute();
      const after = dataOf<OrderDto>(await me().get(`/me/orders/${order.id}`));
      expect(after.items[0]).toMatchObject({
        productName: 't-co-fit-kaftan',
        unitPriceMinor: PRICE,
      });
      expect(after.totalMinor).toBe(PRICE + FEE);
    });

    it('a failed checkout changes nothing: cart intact, no order, no hold, key reusable', async () => {
      await addCap(token, 3, products.limited);
      const address = await createAddress();
      await ctx.db
        .updateTable('product_variants')
        .set({ stock_reserved: 1 })
        .where('id', '=', (await variant(products.limited, 'M')).id)
        .execute();
      const k = key();
      const failed = await checkout(token, k, checkoutBody(address.id));
      expect(failed.status).toBe(409);
      expect(errorOf(failed).code).toBe('INSUFFICIENT_STOCK');
      expect(await ctx.db.selectFrom('orders').select('id').execute()).toHaveLength(0);
      expect(await ctx.db.selectFrom('idempotency_keys').select('id').execute()).toHaveLength(0);
      expect((await variant(products.limited, 'M')).reserved).toBe(1);
      expect(dataOf<CartDto>(await me().get('/cart')).itemCount).toBe(3);

      await ctx.db
        .updateTable('product_variants')
        .set({ stock_reserved: 0 })
        .where('id', '=', (await variant(products.limited, 'M')).id)
        .execute();
      expect((await checkout(token, k, checkoutBody(address.id))).status).toBe(201);
    });

    it('refuses unavailable lines and another customer’s address', async () => {
      await addCap();
      const address = await createAddress();
      expect((await checkout(otherToken, key(), checkoutBody(address.id))).status).toBe(409); // empty cart first
      await addCap(otherToken);
      expect((await checkout(otherToken, key(), checkoutBody(address.id))).status).toBe(404);

      await ctx.db
        .updateTable('products')
        .set({ status: 'archived' })
        .where('id', '=', products.cap)
        .execute();
      const res = await checkout(token, key(), checkoutBody(address.id));
      expect(errorOf(res).code).toBe('PRODUCT_UNAVAILABLE');
    });

    it('stock 3, 10 buyers at once: exactly 3 orders succeed', async () => {
      const buyers = await Promise.all(Array.from({ length: 10 }, () => register()));
      const addresses: AddressDto[] = [];
      for (const buyer of buyers) {
        expect((await addCap(buyer, 1, products.limited)).status).toBe(200);
        addresses.push(await createAddress(buyer));
      }
      const results = await Promise.all(
        buyers.map((buyer, i) => checkout(buyer, key(), checkoutBody(addresses[i]?.id ?? ''))),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);
      expect(
        results
          .filter((r) => r.status === 409)
          .every((r) => errorOf(r).code === 'INSUFFICIENT_STOCK'),
      ).toBe(true);
      const limited = await variant(products.limited, 'M');
      expect(limited).toMatchObject({ onHand: 3, reserved: 3 });
    }, 60_000);
  });

  describe('reservation expiry', () => {
    it('releases expired holds once and cancels the order, even when run twice at once', async () => {
      await addCap(token, 2);
      const address = await createAddress();
      const order = dataOf<OrderDto>(await checkout(token, key(), checkoutBody(address.id)));
      expect(await releaseExpiredReservations(expiryDeps(), 100)).toBe(0); // not expired yet

      await ctx.db
        .updateTable('orders')
        .set({ reservation_expires_at: new Date(Date.now() - 1000) })
        .where('id', '=', order.id)
        .execute();
      const counts = await Promise.all([
        releaseExpiredReservations(expiryDeps(), 100),
        releaseExpiredReservations(expiryDeps(), 100),
      ]);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await releaseExpiredReservations(expiryDeps(), 100)).toBe(0);

      expect((await variant(products.cap, 'M')).reserved).toBe(0);
      const cancelled = dataOf<OrderDto>(await me().get(`/me/orders/${order.id}`));
      expect(cancelled).toMatchObject({
        orderStatus: 'cancelled',
        cancelReason: 'reservation_expired',
      });
      const movements = await ctx.db
        .selectFrom('stock_movements')
        .select(['movement_type', 'quantity_delta'])
        .where('reference_id', '=', order.id)
        .orderBy('created_at')
        .execute();
      expect(movements).toEqual([
        { movement_type: 'reservation', quantity_delta: 2 },
        { movement_type: 'reservation_release', quantity_delta: -2 },
      ]);
      const history = await ctx.db
        .selectFrom('order_status_history')
        .select('to_status')
        .where('order_id', '=', order.id)
        .execute();
      expect(history.map((h) => h.to_status)).toEqual(['pending_payment', 'cancelled']);
      // The cart is untouched, so the customer can check out again.
      expect(dataOf<CartDto>(await me().get('/cart')).itemCount).toBe(2);
    });
  });

  describe('customer orders', () => {
    it('lists own orders (paginated) and hides other customers’ orders', async () => {
      await addCap();
      const address = await createAddress();
      const order = dataOf<OrderDto>(await checkout(token, key(), checkoutBody(address.id)));
      const list = bodyOf<ApiList<OrderSummaryDto>>(await me().get('/me/orders?pageSize=5'));
      expect(list.meta).toMatchObject({ page: 1, pageSize: 5, total: 1 });
      expect(list.data).toMatchObject([{ id: order.id, itemCount: 1, totalMinor: PRICE + FEE }]);

      expect((await as(otherToken).get(`/me/orders/${order.id}`)).status).toBe(404);
      expect(bodyOf<ApiList<OrderSummaryDto>>(await as(otherToken).get('/me/orders')).data).toEqual(
        [],
      );
      expect((await me().get(`/me/orders/${randomUUID()}`)).status).toBe(404);
      const detail = await me().get(`/me/orders/${order.id}`);
      expect(detail.body).not.toHaveProperty('data.internalNote');
    });
  });
});
