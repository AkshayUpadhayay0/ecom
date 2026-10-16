import { randomUUID } from 'node:crypto';
import type {
  AdminReturnDetailDto,
  AdminReturnSummaryDto,
  ApiData,
  ApiErrorBody,
  ApiList,
  CustomerReturnDetailDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  adminClient,
  auditCount,
  customerToken,
  resetAdminApiData,
  resetBlueprintData,
  signInAdmin,
  type AdminClient,
} from '../../../test/admin-fixtures.js';
import {
  type CommerceFixture,
  createCommerceFixture,
  customerApi,
  registerCustomer,
  resetFixtureStock,
} from '../../../test/commerce-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  testDatabaseUrl,
} from '../../../test/helpers.js';
import { type MediaTestContext, makeMediaTestApp } from '../../../test/media-fixtures.js';
import {
  type FitMode,
  addFitVariant,
  deliveredOrder,
  returnBody,
  uploadEvidence,
} from '../../../test/returns-fixtures.js';

describe.skipIf(!hasTestDatabase)('Admin returns, exchange, inspection (Phase 7b)', () => {
  let ctx: MediaTestContext;
  let fixture: CommerceFixture;
  let xlVariant: string;
  let admin: AdminClient;
  let superAdmin: AdminClient;
  let adminId: string;
  let buyer: { token: string; id: string; email: string };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
  const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;
  const errorOf = (res: request.Response) => bodyOf<ApiErrorBody>(res).error;
  const stockOf = (variantId: string) =>
    ctx.db
      .selectFrom('product_variants')
      .select(['stock_on_hand as onHand', 'stock_reserved as reserved'])
      .where('id', '=', variantId)
      .executeTakeFirstOrThrow();
  const ledger = (requestId: string) =>
    ctx.db
      .selectFrom('stock_movements')
      .select(['movement_type as type', 'quantity_delta as delta', 'variant_id as variantId'])
      .where('reference_type', '=', 'return_request')
      .where('reference_id', '=', requestId)
      .orderBy('id')
      .execute();
  const emails = (template: string) =>
    ctx.db
      .selectFrom('email_outbox')
      .select('dedupe_key')
      .where('template', '=', template)
      .execute();

  async function newRequest(
    options: { mode?: FitMode; body?: Record<string, unknown>; who?: typeof buyer } = {},
  ): Promise<CustomerReturnDetailDto> {
    const who = options.who ?? buyer;
    const { order, itemId } = await deliveredOrder(ctx, fixture, who.token, {
      mode: options.mode ?? 'LOCKED',
    });
    const res = await customerApi(ctx, who.token).post(
      `/me/orders/${order.id}/items/${itemId}/returns`,
      returnBody(options.body),
    );
    expect(res.status).toBe(201);
    return dataOf<CustomerReturnDetailDto>(res);
  }
  const exchangeBody = () => ({ requestType: 'EXCHANGE', exchangeSizeId: fixture.sizes.get('XL') });
  const act = (id: string, action: string, body: object, client = admin) =>
    client.post(`/returns/${id}/${action}`, body);

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = await makeMediaTestApp();
    await resetAdminApiData(ctx);
    fixture = await createCommerceFixture(ctx, 't-ar');
    xlVariant = await addFitVariant(ctx, fixture, 'XL', 5);
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx);
    await ctx.db.deleteFrom('admin_audit_logs').execute();
    await resetFixtureStock(ctx, fixture);
    await ctx.db
      .updateTable('product_variants')
      .set({ stock_on_hand: 5, stock_reserved: 0 })
      .where('id', '=', xlVariant)
      .execute();
    const plain = await signInAdmin(ctx, 'admin');
    admin = adminClient(ctx, plain.token);
    adminId = plain.id;
    superAdmin = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);
    buyer = await registerCustomer(ctx);
    await ctx.db.deleteFrom('email_outbox').execute();
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
    await ctx.cleanup();
  });

  it('rejects customer tokens on every admin route', async () => {
    const token = await customerToken(ctx);
    const id = randomUUID();
    for (const [method, path] of [
      ['get', '/returns'],
      ['get', `/returns/${id}`],
      ['post', `/returns/${id}/approve`],
      ['post', `/returns/${id}/reject`],
      ['post', `/returns/${id}/request-info`],
      ['post', `/returns/${id}/mark-received`],
      ['post', `/returns/${id}/status`],
      ['post', `/returns/${id}/inspect`],
      ['patch', `/returns/${id}/responsibility`],
      ['post', `/returns/${id}/notes`],
    ] as const) {
      expect(
        (
          await request(ctx.app)
            [method](`${ADMIN}${path}`)
            .set('Authorization', `Bearer ${token}`)
            .send({})
        ).status,
        path,
      ).toBe(401);
    }
  });

  it('lists with filters and search; the detail shows Blueprint, evidence and the timeline', async () => {
    const photo = await uploadEvidence(ctx, buyer.token);
    const locked = await newRequest({ body: { evidenceMediaIds: [photo] } });
    const override = await newRequest({ mode: 'OVERRIDE' });
    const list = async (q: string) =>
      bodyOf<ApiList<AdminReturnSummaryDto>>(await admin.get(`/returns?${q}`)).data.map(
        (r) => r.id,
      );
    expect((await list('')).sort()).toEqual([locked.id, override.id].sort());
    expect(await list('responsibility=CUSTOMER_FAULT')).toEqual([override.id]);
    expect(await list('responsibility=REVIEW_REQUIRED')).toEqual([locked.id]);
    expect(await list(`q=${locked.requestNumber}`)).toEqual([locked.id]);
    expect(await list(`q=${locked.orderNumber}`)).toEqual([locked.id]);
    expect(
      (await list('status=SUBMITTED&requestType=RETURN&reasonCode=does_not_fit&open=true')).length,
    ).toBe(2);
    expect(await list('open=false')).toEqual([]);
    const stats = dataOf<{ openReturns: number; returnsAwaitingAction: number }>(
      await admin.get('/stats/overview'),
    );
    expect(stats).toMatchObject({ openReturns: 2, returnsAwaitingAction: 2 });

    const detail = dataOf<AdminReturnDetailDto>(await admin.get(`/returns/${locked.id}`));
    expect(detail).toMatchObject({
      status: 'SUBMITTED',
      responsibility: 'REVIEW_REQUIRED',
      payer: 'UNDECIDED',
      responsibilityDetails: { setBy: 'SYSTEM', basis: 'scenario_b_locked_fit_review' },
      item: { purchasedQuantity: 1, sizeLabel: expect.any(String) as string },
      orderDetails: { status: 'delivered', paymentStatus: 'paid' },
      blueprint: {
        method: 'MANUAL_MEASUREMENTS',
        selectionMode: 'LOCKED_RECOMMENDATION',
        fitPreference: 'standard',
      },
      refund: { executed: false, policy: 'PENDING_CLIENT_DECISION' },
      adminDecision: 'PENDING',
    });
    expect(detail.blueprint?.measurements.map((m) => m.code)).toEqual(
      expect.arrayContaining(['chest', 'shoulder']),
    );
    expect(detail.blueprint?.charts.length).toBeGreaterThan(0);
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]?.url).toContain('/media-local/');
    expect(detail.evidence[0]?.expiresAt).not.toBeNull();
    expect(detail.timeline.map((e) => [e.type, e.visibility])).toEqual([
      ['SUBMITTED', 'CUSTOMER'],
      ['RESPONSIBILITY_SET', 'INTERNAL'],
    ]);
    expect(detail.allowedTransitions.map((t) => t.toStatus)).toEqual([
      'UNDER_REVIEW',
      'AWAITING_CUSTOMER',
      'APPROVED',
      'REJECTED',
    ]);
  });

  describe('workflow', () => {
    it('request info -> customer reply returns the SAME request to review; approve -> receive -> inspect -> refund status -> complete', async () => {
      const req = await newRequest();
      const info = await act(req.id, 'request-info', {
        expectedStatus: 'SUBMITTED',
        message: 'Please send a photo of the fit.',
      });
      expect(dataOf<AdminReturnDetailDto>(info).status).toBe('AWAITING_CUSTOMER');
      const photo = await uploadEvidence(ctx, buyer.token);
      const reply = await customerApi(ctx, buyer.token).post(`/me/returns/${req.id}/reply`, {
        message: 'Photo attached.',
        evidenceMediaIds: [photo],
      });
      expect(dataOf<CustomerReturnDetailDto>(reply)).toMatchObject({
        id: req.id,
        status: 'UNDER_REVIEW',
      });
      expect(await ctx.db.selectFrom('return_requests').select('id').execute()).toHaveLength(1);
      expect(
        errorOf(
          await customerApi(ctx, buyer.token).post(`/me/returns/${req.id}/reply`, {
            message: 'again',
          }),
        ).code,
      ).toBe('INVALID_STATUS_TRANSITION');

      // Second round of questions: one email per event.
      await act(req.id, 'request-info', {
        expectedStatus: 'UNDER_REVIEW',
        message: 'And the label?',
      });
      await customerApi(ctx, buyer.token).post(`/me/returns/${req.id}/reply`, {
        message: 'Label is fine.',
      });
      expect(await emails('return_info_requested')).toHaveLength(2);

      const approved = dataOf<AdminReturnDetailDto>(
        await act(req.id, 'approve', { expectedStatus: 'UNDER_REVIEW' }),
      );
      expect(approved).toMatchObject({
        status: 'AWAITING_RETURN',
        adminDecision: 'APPROVED',
        reviewedBy: { id: adminId },
      });
      const approvalEmail = await ctx.db
        .selectFrom('email_outbox')
        .select('payload')
        .where('template', '=', 'return_approved')
        .executeTakeFirstOrThrow();
      expect(JSON.stringify(approvalEmail.payload)).toContain('PLACEHOLDER');
      const mine = dataOf<CustomerReturnDetailDto>(
        await customerApi(ctx, buyer.token).get(`/me/returns/${req.id}`),
      );
      expect(mine.returnInstructions?.address).toContain('PLACEHOLDER');

      expect(
        errorOf(await act(req.id, 'approve', { expectedStatus: 'AWAITING_RETURN' })).code,
      ).toBe('INVALID_STATUS_TRANSITION');
      expect(
        errorOf(await act(req.id, 'mark-received', { expectedStatus: 'SUBMITTED' })).code,
      ).toBe('RETURN_STATUS_CONFLICT');
      expect(
        dataOf<AdminReturnDetailDto>(
          await act(req.id, 'mark-received', { expectedStatus: 'AWAITING_RETURN' }),
        ).status,
      ).toBe('RETURN_RECEIVED');
      expect(
        errorOf(await customerApi(ctx, buyer.token).post(`/me/returns/${req.id}/cancel`, {})).code,
      ).toBe('INVALID_STATUS_TRANSITION');

      const early = await act(req.id, 'status', {
        expectedStatus: 'RETURN_RECEIVED',
        toStatus: 'REFUND_PROCESSING',
      });
      expect(errorOf(early).code).toBe('RETURN_NOT_ALLOWED');
      expect(
        errorOf(
          await act(req.id, 'status', {
            expectedStatus: 'RETURN_RECEIVED',
            toStatus: 'EXCHANGE_PROCESSING',
          }),
        ).code,
      ).toBe('INVALID_STATUS_TRANSITION');
      const before = await stockOf(fixture.variants.fitL);
      await act(req.id, 'inspect', { outcome: 'NOT_RESELLABLE', notes: 'Stained' });
      expect(await stockOf(fixture.variants.fitL)).toEqual(before);
      expect(await ledger(req.id)).toEqual([]);
      await act(req.id, 'status', {
        expectedStatus: 'RETURN_RECEIVED',
        toStatus: 'REFUND_PROCESSING',
      });
      const done = dataOf<AdminReturnDetailDto>(
        await act(req.id, 'status', { expectedStatus: 'REFUND_PROCESSING', toStatus: 'COMPLETED' }),
      );
      expect(done.status).toBe('COMPLETED');
      expect(done.closedAt).not.toBeNull();
      expect(
        await auditCount(ctx, { action: 'return.status_change', entityId: req.id }),
      ).toBeGreaterThanOrEqual(6);

      // Customer timeline: status changes and own replies, never internal events.
      const timeline = dataOf<CustomerReturnDetailDto>(
        await customerApi(ctx, buyer.token).get(`/me/returns/${req.id}`),
      ).timeline;
      expect(timeline.map((e) => e.type)).not.toContain('INSPECTED');
      expect(timeline.some((e) => e.type === 'CUSTOMER_REPLY' && e.by === 'you')).toBe(true);
    });

    it('reject needs a reason; two admins approving at once: one wins', async () => {
      const req = await newRequest();
      expect((await act(req.id, 'reject', { expectedStatus: 'SUBMITTED' })).status).toBe(400);
      const results = await Promise.all([
        act(req.id, 'approve', { expectedStatus: 'SUBMITTED' }),
        act(req.id, 'approve', { expectedStatus: 'SUBMITTED' }, superAdmin),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await emails('return_approved')).toHaveLength(1);
      const other = await newRequest();
      const rejected = dataOf<AdminReturnDetailDto>(
        await act(other.id, 'reject', { expectedStatus: 'SUBMITTED', reason: 'Outside policy' }),
      );
      expect(rejected).toMatchObject({ status: 'REJECTED', adminDecision: 'REJECTED' });
      expect(await emails('return_rejected')).toHaveLength(1);
    });

    it('internal notes are append-only and never reach the customer', async () => {
      const req = await newRequest();
      expect((await act(req.id, 'notes', { body: 'Customer called, very polite.' })).status).toBe(
        201,
      );
      const detail = dataOf<AdminReturnDetailDto>(await admin.get(`/returns/${req.id}`));
      expect(detail.timeline.find((e) => e.type === 'ADMIN_NOTE')).toMatchObject({
        visibility: 'INTERNAL',
        actor: { id: adminId },
      });
      const mine = await customerApi(ctx, buyer.token).get(`/me/returns/${req.id}`);
      expect(JSON.stringify(mine.body)).not.toContain('very polite');
      await expect(
        ctx.db.updateTable('return_request_events').set({ note: 'x' }).execute(),
      ).rejects.toThrow(/append-only/);
      expect(await auditCount(ctx, { action: 'return.note_add', entityId: req.id })).toBe(1);
    });
  });

  describe('exchange stock', () => {
    it('reserves on approval, ships on EXCHANGE_SENT, and the ledger matches', async () => {
      const req = await newRequest({ body: exchangeBody() });
      await act(req.id, 'approve', { expectedStatus: 'SUBMITTED' });
      expect(await stockOf(xlVariant)).toEqual({ onHand: 5, reserved: 1 });
      const hold = await ctx.db
        .selectFrom('stock_reservations')
        .select(['status', 'order_id', 'variant_id'])
        .where('return_request_id', '=', req.id)
        .executeTakeFirstOrThrow();
      expect(hold).toEqual({ status: 'held', order_id: null, variant_id: xlVariant });

      await act(req.id, 'mark-received', { expectedStatus: 'AWAITING_RETURN' });
      await act(req.id, 'inspect', { outcome: 'RESELLABLE' });
      await act(req.id, 'status', {
        expectedStatus: 'RETURN_RECEIVED',
        toStatus: 'EXCHANGE_PROCESSING',
      });
      const sent = dataOf<AdminReturnDetailDto>(
        await act(req.id, 'status', {
          expectedStatus: 'EXCHANGE_PROCESSING',
          toStatus: 'EXCHANGE_SENT',
          carrier: 'SAMPLE Courier',
          trackingReference: 'TRK-9',
        }),
      );
      expect(sent.exchange).toMatchObject({
        carrier: 'SAMPLE Courier',
        trackingReference: 'TRK-9',
        reservationStatus: 'committed',
      });
      expect(await stockOf(xlVariant)).toEqual({ onHand: 4, reserved: 0 });
      expect(await emails('return_exchange_sent')).toHaveLength(1);
      expect(
        (await ledger(req.id)).map((m) => [
          m.type,
          m.delta,
          m.variantId === xlVariant ? 'XL' : 'L',
        ]),
      ).toEqual([
        ['reservation', 1, 'XL'],
        ['return', 1, 'L'],
        ['reservation_release', -1, 'XL'],
        ['sale', -1, 'XL'],
      ]);
      expect(
        dataOf<AdminReturnDetailDto>(
          await act(req.id, 'status', { expectedStatus: 'EXCHANGE_SENT', toStatus: 'COMPLETED' }),
        ).status,
      ).toBe('COMPLETED');
    });

    it('releases the hold on rejection or customer cancel; out of stock = not approved', async () => {
      const cancelled = await newRequest({ body: exchangeBody() });
      await act(cancelled.id, 'approve', { expectedStatus: 'SUBMITTED' });
      await customerApi(ctx, buyer.token).post(`/me/returns/${cancelled.id}/cancel`, {});
      expect(await stockOf(xlVariant)).toEqual({ onHand: 5, reserved: 0 });
      expect((await ledger(cancelled.id)).map((m) => m.type)).toEqual([
        'reservation',
        'reservation_release',
      ]);

      await ctx.db
        .updateTable('product_variants')
        .set({ stock_on_hand: 0 })
        .where('id', '=', xlVariant)
        .execute();
      const blocked = await newRequest({ body: exchangeBody() });
      const res = await act(blocked.id, 'approve', { expectedStatus: 'SUBMITTED' });
      expect(errorOf(res).code).toBe('INSUFFICIENT_STOCK');
      const row = await ctx.db
        .selectFrom('return_requests')
        .select(['status', 'admin_decision'])
        .where('id', '=', blocked.id)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ status: 'SUBMITTED', admin_decision: 'PENDING' });
      expect(await stockOf(xlVariant)).toEqual({ onHand: 0, reserved: 0 });
    });

    it('concurrent approvals for the last unit: exactly one succeeds, never negative', async () => {
      await ctx.db
        .updateTable('product_variants')
        .set({ stock_on_hand: 1 })
        .where('id', '=', xlVariant)
        .execute();
      const second = await registerCustomer(ctx, 'Second Buyer');
      const a = await newRequest({ body: exchangeBody() });
      const b = await newRequest({ body: exchangeBody(), who: second });
      const results = await Promise.all([
        act(a.id, 'approve', { expectedStatus: 'SUBMITTED' }),
        act(b.id, 'approve', { expectedStatus: 'SUBMITTED' }, superAdmin),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(errorOf(results.find((r) => r.status === 409) ?? results[0]).code).toBe(
        'INSUFFICIENT_STOCK',
      );
      expect(await stockOf(xlVariant)).toEqual({ onHand: 1, reserved: 1 });
    });
  });

  describe('inspection and restock', () => {
    it('RESELLABLE restocks exactly once; over-quantity and repeat attempts are refused', async () => {
      const req = await newRequest();
      expect(errorOf(await act(req.id, 'inspect', { outcome: 'RESELLABLE' })).code).toBe(
        'RETURN_NOT_ALLOWED',
      );
      await act(req.id, 'approve', { expectedStatus: 'SUBMITTED' });
      await act(req.id, 'mark-received', { expectedStatus: 'AWAITING_RETURN' });
      expect(
        errorOf(await act(req.id, 'inspect', { outcome: 'RESELLABLE', restockQuantity: 2 })).code,
      ).toBe('QUANTITY_LIMIT_EXCEEDED');
      expect(
        (await act(req.id, 'inspect', { outcome: 'NOT_RESELLABLE', restockQuantity: 1 })).status,
      ).toBe(400);
      const before = await stockOf(fixture.variants.fitL);
      const inspected = dataOf<AdminReturnDetailDto>(
        await act(req.id, 'inspect', { outcome: 'RESELLABLE', notes: 'As new' }),
      );
      expect(inspected.inspection).toMatchObject({
        outcome: 'RESELLABLE',
        restockedQuantity: 1,
        inspectedBy: { id: adminId },
      });
      expect(await stockOf(fixture.variants.fitL)).toEqual({
        onHand: before.onHand + 1,
        reserved: before.reserved,
      });
      expect(await ledger(req.id)).toEqual([
        { type: 'return', delta: 1, variantId: fixture.variants.fitL },
      ]);
      expect(errorOf(await act(req.id, 'inspect', { outcome: 'RESELLABLE' })).code).toBe(
        'RETURN_ALREADY_INSPECTED',
      );
      // The DB guard refuses any extra restock row for this request.
      await expect(
        ctx.db
          .insertInto('stock_movements')
          .values({
            variant_id: fixture.variants.fitL,
            movement_type: 'return',
            quantity_delta: 1,
            reference_type: 'return_request',
            reference_id: req.id,
          })
          .execute(),
      ).rejects.toThrow(/exceed the returned quantity/);
      expect(await auditCount(ctx, { action: 'return.inspect', entityId: req.id })).toBe(1);
    });
  });

  describe('responsibility (super_admin only)', () => {
    it('sets BRAND_FAULT / BLUEPRINT_FAILURE on a locked decision; audited; plain admins refused', async () => {
      const req = await newRequest();
      const body = {
        responsibility: 'BRAND_FAULT',
        faultCause: 'BLUEPRINT_FAILURE',
        note: 'Measured garment confirms the chart was wrong.',
      };
      expect((await admin.patch(`/returns/${req.id}/responsibility`, body)).status).toBe(403);
      expect(
        (await superAdmin.patch(`/returns/${req.id}/responsibility`, { ...body, note: undefined }))
          .status,
      ).toBe(400);
      const res = await superAdmin.patch(`/returns/${req.id}/responsibility`, body);
      expect(res.status).toBe(200);
      expect(dataOf<AdminReturnDetailDto>(res)).toMatchObject({
        responsibility: 'BRAND_FAULT',
        faultCause: 'BLUEPRINT_FAILURE',
        payer: 'BRAND',
        responsibilityDetails: { setBy: 'ADMIN', basis: 'admin_review' },
        status: 'SUBMITTED',
      });
      const audit = await ctx.db
        .selectFrom('admin_audit_logs')
        .select(['before_data', 'after_data'])
        .where('action', '=', 'return.responsibility_set')
        .executeTakeFirstOrThrow();
      expect(audit.before_data).toMatchObject({
        responsibility: 'REVIEW_REQUIRED',
        setBy: 'SYSTEM',
      });
      expect(audit.after_data).toMatchObject({ responsibility: 'BRAND_FAULT', payer: 'BRAND' });
      const mine = dataOf<CustomerReturnDetailDto>(
        await customerApi(ctx, buyer.token).get(`/me/returns/${req.id}`),
      );
      expect(mine.returnCosts).toEqual({
        payer: 'BRAND',
        label: 'Return delivery is covered by Urban Ibile.',
      });
    });

    it('refuses causes that do not fit the responsibility or the decision', async () => {
      const override = await newRequest({ mode: 'OVERRIDE' });
      const res = await superAdmin.patch(`/returns/${override.id}/responsibility`, {
        responsibility: 'BRAND_FAULT',
        faultCause: 'BLUEPRINT_FAILURE',
        note: 'x',
      });
      expect(errorOf(res)).toMatchObject({
        code: 'INVALID_RESPONSIBILITY',
        details: { problem: 'BLUEPRINT_FAILURE_NEEDS_LOCKED_DECISION' },
      });
      expect(
        errorOf(
          await superAdmin.patch(`/returns/${override.id}/responsibility`, {
            responsibility: 'CUSTOMER_FAULT',
            faultCause: 'DEFECTIVE_ITEM',
            note: 'x',
          }),
        ).code,
      ).toBe('INVALID_RESPONSIBILITY');
      // Overriding a system CUSTOMER_FAULT with a payer override is allowed (super_admin, noted).
      const changed = await superAdmin.patch(`/returns/${override.id}/responsibility`, {
        responsibility: 'BRAND_FAULT',
        faultCause: 'DEFECTIVE_ITEM',
        payer: 'BRAND',
        note: 'Seam defect found.',
      });
      expect(dataOf<AdminReturnDetailDto>(changed)).toMatchObject({
        responsibility: 'BRAND_FAULT',
        payer: 'BRAND',
      });
    });
  });
});
