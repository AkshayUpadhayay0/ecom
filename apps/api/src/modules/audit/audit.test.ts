import type { ApiList, AuditLogDto } from '@urban-ibile/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  resetAdminApiData,
  signInAdmin,
  type AdminClient,
  type AdminSession,
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

describe.skipIf(!hasTestDatabase)('admin audit log viewer', () => {
  let ctx: TestContext;
  let superAdmin: AdminSession;
  let api: AdminClient;
  let otherAdmin: AdminClient;

  beforeAll(() => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    superAdmin = await signInAdmin(ctx, 'super_admin');
    api = adminClient(ctx, superAdmin.token);
    otherAdmin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  async function logs(query: string): Promise<ApiList<AuditLogDto>> {
    const res = await api.get(`/audit-logs${query}`);
    expect(res.status).toBe(200);
    return bodyOf<ApiList<AuditLogDto>>(res);
  }

  it('filters by entity type, entity id, admin and date; newest first; paginated', async () => {
    await api.post('/garment-cuts', { code: 'boxy', name: 'Boxy' });
    await otherAdmin.post('/delivery-zones', { code: 'ibadan', name: 'Ibadan' });
    const zone = await otherAdmin.post('/delivery-zones', { code: 'kano', name: 'Kano' });
    const zoneId = bodyOf<{ data: { id: string } }>(zone).data.id;

    const all = await logs('');
    expect(all.data.map((l) => l.action)).toEqual([
      'delivery_zone.create',
      'delivery_zone.create',
      'garment_cut.create',
    ]);
    expect(all.data[0]?.admin.id).not.toBe(superAdmin.id);

    expect((await logs('?entityType=garment_cut')).meta.total).toBe(1);
    expect((await logs(`?entityId=${zoneId}`)).data[0]?.after).toMatchObject({ code: 'kano' });
    expect((await logs(`?adminId=${superAdmin.id}`)).meta.total).toBe(1);

    const page = await logs('?pageSize=2&page=2');
    expect(page.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    expect(page.data).toHaveLength(1);

    const future = new Date(Date.now() + 60_000).toISOString();
    expect((await logs(`?from=${encodeURIComponent(future)}`)).meta.total).toBe(0);
    expect((await logs(`?to=${encodeURIComponent(future)}`)).meta.total).toBe(3);
    expect((await api.get('/audit-logs?from=yesterday')).status).toBe(400);
  });
});
