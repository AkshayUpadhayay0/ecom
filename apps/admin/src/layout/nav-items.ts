import {
  Boxes,
  CreditCard,
  FileText,
  Image,
  LayoutDashboard,
  QrCode,
  RotateCcw,
  Ruler,
  ScrollText,
  Settings,
  Shirt,
  ShoppingBag,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';

/**
 * main: the client admin panel (every admin). internal: developer tools, super_admin only
 * (decision 19 Oct 2026). The API refuses internal routes to normal admins (403) as well.
 */
export type NavGroup = 'main' | 'internal';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Not built yet: renders the "Coming soon" page. */
  comingSoon: boolean;
  /** Keeps the item highlighted on every route under this prefix (sections with sub-tabs). */
  activePrefix?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    group: 'main',
    comingSoon: false,
  },
  {
    label: 'Orders',
    path: '/orders',
    icon: ShoppingBag,
    group: 'main',
    comingSoon: false,
    activePrefix: '/orders',
  },
  {
    label: 'Payment Review',
    path: '/payment-reviews',
    icon: CreditCard,
    group: 'main',
    comingSoon: false,
  },
  {
    label: 'Returns',
    path: '/returns',
    icon: RotateCcw,
    group: 'main',
    comingSoon: false,
    activePrefix: '/returns',
  },
  {
    label: 'Customers',
    path: '/customers',
    icon: Users,
    group: 'main',
    comingSoon: false,
    activePrefix: '/customers',
  },
  {
    label: 'Products',
    path: '/products',
    icon: Shirt,
    group: 'main',
    comingSoon: false,
    activePrefix: '/products',
  },
  { label: 'Inventory', path: '/inventory', icon: Boxes, group: 'main', comingSoon: false },
  // Media Library: every admin since 22 Oct 2026 (public media only; purge is super_admin).
  { label: 'Media', path: '/media', icon: Image, group: 'main', comingSoon: false },
  { label: 'Content', path: '/content', icon: FileText, group: 'main', comingSoon: false },
  { label: 'Delivery', path: '/delivery', icon: Truck, group: 'main', comingSoon: false },
  { label: 'Settings', path: '/settings', icon: Settings, group: 'main', comingSoon: false },
  {
    label: 'Sizes & Charts',
    path: '/sizes/charts',
    icon: Ruler,
    group: 'internal',
    comingSoon: false,
    activePrefix: '/sizes',
  },
  {
    label: 'QR Pages',
    path: '/qr-pages',
    icon: QrCode,
    group: 'internal',
    comingSoon: false,
    activePrefix: '/qr-pages',
  },
  {
    label: 'Audit Log',
    path: '/audit-log',
    icon: ScrollText,
    group: 'internal',
    comingSoon: false,
  },
];

/** The items a signed-in admin may see. */
export function navItemsFor(isSuperAdmin: boolean): readonly NavItem[] {
  return isSuperAdmin ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.group === 'main');
}
