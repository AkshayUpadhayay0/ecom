import type { AddCartItemRequest, CartDto } from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { PG_ERROR, isPgErrorCode } from '../../lib/db-errors.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { SettingsService } from '../settings/settings.service.js';
import { toCartDto } from './cart-lines.js';
import type { CartRepository, VariantOfferRow } from './cart.repository.js';

const ACTIVE = 'active';
/** SQLSTATE of RAISE EXCEPTION in our triggers (check_line_matches_decision). */
const RAISE_EXCEPTION = 'P0001';

export interface CartService {
  get(customerId: string): Promise<CartDto>;
  addItem(customerId: string, input: AddCartItemRequest): Promise<CartDto>;
  updateQuantity(customerId: string, lineId: string, quantity: number): Promise<CartDto>;
  removeLine(customerId: string, lineId: string): Promise<CartDto>;
  /** "Reopen Find My Size": a new decision for the same product; the size (variant) may change. */
  replaceDecision(customerId: string, lineId: string, decisionId: string): Promise<CartDto>;
}

export interface CartServiceDeps {
  db: Database;
  repository: CartRepository;
  settings: SettingsService;
}

function invalidDecision(message: string): AppError {
  return new AppError('BLUEPRINT_DECISION_INVALID', HTTP_STATUS.CONFLICT, message);
}

function isTriggerRejection(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === RAISE_EXCEPTION;
}

