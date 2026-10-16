import { randomUUID } from 'node:crypto';
import type {
  AdminCustomerDetailDto,
  AdminCustomerSummaryDto,
  ApiData,
  ApiList,
  StatsOverviewDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  resetAdminApiData,
  resetBlueprintData,
  signInAdmin,
  type AdminClient,
} from '../../../test/admin-fixtures.js';
import {
  API,
  type CommerceFixture,
  FEE,
  PRICE,
  createCommerceFixture,
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

describe.skipIf(!hasTestDatabase)('Admin customers + dashboard stats (Phase 7a)', () => {
  let ctx: TestContext;
  let fixture: CommerceFixture;
  let superAdmin: AdminClient;
  let plainAdmin: AdminClient;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
  const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    await resetAdminApiData(ctx);
    fixture = await createCommerceFixture(ctx, 't-ac');
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx);
    await ctx.db.deleteFrom('admin_audit_logs').execute();
    await ctx.db.deleteFrom('auth_sessions').execute();
    await ctx.db.deleteFrom('customers').execute();
    await resetFixtureStock(ctx, fixture);
    superAdmin = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);
    plainAdmin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  describe('customers', () => {
    it('lists and searches customers with order totals; never exposes secrets', async () => {
      const ada = await registerCustomer(ctx, 'Ada Obi');
      const chidi = await registerCustomer(ctx, 'Chidi Okafor');
      const order = await placeOrder(ctx, fixture, ada.token, { fitQuantity: 0, plainQuantity: 2 });
      await payOrder(ctx, fixture, ada.token, order.id);
      await placeOrder(ctx, fixture, ada.token, { fitQuantity: 0, plainQuantity: 1 }); // unpaid, ignored in the total

      const res = await plainAdmin.get('/customers');
      expect(res.status).toBe(200);
      const list = bodyOf<ApiList<AdminCustomerSummaryDto>>(res);
      expect(list.meta.total).toBe(2);
      expect(list.data.find((c) => c.id === ada.id)).toMatchObject({
        fullName: 'Ada Obi',
        email: ada.email,
        status: 'active',
        orderCount: 2,
        paidTotalMinor: 2 * PRICE + FEE,
      });
      const search = async (q: string) =>
        bodyOf<ApiList<AdminCustomerSummaryDto>>(
          await plainAdmin.get(`/customers?q=${encodeURIComponent(q)}`),
        ).data.map((c) => c.id);
      expect(await search('chidi')).toEqual([chidi.id]);
      expect(await search(ada.email.slice(0, 10))).toEqual([ada.id]);
      expect(await search('status-nobody')).toEqual([]);

      const detail = dataOf<AdminCustomerDetailDto>(await plainAdmin.get(`/customers/${ada.id}`));
      expect(detail).toMatchObject({ id: ada.id, preferredLanguage: 'en', status: 'active' });
      expect(detail.addresses).toHaveLength(2);
      expect(detail.addresses[0]).toMatchObject({
        recipientName: 'Ada Obi',
        zoneName: 'Zone t-ac',
      });
      expect(detail.orders.map((o) => o.paymentStatus).sort()).toEqual(['paid', 'unpaid']);
      const raw = JSON.stringify([list, detail]);
      expect(raw).not.toMatch(/password|hash|token|session|argon/i);
      expect((await plainAdmin.get(`/customers/${randomUUID()}`)).status).toBe(404);
    });

    it('super_admin suspends (revoking sessions) and re-enables with a reason; audited', async () => {
      const ada = await registerCustomer(ctx);
      const live = await ctx.db
        .selectFrom('auth_sessions')
        .select('id')
        .where('subject_id', '=', ada.id)
        .where('revoked_at', 'is', null)
        .execute();
      expect(live.length).toBeGreaterThan(0);

      expect(
        (
          await plainAdmin.patch(`/customers/${ada.id}/status`, {
            status: 'suspended',
            reason: 'Fraud check',
          })
        ).status,
      ).toBe(403);
      expect(
        (await superAdmin.patch(`/customers/${ada.id}/status`, { status: 'suspended' })).status,
      ).toBe(400);

      const suspended = await superAdmin.patch(`/customers/${ada.id}/status`, {
        status: 'suspended',
        reason: 'Fraud check',
      });
      expect(suspended.status).toBe(200);
      expect(dataOf<AdminCustomerDetailDto>(suspended).status).toBe('suspended');
      const stillLive = await ctx.db
        .selectFrom('auth_sessions')
        .select('id')
        .where('subject_id', '=', ada.id)
        .where('revoked_at', 'is', null)
        .execute();
      expect(stillLive).toEqual([]);
      const login = await request(ctx.app)
        .post(`${API}/auth/login`)
        .send({ email: ada.email, password: 'Ankara-Velvet-2026!', client: 'web' });
      expect(login.status).not.toBe(200);

      const enabled = await superAdmin.patch(`/customers/${ada.id}/status`, {
        status: 'active',
        reason: 'Cleared',
      });
      expect(dataOf<AdminCustomerDetailDto>(enabled).status).toBe('active');
      expect(await auditCount(ctx, { action: 'customer.suspend', entityId: ada.id })).toBe(1);
      expect(await auditCount(ctx, { action: 'customer.enable', entityId: ada.id })).toBe(1);
      const audit = await ctx.db
        .selectFrom('admin_audit_logs')
        .select('after_data')
        .where('action', '=', 'customer.suspend')
        .executeTakeFirstOrThrow();
      expect(audit.after_data).toMatchObject({ status: 'suspended', reason: 'Fraud check' });
    });
  });

  describe('stats overview', () => {
    it('returns counts and revenue that match the data', async () => {
      const ada = await registerCustomer(ctx);
      const paid = await placeOrder(ctx, fixture, ada.token, { fitQuantity: 1, plainQuantity: 1 });
      await payOrder(ctx, fixture, ada.token, paid.id);
      const old = await placeOrder(ctx, fixture, ada.token, { fitQuantity: 0, plainQuantity: 1 });
      await payOrder(ctx, fixture, ada.token, old.id);
      // Paid 10 days ago: counts for 30 days only.
      await ctx.db
        .updateTable('orders')
        .set({ paid_at: new Date(Date.now() - 10 * 24 * 60 * 60_000) })
        .where('id', '=', old.id)
        .execute();
      const flagged = await placeOrder(ctx, fixture, ada.token, {
        fitQuantity: 0,
        plainQuantity: 1,
      });
      await payOrder(ctx, fixture, ada.token, flagged.id, { status: 'success', amountMinor: 1 });
      await placeOrder(ctx, fixture, ada.token, { fitQuantity: 0, plainQuantity: 1 }); // pending
      // Stock: fit L available 9 (threshold default) and plain M set to 0.
      await ctx.db
        .updateTable('product_variants')
        .set({ stock_on_hand: 0, stock_reserved: 0 })
        .where('id', '=', fixture.variants.plainM)
        .execute();
      await ctx.db
        .updateTable('product_variants')
        .set({ low_stock_threshold: 100 })
        .where('id', '=', fixture.variants.fitL)
        .execute();
      await ctx.db
        .insertInto('media_assets')
        .values({
          kind: 'image',
          original_key: `test/${randomUUID()}`,
          mime_type: 'image/jpeg',
          size_bytes: 1,
          processing_status: 'failed',
        })
        .execute();

      const res = await plainAdmin.get('/stats/overview');
      expect(res.status).toBe(200);
      const stats = dataOf<StatsOverviewDto>(res);
      expect(stats).toMatchObject({
        currency: 'NGN',
        ordersByStatus: { being_prepared: 2, payment_review: 1, pending_payment: 1 },
        paid: {
          today: { orders: 1, revenueMinor: 2 * PRICE + FEE },
          last7Days: { orders: 1, revenueMinor: 2 * PRICE + FEE },
          last30Days: { orders: 2, revenueMinor: 3 * PRICE + 2 * FEE },
        },
        ordersNeedingAttention: 1,
        paymentsNeedingReview: 1,
        lowStockVariants: 1,
        outOfStockVariants: 1,
      });
      expect(stats.failedMediaJobs).toBeGreaterThanOrEqual(1);
      await ctx.db.deleteFrom('media_assets').where('processing_status', '=', 'failed').execute();
    });
  });
});
