import { describe, expect, it, vi } from 'vitest';
import { apiState } from '@/test/api-mock';
import { adminAuthApi } from './admin-auth';
import { ApiError, session } from './client';

describe('api client', () => {
  it('on 401 refreshes once, retries once and succeeds', async () => {
    apiState.hasSession = true;
    session.setAccessToken('stale-token');

    const admin = await adminAuthApi.me();

    expect(admin.email).toBe('boss@example.com');
    expect(apiState.refreshCalls).toBe(1);
  });

  it('shares one refresh between concurrent 401s (the API rotates refresh tokens)', async () => {
    apiState.hasSession = true;
    session.setAccessToken('stale-token');

    await Promise.all([adminAuthApi.me(), adminAuthApi.me(), adminAuthApi.me()]);

    expect(apiState.refreshCalls).toBe(1);
  });

  it('clears the session and reports expiry when the refresh fails', async () => {
    const onExpired = vi.fn();
    session.onExpired(onExpired);
    session.setAccessToken('stale-token');

    const error: unknown = await adminAuthApi.me().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('TOKEN_EXPIRED');
    expect((error as ApiError).requestId).toBe('req-test');
    expect(onExpired).toHaveBeenCalledOnce();
    expect(session.hasAccessToken()).toBe(false);
  });

  it('does not try to refresh for unauthenticated calls such as login', async () => {
    await expect(adminAuthApi.login('boss@example.com', 'wrong')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 401,
    });
    expect(apiState.refreshCalls).toBe(0);
  });
});