export function createCartService({ db, repository, settings }: CartServiceDeps): CartService {
  async function view(executor: Database, customerId: string, cartId: string): Promise<CartDto> {
    const [rows, currency, max] = await Promise.all([
      repository.lines(executor, cartId),
      settings.getSetting(executor, 'store.currency'),
      settings.getLimit(executor, 'cart.max_quantity_per_item'),
    ]);
    return toCartDto(cartId, rows, customerId, currency, max);
  }

  /** Product + size must be sellable now; returns the variant to put in the cart. */
  function assertOffered(offer: VariantOfferRow | undefined): VariantOfferRow {
    if (!offer || !offer.variantActive || !offer.sizeActive) {
      throw new AppError(
        'SIZE_NOT_OFFERED',
        HTTP_STATUS.CONFLICT,
        'This product is not made in that size.',
      );
    }
    if (offer.productStatus !== ACTIVE) {
      throw new AppError(
        'PRODUCT_UNAVAILABLE',
        HTTP_STATUS.CONFLICT,
        'This product is not available.',
      );
    }
    return offer;
  }

  async function assertQuantity(
    executor: Database,
    quantity: number,
    available: number,
  ): Promise<void> {
    const max = await settings.getLimit(executor, 'cart.max_quantity_per_item');
    if (quantity > max) {
      throw new AppError(
        'QUANTITY_LIMIT_EXCEEDED',
        HTTP_STATUS.CONFLICT,
        `You can add up to ${max} of an item.`,
        {
          maxQuantity: max,
        },
      );
    }
    if (quantity > available) {
      // Available count is not exposed (no stock quantities leave the API).
      throw new AppError(
        'INSUFFICIENT_STOCK',
        HTTP_STATUS.CONFLICT,
        'Not enough stock for that quantity.',
      );
    }
  }

  /** Resolves which size the line is for and validates the decision against it. */
  async function resolveSize(
    executor: Database,
    customerId: string,
    input: AddCartItemRequest,
  ): Promise<{ sizeId: string; decisionId: string | null }> {
    const product = await repository.productStatus(executor, input.productId);
    if (!product || product.status !== ACTIVE) {
      throw new AppError(
        'PRODUCT_UNAVAILABLE',
        HTTP_STATUS.CONFLICT,
        'This product is not available.',
      );
    }
    if (product.measurementProfileId === null) {
      if (input.blueprintDecisionId !== undefined)
        throw invalidDecision('This product does not use Blueprint sizing.');
      if (input.sizeId === undefined) {
        throw new AppError(
          'VALIDATION_ERROR',
          HTTP_STATUS.BAD_REQUEST,
          'Request validation failed.',
          {
            issues: [{ path: 'sizeId', message: 'Choose a size.' }],
          },
        );
      }
      return { sizeId: input.sizeId, decisionId: null };
    }
    if (input.blueprintDecisionId === undefined) {
      throw new AppError(
        'BLUEPRINT_DECISION_REQUIRED',
        HTTP_STATUS.CONFLICT,
        'Use Find My Size to choose your size for this product first.',
      );
    }
    const decision = await repository.decision(executor, input.blueprintDecisionId);
    if (decision?.customerId !== customerId || decision.productId !== input.productId) {
      throw invalidDecision('That fitting decision does not belong to this product and account.');
    }
    if (input.sizeId !== undefined && input.sizeId !== decision.selectedSizeId) {
      throw invalidDecision('The chosen size does not match your fitting decision.');
    }
    return { sizeId: decision.selectedSizeId, decisionId: decision.id };
  }

  /** Runs a cart change in one transaction with the cart row locked. */
  async function mutate(
    customerId: string,
    change: (trx: Database, cartId: string) => Promise<void>,
  ): Promise<CartDto> {
    try {
      return await db.transaction().execute(async (trx) => {
        const cartId = await repository.activeCartId(trx, customerId, true);
        await change(trx, cartId);
        await repository.touch(trx, cartId);
        return view(trx, customerId, cartId);
      });
    } catch (err) {
      // The DB trigger is the final guard; translate its refusal into a friendly code.
      if (isTriggerRejection(err))
        throw invalidDecision('That fitting decision does not match this item.');
      if (isPgErrorCode(err, PG_ERROR.UNIQUE_VIOLATION)) {
        throw new AppError(
          'DUPLICATE_REQUEST',
          HTTP_STATUS.CONFLICT,
          'The cart changed at the same time. Try again.',
        );
      }
      throw err;
    }
  }

  return {
    async get(customerId) {
      const cartId = await repository.activeCartId(db, customerId);
      return view(db, customerId, cartId);
    },

    addItem(customerId, input) {
      return mutate(customerId, async (trx, cartId) => {
        const { sizeId, decisionId } = await resolveSize(trx, customerId, input);
        const offer = assertOffered(await repository.offer(trx, input.productId, sizeId));
        const existing = await repository.findLineByVariant(trx, cartId, offer.variantId);
        const quantity = (existing?.quantity ?? 0) + input.quantity;
        await assertQuantity(trx, quantity, offer.available);
        if (existing) {
          // Same product + size again: merge into one line (newest fitting decision wins).
          await repository.updateLine(trx, existing.id, {
            quantity,
            ...(decisionId !== null && { decisionId }),
            priceMinor: offer.priceMinor,
          });
        } else {
          await repository.insertLine(trx, {
            cartId,
            variantId: offer.variantId,
            quantity,
            decisionId,
            priceMinor: offer.priceMinor,
          });
        }
      });
    },

    updateQuantity(customerId, lineId, quantity) {
      return mutate(customerId, async (trx, cartId) => {
        const line = await repository.findLineVariant(trx, cartId, lineId);
        if (!line) throw notFoundError('Cart item');
        const rows = await repository.lines(trx, cartId);
        const available = rows.find((row) => row.id === lineId)?.available ?? 0;
        if (quantity > line.quantity) await assertQuantity(trx, quantity, available);
        else await assertQuantity(trx, quantity, Number.POSITIVE_INFINITY);
        await repository.updateLine(trx, lineId, { quantity });
      });
    },

    removeLine(customerId, lineId) {
      return mutate(customerId, async (trx, cartId) => {
        if (!(await repository.deleteLine(trx, cartId, lineId))) throw notFoundError('Cart item');
      });
    },

    replaceDecision(customerId, lineId, decisionId) {
      return mutate(customerId, async (trx, cartId) => {
        const line = await repository.findLineVariant(trx, cartId, lineId);
        if (!line) throw notFoundError('Cart item');
        const decision = await repository.decision(trx, decisionId);
        if (decision?.customerId !== customerId || decision.productId !== line.productId) {
          throw invalidDecision(
            'That fitting decision does not belong to this product and account.',
          );
        }
        const offer = assertOffered(
          await repository.offer(trx, line.productId, decision.selectedSizeId),
        );
        if (offer.variantId === line.variantId) {
          await repository.updateLine(trx, lineId, { decisionId });
          return;
        }
        // The new size moves the line to that variant (merging with an existing line of it).
        const target = await repository.findLineByVariant(trx, cartId, offer.variantId);
        const quantity = line.quantity + (target?.quantity ?? 0);
        await assertQuantity(trx, quantity, offer.available);
        if (target) {
          await repository.deleteLine(trx, cartId, lineId);
          await repository.updateLine(trx, target.id, {
            quantity,
            decisionId,
            priceMinor: offer.priceMinor,
          });
        } else {
          await repository.updateLine(trx, lineId, {
            variantId: offer.variantId,
            decisionId,
            priceMinor: offer.priceMinor,
          });
        }
      });
    },
  };
}
