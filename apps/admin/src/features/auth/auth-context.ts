import type { AdminDto } from '@urban-ibile/shared';
import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  admin: AdminDto | null;
  /** True when the user was signed out because the session could not be refreshed. */
  sessionExpired: boolean;
}

export interface AuthContextValue extends AuthState {
  // Arrow-typed so components can destructure them safely.
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
