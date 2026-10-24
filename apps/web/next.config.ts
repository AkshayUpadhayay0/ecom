import type { NextConfig } from 'next';
import { mediaOriginsOf, mediaSourcesFrom, remotePatternsOf } from './src/config/media';

const isProd = process.env.NODE_ENV === 'production';
const API_DEFAULT = 'http://localhost:4000';

/**
 * Hosts that serve media: the public media base URL (same value as the API's R2_PUBLIC_BASE_URL),
 * optional extras, and the API itself for local-storage dev. Only the media path is allowed.
 */
const sources = mediaSourcesFrom({
  mediaBaseUrl: process.env.NEXT_PUBLIC_MEDIA_BASE_URL,
  extraBaseUrls: process.env.NEXT_PUBLIC_MEDIA_ORIGINS,
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? API_DEFAULT,
});
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? API_DEFAULT).origin;
const mediaSources = mediaOriginsOf(sources).join(' ');

// CSP starts in REPORT-ONLY mode: violations show in the browser console without breaking pages.
// script/style 'unsafe-inline' are needed by Next's inline hydration data until nonces are added.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${mediaSources}`,
  `media-src 'self' blob: ${mediaSources}`,
  `connect-src 'self' ${apiOrigin}`,
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
  // Honoured by browsers only over HTTPS; harmless on http://localhost.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Separate build folder lets the e2e run build while a dev server uses .next.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  poweredByHeader: false,
  transpilePackages: ['@urban-ibile/i18n', '@urban-ibile/shared'],
  images: {
    // Host AND media path only. MediaImage serves pre-generated renditions unoptimised, so this
    // is the safety net for any plain next/image use.
    remotePatterns: remotePatternsOf(sources),
    // Local-storage dev/e2e serves media from localhost (NEXT_ALLOW_LOCAL_MEDIA=true outside dev); production uses the public CDN host.
    dangerouslyAllowLocalIP: !isProd || process.env.NEXT_ALLOW_LOCAL_MEDIA === 'true',
    formats: ['image/avif', 'image/webp'],
  },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
