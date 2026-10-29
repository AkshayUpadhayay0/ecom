import { describe, expect, it } from 'vitest';
import { decideRevalidation } from './handler';

const SECRET = 'a-shared-secret-of-sufficient-length-123';
const auth = `Bearer ${SECRET}`;

describe('decideRevalidation', () => {
  it('does not exist (404) when no secret is configured', () => {
    expect(decideRevalidation(undefined, auth, { tags: ['catalog'] }).status).toBe(404);
    expect(decideRevalidation('', auth, { tags: ['catalog'] }).status).toBe(404);
  });

  it('refuses a missing, malformed or wrong secret (401)', () => {
    const body = { tags: ['catalog'] };
    expect(decideRevalidation(SECRET, null, body).status).toBe(401);
    expect(decideRevalidation(SECRET, SECRET, body).status).toBe(401);
    expect(decideRevalidation(SECRET, 'Bearer wrong', body).status).toBe(401);
    expect(decideRevalidation(SECRET, `Bearer ${SECRET}x`, body).status).toBe(401);
  });

  it('accepts only known tags (400)', () => {
    expect(decideRevalidation(SECRET, auth, null).status).toBe(400);
    expect(decideRevalidation(SECRET, auth, {}).status).toBe(400);
    expect(decideRevalidation(SECRET, auth, { tags: [] }).status).toBe(400);
    expect(decideRevalidation(SECRET, auth, { tags: ['everything'] }).status).toBe(400);
    expect(decideRevalidation(SECRET, auth, { tags: ['catalog', 7] }).status).toBe(400);
  });

  it('returns the tags to revalidate (200), without duplicates', () => {
    const result = decideRevalidation(SECRET, auth, { tags: ['catalog', 'site', 'catalog'] });
    expect(result).toEqual({ status: 200, body: { revalidated: ['catalog', 'site'] } });
  });
});
