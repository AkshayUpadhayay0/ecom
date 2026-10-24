import type { CartDto, CartLineDto } from '@urban-ibile/shared';

/**
 * Pure helpers for the optimistic cart updates. They only mirror what the API will answer so the
 * screen reacts at once; the API's answer always replaces this guess (prices and totals are the
 * server's, never ours).
 */

const UNAVAILABLE = 'UNAVAILABLE';

function isPurchasable(line: CartLineDto): boolean {
  return !line.warnings.includes(UNAVAILABLE);
}

function recount(cart: CartDto, lines: CartLineDto[]): CartDto {
  return {
    ...cart,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor: lines.filter(isPurchasable).reduce((sum, line) => sum + line.lineTotalMinor, 0),
  };
}

export function withQuantity(cart: CartDto, lineId: string, quantity: number): CartDto {
  return recount(
    cart,
    cart.lines.map((line) =>
      line.id === lineId
        ? { ...line, quantity, lineTotalMinor: line.unitPriceMinor * quantity }
        : line,
    ),
  );
}

export function withoutLine(cart: CartDto, lineId: string): CartDto {
  return recount(
    cart,
    cart.lines.filter((line) => line.id !== lineId),
  );
}

/** Blocking warnings from the API (price changes do not block checkout). */
export const BLOCKING_WARNINGS = ['STOCK_LOW', 'OUT_OF_STOCK', 'UNAVAILABLE'] as const;

export function blockingWarnings(line: CartLineDto): CartLineDto['warnings'] {
  return line.warnings.filter((warning) =>
    (BLOCKING_WARNINGS as readonly string[]).includes(warning),
  );
}

/** Next quantity for the +/- buttons: never below 1 (use Remove) nor above the API's per-line limit. */
export function clampQuantity(next: number, max: number): number {
  return Math.min(Math.max(1, Math.trunc(next)), max);
}
