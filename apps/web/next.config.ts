import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';
const API_DEFAULT = 'http://localhost:4000';

function origins(value: string | undefined, fallback: string[]): URL[] {
  const list = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return (list.length > 0 ? list : fallback).map((o) => new URL(o));
}

/** Hosts that serve media (CDN bucket, or the API itself in local-storage dev). */
const mediaOrigins = origins(process.env.NEXT_PUBLIC_MEDIA_ORIGINS, [
  process.env.NEXT_PUBLIC_API_BASE_URL ?? API_DEFAULT,
]);
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? API_DEFAULT).origin;
const mediaSources = mediaOrigins.map((u) => u.origin).join(' ');

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
    remotePatterns: mediaOrigins.map((u) => ({
      protocol: u.protocol.replace(':', '') as 'http' | 'https',
      hostname: u.hostname,
      ...(u.port ? { port: u.port } : {}),
    })),
    // Local-storage dev/e2e serves media from localhost (NEXT_ALLOW_LOCAL_MEDIA=true outside dev); production uses the public CDN host.
    dangerouslyAllowLocalIP: !isProd || process.env.NEXT_ALLOW_LOCAL_MEDIA === 'true',
    formats: ['image/avif', 'image/webp'],
  },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
