import { LOCALES } from '@urban-ibile/i18n';

/**
 * The page path without the language segment. The proxy rewrites "/shop" to "/en/shop" internally,
 * and depending on the router, usePathname() can report either form: compare the stripped one.
 */
export function pathWithoutLocale(pathname: string): string {
  const [, first = '', ...rest] = pathname.split('/');
  if ((LOCALES as readonly string[]).includes(first)) return `/${rest.join('/')}`;
  return pathname;
}

export const isHomePath = (pathname: string): boolean => pathWithoutLocale(pathname) === '/';
