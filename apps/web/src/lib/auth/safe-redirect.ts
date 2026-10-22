const DEFAULT_TARGET = '/';

/**
 * Only same-site relative paths are accepted as a post-login destination. Anything else (absolute
 * URLs, protocol-relative "//host", backslash tricks, control characters, javascript:) falls back
 * to "/".
 */
export function safeRedirect(target: string | null | undefined, fallback = DEFAULT_TARGET): string {
  if (!target) return fallback;
  if (target.length > 2000) return fallback;
  // Control characters (incl. tab/newline, which browsers strip inside URLs) and backslashes.
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f\\]/.test(target)) return fallback;
  if (!target.startsWith('/') || target.startsWith('//')) return fallback;
  try {
    // Encoded control characters / backslashes (%0d%0a, %5c) are rejected too.
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    if (/[\u0000-\u001f\u007f\\]/.test(decodeURIComponent(target))) return fallback;
    const parsed = new URL(target, 'http://placeholder.invalid');
    if (parsed.origin !== 'http://placeholder.invalid') return fallback;
    // Never bounce back to the auth pages themselves.
    if (
      /^\/(login|register|forgot-password|reset-password|verify-email)(\/|$)/.test(parsed.pathname)
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/** Builds /login?next=<current path> for a logged-out shopper (path is validated). */
export function loginHref(next: string, mode: 'login' | 'register' = 'login'): string {
  const safe = safeRedirect(next);
  return safe === DEFAULT_TARGET ? `/${mode}` : `/${mode}?next=${encodeURIComponent(safe)}`;
}
