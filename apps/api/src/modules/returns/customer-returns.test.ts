import { randomUUID } from 'node:crypto';
import type {
  ApiData,
  ApiErrorBody,
  ApiList,
  CustomerReturnDetailDto,
  CustomerReturnSummaryDto,
  MediaUrlDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  resetAdminApiData,
  resetBlueprintData,
  signInAdmin,
} from '../../../test/admin-fixtures.js';
import {
  type CommerceFixture,
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
  testDatabaseUrl,
} from '../../../test/helpers.js';
import {
  type MediaTestContext,
  makeMediaTestApp,
  tinyJpeg,
  uploadAndComplete,
} from '../../../test/media-fixtures.js';
import {
  addFitVariant,
  deliveredOrder,
  returnBody,
  uploadEvidence,
} from '../../../test/returns-fixtures.js';

describe.skipIf(!hasTestDatabase)('Customer returns (Phase 7b)', () => {
  let ctx: MediaTestContext;
  let fixture: CommerceFixture;
  let buyer: { token: string; id: string; email: string };
  let other: { token: string; id: string; email: string };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- names the DTO
  const dataOf = <T>(res: request.Response) => bodyOf<ApiData<T>>(res).data;
  const errorOf = (res: request.Response) => bodyOf<ApiErrorBody>(res).error;
  const create = (token: string, orderId: string, itemId: string, body: object) =>
    customerApi(ctx, token).post(`/me/orders/${orderId}/items/${itemId}/returns`, body);
  const requestRow = (id: string) =>
    ctx.db.selectFrom('return_requests').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const setPolicy = (values: {
    request_window_days?: number | null;
    require_original_tags?: boolean | null;
    require_unworn_unwashed?: boolean | null;
  }) => ctx.db.updateTable('return_policies').set(values).where('status', '=', 'active').execute();

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = await makeMediaTestApp();
    await resetAdminApiData(ctx);
    fixture = await createCommerceFixture(ctx, 't-cr');
    await addFitVariant(ctx, fixture, 'XL', 10);
  });

  beforeEach(async () => {
    await resetBlueprintData(ctx);
    await resetFixtureStock(ctx, fixture);
    await setPolicy({
      request_window_days: null,
      require_original_tags: null,
      require_unworn_unwashed: null,
    });
    buyer = await registerCustomer(ctx);
    other = await registerCustomer(ctx, 'Other Buyer');
    await ctx.db.deleteFrom('email_outbox').execute();
  });

  afterAll(async () => {
    await setPolicy({
      request_window_days: null,
      require_original_tags: null,
      require_unworn_unwashed: null,
    });
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
    await ctx.cleanup();
  });

  it('requires login; other customers get 404 everywhere', async () => {
    const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token);
    const id = randomUUID();
    for (const [method, path] of [
      ['post', `/me/orders/${order.id}/items/${itemId}/returns`],
      ['get', '/me/returns'],
      ['get', `/me/returns/${id}`],
      ['post', `/me/returns/${id}/reply`],
      ['post', `/me/returns/${id}/cancel`],
      ['post', '/me/media/uploads'],
    ] as const) {
      expect((await request(ctx.app)[method](`/api/v1${path}`).send({})).status, path).toBe(401);
    }
    expect((await create(other.token, order.id, itemId, returnBody())).status).toBe(404);
    const mine = dataOf<CustomerReturnDetailDto>(
      await create(buyer.token, order.id, itemId, returnBody()),
    );
    const them = customerApi(ctx, other.token);
    expect((await them.get(`/me/returns/${mine.id}`)).status).toBe(404);
    expect((await them.post(`/me/returns/${mine.id}/reply`, { message: 'x' })).status).toBe(404);
    expect((await them.post(`/me/returns/${mine.id}/cancel`, {})).status).toBe(404);
    expect(bodyOf<ApiList<CustomerReturnSummaryDto>>(await them.get('/me/returns')).data).toEqual(
      [],
    );
  });

  describe('creation rules', () => {
    it('refuses unpaid and undelivered orders', async () => {
      const unpaid = await placeOrder(ctx, fixture, buyer.token, {
        fitQuantity: 0,
        plainQuantity: 1,
      });
      const res = await create(buyer.token, unpaid.id, unpaid.items[0]?.id ?? '', returnBody());
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('RETURN_NOT_ALLOWED');
      await payOrder(ctx, fixture, buyer.token, unpaid.id); // paid, being_prepared (not delivered)
      expect(
        errorOf(await create(buyer.token, unpaid.id, unpaid.items[0]?.id ?? '', returnBody())).code,
      ).toBe('RETURN_NOT_ALLOWED');
    });

    it('limits quantity to purchased minus already returned; one open request per item', async () => {
      const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token, { quantity: 2 });
      const tooMany = await create(buyer.token, order.id, itemId, returnBody({ quantity: 3 }));
      expect(errorOf(tooMany)).toMatchObject({
        code: 'QUANTITY_LIMIT_EXCEEDED',
        details: { remaining: 2 },
      });

      const first = dataOf<CustomerReturnDetailDto>(
        await create(buyer.token, order.id, itemId, returnBody()),
      );
      const dup = await create(buyer.token, order.id, itemId, returnBody());
      expect(dup.status).toBe(409);
      expect(errorOf(dup).code).toBe('RETURN_ALREADY_OPEN');

      await ctx.db
        .updateTable('return_requests')
        .set({ status: 'COMPLETED', closed_at: new Date() })
        .where('id', '=', first.id)
        .execute();
      expect(
        errorOf(await create(buyer.token, order.id, itemId, returnBody({ quantity: 2 }))).code,
      ).toBe('QUANTITY_LIMIT_EXCEEDED');
      expect(
        (await create(buyer.token, order.id, itemId, returnBody({ quantity: 1 }))).status,
      ).toBe(201);
    });

    it('requires evidence when the reason says so; never trusts a client responsibility', async () => {
      const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token, { mode: 'NONE' });
      const missing = await create(
        buyer.token,
        order.id,
        itemId,
        returnBody({ reasonCode: 'wrong_item' }),
      );
      expect(missing.status).toBe(400);
      expect(errorOf(missing).code).toBe('EVIDENCE_REQUIRED');
      const injected = await create(
        buyer.token,
        order.id,
        itemId,
        returnBody({ responsibility: 'BRAND_FAULT' }),
      );
      expect(injected.status).toBe(400);
      expect(errorOf(injected).code).toBe('VALIDATION_ERROR');
      const photo = await uploadEvidence(ctx, buyer.token);
      const ok = await create(
        buyer.token,
        order.id,
        itemId,
        returnBody({ reasonCode: 'wrong_item', evidenceMediaIds: [photo] }),
      );
      expect(ok.status).toBe(201);
      expect(dataOf<CustomerReturnDetailDto>(ok).evidence.map((e) => e.id)).toEqual([photo]);
    });

    it('validates the exchange size and the request type', async () => {
      const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token);
      const notMade = await create(
        buyer.token,
        order.id,
        itemId,
        returnBody({ requestType: 'EXCHANGE', exchangeSizeId: fixture.sizes.get('S') }),
      );
      expect(errorOf(notMade).code).toBe('SIZE_NOT_OFFERED');
      expect(
        (
          await create(
            buyer.token,
            order.id,
            itemId,
            returnBody({ exchangeSizeId: fixture.sizes.get('XL') }),
          )
        ).status,
      ).toBe(400);
      expect(
        (await create(buyer.token, order.id, itemId, returnBody({ requestType: 'EXCHANGE' })))
          .status,
      ).toBe(400);
      const ok = await create(
        buyer.token,
        order.id,
        itemId,
        returnBody({ requestType: 'EXCHANGE', exchangeSizeId: fixture.sizes.get('XL') }),
      );
      expect(ok.status).toBe(201);
      expect(dataOf<CustomerReturnDetailDto>(ok)).toMatchObject({
        requestType: 'EXCHANGE',
        exchangeSizeLabel: expect.any(String) as string,
      });
      expect(
        (await requestRow(dataOf<CustomerReturnDetailDto>(ok).id)).replacement_variant_id,
      ).not.toBeNull();
    });

    it('a policy with NULL rules enforces nothing; set values are enforced and stored', async () => {
      const old = await deliveredOrder(ctx, fixture, buyer.token, { deliveredDaysAgo: 400 });
      const created = await create(buyer.token, old.order.id, old.itemId, returnBody());
      expect(created.status).toBe(201);
      const policy = await ctx.db
        .selectFrom('return_policies')
        .select('id')
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();
      expect((await requestRow(dataOf<CustomerReturnDetailDto>(created).id)).policy_id).toBe(
        policy.id,
      );

      await setPolicy({ request_window_days: 30, require_original_tags: true });
      const late = await deliveredOrder(ctx, fixture, other.token, { deliveredDaysAgo: 31 });
      expect(
        errorOf(
          await create(
            other.token,
            late.order.id,
            late.itemId,
            returnBody({ conditionConfirmations: { originalTags: true } }),
          ),
        ).code,
      ).toBe('RETURN_WINDOW_CLOSED');
      const recent = await deliveredOrder(ctx, fixture, other.token, { deliveredDaysAgo: 29 });
      expect(
        errorOf(await create(other.token, recent.order.id, recent.itemId, returnBody())).code,
      ).toBe('RETURN_CONDITION_NOT_MET');
      const ok = await create(
        other.token,
        recent.order.id,
        recent.itemId,
        returnBody({ conditionConfirmations: { originalTags: true } }),
      );
      expect(ok.status).toBe(201);
      const row = await requestRow(dataOf<CustomerReturnDetailDto>(ok).id);
      expect(row).toMatchObject({ confirmed_original_tags: true, confirmed_unworn_unwashed: null });
    });
  });

  describe('responsibility matrix (backend-decided)', () => {
    it.each([
      [
        'does_not_fit',
        'OVERRIDE',
        'CUSTOMER_FAULT',
        'CUSTOMER_OVERRODE_RECOMMENDATION',
        'CUSTOMER',
      ],
      ['changed_mind', 'LOCKED', 'CUSTOMER_FAULT', 'CHANGED_MIND', 'CUSTOMER'],
      ['does_not_fit', 'LOCKED', 'REVIEW_REQUIRED', null, 'UNDECIDED'],
      ['does_not_fit', 'NONE', 'REVIEW_REQUIRED', null, 'UNDECIDED'],
      ['damaged_faulty', 'LOCKED', 'REVIEW_REQUIRED', null, 'UNDECIDED'],
      ['wrong_item', 'OVERRIDE', 'REVIEW_REQUIRED', null, 'UNDECIDED'],
      ['other', 'NONE', 'REVIEW_REQUIRED', null, 'UNDECIDED'],
    ] as const)(
      '%s with %s decision -> %s / %s / %s',
      async (reason, mode, responsibility, cause, payer) => {
        const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token, { mode });
        const evidence =
          reason === 'wrong_item' || reason === 'damaged_faulty'
            ? [await uploadEvidence(ctx, buyer.token)]
            : [];
        const res = await create(
          buyer.token,
          order.id,
          itemId,
          returnBody({ reasonCode: reason, evidenceMediaIds: evidence }),
        );
        expect(res.status).toBe(201);
        const detail = dataOf<CustomerReturnDetailDto>(res);
        const row = await requestRow(detail.id);
        expect(row).toMatchObject({
          responsibility,
          fault_cause: cause,
          reverse_logistics_payer: payer,
          responsibility_set_by: 'SYSTEM',
        });
        expect(row.fault_basis).toBeTruthy();
        expect(row.blueprint_decision_id === null).toBe(mode === 'NONE');
        // The customer sees neutral wording only, and no internal events.
        expect(detail.returnCosts.payer).toBe(payer);
        expect(JSON.stringify(detail)).not.toMatch(
          /_FAULT|faultCause|fault_basis|RESPONSIBILITY_SET|CUSTOMER_OVERRODE/,
        );
        expect(detail.timeline.map((e) => [e.type, e.by])).toEqual([['SUBMITTED', 'you']]);
        expect(detail.refund).toEqual({ executed: false, policy: 'PENDING_CLIENT_DECISION' });
      },
    );
  });

  describe('evidence', () => {
    it('is private, owned and single-use; others and public media are refused', async () => {
      const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token, { mode: 'NONE' });
      const othersPhoto = await uploadEvidence(ctx, other.token);
      const admin = await signInAdmin(ctx, 'admin');
      const publicAsset = await uploadAndComplete(ctx, admin.token, {
        fileName: 'p.jpg',
        mimeType: 'image/jpeg',
        bytes: await tinyJpeg(),
      });
      for (const id of [othersPhoto, publicAsset, randomUUID()]) {
        const res = await create(
          buyer.token,
          order.id,
          itemId,
          returnBody({ reasonCode: 'damaged_faulty', evidenceMediaIds: [id] }),
        );
        expect(res.status, id).toBe(404);
      }
      const mine = await uploadEvidence(ctx, buyer.token);
      const row = await ctx.db
        .selectFrom('media_assets')
        .select(['visibility', 'owner_customer_id', 'uploaded_by'])
        .where('id', '=', mine)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({
        visibility: 'private',
        owner_customer_id: buyer.id,
        uploaded_by: null,
      });

      const url = await customerApi(ctx, buyer.token).get(`/me/media/${mine}/url`);
      expect(url.status).toBe(200);
      const signed = dataOf<MediaUrlDto>(url);
      expect(signed.expiresAt).not.toBeNull();
      const ttl = 300;
      expect(new Date(signed.expiresAt ?? 0).getTime()).toBeLessThanOrEqual(
        Date.now() + ttl * 1000 + 1000,
      );
      expect(signed.url).not.toContain('/public/');
      expect((await customerApi(ctx, other.token).get(`/me/media/${mine}/url`)).status).toBe(404);

      const created = dataOf<CustomerReturnDetailDto>(
        await create(
          buyer.token,
          order.id,
          itemId,
          returnBody({ reasonCode: 'damaged_faulty', evidenceMediaIds: [mine] }),
        ),
      );
      expect(JSON.stringify(created.evidence)).not.toMatch(/https?:/);
      // Already attached: cannot be reused on another request.
      const second = await deliveredOrder(ctx, fixture, buyer.token, { mode: 'NONE' });
      expect(
        (
          await create(
            buyer.token,
            second.order.id,
            second.itemId,
            returnBody({ reasonCode: 'damaged_faulty', evidenceMediaIds: [mine] }),
          )
        ).status,
      ).toBe(404);
    });

    it('accepts photos only, within the size limit', async () => {
      const api = customerApi(ctx, buyer.token);
      expect(
        (
          await api.post('/me/media/uploads', {
            fileName: 'v.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 100,
          })
        ).status,
      ).toBe(415);
      expect(
        (
          await api.post('/me/media/uploads', {
            fileName: 'big.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 20_000_000,
          })
        ).status,
      ).toBe(413);
      expect(
        (
          await api.post('/me/media/uploads', {
            fileName: 'p.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            visibility: 'public',
          })
        ).status,
      ).toBe(400);
      const photo = await uploadEvidence(ctx, buyer.token);
      expect((await customerApi(ctx, other.token).post(`/me/media/${photo}/complete`)).status).toBe(
        404,
      );
    });
  });

  it('cancels before the item is received; queues one "received" email per request', async () => {
    const { order, itemId } = await deliveredOrder(ctx, fixture, buyer.token);
    const created = dataOf<CustomerReturnDetailDto>(
      await create(buyer.token, order.id, itemId, returnBody()),
    );
    const emails = await ctx.db
      .selectFrom('email_outbox')
      .select(['template', 'dedupe_key'])
      .where('template', 'like', 'return_%')
      .execute();
    expect(emails).toHaveLength(1);
    expect(emails[0]?.template).toBe('return_received');
    const cancelled = await customerApi(ctx, buyer.token).post(`/me/returns/${created.id}/cancel`, {
      reason: 'Changed plan',
    });
    expect(dataOf<CustomerReturnDetailDto>(cancelled)).toMatchObject({ status: 'CANCELLED' });
    expect(
      errorOf(await customerApi(ctx, buyer.token).post(`/me/returns/${created.id}/cancel`, {}))
        .code,
    ).toBe('INVALID_STATUS_TRANSITION');
    // A new request for the same item is possible once the old one is closed.
    expect((await create(buyer.token, order.id, itemId, returnBody())).status).toBe(201);
  });
});
