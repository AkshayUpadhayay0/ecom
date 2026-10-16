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

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Not built yet: renders the "Coming soon" page. */
  comingSoon: boolean;
  /** Keeps the item highlighted on every route under this prefix (sections with sub-tabs). */
  activePrefix?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, comingSoon: false },
  {
    label: 'Orders',
    path: '/orders',
    icon: ShoppingBag,
    comingSoon: true,
    activePrefix: '/orders',
  },
  { label: 'Payment review', path: '/payment-reviews', icon: CreditCard, comingSoon: true },
  {
    label: 'Returns',
    path: '/returns',
    icon: RotateCcw,
    comingSoon: true,
    activePrefix: '/returns',
  },
  {
    label: 'Customers',
    path: '/customers',
    icon: Users,
    comingSoon: true,
    activePrefix: '/customers',
  },
  {
    label: 'Products',
    path: '/products',
    icon: Shirt,
    comingSoon: false,
    activePrefix: '/products',
  },
  { label: 'Inventory', path: '/inventory', icon: Boxes, comingSoon: false },
  { label: 'Media', path: '/media', icon: Image, comingSoon: false },
  {
    label: 'Sizes & Charts',
    path: '/sizes/charts',
    icon: Ruler,
    comingSoon: false,
    activePrefix: '/sizes',
  },
  { label: 'Content', path: '/content', icon: FileText, comingSoon: false },
  {
    label: 'QR Pages',
    path: '/qr-pages',
    icon: QrCode,
    comingSoon: false,
    activePrefix: '/qr-pages',
  },
  { label: 'Delivery', path: '/delivery', icon: Truck, comingSoon: false },
  { label: 'Settings', path: '/settings', icon: Settings, comingSoon: false },
  { label: 'Audit log', path: '/audit-log', icon: ScrollText, comingSoon: false },
];
