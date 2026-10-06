import type {
  ApiData,
  ApiErrorBody,
  AuthTokensDto,
  CustomerAuthDto,
  CustomerDto,
} from '@urban-ibile/shared';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TEST_SECRETS,
  assertSafeTestDatabase,
  bodyOf,
  createTestAdmin,
  flushOutbox,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  resetAuthTables,
  testDatabaseUrl,
  tokenFromEmail,
  type TestContext,
} from '../../../test/helpers.js';
import { TOKEN_AUDIENCES } from './core/access-tokens.js';

const AUTH = '/api/v1/auth';
const PASSWORD = 'Ankara-Velvet-2026!';
const NEW_PASSWORD = 'Lagos-Linen-Season-9';

interface RegisterOptions {
  email?: string;
  client?: 'web' | 'ios' | 'android';
  password?: string;
}

describe.skipIf(!hasTestDatabase)('customer auth (/api/v1/auth)', () => {
  let ctx: TestContext;

  beforeAll(() => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv());
  });

  beforeEach(async () => {
    await resetAuthTables(ctx.db);
  });

  afterAll(async () => {
    await resetAuthTables(ctx.db);
    await ctx.db.destroy();
  });

  function register(options: RegisterOptions = {}): request.Test {
    return request(ctx.app)
      .post(`${AUTH}/register`)
      .send({
        email: options.email ?? 'ada@example.com',
        password: options.password ?? PASSWORD,
        fullName: 'Ada Obi',
        acceptTerms: true,
        client: options.client ?? 'ios',
      });
  }

  function login(email: string, password: string, client = 'ios'): request.Test {
    return request(ctx.app).post(`${AUTH}/login`).send({ email, password, client });
  }

  async function registerMobile(email = 'ada@example.com'): Promise<AuthTokensDto> {
    const res = await register({ email, client: 'android' });
    expect(res.status).toBe(201);
    return bodyOf<ApiData<CustomerAuthDto>>(res).data.tokens;
  }

  function refresh(refreshToken: string): request.Test {
    return request(ctx.app).post(`${AUTH}/refresh`).send({ refreshToken });
  }

  function errorCode(res: request.Response): string {
    return bodyOf<ApiErrorBody>(res).error.code;
  }

  // ---------------------------------------------------------------- register

  describe('register', () => {
    it('creates the customer, queues a verification email and sets an httpOnly cookie for web', async () => {
      const res = await register({ client: 'web' });

      expect(res.status).toBe(201);
      const { customer, tokens } = bodyOf<ApiData<CustomerAuthDto>>(res).data;
      expect(customer).toMatchObject({
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        phone: null,
        preferredLanguage: 'en',
        emailVerified: false,
      });
      expect(tokens.accessToken).toEqual(expect.any(String));
      expect(tokens.refreshToken).toBeUndefined(); // web: cookie only

      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/^ui_rt=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

      const row = await ctx.db
        .selectFrom('customers')
        .select(['password_hash', 'terms_version', 'terms_accepted_at'])
        .executeTakeFirstOrThrow();
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.terms_version).toBe(ctx.env.TERMS_VERSION);
      expect(row.terms_accepted_at).not.toBeNull();

      const outbox = await ctx.db.selectFrom('email_outbox').selectAll().execute();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({ template: 'email_verification', status: 'queued' });
    });

    it('returns the refresh token in the body for mobile clients', async () => {
      const tokens = await registerMobile();
      expect(tokens.refreshToken).toEqual(expect.any(String));
    });

    it('rejects a duplicate email regardless of case', async () => {
      await registerMobile('ada@example.com');
      const res = await register({ email: 'ADA@Example.com' });

      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it.each([
      ['too short', 'Ab1!short'],
      ['common', 'qwertyuiop'],
      ['contains the email', 'ada-obi-ada@example'],
    ])('rejects a weak password (%s)', async (_label, password) => {
      const res = await register({ email: 'ada-obi@example.com', password });

      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('WEAK_PASSWORD');
    });

    it('requires acceptTerms to be true', async () => {
      const res = await request(ctx.app).post(`${AUTH}/register`).send({
        email: 'ada@example.com',
        password: PASSWORD,
        fullName: 'Ada Obi',
        acceptTerms: false,
        client: 'web',
      });

      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
    });
  });

  // ---------------------------------------------------------------- login + lockout

  describe('login', () => {
    it('signs in with the right password', async () => {
      await registerMobile();
      const res = await login('ADA@example.com', PASSWORD);

      expect(res.status).toBe(200);
      expect(bodyOf<ApiData<CustomerAuthDto>>(res).data.customer.email).toBe('ada@example.com');
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      await registerMobile();
      const wrongPassword = await login('ada@example.com', 'not-the-password');
      const unknownEmail = await login('nobody@example.com', 'not-the-password');

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      const strip = (res: request.Response): Omit<ApiErrorBody['error'], 'requestId'> => {
        const { requestId: _requestId, ...rest } = bodyOf<ApiErrorBody>(res).error;
        return rest;
      };
      expect(strip(wrongPassword)).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password.',
      });
      expect(strip(unknownEmail)).toEqual(strip(wrongPassword));
    });

    it('locks the account after too many failures, then unlocks when the lock expires', async () => {
      await registerMobile();
      const max = ctx.env.AUTH_MAX_FAILED_LOGINS;

      for (let attempt = 1; attempt < max; attempt += 1) {
        expect((await login('ada@example.com', 'wrong-password')).status).toBe(401);
      }
      const locking = await login('ada@example.com', 'wrong-password');
      expect(locking.status).toBe(429);
      expect(errorCode(locking)).toBe('ACCOUNT_LOCKED');
      expect(Number(locking.headers['retry-after'])).toBeGreaterThan(0);

      // Even the right password is refused while locked.
      const whileLocked = await login('ada@example.com', PASSWORD);
      expect(whileLocked.status).toBe(429);

      await ctx.db
        .updateTable('customers')
        .set({ locked_until: new Date(Date.now() - 1000) })
        .execute();
      expect((await login('ada@example.com', PASSWORD)).status).toBe(200);

      const row = await ctx.db
        .selectFrom('customers')
        .select(['failed_login_count', 'locked_until'])
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ failed_login_count: 0, locked_until: null });
    });
  });

  // ---------------------------------------------------------------- refresh rotation

  describe('refresh', () => {
    it('rotates the refresh token', async () => {
      const first = await registerMobile();
      const res = await refresh(first.refreshToken ?? '');

      expect(res.status).toBe(200);
      const rotated = bodyOf<ApiData<{ tokens: AuthTokensDto }>>(res).data.tokens;
      expect(rotated.refreshToken).toEqual(expect.any(String));
      expect(rotated.refreshToken).not.toBe(first.refreshToken);
      expect((await refresh(rotated.refreshToken ?? '')).status).toBe(200);
    });

    it('detects reuse of a rotated token and revokes the whole session family', async () => {
      const first = await registerMobile();
      const second = bodyOf<ApiData<{ tokens: AuthTokensDto }>>(
        await refresh(first.refreshToken ?? ''),
      ).data.tokens;

      const replay = await refresh(first.refreshToken ?? '');
      expect(replay.status).toBe(401);
      expect(errorCode(replay)).toBe('UNAUTHENTICATED');

      // The legitimate newer token is now dead too.
      expect((await refresh(second.refreshToken ?? '')).status).toBe(401);
      const reasons = await ctx.db.selectFrom('auth_sessions').select('revoked_reason').execute();
      expect(reasons.map((r) => r.revoked_reason)).toContain('reuse_detected');
      expect(reasons.every((r) => r.revoked_reason !== null)).toBe(true);
    });

    it('lets only one of two concurrent refreshes with the same token succeed', async () => {
      const first = await registerMobile();
      const results = await Promise.all([
        refresh(first.refreshToken ?? ''),
        refresh(first.refreshToken ?? ''),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 401]);
      const winner = results.find((r) => r.status === 200);
      const winnerToken = bodyOf<ApiData<{ tokens: AuthTokensDto }>>(winner as request.Response)
        .data.tokens.refreshToken;
      // The loser looked like a replay, so the family (including the winner) is revoked.
      expect((await refresh(winnerToken ?? '')).status).toBe(401);
    });

    it('rotates the httpOnly cookie for web clients', async () => {
      const agent = request.agent(ctx.app);
      const registered = await agent.post(`${AUTH}/register`).send({
        email: 'web@example.com',
        password: PASSWORD,
        fullName: 'Web User',
        acceptTerms: true,
        client: 'web',
      });
      expect(registered.status).toBe(201);

      const res = await agent.post(`${AUTH}/refresh`).send();
      expect(res.status).toBe(200);
      expect(
        bodyOf<ApiData<{ tokens: AuthTokensDto }>>(res).data.tokens.refreshToken,
      ).toBeUndefined();
      expect(String(res.headers['set-cookie'])).toMatch(/^ui_rt=/);
    });

    it('rejects an unknown refresh token', async () => {
      expect((await refresh('not-a-real-token')).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------- access tokens

  describe('access tokens and /me', () => {
    it('returns and updates the profile', async () => {
      const tokens = await registerMobile();
      const auth = `Bearer ${tokens.accessToken}`;

      const me = await request(ctx.app).get(`${AUTH}/me`).set('Authorization', auth);
      expect(me.status).toBe(200);
      expect(bodyOf<ApiData<CustomerDto>>(me).data.email).toBe('ada@example.com');

      const patched = await request(ctx.app)
        .patch(`${AUTH}/me`)
        .set('Authorization', auth)
        .send({ fullName: 'Ada N. Obi', phone: '+234 801 234 5678', preferredLanguage: 'pcm' });
      expect(patched.status).toBe(200);
      expect(bodyOf<ApiData<CustomerDto>>(patched).data).toMatchObject({
        fullName: 'Ada N. Obi',
        phone: '+234 801 234 5678',
        preferredLanguage: 'pcm',
      });

      const badLanguage = await request(ctx.app)
        .patch(`${AUTH}/me`)
        .set('Authorization', auth)
        .send({ preferredLanguage: 'xx' });
      expect(badLanguage.status).toBe(400);
    });

    it('requires a token', async () => {
      const res = await request(ctx.app).get(`${AUTH}/me`);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('UNAUTHENTICATED');
    });

    it('rejects an expired access token with TOKEN_EXPIRED', async () => {
      const { customer } = bodyOf<ApiData<CustomerAuthDto>>(await register()).data;
      const past = Math.floor(Date.now() / 1000) - 3600;
      const expired = await new SignJWT({ sid: '00000000-0000-0000-0000-000000000000' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(customer.id)
        .setAudience(TOKEN_AUDIENCES.customer)
        .setIssuer(ctx.env.JWT_ISSUER)
        .setIssuedAt(past - 900)
        .setExpirationTime(past)
        .sign(new TextEncoder().encode(TEST_SECRETS.JWT_ACCESS_SECRET));

      const res = await request(ctx.app)
        .get(`${AUTH}/me`)
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('TOKEN_EXPIRED');
    });

    it('rejects a tampered access token', async () => {
      const tokens = await registerMobile();
      const tampered = `${tokens.accessToken.slice(0, -4)}AAAA`;
      const res = await request(ctx.app)
        .get(`${AUTH}/me`)
        .set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('UNAUTHENTICATED');
    });

    it('rejects an ADMIN token on customer routes', async () => {
      await createTestAdmin(ctx, { email: 'boss@example.com', password: PASSWORD });
      const adminLogin = await request(ctx.app)
        .post('/api/v1/admin/auth/login')
        .send({ email: 'boss@example.com', password: PASSWORD });
      const adminToken =
        bodyOf<ApiData<{ tokens: AuthTokensDto }>>(adminLogin).data.tokens.accessToken;

      const res = await request(ctx.app)
        .get(`${AUTH}/me`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(401);
      expect(errorCode(res)).toBe('UNAUTHENTICATED');
    });
  });

  // ---------------------------------------------------------------- logout

  describe('logout', () => {
    it('revokes the refresh token and is idempotent', async () => {
      const tokens = await registerMobile();
      const out = await request(ctx.app)
        .post(`${AUTH}/logout`)
        .send({ refreshToken: tokens.refreshToken });
      expect(out.status).toBe(204);

      expect((await refresh(tokens.refreshToken ?? '')).status).toBe(401);
      const again = await request(ctx.app)
        .post(`${AUTH}/logout`)
        .send({ refreshToken: tokens.refreshToken });
      expect(again.status).toBe(204);
    });
  });

  // ---------------------------------------------------------------- email verification

  describe('email verification', () => {
    it('verifies via the emailed link once, and scrubs the token from the outbox', async () => {
      const tokens = await registerMobile();
      const [email] = await flushOutbox(ctx);
      expect(email).toMatchObject({
        to: 'ada@example.com',
        subject: expect.any(String) as unknown,
      });
      const token = tokenFromEmail(email);

      const verified = await request(ctx.app).post(`${AUTH}/verify-email`).send({ token });
      expect(verified.status).toBe(200);

      const me = await request(ctx.app)
        .get(`${AUTH}/me`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(bodyOf<ApiData<CustomerDto>>(me).data.emailVerified).toBe(true);

      const reused = await request(ctx.app).post(`${AUTH}/verify-email`).send({ token });
      expect(reused.status).toBe(400);
      expect(errorCode(reused)).toBe('INVALID_TOKEN');

      const outbox = await ctx.db
        .selectFrom('email_outbox')
        .select(['status', 'payload'])
        .execute();
      expect(outbox).toEqual([{ status: 'sent', payload: { scrubbed: true } }]);
    });

    it('resend replaces the previous link', async () => {
      const tokens = await registerMobile();
      const [firstEmail] = await flushOutbox(ctx);

      const resent = await request(ctx.app)
        .post(`${AUTH}/resend-verification`)
        .set('Authorization', `Bearer ${tokens.accessToken}`);
      expect(resent.status).toBe(202);
      const [secondEmail] = await flushOutbox(ctx);

      const stale = await request(ctx.app)
        .post(`${AUTH}/verify-email`)
        .send({ token: tokenFromEmail(firstEmail) });
      expect(stale.status).toBe(400);
      const fresh = await request(ctx.app)
        .post(`${AUTH}/verify-email`)
        .send({ token: tokenFromEmail(secondEmail) });
      expect(fresh.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------- password reset

  describe('password reset', () => {
    it('answers 202 for an unknown email without sending anything', async () => {
      const res = await request(ctx.app)
        .post(`${AUTH}/forgot-password`)
        .send({ email: 'nobody@example.com' });
      expect(res.status).toBe(202);
      expect(await flushOutbox(ctx)).toEqual([]);
    });

    it('resets the password, revokes all sessions, and keeps the link after a weak attempt', async () => {
      const tokens = await registerMobile();
      await flushOutbox(ctx); // verification email

      expect(
        (await request(ctx.app).post(`${AUTH}/forgot-password`).send({ email: 'ada@example.com' }))
          .status,
      ).toBe(202);
      const token = tokenFromEmail((await flushOutbox(ctx))[0]);

      const weak = await request(ctx.app)
        .post(`${AUTH}/reset-password`)
        .send({ token, newPassword: 'password1' });
      expect(weak.status).toBe(400);
      expect(errorCode(weak)).toBe('WEAK_PASSWORD');

      const reset = await request(ctx.app)
        .post(`${AUTH}/reset-password`)
        .send({ token, newPassword: NEW_PASSWORD });
      expect(reset.status).toBe(204);

      expect((await refresh(tokens.refreshToken ?? '')).status).toBe(401);
      expect((await login('ada@example.com', PASSWORD)).status).toBe(401);
      expect((await login('ada@example.com', NEW_PASSWORD)).status).toBe(200);

      const reused = await request(ctx.app)
        .post(`${AUTH}/reset-password`)
        .send({ token, newPassword: 'Another-Strong-Pass-77' });
      expect(reused.status).toBe(400);
      expect(errorCode(reused)).toBe('INVALID_TOKEN');
    });
  });
});

describe.skipIf(!hasTestDatabase)('auth rate limiting', () => {
  let ctx: TestContext;

  beforeAll(() => {
    ctx = makeTestApp(makeTestEnv({ AUTH_RATE_LIMIT_MAX: '2' }));
  });

  afterAll(async () => {
    await ctx.db.destroy();
  });

  it('applies the strict limit to login', async () => {
    const attempt = (): request.Test =>
      request(ctx.app)
        .post(`${AUTH}/login`)
        .send({ email: 'nobody@example.com', password: 'whatever-123', client: 'web' });

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(bodyOf<ApiErrorBody>(limited).error.code).toBe('RATE_LIMITED');
  });
});
