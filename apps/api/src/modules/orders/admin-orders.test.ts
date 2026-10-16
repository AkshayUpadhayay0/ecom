import { randomUUID } from 'node:crypto';
import type {
  AdminOrderDetailDto,
  AdminOrderNoteDto,
  AdminOrderSummaryDto,
  ApiData,
  ApiList,
  OrderDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  adminClient,
  auditCount,
  customerToken,
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

describe.skipIf(!hasTestDatabase)('Admin orders API (Phase 7a)', () => {
  let ctx: TestContext;
  let fixture: CommerceFixture;
  let admin: AdminClient;
  let adminId: string;
  let buyer: { token: string; id: string; email: string };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
  const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;
  const detail = async (id: string) =>
    dataOf<AdminOrderDetailDto>(await admin.get(`/orders/${id}`));
  const status = (id: string, body: object) => admin.patch(`/orders/${id}/status`, body);

  async function paidOrder(
    options: Parameters<typeof placeOrder>[3] = {},
    who = buyer,
  ): Promise<OrderDto> {
    const order = await placeOrder(ctx, fixture, who.token, options);
    await payOrder(ctx, fixture, who.token, order.id);
    return order;
  }

  async function outboxCount(orderId: string, template: string): Promise<number> {
    const row = await ctx.db
      .selectFrom('email_outbox')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('order_id', '=', orderId)
      .where('template', '=', template)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    await resetAdminApiData(ctx);
    fixture = await createCommerceFixture(ctx, 't-ao');
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx); // clears orders, payments, notes, carts, outbox
    await ctx.db.deleteFrom('admin_audit_logs').execute();
    await resetFixtureStock(ctx, fixture);
    const session = await signInAdmin(ctx, 'admin');
    admin = adminClient(ctx, session.token);
    adminId = session.id;
    buyer = await registerCustomer(ctx);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  it('rejects customer tokens and anonymous calls on every route', async () => {
    const token = await customerToken(ctx);
    const id = randomUUID();
    for (const [method, path] of [
      ['get', '/orders'],
      ['get', `/orders/${id}`],
      ['patch', `/orders/${id}/status`],
      ['get', `/orders/${id}/notes`],
      ['post', `/orders/${id}/notes`],
      ['get', '/payment-reviews'],
      ['post', `/payment-reviews/${id}/resolve`],
      ['get', '/customers'],
      ['get', `/customers/${id}`],
      ['patch', `/customers/${id}/status`],
      ['get', '/stats/overview'],
    ] as const) {
      expect((await request(ctx.app)[method](`${ADMIN}${path}`).send({})).status, path).toBe(401);
      const res = await request(ctx.app)
        [method](`${ADMIN}${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status, `customer token ${path}`).toBe(401);
    }
  });

  describe('list', () => {
    it('filters, searches, sorts and paginates', async () => {
      const other = await registerCustomer(ctx, 'Chidi Okafor');
      const unpaid = await placeOrder(ctx, fixture, buyer.token, {
        fitQuantity: 0,
        plainQuantity: 1,
      });
      const paid = await paidOrder(
        { fitQuantity: 1, plainQuantity: 2, phone: '+2348099990000' },
        other,
      );

      const all = bodyOf<ApiList<AdminOrderSummaryDto>>(await admin.get('/orders'));
      expect(all.meta.total).toBe(2);
      expect(all.data.map((o) => o.id)).toEqual([paid.id, unpaid.id]); // newest first
      expect(all.data[0]).toMatchObject({
        orderStatus: 'being_prepared',
        paymentStatus: 'paid',
        needsAttention: false,
        customer: { id: other.id, fullName: 'Chidi Okafor', email: other.email },
        itemCount: 3,
        totalMinor: 3 * PRICE + FEE,
      });

      const list = async (query: string) =>
        bodyOf<ApiList<AdminOrderSummaryDto>>(await admin.get(`/orders?${query}`)).data.map(
          (o) => o.id,
        );
      expect(await list('paymentStatus=paid')).toEqual([paid.id]);
      expect(await list('orderStatus=pending_payment')).toEqual([unpaid.id]);
      expect(await list(`deliveryZoneId=${fixture.zoneId}`)).toHaveLength(2);
      expect(await list('needsAttention=true')).toEqual([]);
      expect(await list('q=chidi')).toEqual([paid.id]);
      expect(await list(`q=${other.email.slice(0, 12)}`)).toEqual([paid.id]);
      expect(await list('q=8099990')).toEqual([paid.id]);
      expect(await list(`q=${unpaid.orderNumber}`)).toEqual([unpaid.id]);
      expect(await list('sort=total&order=asc')).toEqual([unpaid.id, paid.id]);
      const today = new Date().toISOString().slice(0, 10);
      expect(await list(`from=${today}&to=${today}`)).toHaveLength(2);
      expect(await list('to=2000-01-01')).toEqual([]);
      const page = bodyOf<ApiList<AdminOrderSummaryDto>>(
        await admin.get('/orders?pageSize=1&page=2'),
      );
      expect(page.meta).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
      expect(page.data.map((o) => o.id)).toEqual([unpaid.id]);
      expect((await admin.get('/orders?orderStatus=BAD STATUS')).status).toBe(400);
    });
  });

  describe('detail', () => {
    it('shows items with fit snapshot and measurements, every attempt, history; no raw payloads', async () => {
      const order = await placeOrder(ctx, fixture, buyer.token, {
        fitQuantity: 1,
        plainQuantity: 1,
      });
      await payOrder(ctx, fixture, buyer.token, order.id, { status: 'failed' });
      await payOrder(ctx, fixture, buyer.token, order.id);

      const res = await admin.get(`/orders/${order.id}`);
      expect(res.status).toBe(200);
      const view = dataOf<AdminOrderDetailDto>(res);
      expect(view).toMatchObject({
        orderStatus: 'being_prepared',
        paymentStatus: 'paid',
        subtotalMinor: 2 * PRICE,
        deliveryFeeMinor: FEE,
        totalMinor: 2 * PRICE + FEE,
        contact: { email: 'ada@example.com' },
        delivery: {
          recipientName: 'Ada Obi',
          addressLine1: '12 Admiralty Way',
          zoneId: fixture.zoneId,
          zoneName: 'Zone t-ao',
        },
        customer: { id: buyer.id },
      });
      const fitLine = view.items.find((i) => i.productId === fixture.products.fit);
      expect(fitLine).toMatchObject({
        sku: 't-ao-fit-kaftan-L',
        quantity: 1,
        unitPriceMinor: PRICE,
        lineTotalMinor: PRICE,
        fit: {
          method: 'MANUAL_MEASUREMENTS',
          selectionMode: 'LOCKED_RECOMMENDATION',
          fitPreference: 'tailored',
        },
      });
      expect(fitLine?.measurements.map((m) => [m.code, m.valueInches])).toEqual(
        expect.arrayContaining([
          ['chest', 42],
          ['shoulder', 17.5],
          ['sleeve', 24],
          ['top_length', 32],
        ]),
      );
      expect(fitLine?.measurements.find((m) => m.code === 'chest')?.requiredSize).toBeTruthy();
      expect(view.items.find((i) => i.productId === fixture.products.plain)).toMatchObject({
        fit: null,
        measurements: [],
      });
      expect(view.payments.map((p) => [p.status, p.failureReason])).toEqual([
        ['failed', 'DECLINED'],
        ['success', null],
      ]);
      expect(view.history.map((h) => [h.fromStatus, h.toStatus, h.actor.type])).toEqual([
        [null, 'pending_payment', 'system'],
        ['pending_payment', 'being_prepared', 'system'],
      ]);
      expect(view.allowedTransitions).toEqual([
        { toStatus: 'sent_out', requiresPaid: true, requiresReason: false },
      ]);
      expect(JSON.stringify(view)).not.toMatch(
        /raw_verify|rawVerify|gatewayResponse|gateway_response|MOCK Approved|password/i,
      );
      expect((await admin.get(`/orders/${randomUUID()}`)).status).toBe(404);
    });
  });

  describe('status updates', () => {
    it('moves being_prepared -> sent_out -> delivered with history, audit and one email each', async () => {
      const order = await paidOrder();
      const sent = await status(order.id, {
        toStatus: 'sent_out',
        expectedStatus: 'being_prepared',
        carrier: 'SAMPLE Courier',
        trackingReference: 'TRK-123',
      });
      expect(sent.status).toBe(200);
      expect(dataOf<AdminOrderDetailDto>(sent)).toMatchObject({
        orderStatus: 'sent_out',
        carrier: 'SAMPLE Courier',
        trackingReference: 'TRK-123',
        allowedTransitions: [{ toStatus: 'delivered' }],
      });

      const delivered = dataOf<AdminOrderDetailDto>(
        await status(order.id, { toStatus: 'delivered', expectedStatus: 'sent_out' }),
      );
      expect(delivered.orderStatus).toBe('delivered');
      expect(delivered.deliveredAt).not.toBeNull();
      expect(delivered.allowedTransitions).toEqual([]);
      const adminRows = delivered.history.filter((h) => h.actor.type === 'admin');
      expect(adminRows.map((h) => [h.fromStatus, h.toStatus, h.actor.id])).toEqual([
        ['being_prepared', 'sent_out', adminId],
        ['sent_out', 'delivered', adminId],
      ]);
      expect(adminRows[0]?.note).toContain('TRK-123');
      expect(await auditCount(ctx, { action: 'order.status_change', entityId: order.id })).toBe(2);
      expect(await outboxCount(order.id, 'order_sent_out')).toBe(1);
      expect(await outboxCount(order.id, 'order_delivered')).toBe(1);

      // The customer sees the new status (and never internal data).
      const mine = dataOf<OrderDto>(
        await customerApi(ctx, buyer.token).get(`/me/orders/${order.id}`),
      );
      expect(mine.orderStatus).toBe('delivered');
    });

    it('rejects invalid transitions, unpaid orders, payment_review and stale expected status', async () => {
      const order = await paidOrder();
      const skip = await status(order.id, {
        toStatus: 'delivered',
        expectedStatus: 'being_prepared',
      });
      expect(skip.status).toBe(409);
      expect(errorCode(skip)).toBe('INVALID_STATUS_TRANSITION');
      expect(
        bodyOf<{ error: { details: { allowed: string[] } } }>(skip).error.details.allowed,
      ).toEqual(['sent_out']);
      expect(
        errorCode(
          await status(order.id, { toStatus: 'payment_review', expectedStatus: 'being_prepared' }),
        ),
      ).toBe('INVALID_STATUS_TRANSITION');
      expect(
        errorCode(
          await status(order.id, { toStatus: 'pending_payment', expectedStatus: 'being_prepared' }),
        ),
      ).toBe('INVALID_STATUS_TRANSITION');
      // Paid orders cannot be cancelled here (refund policy pending).
      expect(
        errorCode(
          await status(order.id, {
            toStatus: 'cancelled',
            expectedStatus: 'being_prepared',
            reason: 'x',
          }),
        ),
      ).toBe('INVALID_STATUS_TRANSITION');

      const stale = await status(order.id, {
        toStatus: 'sent_out',
        expectedStatus: 'pending_payment',
      });
      expect(stale.status).toBe(409);
      expect(errorCode(stale)).toBe('ORDER_STATUS_CONFLICT');
      expect(
        bodyOf<{ error: { details: { currentStatus: string } } }>(stale).error.details
          .currentStatus,
      ).toBe('being_prepared');

      const unpaid = await placeOrder(ctx, fixture, buyer.token, { fitQuantity: 0 });
      const ship = await status(unpaid.id, {
        toStatus: 'being_prepared',
        expectedStatus: 'pending_payment',
      });
      expect(ship.status).toBe(409);
      expect(errorCode(ship)).toBe('ORDER_NOT_PAID');

      expect(
        (
          await status(order.id, {
            toStatus: 'delivered',
            expectedStatus: 'being_prepared',
            carrier: 'x',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await status(order.id, {
            toStatus: 'sent_out',
            expectedStatus: 'being_prepared',
            paid: true,
          })
        ).status,
      ).toBe(400);
      expect(await auditCount(ctx, { action: 'order.status_change' })).toBe(0);
    });

    it('two admins at once: one wins, the other gets a conflict; one email', async () => {
      const order = await paidOrder();
      const second = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
      const body = { toStatus: 'sent_out', expectedStatus: 'being_prepared' };
      const results = await Promise.all([
        admin.patch(`/orders/${order.id}/status`, body),
        second.patch(`/orders/${order.id}/status`, body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(errorCode(results.find((r) => r.status === 409) ?? results[0])).toBe(
        'ORDER_STATUS_CONFLICT',
      );
      expect(await outboxCount(order.id, 'order_sent_out')).toBe(1);
      const history = await ctx.db
        .selectFrom('order_status_history')
        .select('to_status')
        .where('order_id', '=', order.id)
        .execute();
      expect(history.filter((h) => h.to_status === 'sent_out')).toHaveLength(1);
    });

    it('cancels an unpaid order only with a reason, releasing its stock', async () => {
      const order = await placeOrder(ctx, fixture, buyer.token, {
        fitQuantity: 0,
        plainQuantity: 2,
      });
      const noReason = await status(order.id, {
        toStatus: 'cancelled',
        expectedStatus: 'pending_payment',
      });
      expect(noReason.status).toBe(400);
      expect(errorCode(noReason)).toBe('VALIDATION_ERROR');

      const res = await status(order.id, {
        toStatus: 'cancelled',
        expectedStatus: 'pending_payment',
        reason: 'Customer asked by phone',
      });
      expect(res.status).toBe(200);
      expect(dataOf<AdminOrderDetailDto>(res)).toMatchObject({
        orderStatus: 'cancelled',
        cancelReason: 'Customer asked by phone',
      });
      const variant = await ctx.db
        .selectFrom('product_variants')
        .select('stock_reserved')
        .where('id', '=', fixture.variants.plainM)
        .executeTakeFirstOrThrow();
      expect(variant.stock_reserved).toBe(0);
      const ledger = await ctx.db
        .selectFrom('stock_movements')
        .select('movement_type')
        .where('reference_id', '=', order.id)
        .orderBy('id')
        .execute();
      expect(ledger.map((m) => m.movement_type)).toEqual(['reservation', 'reservation_release']);
    });

    it('refuses to cancel while a payment is in flight unless confirmInFlight is sent', async () => {
      const order = await placeOrder(ctx, fixture, buyer.token, { fitQuantity: 0 });
      expect(
        (await customerApi(ctx, buyer.token).post('/payments/initialize', { orderId: order.id }))
          .status,
      ).toBe(201);
      const body = {
        toStatus: 'cancelled',
        expectedStatus: 'pending_payment',
        reason: 'Duplicate order',
      };
      const blocked = await status(order.id, body);
      expect(blocked.status).toBe(409);
      expect(errorCode(blocked)).toBe('PAYMENT_IN_PROGRESS');
      const forced = await status(order.id, { ...body, confirmInFlight: true });
      expect(forced.status).toBe(200);
      const audit = await ctx.db
        .selectFrom('admin_audit_logs')
        .select('after_data')
        .where('entity_id', '=', order.id)
        .executeTakeFirstOrThrow();
      expect(audit.after_data).toMatchObject({ orderStatus: 'cancelled', confirmInFlight: true });
    });
  });

  describe('notes', () => {
    it('are append-only, attributed, audited and never shown to customers', async () => {
      const order = await paidOrder();
      const res = await admin.post(`/orders/${order.id}/notes`, {
        body: 'Customer prefers morning delivery.',
      });
      expect(res.status).toBe(201);
      expect(dataOf<AdminOrderNoteDto>(res)).toMatchObject({
        body: 'Customer prefers morning delivery.',
        author: { id: adminId },
      });
      await admin.post(`/orders/${order.id}/notes`, { body: 'Second note' });
      const notes = dataOf<AdminOrderNoteDto[]>(await admin.get(`/orders/${order.id}/notes`));
      expect(notes.map((n) => n.body)).toEqual([
        'Customer prefers morning delivery.',
        'Second note',
      ]);
      expect((await detail(order.id)).notes).toHaveLength(2);
      expect(await auditCount(ctx, { action: 'order.note_add', entityId: order.id })).toBe(2);
      expect((await admin.post(`/orders/${order.id}/notes`, { body: '   ' })).status).toBe(400);
      expect((await admin.post(`/orders/${randomUUID()}/notes`, { body: 'x' })).status).toBe(404);

      await expect(
        ctx.db.updateTable('order_notes').set({ body: 'changed' }).execute(),
      ).rejects.toThrow(/append-only/);
      await expect(ctx.db.deleteFrom('order_notes').execute()).rejects.toThrow(/append-only/);

      const mine = await customerApi(ctx, buyer.token).get(`/me/orders/${order.id}`);
      expect(JSON.stringify(mine.body)).not.toMatch(/morning delivery|Second note|notes/);
    });
  });
});
