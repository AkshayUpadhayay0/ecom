/** PostgreSQL SQLSTATE codes the repositories translate into domain results. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const;

interface PgError {
  code: string;
  constraint?: string;
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string';
}

/** True when `err` is a Postgres error with `code` (and, if given, on `constraint`). */
export function isPgErrorCode(
  err: unknown,
  code: (typeof PG_ERROR)[keyof typeof PG_ERROR],
  constraint?: string,
): boolean {
  if (!isPgError(err) || err.code !== code) return false;
  return constraint === undefined || err.constraint === constraint;
}

/** Name of the violated constraint, if Postgres reported one. */
export function pgConstraintOf(err: unknown): string | undefined {
  return isPgError(err) ? err.constraint : undefined;
}

/** Escapes `%`, `_` and `\` so user input is matched literally inside ILIKE patterns. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** int8 columns arrive as strings; money and counts here always fit in a JS number. */
export function int8ToNumber(value: string | number | bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`int8 value out of safe range: ${value}`);
  return result;
}
