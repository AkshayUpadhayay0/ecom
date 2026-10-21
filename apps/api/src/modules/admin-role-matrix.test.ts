import { randomUUID } from 'node:crypto';
import {
  ADMIN_EDITABLE_SETTING_KEYS,
  SETTING_KEYS,
  isAdminEditableSetting,
  type ApiData,
  type ApiList,
  type MeasurementProfileDto,
  type SizeDto,
} from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  customerToken,
  resetAdminApiData,
  restoreSettings,
  signInAdmin,
  snapshotSettings,
  type SettingsSnapshot,
} from '../../test/admin-fixtures.js';
import { ADMIN_ROLE_MATRIX, type RoleRule } from '../../test/admin-role-matrix.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../test/helpers.js';
import { adminRouteInventory } from '../../test/route-inventory.js';

const API = '/api/v1';
const UNAUTHORISED = 401;
const FORBIDDEN = 403;
const OK = 200;
/** Content-block key that does not exist: generic calls never change real content. */
const MISSING_BLOCK = 'test.missing-block';

/**
 * Role restrictions proved on the backend, route by route (follow-up 2, 21 Oct 2026). Every
 * registered /admin route must have an explicit rule in test/admin-role-matrix.ts; the HTTP checks
 * then run against the real app with real tokens:
 * - customer token: 401 on every non-public /admin route
 * - role admin: 403 on every super_admin route, never 403 on any_admin routes
 * - super_admin: passes the guard on every route (GET returns 200)
 * Write calls use invalid or missing ids / bodies so they prove access without changing data.
 */
