import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminAuthApi } from '@/lib/api/admin-auth';
import { session } from '@/lib/api/client';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';

const SIGNED_OUT: AuthState = { status: 'unauthenticated', admin: null, sessionExpired: false };

/**
 * Owns the signed-in admin. On start it silently restores the session from the httpOnly
 * refresh cookie (the in-memory access token does not survive a page load).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    admin: null,
    sessionExpired: false,
  });

  useEffect(() => {
    let active = true;
    adminAuthApi
      .restore()
      .then((admin) => {
        if (!active) return;
        setState(admin ? { status: 'authenticated', admin, sessionExpired: false } : SIGNED_OUT);
      })
      .catch(() => {
        if (active) setState(SIGNED_OUT);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    session.onExpired(() => {
      queryClient.clear();
      setState({ status: 'unauthenticated', admin: null, sessionExpired: true });
    });
    return () => {
      session.onExpired(null);
    };
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const admin = await adminAuthApi.login(email, password);
    setState({ status: 'authenticated', admin, sessionExpired: false });
  }, []);

  const logout = useCallback(async () => {
    await adminAuthApi.logout();
    queryClient.clear();
    setState(SIGNED_OUT);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
