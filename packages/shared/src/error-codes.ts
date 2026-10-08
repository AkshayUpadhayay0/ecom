/**
 * API error codes shared by the API and every client.
 * Extend this list; never rename or remove a code (clients branch on them).
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'PRODUCT_UNAVAILABLE',
  'INVALID_SIZE',
  'SIZE_NOT_CONFIRMED',
  'INSUFFICIENT_STOCK',
  'CART_EMPTY',
  'INVALID_DELIVERY_ZONE',
  'RESERVATION_EXPIRED',
  'PAYMENT_FAILED',
  'PAYMENT_VERIFICATION_FAILED',
  'DUPLICATE_REQUEST',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  // Added in Phase 0: a dependency (e.g. the database) is unreachable.
  'SERVICE_UNAVAILABLE',
  // Added in Phase 1 (auth).
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'EMAIL_ALREADY_REGISTERED',
  'WEAK_PASSWORD',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'PASSWORD_CHANGE_REQUIRED',
  // Added in Phase 2 (admin API).
  'ALREADY_EXISTS',
  'INVALID_STATE',
  'ACTIVE_PRODUCT_LIMIT_REACHED',
  'STOCK_BELOW_RESERVED',
  'ZONE_FEE_REQUIRED',
  'MEDIA_NOT_READY',
  'INVALID_MEDIA_TYPE',
  'UNKNOWN_SETTING',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
