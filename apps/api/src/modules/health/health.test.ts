import type { ApiErrorBody } from '@urban-ibile/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertSafeTestDatabase,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../../test/helpers.js';

const HEALTH_URL = '/api/v1/health';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Port 1 on loopback refuses connections immediately: a real "database down" scenario.
const UNREACHABLE_DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/unreachable';

describe.skipIf(!hasTestDatabase)('GET /api/v1/health (real ecom_test database)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv());
  });

  afterAll(async () => {
    await ctx.db.destroy();
  });

  it('returns 200 with database up and a request id header', async () => {
    const res = await request(ctx.app).get(HEALTH_URL);

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      data: {
        status: 'ok',
        db: 'up',
        uptimeSeconds: expect.any(Number) as unknown,
        timestamp: expect.any(String) as unknown,
      },
    });
  });

  it('echoes a safe caller-supplied X-Request-Id', async () => {
    const res = await request(ctx.app).get(HEALTH_URL).set('X-Request-Id', 'lb-abc-123');
    expect(res.headers['x-request-id']).toBe('lb-abc-123');
  });
});

describe('API with the database unreachable', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = makeTestApp(makeTestEnv({ DATABASE_URL: UNREACHABLE_DATABASE_URL }));
  });

  afterAll(async () => {
    await ctx.db.destroy();
  });

  it('GET /health returns 503 in the standard error shape', async () => {
    const res = await request(ctx.app).get(HEALTH_URL);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database unavailable.',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('unknown routes return 404 in the standard error shape', async () => {
    const res = await request(ctx.app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect((res.body as ApiErrorBody).error).toMatchObject({
      code: 'NOT_FOUND',
      requestId: expect.any(String) as unknown,
    });
  });

  it('rejects malformed JSON with VALIDATION_ERROR', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.code).toBe('VALIDATION_ERROR');
  });

  it('sends CORS headers only to allow-listed origins', async () => {
    const allowed = await request(ctx.app).get(HEALTH_URL).set('Origin', 'http://localhost:5173');
    const blocked = await request(ctx.app).get(HEALTH_URL).set('Origin', 'https://evil.example');

    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sets helmet security headers', async () => {
    const res = await request(ctx.app).get(HEALTH_URL);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
