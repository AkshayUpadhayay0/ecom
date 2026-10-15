import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AddressDto,
  ApiData,
  ApiErrorBody,
  CartDto,
  CustomerAuthDto,
  OrderDto,
  PaymentInitDto,
  PaymentVerificationDto,
} from '@urban-ibile/shared';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  resetAdminApiData,
  resetBlueprintData,
  restoreSettings,
  seededClothingTypeId,
  snapshotSettings,
  type SettingsSnapshot,
} from '../../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  flushOutbox,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../../test/helpers.js';
import { releaseExpiredReservations } from '../checkout/reservation-expiry.js';
import { createReservationsRepository } from '../inventory/reservations.repository.js';
import { createEmailOutboxRepository } from '../notifications/email-outbox.repository.js';
import { createEmailOutboxService } from '../notifications/email-outbox.service.js';
import { createLogEmailSender, type OutgoingEmail } from '../notifications/email-sender.js';
import { createOrdersRepository } from '../orders/orders.repository.js';
import { createSettingsRepository } from '../settings/settings.repository.js';
import { createSettingsService } from '../settings/settings.service.js';
import { buildPaymentConfirmation } from './payments.module.js';
import { createPaymentsRepository } from './payments.repository.js';
import { createPaymentsService } from './payments.service.js';
import { webhookSigningSecret } from './provider/create-provider.js';
import { createMockPaymentProvider, type MockPaymentProvider } from './provider/mock-provider.js';
import { signWebhookBody } from './provider/payment-provider.js';
import { reconcilePayments } from './reconciliation.js';

const API = '/api/v1';
const PRICE = 1_500_000;
const FEE = 250_000;
const WEBHOOK = `${API}/webhooks/paystack`;
const SIGNATURE_HEADER = 'x-paystack-signature';

