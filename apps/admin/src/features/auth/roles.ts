import { useAuth } from './auth-context';

/** The signed-in admin's role comes from the session (`GET /admin/auth/me` / login). */
export function useIsSuperAdmin(): boolean {
  const { admin } = useAuth();
  return admin?.role === 'super_admin';
}

export const SUPER_ADMIN_ONLY = 'Only a super admin can do this.';
