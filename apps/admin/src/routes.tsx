import { Navigate, type RouteObject } from 'react-router';
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { ContentPage } from '@/features/content/ContentPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DeliveryPage } from '@/features/delivery/DeliveryPage';
import { QrPagesPage } from '@/features/qr-pages/QrPagesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { MediaPage } from '@/features/media/MediaPage';
import { OrderDetailPage } from '@/features/orders/OrderDetailPage';
import { OrdersListPage } from '@/features/orders/OrdersListPage';
import { ClothingTypesPage } from '@/features/products/ClothingTypesPage';
import { ProductDetailPage } from '@/features/products/ProductDetailPage';
import { ProductsLayout } from '@/features/products/ProductsLayout';
import { ProductsListPage } from '@/features/products/ProductsListPage';
import { MeasurementProfilesPage } from '@/features/sizes/MeasurementProfilesPage';
import { SizeChartsPage } from '@/features/sizes/SizeChartsPage';
import { SizesLayout } from '@/features/sizes/SizesLayout';
import { SizesPage } from '@/features/sizes/SizesPage';
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
      {
        // Read-only Sizes & Charts section (sub-tabs share SizesLayout).
        path: 'sizes',
        element: <SizesLayout />,
        children: [
          { index: true, element: <SizesPage /> },
          { path: 'charts', element: <SizeChartsPage /> },
          { path: 'profiles', element: <MeasurementProfilesPage /> },
        ],
      },
      {
        path: 'products',
        element: <ProductsLayout />,
        children: [
          { index: true, element: <ProductsListPage /> },
          { path: 'clothing-types', element: <ClothingTypesPage /> },
        ],
      },
      { path: 'products/:id', element: <ProductDetailPage /> },
      { path: 'orders', element: <OrdersListPage /> },
      { path: 'orders/:id', element: <OrderDetailPage /> },
      { path: 'inventory', element: <InventoryPage /> },
      { path: 'media', element: <MediaPage /> },
      { path: 'delivery', element: <DeliveryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'content', element: <ContentPage /> },
      { path: 'qr-pages', element: <QrPagesPage /> },
      { path: 'audit-log', element: <AuditLogPage /> },
      ...comingSoonRoutes,
      { path: '*', element: <Navigate to={DEFAULT_AUTHED_PATH} replace /> },
    ],
  },
];