describe.skipIf(!hasTestDatabase)(
  'Payments: initialize, verify, webhook, confirmation, outbox',
  () => {
    let ctx: TestContext;
    let mock: MockPaymentProvider;
    let settingsSnapshot: SettingsSnapshot;
    let token: string;
    let otherToken: string;
    let zoneId: string;
    const products = {} as Record<'cap' | 'limited', string>;
    const variants = {} as Record<'cap' | 'limited', string>;
    const silent = pino({ level: 'silent' });

    const errorOf = (res: request.Response) => bodyOf<ApiErrorBody>(res).error;
    // The type parameter only names the expected response DTO (same pattern as bodyOf).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;
    const settings = () =>
      createSettingsService({ db: ctx.db, repository: createSettingsRepository() });

    async function register(): Promise<string> {
      const res = await request(ctx.app)
        .post(`${API}/auth/register`)
        .send({
          email: `payer-${randomUUID().slice(0, 8)}@example.com`,
          password: 'Ankara-Velvet-2026!',
          fullName: 'Payment Tester',
          acceptTerms: true,
          client: 'web',
        });
      expect(res.status).toBe(201);
      return dataOf<CustomerAuthDto>(res).tokens.accessToken;
    }

    const as = (bearer: string) => ({
      get: (path: string) =>
        request(ctx.app).get(`${API}${path}`).set('Authorization', `Bearer ${bearer}`),
      post: (path: string, body: object = {}) =>
        request(ctx.app).post(`${API}${path}`).set('Authorization', `Bearer ${bearer}`).send(body),
    });

    async function createProduct(slug: string, onHand: number): Promise<[string, string]> {
      const product = await ctx.db
        .insertInto('products')
        .values({
          slug,
          name: slug,
          clothing_type_id: await seededClothingTypeId(ctx),
          price_minor: PRICE,
          status: 'active',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const size = await ctx.db
        .selectFrom('sizes')
        .select('id')
        .where('code', '=', 'M')
        .executeTakeFirstOrThrow();
      const variant = await ctx.db
        .insertInto('product_variants')
        .values({
          product_id: product.id,
          size_id: size.id,
          sku: `${slug}-M`,
          stock_on_hand: onHand,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return [product.id, variant.id];
    }

    async function stock(variantId: string) {
      return ctx.db
        .selectFrom('product_variants')
        .select(['stock_on_hand as onHand', 'stock_reserved as reserved'])
        .where('id', '=', variantId)
        .executeTakeFirstOrThrow();
    }

    async function movements(orderId: string) {
      return ctx.db
        .selectFrom('stock_movements')
        .select(['movement_type as type', 'quantity_delta as delta'])
        .where('reference_id', '=', orderId)
        .orderBy('id')
        .execute();
    }

    /** Fit Kaftan-style walkthrough condensed: cart -> address -> checkout. */
    async function placeOrder(
      bearer = token,
      quantity = 2,
      productId = products.cap,
    ): Promise<OrderDto> {
      const size = await ctx.db
        .selectFrom('sizes')
        .select('id')
        .where('code', '=', 'M')
        .executeTakeFirstOrThrow();
      expect(
        (await as(bearer).post('/cart/items', { productId, sizeId: size.id, quantity })).status,
      ).toBe(200);
      const address = dataOf<AddressDto>(
        await as(bearer).post('/me/addresses', {
          recipientName: 'Ada Obi',
          phone: '+2348012345678',
          addressLine1: '12 Admiralty Way',
          city: 'Lagos',
          deliveryZoneId: zoneId,
        }),
      );
      const res = await as(bearer)
        .post('/checkout/orders', {
          client: 'web',
          contactEmail: 'ada@example.com',
          contactPhone: '+2348012345678',
          addressId: address.id,
        })
        .set('Idempotency-Key', `ck-${randomUUID()}`);
      expect(res.status).toBe(201);
      return dataOf<OrderDto>(res);
    }

    async function initialize(orderId: string, bearer = token): Promise<PaymentInitDto> {
      const res = await as(bearer).post('/payments/initialize', { orderId });
      expect(res.status).toBe(201);
      return dataOf<PaymentInitDto>(res);
    }

    const verify = (reference: string, bearer = token) =>
      as(bearer).get(`/payments/verify?reference=${reference}`);

    function webhook(
      body: string,
      signature: string | null = signWebhookBody(body, webhookSigningSecret(ctx.env)),
    ) {
      const test = request(ctx.app).post(WEBHOOK).set('Content-Type', 'application/json');
      return (signature === null ? test : test.set(SIGNATURE_HEADER, signature)).send(body);
    }

    function chargeEvent(
      reference: string,
      event = 'charge.success',
      id: number | string = 9001,
    ): string {
      return JSON.stringify({
        event,
        data: {
          id,
          reference,
          status: 'success',
          amount: 1,
          currency: 'NGN',
          customer: { email: 'x@example.com' },
          authorization: { last4: '4081' },
        },
      });
    }

    async function orderView(orderId: string, bearer = token): Promise<OrderDto> {
      return dataOf<OrderDto>(await as(bearer).get(`/me/orders/${orderId}`));
    }

    async function count(
      table: 'payments' | 'email_outbox' | 'payment_webhook_events',
      where?: [string, string],
    ) {
      let query = ctx.db.selectFrom(table).select((eb) => eb.fn.countAll<string>().as('n'));
      // Test-only dynamic filter on a known column.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- column name is test-controlled
      if (where) query = query.where(where[0] as any, '=', where[1]);
      return Number((await query.executeTakeFirstOrThrow()).n);
    }

    const backdatePayment = (reference: string, minutes: number) =>
      ctx.db
        .updateTable('payments')
        .set({ created_at: new Date(Date.now() - minutes * 60_000) })
        .where('reference', '=', reference)
        .execute();

    const confirmation = () =>
      buildPaymentConfirmation({ db: ctx.db, logger: silent, provider: mock });

    beforeAll(async () => {
      assertSafeTestDatabase(testDatabaseUrl ?? '');
      ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
      await rm(ctx.env.MOCK_PAYMENTS_DIR, { recursive: true, force: true });
      mock = createMockPaymentProvider({
        dir: ctx.env.MOCK_PAYMENTS_DIR,
        checkoutBaseUrl: `${ctx.env.API_PUBLIC_URL}${API}`,
        webhookSecret: webhookSigningSecret(ctx.env),
      });
      await resetAdminApiData(ctx);
      settingsSnapshot = await snapshotSettings(ctx);
      [products.cap, variants.cap] = await createProduct('t-pay-cap', 10);
      [products.limited, variants.limited] = await createProduct('t-pay-limited', 3);
      zoneId = (
        await ctx.db
          .insertInto('delivery_zones')
          .values({ code: 'T_PAY_ZONE', name: 'Zone T_PAY', fee_minor: FEE, is_active: true })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });

    beforeEach(async () => {
      await resetBlueprintData(ctx); // clears carts, orders, payments, webhook events, outbox
      await restoreSettings(ctx, settingsSnapshot);
      await ctx.db
        .updateTable('product_variants')
        .set({ stock_on_hand: 10, stock_reserved: 0 })
        .where('id', '=', variants.cap)
        .execute();
      await ctx.db
        .updateTable('product_variants')
        .set({ stock_on_hand: 3, stock_reserved: 0 })
        .where('id', '=', variants.limited)
        .execute();
      token = await register();
      otherToken = await register();
      // Registration queues verification emails; only order emails matter here.
      await ctx.db.deleteFrom('email_outbox').execute();
    });

    afterAll(async () => {
      await restoreSettings(ctx, settingsSnapshot);
      await resetAdminApiData(ctx);
      await ctx.db.destroy();
    });

    describe('initialize', () => {
      it('requires login and only opens the customer’s own unpaid order', async () => {
        expect(
          (
            await request(ctx.app)
              .post(`${API}/payments/initialize`)
              .send({ orderId: randomUUID() })
          ).status,
        ).toBe(401);
        expect(
          (await request(ctx.app).get(`${API}/payments/verify?reference=UI-1-${'0'.repeat(32)}`))
            .status,
        ).toBe(401);
        const order = await placeOrder();
        expect(
          (await as(otherToken).post('/payments/initialize', { orderId: order.id })).status,
        ).toBe(404);
        const init = await initialize(order.id);
        expect((await verify(init.reference, otherToken)).status).toBe(404);
      });

      it('creates an initiated attempt with a server reference and the order total', async () => {
        const order = await placeOrder();
        const init = await initialize(order.id);
        expect(init).toMatchObject({ amountMinor: 2 * PRICE + FEE, currency: 'NGN', mocked: true });
        expect(init.reference).toMatch(new RegExp(`^${order.orderNumber}-[0-9a-f]{32}$`));
        expect(init.authorizationUrl).toContain(`/payments/mock/checkout/${init.reference}`);
        const row = await ctx.db
          .selectFrom('payments')
          .selectAll()
          .where('reference', '=', init.reference)
          .executeTakeFirstOrThrow();
        expect(row).toMatchObject({
          status: 'initiated',
          amount_minor: String(2 * PRICE + FEE),
          order_id: order.id,
        });

        const second = await initialize(order.id);
        expect(second.reference).not.toBe(init.reference);
      });

      it('rejects any client-sent amount or status, and paid / expired / cancelled orders', async () => {
        const order = await placeOrder();
        for (const body of [
          { orderId: order.id, amountMinor: 1 },
          { orderId: order.id, status: 'paid' },
        ]) {
          const res = await as(token).post('/payments/initialize', body);
          expect(res.status).toBe(400);
          expect(errorOf(res).code).toBe('VALIDATION_ERROR');
        }
        await ctx.db
          .updateTable('orders')
          .set({ reservation_expires_at: new Date(Date.now() - 1000) })
          .where('id', '=', order.id)
          .execute();
        expect(
          errorOf(await as(token).post('/payments/initialize', { orderId: order.id })).code,
        ).toBe('RESERVATION_EXPIRED');
        await ctx.db
          .updateTable('orders')
          .set({ order_status: 'cancelled' })
          .where('id', '=', order.id)
          .execute();
        expect(
          errorOf(await as(token).post('/payments/initialize', { orderId: order.id })).code,
        ).toBe('ORDER_NOT_PAYABLE');
      });

      it('extends the hold within the cap and supports an optional Idempotency-Key', async () => {
        const order = await placeOrder();
        await ctx.db
          .updateTable('orders')
          .set({ reservation_expires_at: new Date(Date.now() + 60_000) })
          .where('id', '=', order.id)
          .execute();
        const res = await as(token)
          .post('/payments/initialize', { orderId: order.id })
          .set('Idempotency-Key', 'pay-key-0001');
        const init = dataOf<PaymentInitDto>(res);
        expect(new Date(init.reservationExpiresAt ?? 0).getTime()).toBeGreaterThan(
          Date.now() + 10 * 60_000,
        );
        const held = await ctx.db
          .selectFrom('stock_reservations')
          .select('expires_at')
          .where('order_id', '=', order.id)
          .executeTakeFirstOrThrow();
        expect(held.expires_at.toISOString()).toBe(init.reservationExpiresAt);

        const replay = await as(token)
          .post('/payments/initialize', { orderId: order.id })
          .set('Idempotency-Key', 'pay-key-0001');
        expect(dataOf<PaymentInitDto>(replay).reference).toBe(init.reference);
        expect(await count('payments')).toBe(1);
      });
    });

    describe('confirmation via verify (mock dev checkout page)', () => {
      it('pays through the dev page + verify: paid, stock sold, cart cleared, one email', async () => {
        const order = await placeOrder(token, 2);
        const before = await stock(variants.cap);
        expect(before).toEqual({ onHand: 10, reserved: 2 });
        const init = await initialize(order.id);

        const pageRes = await request(ctx.app).get(
          `${API}/payments/mock/checkout/${init.reference}`,
        );
        expect(pageRes.status).toBe(200);
        expect(pageRes.text).toContain('MOCKED');
        // The page only records the provider outcome; nothing is paid until verify / webhook.
        expect(
          (await request(ctx.app).post(`${API}/payments/mock/checkout/${init.reference}/pay`))
            .status,
        ).toBe(200);
        expect((await orderView(order.id)).payment.status).toBe('unpaid');

        const res = await verify(init.reference);
        expect(res.status).toBe(200);
        expect(dataOf<PaymentVerificationDto>(res)).toMatchObject({
          reference: init.reference,
          paymentStatus: 'success',
          orderStatus: 'being_prepared',
          orderPaymentStatus: 'paid',
        });

        expect(await stock(variants.cap)).toEqual({ onHand: 8, reserved: 0 });
        expect(await movements(order.id)).toEqual([
          { type: 'reservation', delta: 2 },
          { type: 'reservation_release', delta: -2 },
          { type: 'sale', delta: -2 },
        ]);
        const reservation = await ctx.db
          .selectFrom('stock_reservations')
          .select('status')
          .where('order_id', '=', order.id)
          .execute();
        expect(reservation).toEqual([{ status: 'committed' }]);
        const cart = await ctx.db.selectFrom('carts').select('status').execute();
        expect(cart).toEqual([{ status: 'converted' }]);
        expect(dataOf<CartDto>(await as(token).get('/cart')).lines).toEqual([]);
        expect(await count('email_outbox', ['order_id', order.id])).toBe(1);

        const view = await orderView(order.id);
        expect(view).toMatchObject({
          orderStatus: 'being_prepared',
          paymentStatus: 'paid',
          reservationExpiresAt: null,
          payment: {
            status: 'paid',
            latestAttempt: {
              reference: init.reference,
              status: 'success',
              failureReason: null,
              channel: 'mock_card',
            },
          },
        });
        expect(JSON.stringify(view)).not.toMatch(/raw|authorization|gateway/i);
        const history = await ctx.db
          .selectFrom('order_status_history')
          .select(['from_status', 'to_status'])
          .where('order_id', '=', order.id)
          .orderBy('id')
          .execute();
        expect(history).toEqual([
          { from_status: null, to_status: 'pending_payment' },
          { from_status: 'pending_payment', to_status: 'being_prepared' },
        ]);
      });

      it('keeps lines added after checkout in the cart (only purchased quantities are removed)', async () => {
        const order = await placeOrder(token, 2);
        const size = await ctx.db
          .selectFrom('sizes')
          .select('id')
          .where('code', '=', 'M')
          .executeTakeFirstOrThrow();
        await as(token).post('/cart/items', {
          productId: products.limited,
          sizeId: size.id,
          quantity: 1,
        });
        const init = await initialize(order.id);
        await mock.setOutcome(init.reference, { status: 'success' });
        await verify(init.reference);
        const cart = dataOf<CartDto>(await as(token).get('/cart'));
        expect(cart.lines.map((l) => [l.product.id, l.quantity])).toEqual([[products.limited, 1]]);
      });

      it('verify before paying changes nothing; query tricks are refused', async () => {
        const order = await placeOrder();
        const init = await initialize(order.id);
        const res = await verify(init.reference);
        expect(dataOf<PaymentVerificationDto>(res)).toMatchObject({
          paymentStatus: 'initiated',
          orderPaymentStatus: 'unpaid',
        });
        expect(
          (await as(token).get(`/payments/verify?reference=${init.reference}&status=success`))
            .status,
        ).toBe(400);
        expect((await as(token).get('/payments/verify?reference=not-a-reference')).status).toBe(
          400,
        );
        expect((await orderView(order.id)).paymentStatus).toBe('unpaid');
      });
    });

    describe('webhook', () => {
      it('accepts a valid signature; refuses invalid, missing and tampered ones without storing', async () => {
        const order = await placeOrder();
        const init = await initialize(order.id);
        await mock.setOutcome(init.reference, { status: 'success' });
        const body = chargeEvent(init.reference);

        expect((await webhook(body, 'ab'.repeat(64))).status).toBe(401);
        expect((await webhook(body, null)).status).toBe(401);
        const tampered = body.replace('"amount":1', '"amount":2');
        const tamperedRes = await webhook(
          tampered,
          signWebhookBody(body, webhookSigningSecret(ctx.env)),
        );
        expect(tamperedRes.status).toBe(401);
        expect(errorOf(tamperedRes).code).toBe('INVALID_SIGNATURE');
        expect(await count('payment_webhook_events')).toBe(0);
        expect((await orderView(order.id)).paymentStatus).toBe('unpaid');

        const ok = await webhook(body);
        expect(ok.status).toBe(200);
        expect((await orderView(order.id)).paymentStatus).toBe('paid');
        const stored = await ctx.db
          .selectFrom('payment_webhook_events')
          .selectAll()
          .executeTakeFirstOrThrow();
        expect(stored).toMatchObject({
          event_type: 'charge.success',
          reference: init.reference,
          signature_valid: true,
        });
        expect(stored.processed_at).not.toBeNull();
        // Only non-sensitive fields are stored.
        expect(JSON.stringify(stored.payload)).not.toMatch(/customer|authorization|last4/);
      });

      it('never trusts the payload: a signed charge.success for an unpaid transaction pays nothing', async () => {
        const order = await placeOrder();
        const init = await initialize(order.id); // provider still says pending
        expect((await webhook(chargeEvent(init.reference))).status).toBe(200);
        expect((await orderView(order.id)).paymentStatus).toBe('unpaid');
        expect(await count('payments', ['status', 'success'])).toBe(0);
      });

      it('5 concurrent duplicate deliveries: one success, one deduction, one cart clear, one email', async () => {
        const order = await placeOrder(token, 2);
        const init = await initialize(order.id);
        await mock.setOutcome(init.reference, { status: 'success' });
        const body = chargeEvent(init.reference, 'charge.success', 777);
        const results = await Promise.all(Array.from({ length: 5 }, () => webhook(body)));
        expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
        expect(results.filter((r) => dataOf<{ duplicate: boolean }>(r).duplicate)).toHaveLength(4);

        // Distinct event ids for the same reference are also applied only once.
        await Promise.all(
          [1, 2, 3, 4, 5].map((id) => webhook(chargeEvent(init.reference, 'charge.success', id))),
        );

        expect(await count('payments', ['status', 'success'])).toBe(1);
        expect((await movements(order.id)).filter((m) => m.type === 'sale')).toEqual([
          { type: 'sale', delta: -2 },
        ]);
        expect(await stock(variants.cap)).toEqual({ onHand: 8, reserved: 0 });
        expect(await count('email_outbox', ['order_id', order.id])).toBe(1);
        expect(await ctx.db.selectFrom('carts').select('status').execute()).toEqual([
          { status: 'converted' },
        ]);
        const history = await ctx.db
          .selectFrom('order_status_history')
          .select('to_status')
          .where('order_id', '=', order.id)
          .execute();
        expect(history.filter((h) => h.to_status === 'being_prepared')).toHaveLength(1);
      });

      it('verify and webhook at the same moment: processed once', async () => {
        const order = await placeOrder(token, 1);
        const init = await initialize(order.id);
        await mock.setOutcome(init.reference, { status: 'success' });
        const [v, w] = await Promise.all([
          verify(init.reference),
          webhook(chargeEvent(init.reference)),
        ]);
        expect(v.status).toBe(200);
        expect(w.status).toBe(200);
        expect(dataOf<PaymentVerificationDto>(v).orderPaymentStatus).toBe('paid');
        expect(await count('payments', ['status', 'success'])).toBe(1);
        expect((await movements(order.id)).filter((m) => m.type === 'sale')).toHaveLength(1);
        expect(await count('email_outbox', ['order_id', order.id])).toBe(1);
      });

      it('answers 200 for unknown events and unknown references (stored, no effect)', async () => {
        expect(
          (await webhook(JSON.stringify({ event: 'transfer.success', data: { id: 5 } }))).status,
        ).toBe(200);
        expect((await webhook(chargeEvent(`UI-1-${'a'.repeat(32)}`))).status).toBe(200);
        expect(await count('payment_webhook_events')).toBe(2);
        expect(
          (await webhook('not json', signWebhookBody('not json', webhookSigningSecret(ctx.env))))
            .status,
        ).toBe(400);
      });

      it('answers 5xx when the event cannot be stored (so Paystack retries)', async () => {
        const service = createPaymentsService({
          db: ctx.db,
          logger: silent,
          provider: mock,
          payments: createPaymentsRepository(),
          orders: createOrdersRepository(),
          reservations: createReservationsRepository(),
          idempotency: {
            claim: () => Promise.reject(new Error('unused')),
            complete: () => Promise.resolve(),
            release: () => Promise.resolve(),
          },
          webhookEvents: {
            store: () => Promise.reject(new Error('database unavailable')),
            markProcessed: () => Promise.resolve(),
          },
          confirmation: confirmation(),
          settings: settings(),
          callbackUrl: ctx.env.PAYSTACK_CALLBACK_URL,
        });
        const body = Buffer.from(chargeEvent(`UI-1-${'b'.repeat(32)}`));
        await expect(
          service.handleWebhook(
            body,
            signWebhookBody(body, webhookSigningSecret(ctx.env)),
            '127.0.0.1',
          ),
        ).rejects.toThrow('database unavailable');
      });
    });

    describe('mismatches are never marked paid', () => {
      it.each([
        ['amount', { amountMinor: 100 }, 'AMOUNT_MISMATCH'],
        ['currency', { currency: 'USD' }, 'CURRENCY_MISMATCH'],
      ] as const)(
        '%s mismatch: needs_review, order flagged, holds released',
        async (_label, override, reason) => {
          const order = await placeOrder(token, 2);
          const init = await initialize(order.id);
          await mock.setOutcome(init.reference, { status: 'success', ...override });
          const result = dataOf<PaymentVerificationDto>(await verify(init.reference));
          expect(result).toMatchObject({
            paymentStatus: 'needs_review',
            orderStatus: 'payment_review',
            orderPaymentStatus: 'unpaid',
          });
          const payment = await ctx.db
            .selectFrom('payments')
            .select(['status', 'failure_reason'])
            .executeTakeFirstOrThrow();
          expect(payment).toEqual({ status: 'needs_review', failure_reason: reason });
          expect(await stock(variants.cap)).toEqual({ onHand: 10, reserved: 0 });
          expect((await movements(order.id)).map((m) => m.type)).toEqual([
            'reservation',
            'reservation_release',
          ]);
          expect(await count('email_outbox')).toBe(0);
          const history = await ctx.db
            .selectFrom('order_status_history')
            .select(['to_status', 'note'])
            .where('order_id', '=', order.id)
            .orderBy('id')
            .execute();
          expect(history.at(-1)).toMatchObject({ to_status: 'payment_review' });
          expect(history.at(-1)?.note).toContain(reason.toLowerCase());
        },
      );

      it('a reference reported for another order is flagged, not paid', async () => {
        const order = await placeOrder(token, 1);
        const other = await placeOrder(otherToken, 1);
        const init = await initialize(order.id);
        await mock.setOutcome(init.reference, { status: 'success', orderId: other.id });
        expect(dataOf<PaymentVerificationDto>(await verify(init.reference)).paymentStatus).toBe(
          'needs_review',
        );
        expect((await orderView(order.id)).paymentStatus).toBe('unpaid');
        expect((await orderView(other.id, otherToken)).paymentStatus).toBe('unpaid');
      });
    });

    describe('failed payments and retries', () => {
      it('keeps the cart and the hold; a retry gets a new reference; only one attempt can succeed', async () => {
        const order = await placeOrder(token, 2);
        const first = await initialize(order.id);
        await mock.setOutcome(first.reference, { status: 'failed' });
        expect(dataOf<PaymentVerificationDto>(await verify(first.reference))).toMatchObject({
          paymentStatus: 'failed',
          orderStatus: 'pending_payment',
          orderPaymentStatus: 'failed',
        });
        expect((await orderView(order.id)).payment.latestAttempt).toMatchObject({
          status: 'failed',
          failureReason: 'DECLINED',
        });
        expect(dataOf<CartDto>(await as(token).get('/cart')).itemCount).toBe(2);
        expect(await stock(variants.cap)).toEqual({ onHand: 10, reserved: 2 });

        const retry = await initialize(order.id);
        expect(retry.reference).not.toBe(first.reference);
        await mock.setOutcome(retry.reference, { status: 'success' });
        expect(
          dataOf<PaymentVerificationDto>(await verify(retry.reference)).orderPaymentStatus,
        ).toBe('paid');

        // The provider later reports the FIRST attempt as paid too (customer paid twice).
        await mock.setOutcome(first.reference, { status: 'success' });
        expect(dataOf<PaymentVerificationDto>(await verify(first.reference)).paymentStatus).toBe(
          'needs_review',
        );
        const rows = await ctx.db
          .selectFrom('payments')
          .select(['reference', 'status', 'failure_reason'])
          .orderBy('created_at')
          .execute();
        expect(rows).toEqual([
          {
            reference: first.reference,
            status: 'needs_review',
            failure_reason: 'DUPLICATE_SUCCESS',
          },
          { reference: retry.reference, status: 'success', failure_reason: null },
        ]);
        expect((await movements(order.id)).filter((m) => m.type === 'sale')).toHaveLength(1);

        // And the database itself refuses a second success for one order.
        await expect(
          ctx.db
            .updateTable('payments')
            .set({ status: 'success' })
            .where('reference', '=', first.reference)
            .execute(),
        ).rejects.toMatchObject({ code: '23505' });
      });

      it('checkout after a declined payment reuses the same open order', async () => {
        const order = await placeOrder(token, 1);
        const init = await initialize(order.id);
        await mock.setOutcome(init.reference, { status: 'failed' });
        await verify(init.reference);
        const addressId = (
          await ctx.db.selectFrom('customer_addresses').select('id').executeTakeFirstOrThrow()
        ).id;
        const again = await as(token)
          .post('/checkout/orders', {
            client: 'web',
            contactEmail: 'ada@example.com',
            contactPhone: '+2348012345678',
            addressId,
          })
          .set('Idempotency-Key', `ck-${randomUUID()}`);
        expect(dataOf<OrderDto>(again).id).toBe(order.id);
      });
    });

    describe('late success after the hold expired', () => {
      async function expire(orderId: string, reference: string) {
        await backdatePayment(reference, 10); // past the in-flight grace period
        await ctx.db
          .updateTable('orders')
          .set({ reservation_expires_at: new Date(Date.now() - 1000) })
          .where('id', '=', orderId)
          .execute();
        await releaseExpiredReservations(
          {
            db: ctx.db,
            orders: createOrdersRepository(),
            reservations: createReservationsRepository(),
            settings: settings(),
            logger: silent,
          },
          100,
        );
        expect((await orderView(orderId)).orderStatus).toBe('cancelled');
      }

      it('keeps the hold while a payment attempt is in flight', async () => {
        const order = await placeOrder(token, 1);
        await initialize(order.id);
        await ctx.db
          .updateTable('orders')
          .set({ reservation_expires_at: new Date(Date.now() - 1000) })
          .where('id', '=', order.id)
          .execute();
        const n = await releaseExpiredReservations(
          {
            db: ctx.db,
            orders: createOrdersRepository(),
            reservations: createReservationsRepository(),
            settings: settings(),
            logger: silent,
          },
          100,
        );
        expect(n).toBe(0);
        expect((await orderView(order.id)).orderStatus).toBe('pending_payment');
      });

      it('re-reserves and fulfils when stock is still available', async () => {
        const order = await placeOrder(token, 2);
        const init = await initialize(order.id);
        await expire(order.id, init.reference);
        expect(await stock(variants.cap)).toEqual({ onHand: 10, reserved: 0 });

        await mock.setOutcome(init.reference, { status: 'success' });
        expect(dataOf<PaymentVerificationDto>(await verify(init.reference))).toMatchObject({
          orderStatus: 'being_prepared',
          orderPaymentStatus: 'paid',
        });
        const view = await orderView(order.id);
        expect(view.cancelReason).toBeNull();
        expect(await stock(variants.cap)).toEqual({ onHand: 8, reserved: 0 });
        expect((await movements(order.id)).map((m) => m.type)).toEqual([
          'reservation',
          'reservation_release',
          'sale',
        ]);
        expect(await count('email_outbox', ['order_id', order.id])).toBe(1);
      });

      it('without stock: payment kept, order flagged "needs attention", nothing refunded or lost', async () => {
        const order = await placeOrder(token, 3, products.limited);
        const init = await initialize(order.id);
        await expire(order.id, init.reference);
        await ctx.db
          .updateTable('product_variants')
          .set({ stock_on_hand: 1 })
          .where('id', '=', variants.limited)
          .execute();

        await mock.setOutcome(init.reference, { status: 'success' });
        expect(dataOf<PaymentVerificationDto>(await verify(init.reference))).toMatchObject({
          paymentStatus: 'success',
          orderStatus: 'payment_review',
          orderPaymentStatus: 'paid',
        });
        expect(await stock(variants.limited)).toEqual({ onHand: 1, reserved: 0 });
        expect((await movements(order.id)).filter((m) => m.type === 'sale')).toEqual([]);
        expect(await count('email_outbox')).toBe(0);
        expect(dataOf<CartDto>(await as(token).get('/cart')).itemCount).toBe(3);
        const payment = await ctx.db
          .selectFrom('payments')
          .select(['status', 'paid_at'])
          .executeTakeFirstOrThrow();
        expect(payment.status).toBe('success');
        expect(payment.paid_at).not.toBeNull();
      });
    });

    describe('stock under concurrent confirmations', () => {
      it('reservations become deductions exactly once; on-hand matches the ledger; never negative', async () => {
        const buyers = [token, otherToken, await register()];
        const orders = [];
        for (const buyer of buyers) orders.push(await placeOrder(buyer, 1, products.limited));
        const inits = [];
        for (const [i, order] of orders.entries())
          inits.push(await initialize(order.id, buyers[i]));
        for (const init of inits) await mock.setOutcome(init.reference, { status: 'success' });

        await Promise.all(
          inits.flatMap((init, i) => [
            verify(init.reference, buyers[i]),
            webhook(chargeEvent(init.reference, 'charge.success', `a-${i}`)),
            webhook(chargeEvent(init.reference, 'charge.success', `b-${i}`)),
          ]),
        );
        const after = await stock(variants.limited);
        expect(after).toEqual({ onHand: 0, reserved: 0 });
        const sales = await ctx.db
          .selectFrom('stock_movements')
          .select((eb) => eb.fn.sum<string>('quantity_delta').as('total'))
          .where('variant_id', '=', variants.limited)
          .where('movement_type', '=', 'sale')
          .executeTakeFirstOrThrow();
        expect(3 + Number(sales.total)).toBe(after.onHand);
        expect(await count('payments', ['status', 'success'])).toBe(3);
      });
    });

    describe('reconciliation', () => {
      it('confirms a paid transaction whose webhook was missed; running twice is safe', async () => {
        const order = await placeOrder(token, 2);
        const init = await initialize(order.id);
        await mock.setOutcome(init.reference, { status: 'success' });
        const deps = {
          db: ctx.db,
          payments: createPaymentsRepository(),
          confirmation: confirmation(),
          settings: settings(),
          logger: silent,
        };

        expect(await reconcilePayments(deps)).toEqual({ checked: 0, resolved: 0, abandoned: 0 }); // too recent
        await backdatePayment(init.reference, 10);
        const [a, b] = await Promise.all([reconcilePayments(deps), reconcilePayments(deps)]);
        expect(a.checked + b.checked).toBe(1);
        expect(a.resolved + b.resolved).toBe(1);
        expect(await reconcilePayments(deps)).toMatchObject({ checked: 0 });

        expect((await orderView(order.id)).paymentStatus).toBe('paid');
        expect((await movements(order.id)).filter((m) => m.type === 'sale')).toHaveLength(1);
        expect(await count('email_outbox')).toBe(1);
      });

      it('leaves unpaid attempts open and abandons very old ones', async () => {
        const order = await placeOrder(token, 1);
        const pending = await initialize(order.id);
        const old = await initialize(order.id);
        await backdatePayment(pending.reference, 10);
        await backdatePayment(old.reference, 49 * 60);
        const deps = {
          db: ctx.db,
          payments: createPaymentsRepository(),
          confirmation: confirmation(),
          settings: settings(),
          logger: silent,
        };
        expect(await reconcilePayments(deps)).toEqual({ checked: 1, resolved: 0, abandoned: 1 });
        const rows = await ctx.db
          .selectFrom('payments')
          .select(['reference', 'status'])
          .orderBy('created_at')
          .execute();
        expect(rows).toEqual([
          { reference: old.reference, status: 'abandoned' },
          { reference: pending.reference, status: 'initiated' },
        ]);
      });
    });

    describe('order confirmation email', () => {
      async function paidOrder(): Promise<OrderDto> {
        const order = await placeOrder(token, 2);
        const init = await initialize(order.id);
        await mock.setOutcome(init.reference, { status: 'success' });
        await verify(init.reference);
        return order;
      }

      function outbox(sender: (email: OutgoingEmail) => Promise<void>) {
        return createEmailOutboxService({
          db: ctx.db,
          repository: createEmailOutboxRepository(),
          sender: { mocked: true, send: sender },
          settings: settings(),
          from: ctx.env.EMAIL_FROM,
          batchSize: 10,
          logger: silent,
        });
      }

      it('contains the order details and no payment data; sent once', async () => {
        const order = await paidOrder();
        const sent = await flushOutbox(ctx);
        expect(sent).toHaveLength(1);
        const email = sent[0];
        expect(email?.to).toBe('ada@example.com');
        expect(email?.subject).toContain(order.orderNumber);
        for (const text of [
          't-pay-cap',
          'Size M',
          'x 2',
          'NGN 15,000.00',
          'NGN 30,000.00',
          'Delivery: NGN 2,500.00',
          'Total: NGN 32,500.00',
          '12 Admiralty Way',
          'Zone T_PAY',
        ]) {
          expect(email?.text).toContain(text);
        }
        expect(email?.text).not.toMatch(/UI-\d+-[0-9a-f]{32}|card|mock_card|authorization/i);
        expect(await flushOutbox(ctx)).toHaveLength(0);
      });

      it('retries after a provider failure, then sends exactly once', async () => {
        await paidOrder();
        let calls = 0;
        await outbox(() => {
          calls += 1;
          return Promise.reject(new Error('provider down'));
        }).processBatch();
        const row = await ctx.db.selectFrom('email_outbox').selectAll().executeTakeFirstOrThrow();
        expect(row).toMatchObject({ status: 'queued', attempts: 1, last_error: 'provider down' });
        expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());

        expect(await outbox(() => Promise.resolve()).processBatch()).toBe(0); // not due yet
        await ctx.db
          .updateTable('email_outbox')
          .set({ next_attempt_at: new Date(Date.now() - 1000) })
          .execute();
        const sent: OutgoingEmail[] = [];
        await outbox((email) => {
          sent.push(email);
          return Promise.resolve();
        }).processBatch();
        expect(sent).toHaveLength(1);
        expect(sent[0]?.idempotencyKey).toBe(row.id);
        expect(
          await ctx.db
            .selectFrom('email_outbox')
            .select(['status', 'attempts'])
            .executeTakeFirstOrThrow(),
        ).toEqual({ status: 'sent', attempts: 2 });
        expect(calls).toBe(1);
      });

      it('gives up after email.max_attempts', async () => {
        await paidOrder();
        await ctx.db
          .updateTable('app_settings')
          .set({ value: '1' })
          .where('setting_key', '=', 'email.max_attempts')
          .execute();
        await outbox(() => Promise.reject(new Error('still down'))).processBatch();
        expect(
          (await ctx.db.selectFrom('email_outbox').select('status').executeTakeFirstOrThrow())
            .status,
        ).toBe('failed');
      });

      it('the MOCK log provider writes one file per outbox row (a retry overwrites it)', async () => {
        const dir = join(ctx.env.EMAIL_LOG_DIR, randomUUID());
        const sender = createLogEmailSender(silent, dir);
        const email = {
          idempotencyKey: 'row-1',
          from: 'a@example.com',
          to: 'b@example.com',
          subject: 'S',
          text: 'Body',
        };
        await sender.send(email);
        await sender.send({ ...email, text: 'Body again' });
        expect(await readFile(join(dir, 'row-1.txt'), 'utf8')).toContain('Body again');
        await rm(dir, { recursive: true, force: true });
      });
    });
  },
);
