import { timingSafeEqual } from 'node:crypto';
import { REVALIDATE_TAGS } from '@/lib/api/cache-tags';

export interface RevalidateResult {
  status: 200 | 400 | 401 | 404;
  body: { revalidated?: string[]; error?: string };
}

const MAX_TAGS = 10;
const BEARER = /^Bearer (.+)$/;

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requestedTags(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const tags = (body as { tags?: unknown }).tags;
  if (!Array.isArray(tags) || tags.length === 0 || tags.length > MAX_TAGS) return null;
  if (
    !tags.every((tag): tag is string => typeof tag === 'string' && REVALIDATE_TAGS.includes(tag))
  ) {
    return null;
  }
  return [...new Set(tags)];
}

/**
 * Server-to-server cache invalidation, kept free of Next so it is unit-testable. Not configured
 * (no REVALIDATE_SECRET) means the route does not exist (404); a wrong secret is 401; only the
 * known tags are accepted.
 */
export function decideRevalidation(
  secret: string | undefined,
  authorization: string | null,
  body: unknown,
): RevalidateResult {
  if (!secret) return { status: 404, body: { error: 'Not found' } };
  const given = BEARER.exec(authorization ?? '')?.[1];
  if (!given || !sameSecret(given, secret)) return { status: 401, body: { error: 'Unauthorized' } };
  const tags = requestedTags(body);
  if (!tags) return { status: 400, body: { error: 'Unknown or missing tags' } };
  return { status: 200, body: { revalidated: tags } };
}
