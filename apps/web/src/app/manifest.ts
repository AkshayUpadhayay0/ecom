import type { MetadataRoute } from 'next';
import { BRAND_NAME } from '@/brand/brand';
import { BRAND_COLORS } from '@/brand/tokens';

/** Web app manifest. Icons are generated from the supplied Icon (Red) on Warm Ivory only. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    start_url: '/',
    display: 'standalone',
    background_color: BRAND_COLORS.ivory,
    theme_color: BRAND_COLORS.ivory,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
