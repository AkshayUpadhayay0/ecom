/**
 * The only API paths the browser may reach through /api/bff (everything else is refused), with the
 * methods allowed on each and whether a signed-in customer is needed. Admin, payments and order
 * routes are deliberately absent: they arrive with their own steps.
 */
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

interface Rule {
  pattern: RegExp;
  methods: readonly string[];
  /** false = public endpoint (no access token is attached). */
  auth: boolean;
}

const rule = (path: string, methods: readonly string[], auth = true): Rule => ({
  pattern: new RegExp(`^${path}$`),
  methods,
  auth,
});

const RULES: readonly Rule[] = [
  rule('auth/me', ['GET', 'PATCH']),
  rule('auth/resend-verification', ['POST']),
  rule('auth/(?:verify-email|forgot-password|reset-password)', ['POST'], false),
  rule('me/addresses', ['GET', 'POST']),
  rule(`me/addresses/${UUID}`, ['PATCH', 'DELETE']),
  rule('cart', ['GET']),
  rule('cart/items', ['POST']),
  rule(`cart/items/${UUID}`, ['PATCH', 'DELETE']),
  rule(`cart/items/${UUID}/decision`, ['PUT']),
  rule(`blueprint/products/${UUID}/requirements`, ['GET']),
  rule('blueprint/(?:recommendations|decisions)', ['POST']),
  rule('body-scan/sessions', ['POST']),
  rule(`body-scan/sessions/${UUID}`, ['GET']),
  rule('delivery/zones', ['GET']),
];

export type Match =
  { allowed: true; auth: boolean } | { allowed: false; reason: 'not_found' | 'method' };

export function matchBffPath(method: string, path: string): Match {
  const upper = method.toUpperCase();
  let pathMatched = false;
  for (const candidate of RULES) {
    if (!candidate.pattern.test(path)) continue;
    pathMatched = true;
    if (candidate.methods.includes(upper)) return { allowed: true, auth: candidate.auth };
  }
  return { allowed: false, reason: pathMatched ? 'method' : 'not_found' };
}
