import type { AdminAuthDto, AdminDto, ApiData } from '@urban-ibile/shared';
import { apiRequest, refreshAccessToken, session } from './client';

/**
 * Admin auth endpoints (apps/api/src/modules/admin-users). The API never returns the admin
 * refresh token in the body: it sets the httpOnly `ui_admin_rt` cookie on
 * /api/v1/admin/auth, which the browser sends back on refresh/logout.
 */
export const adminAuthApi = {
  async login(email: string, password: string): Promise<AdminDto> {
    const { data } = await apiRequest<ApiData<AdminAuthDto>>('/admin/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    session.setAccessToken(data.tokens.accessToken);
    return data.admin;
  },

  async me(): Promise<AdminDto> {
    const { data } = await apiRequest<ApiData<AdminDto>>('/admin/auth/me');
    return data;
  },

  /** Restores a session after a page load using the refresh cookie. Null = not signed in. */
  async restore(): Promise<AdminDto | null> {
    if (!(await refreshAccessToken())) return null;
    return adminAuthApi.me();
  },

  /** Revokes the session server-side (best effort) and always clears local state. */
  async logout(): Promise<void> {
    try {
      await apiRequest<undefined>('/admin/auth/logout', { method: 'POST', auth: false });
    } catch {
      // Network/server failure: the local session is still cleared below.
    } finally {
      session.clear();
    }
  },
};
