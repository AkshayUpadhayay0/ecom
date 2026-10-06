import {
  Boxes,
  FileText,
  LayoutDashboard,
  QrCode,
  Settings,
  Shirt,
  ShoppingBag,
  Truck,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Not built yet: renders the "Coming soon" page. */
  comingSoon: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, comingSoon: false },
  { label: 'Products', path: '/products', icon: Shirt, comingSoon: true },
  { label: 'Orders', path: '/orders', icon: ShoppingBag, comingSoon: true },
  { label: 'Inventory', path: '/inventory', icon: Boxes, comingSoon: true },
  { label: 'Content', path: '/content', icon: FileText, comingSoon: true },
  { label: 'QR Pages', path: '/qr-pages', icon: QrCode, comingSoon: true },
  { label: 'Delivery', path: '/delivery', icon: Truck, comingSoon: true },
  { label: 'Settings', path: '/settings', icon: Settings, comingSoon: true },
];
