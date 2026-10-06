import type { ReactNode } from 'react';
import { Navigate, useLocation, type Location } from 'react-router';
import { FullPageLoader } from '@/components/FullPageLoader';
import { useAuth } from './auth-context';

export const DEFAULT_AUTHED_PATH = '/dashboard';
export const LOGIN_PATH = '/login';

/** Router state carried to /login so we can return the admin to the page they wanted. */
export interface LoginRedirectState {
  from?: Pick<Location, 'pathname' | 'search' | 'hash'>;
}

/** Only signed-in admins may render children; everyone else goes to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, sessionExpired } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'unauthenticated') {
    const state: LoginRedirectState = {
      from: { pathname: location.pathname, search: location.search, hash: location.hash },
    };
    const search = sessionExpired ? '?reason=expired' : '';
    return <Navigate to={`${LOGIN_PATH}${search}`} replace state={state} />;
  }
  return children;
}

/** Signed-in admins visiting /login are sent on (to the page they originally wanted). */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') {
    const from = (location.state as LoginRedirectState | null)?.from;
    const target =
      from && from.pathname !== LOGIN_PATH
        ? `${from.pathname}${from.search}${from.hash}`
        : DEFAULT_AUTHED_PATH;
    return <Navigate to={target} replace />;
  }
  return children;
}
