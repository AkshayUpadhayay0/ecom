import type { MessageKey, MessageParams } from '@urban-ibile/i18n';
import { BffError, NETWORK_ERROR_CODE } from './bff';

/** API error code -> dictionary key. Codes not listed fall back to the generic message. */
const CODE_TO_KEY: Readonly<Record<string, MessageKey>> = {
  VALIDATION_ERROR: 'err.VALIDATION_ERROR',
  UNAUTHENTICATED: 'err.UNAUTHENTICATED',
  FORBIDDEN: 'err.FORBIDDEN',
  NOT_FOUND: 'err.NOT_FOUND',
  RATE_LIMITED: 'err.RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'err.SERVICE_UNAVAILABLE',
  INVALID_CREDENTIALS: 'err.INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'err.ACCOUNT_LOCKED',
  EMAIL_ALREADY_REGISTERED: 'err.EMAIL_ALREADY_REGISTERED',
  WEAK_PASSWORD: 'err.WEAK_PASSWORD',
  INVALID_TOKEN: 'err.INVALID_TOKEN',
  TOKEN_EXPIRED: 'err.TOKEN_EXPIRED',
  PRODUCT_UNAVAILABLE: 'err.PRODUCT_UNAVAILABLE',
  INSUFFICIENT_STOCK: 'err.INSUFFICIENT_STOCK',
  QUANTITY_LIMIT_EXCEEDED: 'err.QUANTITY_LIMIT_EXCEEDED',
  SIZE_NOT_OFFERED: 'err.SIZE_NOT_OFFERED',
  INVALID_SIZE: 'err.INVALID_SIZE',
  BLUEPRINT_OUT_OF_RANGE: 'err.BLUEPRINT_OUT_OF_RANGE',
  BLUEPRINT_MEASUREMENTS_INVALID: 'err.BLUEPRINT_MEASUREMENTS_INVALID',
  BLUEPRINT_NOT_APPLICABLE: 'err.BLUEPRINT_NOT_APPLICABLE',
  BLUEPRINT_CHART_UNAVAILABLE: 'err.BLUEPRINT_CHART_UNAVAILABLE',
  BLUEPRINT_DECISION_REQUIRED: 'err.BLUEPRINT_DECISION_REQUIRED',
  BLUEPRINT_DECISION_INVALID: 'err.BLUEPRINT_DECISION_INVALID',
  BODY_SCAN_NOT_READY: 'err.BODY_SCAN_NOT_READY',
  BODY_SCAN_UNAVAILABLE: 'err.BODY_SCAN_UNAVAILABLE',
  INVALID_DELIVERY_ZONE: 'err.INVALID_DELIVERY_ZONE',
  CART_EMPTY: 'err.CART_EMPTY',
  [NETWORK_ERROR_CODE]: 'err.NETWORK_ERROR',
  UNEXPECTED_RESPONSE: 'err.UNEXPECTED_RESPONSE',
};

export interface DescribedError {
  key: MessageKey;
  params: MessageParams;
  code: string;
}

function numberAt(details: unknown, key: string): number | undefined {
  if (typeof details !== 'object' || details === null) return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

/** Maps any thrown value to a dictionary key (+ params), never to the API's English text. */
export function describeError(error: unknown): DescribedError {
  if (!(error instanceof BffError)) return { key: 'err.generic', params: {}, code: 'UNKNOWN' };
  const params: MessageParams = {};
  if (error.code === 'QUANTITY_LIMIT_EXCEEDED') {
    params.max = numberAt(error.details, 'maxQuantity') ?? 0;
  }
  const key =
    CODE_TO_KEY[error.code] ?? (error.status === 429 ? 'err.RATE_LIMITED' : 'err.generic');
  return { key, params, code: error.code };
}

/**
 * Names of the fields the API flagged (VALIDATION_ERROR / BLUEPRINT_MEASUREMENTS_INVALID
 * `details.issues`). Only the names are used: the text shown comes from the dictionary.
 */
export function flaggedFields(error: unknown): Set<string> {
  const names = new Set<string>();
  if (!(error instanceof BffError) || typeof error.details !== 'object' || error.details === null)
    return names;
  const issues = (error.details as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return names;
  for (const issue of issues as unknown[]) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, field, code } = issue as Record<string, unknown>;
    const name =
      typeof field === 'string'
        ? field
        : typeof code === 'string'
          ? code
          : Array.isArray(path)
            ? path.join('.')
            : undefined;
    if (name) names.add(name);
  }
  return names;
}
