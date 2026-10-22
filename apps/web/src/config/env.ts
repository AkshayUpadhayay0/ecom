/**
 * Runtime configuration. Server-only values are read where they are used (never exported to
 * client code); NEXT_PUBLIC_* values are inlined by Next at build time. No secrets live here.
 */

const DEFAULT_API_ORIGIN = 'http://localhost:4000';
const DEFAULT_SITE_ORIGIN = 'http://localhost:3000';

/** API root as seen from the server (may be an internal address in production). */
export function serverApiBase(): string {
  return stripSlash(
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_ORIGIN,
  );
}

/** API root as seen from the browser (media only: customer API calls go through /api/bff). */
export function browserApiBase(): string {
  return stripSlash(process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_ORIGIN);
}

/** Public origin of this website (canonical URLs, sitemap, Open Graph, CSRF origin check). */
export function siteOrigin(): string {
  return stripSlash(process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_ORIGIN);
}

/** Session cookies are Secure whenever the site is served over HTTPS (override: WEB_COOKIE_SECURE). */
export function cookieSecure(): boolean {
  const override = process.env.WEB_COOKIE_SECURE;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return siteOrigin().startsWith('https://');
}

/** Pidgin switcher stays hidden until the client's approved copy is in. */
export const PIDGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PIDGIN === 'true';

/** Body Scan entry point (MOCK provider only today). Off by default. */
export const BODY_SCAN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_BODY_SCAN === 'true';

function stripSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
