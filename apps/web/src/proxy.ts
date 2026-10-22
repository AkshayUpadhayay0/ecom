import { DEFAULT_LOCALE, isLocale } from '@urban-ibile/i18n';
import { NextResponse, type NextRequest } from 'next/server';
import { LANGUAGE_COOKIE } from '@/config/constants';
import { PIDGIN_ENABLED } from '@/config/env';

/**
 * Language without changing URLs: the chosen language (cookie) is mapped onto an internal
 * [locale] route segment by a rewrite. Pages stay statically cacheable per language (no cookies()
 * in components), and while Pidgin is switched off every request is English.
 */
export function proxy(request: NextRequest): NextResponse {
  const cookie = request.cookies.get(LANGUAGE_COOKIE)?.value;
  const locale = PIDGIN_ENABLED && isLocale(cookie) ? cookie : DEFAULT_LOCALE;

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${url.pathname === '/' ? '' : url.pathname}`;
  const response = NextResponse.rewrite(url);
  // The same URL can answer in two languages: shared caches must key on the cookie.
  response.headers.append('Vary', 'Cookie');
  return response;
}

export const config = {
  // Skip Next internals, the API-free static files and the SEO files.
  matcher: ['/((?!_next/|api/|fonts/|brand/|favicon|icon|apple-icon|sitemap.xml|robots.txt|.*\\..*).*)'],
};
