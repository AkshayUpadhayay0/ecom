import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN,
  adminClient,
  customerToken,
  errorCode,
  resetAdminApiData,
  signInAdmin,
} from '../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../test/helpers.js';

type Method = 'get' | 'post' | 'patch' | 'put';

const ID = randomUUID();
/** Every Phase 2 admin route (method, path). Keep in sync with the routers. */
const ADMIN_ROUTES: [Method, string][] = [
  ['get', '/clothing-types'],
  ['post', '/clothing-types'],
  ['get', `/clothing-types/${ID}`],
  ['patch', `/clothing-types/${ID}`],
  ['get', '/sizes'],
  ['post', '/sizes'],
  ['put', '/sizes/order'],
  ['get', `/sizes/${ID}`],
  ['patch', `/sizes/${ID}`],
  ['get', '/garment-cuts'],
  ['post', '/garment-cuts'],
  ['get', `/garment-cuts/${ID}`],
  ['patch', `/garment-cuts/${ID}`],
  ['get', '/products'],
  ['post', '/products'],
  ['get', `/products/${ID}`],
  ['patch', `/products/${ID}`],
  ['post', `/products/${ID}/status`],
  ['put', `/products/${ID}/video`],
  ['get', `/products/${ID}/variants`],
  ['post', `/products/${ID}/variants`],
  ['patch', `/variants/${ID}`],
  ['post', `/variants/${ID}/stock-adjustments`],
  ['get', `/variants/${ID}/stock-movements`],
  ['get', '/inventory/low-stock'],
  ['get', '/delivery-zones'],
  ['post', '/delivery-zones'],
  ['get', `/delivery-zones/${ID}`],
  ['patch', `/delivery-zones/${ID}`],
  ['get', '/settings'],
  ['patch', '/settings/catalog.page_size'],
  ['get', '/content-blocks'],
  ['get', '/content-blocks/home.hero'],
  ['put', '/content-blocks/home.hero/translations/en'],
  ['post', '/content-blocks/home.hero/publish'],
  ['post', '/content-blocks/home.hero/unpublish'],
  ['put', '/content-blocks/home.hero/media'],
  ['get', '/audit-logs'],
];

describe.skipIf(!hasTestDatabase)('admin API access control', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv());
    await resetAdminApiData(ctx);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  it.each(ADMIN_ROUTES)('%s %s rejects requests without a token (401)', async (method, path) => {
    const res = await request(ctx.app)[method](`${ADMIN}${path}`).send({});
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
  });

  it.each(ADMIN_ROUTES)('%s %s rejects a customer token (401)', async (method, path) => {
    const token = await customerToken(ctx);
    const res = await request(ctx.app)
      [method](`${ADMIN}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('limits settings changes and the audit log to super admins', async () => {
    const admin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
    const superAdmin = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);

    const patch = await admin.patch('/settings/catalog.page_size', { value: 20 });
    expect(patch.status).toBe(403);
    expect(errorCode(patch)).toBe('FORBIDDEN');
    expect((await admin.get('/audit-logs')).status).toBe(403);
    // Reading settings is allowed for every admin.
    expect((await admin.get('/settings')).status).toBe(200);

    expect((await superAdmin.get('/audit-logs')).status).toBe(200);
  });

  it('answers 400 (not a SQL error) for a malformed id', async () => {
    const admin = adminClient(ctx, (await signInAdmin(ctx)).token);
    const res = await admin.get('/products/not-a-uuid');
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });
});
