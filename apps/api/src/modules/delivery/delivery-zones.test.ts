import type { ApiData, ApiList, DeliveryZoneDto } from '@urban-ibile/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  errorCode,
  resetAdminApiData,
  signInAdmin,
  type AdminClient,
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

describe.skipIf(!hasTestDatabase)('admin delivery zones API', () => {
  let ctx: TestContext;
  let api: AdminClient;

  beforeAll(() => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
  });

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    api = adminClient(ctx, (await signInAdmin(ctx)).token);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await ctx.db.destroy();
  });

  async function createZone(body: Record<string, unknown> = {}): Promise<DeliveryZoneDto> {
    const res = await api.post('/delivery-zones', {
      code: 'lagos-island',
      name: 'Lagos Island',
      ...body,
    });
    expect(res.status).toBe(201);
    return bodyOf<ApiData<DeliveryZoneDto>>(res).data;
  }

  it('requires a fee to activate a zone (create and update)', async () => {
    const activeWithoutFee = await api.post('/delivery-zones', {
      code: 'abuja',
      name: 'Abuja',
      isActive: true,
    });
    expect(activeWithoutFee.status).toBe(400);
    expect(errorCode(activeWithoutFee)).toBe('ZONE_FEE_REQUIRED');

    const zone = await createZone();
    expect(zone).toMatchObject({ feeMinor: null, isActive: false, isSampleData: false });

    const activate = await api.patch(`/delivery-zones/${zone.id}`, { isActive: true });
    expect(activate.status).toBe(400);
    expect(errorCode(activate)).toBe('ZONE_FEE_REQUIRED');

    const withFee = await api.patch(`/delivery-zones/${zone.id}`, {
      feeMinor: 350_000,
      estDaysMin: 1,
      estDaysMax: 3,
      isActive: true,
    });
    expect(withFee.status).toBe(200);
    expect(bodyOf<ApiData<DeliveryZoneDto>>(withFee).data).toMatchObject({
      feeMinor: 350_000,
      isActive: true,
    });

    // Clearing the fee of an active zone is refused too.
    const clearFee = await api.patch(`/delivery-zones/${zone.id}`, { feeMinor: null });
    expect(errorCode(clearFee)).toBe('ZONE_FEE_REQUIRED');
    expect(await auditCount(ctx, { action: 'delivery_zone.update', entityId: zone.id })).toBe(1);
  });

  it('keeps seeded SAMPLE zones inactive', async () => {
    const list = await api.get('/delivery-zones?isActive=false');
    const sample = bodyOf<ApiList<DeliveryZoneDto>>(list).data.find((zone) => zone.isSampleData);
    expect(sample).toBeDefined();
    const res = await api.patch(`/delivery-zones/${sample?.id ?? ''}`, {
      feeMinor: 100_000,
      isActive: true,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('INVALID_STATE');
  });

  it('validates day ranges, rejects duplicate codes and has no DELETE', async () => {
    const zone = await createZone();
    expect(
      (await api.patch(`/delivery-zones/${zone.id}`, { estDaysMin: 5, estDaysMax: 2 })).status,
    ).toBe(400);
    const duplicate = await api.post('/delivery-zones', { code: 'lagos-island', name: 'Again' });
    expect(errorCode(duplicate)).toBe('ALREADY_EXISTS');
    expect((await api.delete(`/delivery-zones/${zone.id}`)).status).toBe(404);

    const deactivated = await api.patch(`/delivery-zones/${zone.id}`, { isActive: false });
    expect(deactivated.status).toBe(200);
    expect(await auditCount(ctx, { action: 'delivery_zone.create', entityId: zone.id })).toBe(1);
  });
});
