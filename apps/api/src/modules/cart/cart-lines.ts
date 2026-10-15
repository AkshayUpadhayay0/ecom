import type { CartDto, CartLineDto, CartWarning, SelectionMode } from '@urban-ibile/shared';
import { int8ToNumber } from '../../lib/db-errors.js';
import type { CartLineRow } from './cart.repository.js';

const ACTIVE = 'active';
/** Warnings that make a line impossible to check out as it is. */
const BLOCKING: readonly CartWarning[] = ['UNAVAILABLE', 'OUT_OF_STOCK', 'STOCK_LOW'];

export type DecisionProblem = 'missing' | 'invalid' | null;

/**
 * Is the line's fitting decision acceptable for this customer? (The DB trigger enforces the same
 * on write; this lets the API answer with a friendly code first.)
 */
export function decisionProblem(row: CartLineRow, customerId: string): DecisionProblem {
  if (row.decisionId === null) return row.measurementProfileId === null ? null : 'missing';
  const matches =
    row.decisionCustomerId === customerId &&
    row.decisionProductId === row.productId &&
    row.decisionSelectedSizeId === row.sizeId;
  return matches ? null : 'invalid';
}

/** Unavailable: inactive product/variant/size, wrong currency, or a missing/invalid decision. */
export function isUnavailable(row: CartLineRow, customerId: string, currency: string): boolean {
  return (
    row.productStatus !== ACTIVE ||
    !row.variantActive ||
    !row.sizeActive ||
    row.currency.trim() !== currency ||
    decisionProblem(row, customerId) !== null
  );
}

export function lineWarnings(
  row: CartLineRow,
  customerId: string,
  currency: string,
): CartWarning[] {
  const warnings: CartWarning[] = [];
  const price = int8ToNumber(row.priceMinor);
  if (row.addedUnitPriceMinor !== null && int8ToNumber(row.addedUnitPriceMinor) !== price) {
    warnings.push('PRICE_CHANGED');
  }
  if (isUnavailable(row, customerId, currency)) warnings.push('UNAVAILABLE');
  else if (row.available <= 0) warnings.push('OUT_OF_STOCK');
  else if (row.available < row.quantity) warnings.push('STOCK_LOW');
  return warnings;
}

function toLineDto(row: CartLineRow, warnings: CartWarning[]): CartLineDto {
  const unitPriceMinor = int8ToNumber(row.priceMinor);
  return {
    id: row.id,
    product: { id: row.productId, slug: row.productSlug, name: row.productName },
    size: { id: row.sizeId, code: row.sizeCode, label: row.sizeLabel },
    quantity: row.quantity,
    unitPriceMinor,
    lineTotalMinor: unitPriceMinor * row.quantity,
    addedUnitPriceMinor:
      row.addedUnitPriceMinor === null ? null : int8ToNumber(row.addedUnitPriceMinor),
    decision:
      row.decisionId !== null && row.decisionSelectionMode !== null
        ? {
            id: row.decisionId,
            // CHECK-constrained in the database.
            selectionMode: row.decisionSelectionMode as SelectionMode,
            recommendedSizeCode: row.decisionRecommendedCode ?? '',
          }
        : null,
    warnings,
  };
}

/** Prices always come from products.price_minor at read time. */
export function toCartDto(
  cartId: string,
  rows: readonly CartLineRow[],
  customerId: string,
  currency: string,
  maxQuantityPerLine: number,
): CartDto {
  const lines = rows.map((row) => toLineDto(row, lineWarnings(row, customerId, currency)));
  const purchasable = lines.filter((line) => !line.warnings.includes('UNAVAILABLE'));
  return {
    id: cartId,
    currency,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalMinor: purchasable.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    canCheckout:
      lines.length > 0 && lines.every((line) => !line.warnings.some((w) => BLOCKING.includes(w))),
    maxQuantityPerLine,
  };
}
