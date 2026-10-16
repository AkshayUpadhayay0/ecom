import type {
  AdminOrderDetailDto,
  ApiData,
  ApiList,
  OrderDto,
  PaymentInitDto,
  PaymentReviewDto,
} from '@urban-ibile/shared';
import { pino } from 'pino';
import type request from 'supertest';
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
  type CommerceFixture,
  FEE,
  PRICE,
  createCommerceFixture,
  customerApi,
  payOrder,
  placeOrder,
  registerCustomer,
  resetFixtureStock,
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
import { releaseExpiredReservations } from '../checkout/reservation-expiry.js';
import { createReservationsRepository } from '../inventory/reservations.repository.js';
import { createOrdersRepository } from '../orders/orders.repository.js';
import { createSettingsRepository } from '../settings/settings.repository.js';
import { createSettingsService } from '../settings/settings.service.js';

const TOTAL_ONE_CAP = PRICE + FEE;

describe.skipIf(!hasTestDatabase)('Payment review queue (Phase 7a)', () => {
  let ctx: TestContext;
  let fixture: CommerceFixture;
  let superAdmin: AdminClient;
  let plainAdmin: AdminClient;
  let buyer: { token: string; id: string; email: string };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
  const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;
  const resolve = (paymentId: string, body: object, client = superAdmin) =>
    client.post(`/payment-reviews/${paymentId}/resolve`, body);
  const paymentIdOf = async (reference: string) =>
    (
      await ctx.db
        .selectFrom('payments')
        .select('id')
        .where('reference', '=', reference)
        .executeTakeFirstOrThrow()
    ).id;
  const orderView = async (id: string) =>
    dataOf<AdminOrderDetailDto>(await superAdmin.get(`/orders/${id}`));
  const plainStock = () =>
    ctx.db
      .selectFrom('product_variants')
      .select(['stock_on_hand as onHand', 'stock_reserved as reserved'])
      .where('id', '=', fixture.variants.plainM)
      .executeTakeFirstOrThrow();
  const sales = async (orderId: string) =>
    (
      await ctx.db
        .selectFrom('stock_movements')
        .select('quantity_delta')
        .where('reference_id', '=', orderId)
        .where('movement_type', '=', 'sale')
        .execute()
    ).map((m) => m.quantity_delta);
  const confirmationEmails = async (orderId: string) =>
    Number(
      (
        await ctx.db
          .selectFrom('email_outbox')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('order_id', '=', orderId)
          .where('template', '=', 'order_confirmation')
          .executeTakeFirstOrThrow()
      ).n,
    );

  /** One cap ordered; payment reported with `outcome`. */
  async function mismatchedOrder(outcome: {
    amountMinor?: number;
    currency?: string;
  }): Promise<{ order: OrderDto; paymentId: string }> {
    const order = await placeOrder(ctx, fixture, buyer.token, { fitQuantity: 0, plainQuantity: 1 });
    const reference = await payOrder(ctx, fixture, buyer.token, order.id, {
      status: 'success',
      ...outcome,
    });
    return { order, paymentId: await paymentIdOf(reference) };
  }

  /** Paid after the hold expired while stock went to 0: success + payment_review (LATE_NO_STOCK). */
  async function lateNoStockOrder(): Promise<{ order: OrderDto; paymentId: string }> {
    const order = await placeOrder(ctx, fixture, buyer.token, { fitQuantity: 0, plainQuantity: 2 });
    const api = customerApi(ctx, buyer.token);
    const { reference } = dataOf<PaymentInitDto>(
      await api.post('/payments/initialize', { orderId: order.id }),
    );
    await ctx.db
      .updateTable('payments')
      .set({ created_at: new Date(Date.now() - 10 * 60_000) })
      .where('reference', '=', reference)
      .execute();
    await ctx.db
      .updateTable('orders')
      .set({ reservation_expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', order.id)
      .execute();
    await releaseExpiredReservations(
      {
        db: ctx.db,
        orders: createOrdersRepository(),
        reservations: createReservationsRepository(),
        settings: createSettingsService({ db: ctx.db, repository: createSettingsRepository() }),
        logger: pino({ level: 'silent' }),
      },
      100,
    );
    await ctx.db
      .updateTable('product_variants')
      .set({ stock_on_hand: 1 })
      .where('id', '=', fixture.variants.plainM)
      .execute();
    await fixture.mock.setOutcome(reference, { status: 'success' });
    await api.get(`/payments/verify?reference=${reference}`);
    return { order, paymentId: await paymentIdOf(reference) };
  }

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    await resetAdminApiData(ctx);
    fixture = await createCommerceFixture(ctx, 't-pr');
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx);
    await ctx.db.deleteFrom('admin_audit_logs').execute();
    await resetFixtureStock(ctx, fixture);
    superAdmin = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);
    plainAdmin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
    buyer = await registerCustomer(ctx);
    await ctx.db.deleteFrom('email_outbox').execute();
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  it('lists open reviews with reason and amounts; plain admins can read but not resolve', async () => {
    const under = await mismatchedOrder({ amountMinor: TOTAL_ONE_CAP - 100 });
    const late = await lateNoStockOrder();
    const res = await plainAdmin.get('/payment-reviews');
    expect(res.status).toBe(200);
    const list = bodyOf<ApiList<PaymentReviewDto>>(res);
    expect(list.meta.total).toBe(2);
    const byId = new Map(list.data.map((r) => [r.paymentId, r]));
    expect(byId.get(under.paymentId)).toMatchObject({
      reason: 'AMOUNT_MISMATCH',
      paymentStatus: 'needs_review',
      receivedAmountMinor: TOTAL_ONE_CAP - 100,
      receivedCurrency: 'NGN',
      order: {
        id: under.order.id,
        orderStatus: 'payment_review',
        paymentStatus: 'unpaid',
        totalMinor: TOTAL_ONE_CAP,
      },
      customer: { id: buyer.id },
      open: true,
      refundOwedMinor: null,
    });
    expect(byId.get(late.paymentId)).toMatchObject({
      reason: 'LATE_NO_STOCK',
      paymentStatus: 'success',
      order: { orderStatus: 'payment_review', paymentStatus: 'paid' },
    });
    const forbidden = await resolve(
      under.paymentId,
      { action: 'MARK_REFUND_REQUIRED', amountMinor: 1, note: 'x' },
      plainAdmin,
    );
    expect(forbidden.status).toBe(403);
    expect((await resolve(under.paymentId, { action: 'FULFIL' })).status).toBe(400); // note required
  });

  describe('FULFIL', () => {
    it('fails cleanly when stock is gone, then fulfils once stock is back', async () => {
      const late = await lateNoStockOrder();
      const before = await plainStock();
      const failed = await resolve(late.paymentId, { action: 'FULFIL', note: 'Try to ship' });
      expect(failed.status).toBe(409);
      expect(errorCode(failed)).toBe('INSUFFICIENT_STOCK');
      expect(await plainStock()).toEqual(before);
      expect(await sales(late.order.id)).toEqual([]);
      expect((await orderView(late.order.id)).orderStatus).toBe('payment_review');
      expect(await ctx.db.selectFrom('payment_review_resolutions').selectAll().execute()).toEqual(
        [],
      );
      expect(await auditCount(ctx, { action: 'payment_review.resolve' })).toBe(0);

      await ctx.db
        .updateTable('product_variants')
        .set({ stock_on_hand: 5 })
        .where('id', '=', fixture.variants.plainM)
        .execute();
      const ok = await resolve(late.paymentId, { action: 'FULFIL', note: 'Restocked, shipping' });
      expect(ok.status).toBe(200);
      expect(dataOf<PaymentReviewDto>(ok)).toMatchObject({
        open: false,
        resolutions: [{ action: 'FULFIL', note: 'Restocked, shipping' }],
      });
      expect(await plainStock()).toEqual({ onHand: 3, reserved: 0 });
      expect(await sales(late.order.id)).toEqual([-2]);
      expect(await confirmationEmails(late.order.id)).toBe(1);
      const view = await orderView(late.order.id);
      expect(view).toMatchObject({ orderStatus: 'being_prepared', paymentStatus: 'paid' });
      expect(view.history.at(-1)).toMatchObject({
        fromStatus: 'payment_review',
        toStatus: 'being_prepared',
        actor: { type: 'admin' },
      });
      expect(view.reviewResolutions.map((r) => r.action)).toEqual(['FULFIL']);
      expect(
        await auditCount(ctx, { action: 'payment_review.resolve', entityId: late.paymentId }),
      ).toBe(1);

      const again = await resolve(late.paymentId, { action: 'FULFIL', note: 'again' });
      expect(errorCode(again)).toBe('REVIEW_ALREADY_RESOLVED');
      expect(
        bodyOf<ApiList<PaymentReviewDto>>(await superAdmin.get('/payment-reviews')).data,
      ).toEqual([]);
    });

    it('is refused when the amount received does not cover the total, or for duplicates', async () => {
      const under = await mismatchedOrder({ amountMinor: TOTAL_ONE_CAP - 100 });
      const res = await resolve(under.paymentId, { action: 'FULFIL', note: 'ship anyway' });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('REVIEW_ACTION_NOT_ALLOWED');
      const usd = await mismatchedOrder({ currency: 'USD' });
      expect(errorCode(await resolve(usd.paymentId, { action: 'FULFIL', note: 'x' }))).toBe(
        'REVIEW_ACTION_NOT_ALLOWED',
      );
    });

    it('an overpayment is fulfilled and the excess recorded automatically as a refund owed', async () => {
      const excess = 5_000;
      const over = await mismatchedOrder({ amountMinor: TOTAL_ONE_CAP + excess });
      const res = await resolve(over.paymentId, { action: 'FULFIL', note: 'Customer overpaid' });
      expect(res.status).toBe(200);
      const review = dataOf<PaymentReviewDto>(res);
      expect(review).toMatchObject({
        paymentStatus: 'success',
        open: true,
        refundOwedMinor: excess,
      });
      expect(review.resolutions.map((r) => [r.action, r.amountMinor])).toEqual([
        ['FULFIL', null],
        ['MARK_REFUND_REQUIRED', excess],
      ]);
      expect(await orderView(over.order.id)).toMatchObject({
        orderStatus: 'being_prepared',
        paymentStatus: 'paid',
      });
      expect(await sales(over.order.id)).toEqual([-1]);

      // Recording the manual partial refund closes it; the order stays fulfilled.
      const refunded = await resolve(over.paymentId, {
        action: 'MARK_REFUNDED',
        refundReference: 'PSK-RF-1',
        note: 'Refunded excess in Paystack',
      });
      expect(dataOf<PaymentReviewDto>(refunded)).toMatchObject({
        open: false,
        paymentStatus: 'success',
        refundOwedMinor: null,
      });
      expect(await orderView(over.order.id)).toMatchObject({
        orderStatus: 'being_prepared',
        paymentStatus: 'paid',
      });
      expect(
        errorCode(
          await resolve(over.paymentId, {
            action: 'MARK_REFUND_REQUIRED',
            amountMinor: 1,
            note: 'x',
          }),
        ),
      ).toBe('REVIEW_ALREADY_RESOLVED');
    });
  });

  describe('refunds (recorded only; nothing is refunded automatically)', () => {
    it('refund required then refunded: payment refunded, unpaid order cancelled, stock untouched', async () => {
      const under = await mismatchedOrder({ amountMinor: TOTAL_ONE_CAP - 100 });
      const stockBefore = await plainStock();
      expect(
        (
          await resolve(under.paymentId, {
            action: 'MARK_REFUND_REQUIRED',
            amountMinor: TOTAL_ONE_CAP,
            note: 'Too much',
          })
        ).status,
      ).toBe(400);
      const required = await resolve(under.paymentId, {
        action: 'MARK_REFUND_REQUIRED',
        amountMinor: TOTAL_ONE_CAP - 100,
        note: 'Refund the underpayment',
      });
      expect(dataOf<PaymentReviewDto>(required)).toMatchObject({
        open: true,
        refundOwedMinor: TOTAL_ONE_CAP - 100,
      });
      expect((await orderView(under.order.id)).orderStatus).toBe('payment_review');
      expect(
        errorCode(
          await resolve(under.paymentId, {
            action: 'MARK_REFUND_REQUIRED',
            amountMinor: 10,
            note: 'again',
          }),
        ),
      ).toBe('REVIEW_ALREADY_RESOLVED');

      const done = await resolve(under.paymentId, {
        action: 'MARK_REFUNDED',
        refundReference: 'PSK-RF-2',
        note: 'Refunded in dashboard',
      });
      expect(dataOf<PaymentReviewDto>(done)).toMatchObject({
        paymentStatus: 'refunded',
        open: false,
      });
      const view = await orderView(under.order.id);
      expect(view).toMatchObject({
        orderStatus: 'cancelled',
        paymentStatus: 'unpaid',
        cancelReason: 'refunded_after_payment_review',
      });
      expect(view.history.slice(-2).map((h) => [h.fromStatus, h.toStatus])).toEqual([
        ['payment_review', 'payment_review'],
        ['payment_review', 'cancelled'],
      ]);
      expect(await plainStock()).toEqual(stockBefore);
      expect(errorCode(await resolve(under.paymentId, { action: 'FULFIL', note: 'x' }))).toBe(
        'REVIEW_ALREADY_RESOLVED',
      );
      expect(
        await auditCount(ctx, { action: 'payment_review.resolve', entityId: under.paymentId }),
      ).toBe(2);
    });

    it('late payment without stock refunded directly: order cancelled, payment_status refunded', async () => {
      const late = await lateNoStockOrder();
      const res = await resolve(late.paymentId, {
        action: 'MARK_REFUNDED',
        refundReference: 'PSK-RF-3',
        note: 'No stock',
      });
      expect(res.status).toBe(200);
      expect(await orderView(late.order.id)).toMatchObject({
        orderStatus: 'cancelled',
        paymentStatus: 'refunded',
      });
      expect(await sales(late.order.id)).toEqual([]);
    });

    it('a duplicate payment is refunded without touching the paid order', async () => {
      const order = await placeOrder(ctx, fixture, buyer.token, { fitQuantity: 0 });
      const api = customerApi(ctx, buyer.token);
      const first = dataOf<PaymentInitDto>(
        await api.post('/payments/initialize', { orderId: order.id }),
      ).reference;
      const second = dataOf<PaymentInitDto>(
        await api.post('/payments/initialize', { orderId: order.id }),
      ).reference;
      for (const reference of [first, second]) {
        await fixture.mock.setOutcome(reference, { status: 'success' });
        await api.get(`/payments/verify?reference=${reference}`);
      }
      const duplicateId = await paymentIdOf(second);
      const queue = bodyOf<ApiList<PaymentReviewDto>>(
        await superAdmin.get('/payment-reviews'),
      ).data;
      expect(queue.map((r) => [r.paymentId, r.reason])).toEqual([
        [duplicateId, 'DUPLICATE_SUCCESS'],
      ]);
      expect(errorCode(await resolve(duplicateId, { action: 'FULFIL', note: 'x' }))).toBe(
        'REVIEW_ACTION_NOT_ALLOWED',
      );
      const res = await resolve(duplicateId, {
        action: 'MARK_REFUNDED',
        refundReference: 'PSK-RF-4',
        note: 'Paid twice',
      });
      expect(dataOf<PaymentReviewDto>(res)).toMatchObject({
        paymentStatus: 'refunded',
        open: false,
      });
      expect(await orderView(order.id)).toMatchObject({
        orderStatus: 'being_prepared',
        paymentStatus: 'paid',
      });
      const all = bodyOf<ApiList<PaymentReviewDto>>(
        await superAdmin.get('/payment-reviews?state=all'),
      ).data;
      expect(all.map((r) => [r.paymentId, r.open])).toEqual([[duplicateId, false]]);
    });
  });
});