describe.skipIf(!hasTestDatabase)('admin role matrix (every /admin route)', () => {
  let ctx: TestContext;
  let tokens: { admin: string; superAdmin: string; customer: string };
  let samples: {
    pageId: string;
    groupId: string;
    chartId: string;
    sizeIds: string[];
    assetId: string;
  };
  let snapshot: SettingsSnapshot;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    snapshot = await snapshotSettings(ctx);
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, snapshot);
    tokens = {
      admin: (await signInAdmin(ctx, 'admin')).token,
      superAdmin: (await signInAdmin(ctx, 'super_admin')).token,
      customer: await customerToken(ctx),
    };
    const page = await ctx.db.selectFrom('qr_pages').select('id').executeTakeFirstOrThrow();
    const chart = await ctx.db
      .selectFrom('size_charts')
      .select(['id', 'group_id'])
      .executeTakeFirstOrThrow();
    const sizes = await ctx.db
      .selectFrom('sizes')
      .select('id')
      .orderBy('sort_order')
      .orderBy('code')
      .execute();
    // A stored public asset, so the super admin's signed-URL call can succeed.
    const asset = await ctx.db
      .insertInto('media_assets')
      .values({
        kind: 'image',
        original_key: `test/${randomUUID()}`,
        mime_type: 'image/jpeg',
        size_bytes: 10,
        processing_status: 'ready',
        visibility: 'public',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    samples = {
      assetId: asset.id,
      pageId: page.id,
      groupId: chart.group_id,
      chartId: chart.id,
      sizeIds: sizes.map((s) => s.id),
    };
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await restoreSettings(ctx, snapshot);
    await ctx.db.destroy();
  });

  const entries = (): [string, RoleRule][] => Object.entries(ADMIN_ROLE_MATRIX);

  /** A concrete URL for a route: real ids where a super admin GET must succeed, else random. */
  function concretePath(route: string): string {
    const path = route.slice(route.indexOf(' ') + 1);
    return path
      .replace(':groupId', samples.groupId)
      .replace(':chartId', samples.chartId)
      .replace(':key', route.includes('/settings/') ? 'support.email' : MISSING_BLOCK)
      .replace(
        ':id',
        route.includes('/hidden-pages/')
          ? samples.pageId
          : route === 'GET /admin/media/:id/url'
            ? samples.assetId
            : randomUUID(),
      )
      .replace(':paymentId', randomUUID())
      .replace(':productId', randomUUID());
  }

  /** Harmless request bodies for the internal write routes (invalid or no-op). */
  function bodyFor(route: string): object | string {
    switch (route) {
      case 'PUT /admin/sizes/order':
        return { ids: samples.sizeIds }; // same order: no change
      case 'PUT /admin/hidden-pages/:id/content':
        return { title: '', body: '' }; // 400 after the guard
      case 'POST /admin/serial-imports':
        return ' '; // empty CSV: 400 after the guard
      case 'PATCH /admin/customers/:id/status':
        return { status: 'suspended', reason: 'role matrix test' }; // unknown customer: 404
      default:
        return {};
    }
  }

  function call(route: string, token: string | null): request.Test {
    const method = route.slice(0, route.indexOf(' ')).toLowerCase() as
      'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = request(ctx.app)[method](`${API}${concretePath(route)}`);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (method === 'get') return req;
    const body = bodyFor(route);
    return typeof body === 'string'
      ? req.set('Content-Type', 'text/csv').send(body)
      : req.send(body);
  }

  it('every registered /admin route has an explicit role rule (and nothing stale is listed)', () => {
    const registered = adminRouteInventory(ctx);
    const listed = Object.keys(ADMIN_ROLE_MATRIX).sort();
    const missing = registered.filter((r) => !(r in ADMIN_ROLE_MATRIX));
    const stale = listed.filter((r) => !registered.includes(r));
    expect(missing, 'add these routes to test/admin-role-matrix.ts with a role rule').toEqual([]);
    expect(stale, 'these routes are no longer registered').toEqual([]);
  });

  it('a customer token is rejected (401) on every non-public /admin route', async () => {
    const failures: string[] = [];
    for (const [route, rule] of entries()) {
      if (rule === 'public') continue;
      const res = await call(route, tokens.customer);
      if (res.status !== UNAUTHORISED) failures.push(`${route} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('role admin gets 403 on every super_admin route; super_admin passes (GET 200)', async () => {
    const failures: string[] = [];
    for (const [route, rule] of entries()) {
      if (rule !== 'super_admin') continue;
      const asAdmin = await call(route, tokens.admin);
      if (asAdmin.status !== FORBIDDEN) failures.push(`admin ${route} -> ${asAdmin.status}`);
      const asSuper = await call(route, tokens.superAdmin);
      const superOk = route.startsWith('GET ')
        ? asSuper.status === OK
        : ![UNAUTHORISED, FORBIDDEN].includes(asSuper.status);
      if (!superOk) failures.push(`super ${route} -> ${asSuper.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('role admin is never refused on any_admin routes', async () => {
    const failures: string[] = [];
    for (const [route, rule] of entries()) {
      if (rule !== 'any_admin') continue;
      const res = await call(route, tokens.admin);
      if ([UNAUTHORISED, FORBIDDEN].includes(res.status))
        failures.push(`${route} -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  describe('settings (PATCH and Clear)', () => {
    const restricted = SETTING_KEYS.filter((key) => !isAdminEditableSetting(key));
    const patch = (token: string, key: string, value: unknown) =>
      request(ctx.app)
        .patch(`${API}/admin/settings/${key}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ value });

    it('role admin gets 403 on every restricted key; super_admin can change and clear them', async () => {
      expect(restricted).toEqual(
        expect.arrayContaining(['media.max_video_bytes', 'store.timezone']),
      );
      const current = new Map(
        (await ctx.db.selectFrom('app_settings').select(['setting_key', 'value']).execute()).map(
          (r) => [r.setting_key, r.value],
        ),
      );
      const failures: string[] = [];
      for (const key of restricted) {
        const value = current.get(key) ?? null;
        const edit = await patch(tokens.admin, key, value);
        if (edit.status !== FORBIDDEN) failures.push(`admin edit ${key} -> ${edit.status}`);
        const clear = await patch(tokens.admin, key, null);
        if (clear.status !== FORBIDDEN) failures.push(`admin clear ${key} -> ${clear.status}`);
        const superEdit = await patch(tokens.superAdmin, key, value);
        if (superEdit.status !== OK) failures.push(`super edit ${key} -> ${superEdit.status}`);
        const superClear = await patch(tokens.superAdmin, key, null);
        if (superClear.status !== OK) failures.push(`super clear ${key} -> ${superClear.status}`);
      }
      expect(failures).toEqual([]);
    });

    it('role admin can change the client contact / return-address keys', async () => {
      for (const key of ADMIN_EDITABLE_SETTING_KEYS) {
        expect((await patch(tokens.admin, key, null)).status, key).toBe(OK);
      }
    });
  });

  it('role admin keeps what the product form needs', async () => {
    const as = (path: string) =>
      request(ctx.app).get(`${API}${path}`).set('Authorization', `Bearer ${tokens.admin}`);
    const upload = await request(ctx.app)
      .post(`${API}/admin/media/uploads`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ fileName: 'look.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 });
    expect(upload.status).toBe(201);
    expect((await as('/admin/media/picker?kind=image')).status).toBe(OK);
    const sizes = bodyOf<ApiList<SizeDto>>(await as('/admin/sizes?pageSize=50')).data;
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((s) => typeof s.label === 'string')).toBe(true);
    const profiles = bodyOf<ApiList<MeasurementProfileDto>>(
      await as('/admin/measurement-profiles'),
    ).data;
    expect(profiles.every((p) => typeof p.name === 'string')).toBe(true);

    const failed = await ctx.db
      .insertInto('media_assets')
      .values({
        kind: 'image',
        original_key: `test/${randomUUID()}`,
        mime_type: 'image/jpeg',
        size_bytes: 10,
        processing_status: 'failed',
        processing_attempts: 3,
        visibility: 'public',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const retry = await request(ctx.app)
      .post(`${API}/admin/media/${failed.id}/retry`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(retry.status).toBe(OK);
    expect(bodyOf<ApiData<{ status: string }>>(retry).data.status).toBe('uploaded');
  });
});
