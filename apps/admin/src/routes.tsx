import { Navigate, type RouteObject } from 'react-router';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { LoginPage } from '@/features/auth/LoginPage';
import {
  DEFAULT_AUTHED_PATH,
  LOGIN_PATH,
  RedirectIfAuthenticated,
  RequireAuth,
} from '@/features/auth/route-guards';
import { AppLayout } from '@/layout/AppLayout';
import { NAV_ITEMS } from '@/layout/nav-items';
import { ComingSoonPage } from '@/pages/ComingSoonPage';

const comingSoonRoutes: RouteObject[] = NAV_ITEMS.filter((item) => item.comingSoon).map((item) => ({
  path: item.path.slice(1),
  element: <ComingSoonPage item={item} />,
}));

/** Shared by the browser router (main.tsx) and the memory router in tests. */
export const routes: RouteObject[] = [
  {
    path: LOGIN_PATH,
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to={DEFAULT_AUTHED_PATH} replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      ...comingSoonRoutes,
      { path: '*', element: <Navigate to={DEFAULT_AUTHED_PATH} replace /> },
    ],
  },
];
