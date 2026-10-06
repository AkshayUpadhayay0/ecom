import type {
  AdminAuthDto,
  AdminDto,
  ApiData,
  ApiErrorBody,
  AuthTokensDto,
  CustomerAuthDto,
} from '@urban-ibile/shared';
import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertSafeTestDatabase,
  bodyOf,
  createTestAdmin,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  resetAuthTables,
  testDatabaseUrl,
  type TestContext,
} from '../../../test/helpers.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { requestLogger } from '../../middleware/request-logger.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import type { AppError } from '../../lib/errors.js';
import { buildAdminAuthService } from './admin-auth.module.js';

const ADMIN_AUTH = '/api/v1/admin/auth';
const EMAIL = 'boss@example.com';
const PASSWORD = 'Ankara-Velvet-2026!';
const NEW_PASSWORD = 'Lagos-Linen-Season-9';

describe.skipIf(!hasTestDatabase)('admin auth (/api/v1/admin/auth)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv());
  });

  beforeEach(async () => {
    await resetAuthTables(ctx.db);
    await createTestAdmin(ctx, { email: EMAIL, password: PASSWORD, displayName: 'Boss' });
  });

  afterAll(async () => {
    await resetAuthTables(ctx.db);
    await ctx.db.destroy();
  });

  function login(password = PASSWORD, agent = request(ctx.app)): request.Test {
    return agent.post(`${ADMIN_AUTH}/login`).send({ email: EMAIL, password });
  }

  async function accessToken(): Promise<string> {
    const res = await login();
    expect(res.status).toBe(200);
    return bodyOf<ApiData<AdminAuthDto>>(res).data.tokens.accessToken;
  }

  function errorCode(res: request.Response): string {
    return bodyOf<ApiErrorBody>(res).error.code;
  }

  it('logs in with a cookie scoped to the admin auth path and returns /me', async () => {
    const res = await login();

    expect(res.status).toBe(200);
    const { admin, tokens } = bodyOf<ApiData<AdminAuthDto>>(res).data;
    expect(admin).toMatchObject({ email: EMAIL, displayName: 'Boss', role: 'admin' });
    expect(tokens.refreshToken).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^ui_admin_rt=/);
    expect(cookie).toMatch(/Path=\/api\/v1\/admin\/auth/);
    expect(cookie).toMatch(/HttpOnly/);

    const me = await request(ctx.app)
      .get(`${ADMIN_AUTH}/me`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(me.status).toBe(200);
    expect(bodyOf<ApiData<AdminDto>>(me).data.email).toBe(EMAIL);
  });

  it('uses the generic error and locks out after repeated failures', async () => {
    const unknown = await request(ctx.app)
      .post(`${ADMIN_AUTH}/login`)
      .send({ email: 'nobody@example.com', password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(errorCode(unknown)).toBe('INVALID_CREDENTIALS');

    for (let attempt = 1; attempt < ctx.env.AUTH_MAX_FAILED_LOGINS; attempt += 1) {
      const res = await login('wrong-password');
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
    }
    const locked = await login('wrong-password');
    expect(locked.status).toBe(429);
    expect(errorCode(locked)).toBe('ACCOUNT_LOCKED');
    expect((await login()).status).toBe(429);
  });

  it('rejects a CUSTOMER token on admin routes', async () => {
    const registered = await request(ctx.app).post('/api/v1/auth/register').send({
      email: 'ada@example.com',
      password: PASSWORD,
      fullName: 'Ada Obi',
      acceptTerms: true,
      client: 'ios',
    });
    const customerToken = bodyOf<ApiData<CustomerAuthDto>>(registered).data.tokens.accessToken;

    const res = await request(ctx.app)
      .get(`${ADMIN_AUTH}/me`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHENTICATED');
  });

  it('rotates the refresh cookie and detects reuse', async () => {
    const agent = request.agent(ctx.app);
    const first = await login(PASSWORD, agent);
    const firstCookie = String(first.headers['set-cookie']).split(';')[0] ?? '';
    const firstToken = firstCookie.split('=')[1] ?? '';

    const rotated = await agent.post(`${ADMIN_AUTH}/refresh`).send();
    expect(rotated.status).toBe(200);
    expect(bodyOf<ApiData<{ tokens: AuthTokensDto }>>(rotated).data.tokens.accessToken).toEqual(
      expect.any(String),
    );

    // Replaying the first token (e.g. stolen cookie) revokes the family...
    const replay = await request(ctx.app)
      .post(`${ADMIN_AUTH}/refresh`)
      .send({ refreshToken: firstToken });
    expect(replay.status).toBe(401);
    // ...so the agent's current cookie stops working too.
    expect((await agent.post(`${ADMIN_AUTH}/refresh`).send()).status).toBe(401);
  });

  it('logout invalidates the access token immediately', async () => {
    const agent = request.agent(ctx.app);
    const res = await login(PASSWORD, agent);
    const token = bodyOf<ApiData<AdminAuthDto>>(res).data.tokens.accessToken;

    expect((await agent.post(`${ADMIN_AUTH}/logout`).send()).status).toBe(204);
    const me = await request(ctx.app)
      .get(`${ADMIN_AUTH}/me`)
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
  });

  describe('change password', () => {
    it('rejects a wrong current password', async () => {
      const token = await accessToken();
      const res = await request(ctx.app)
        .post(`${ADMIN_AUTH}/change-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'not-it-at-all', newPassword: NEW_PASSWORD });
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
    });

    it('changes the password, signs out other devices, keeps this one, and audits it', async () => {
      const otherDevice = await accessToken();
      const thisDevice = await accessToken();

      const res = await request(ctx.app)
        .post(`${ADMIN_AUTH}/change-password`)
        .set('Authorization', `Bearer ${thisDevice}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(res.status).toBe(204);

      const meHere = await request(ctx.app)
        .get(`${ADMIN_AUTH}/me`)
        .set('Authorization', `Bearer ${thisDevice}`);
      expect(meHere.status).toBe(200);
      const meOther = await request(ctx.app)
        .get(`${ADMIN_AUTH}/me`)
        .set('Authorization', `Bearer ${otherDevice}`);
      expect(meOther.status).toBe(401);

      expect((await login(PASSWORD)).status).toBe(401);
      expect((await login(NEW_PASSWORD)).status).toBe(200);

      const audit = await ctx.db
        .selectFrom('admin_audit_logs')
        .select(['action', 'entity_type', 'after_data'])
        .execute();
      expect(audit).toEqual([
        {
          action: 'admin.password_change',
          entity_type: 'admin_user',
          after_data: { mustChangePassword: false, revokedSessions: 1 },
        },
      ]);
    });
  });

  it('requireAdmin blocks admins who must change their password, except where allowed', async () => {
    await ctx.db.updateTable('admin_users').set({ must_change_password: true }).execute();
    const token = await accessToken();

    const service = buildAdminAuthService(ctx.env, ctx.db, pino({ level: 'silent' }));
    const probe = express();
    probe.use(requestLogger(pino({ level: 'silent' })));
    probe.get('/strict', requireAdmin(service), (_req, res) => {
      res.json({ ok: true });
    });
    probe.use(errorHandler);

    const strict = await request(probe).get('/strict').set('Authorization', `Bearer ${token}`);
    expect(strict.status).toBe(403);
    expect(errorCode(strict)).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await request(ctx.app)
      .get(`${ADMIN_AUTH}/me`)
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(bodyOf<ApiData<AdminDto>>(me).data.mustChangePassword).toBe(true);
  });

  it('createAdmin (admin:create CLI) rejects duplicates and weak passwords', async () => {
    await expect(createTestAdmin(ctx, { email: EMAIL, password: PASSWORD })).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_REGISTERED',
    } satisfies Partial<AppError>);
    await expect(
      createTestAdmin(ctx, { email: 'second@example.com', password: 'password' }),
    ).rejects.toMatchObject({ code: 'WEAK_PASSWORD' } satisfies Partial<AppError>);
  });
});
