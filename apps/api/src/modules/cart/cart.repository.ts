import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

const DEFAULT_LANGUAGE = sql<string>`(SELECT code FROM languages WHERE is_default LIMIT 1)`;
const ACTIVE = 'active';
const CONVERTED = 'converted';

/** Everything needed to price, validate and snapshot one cart line. */
export interface CartLineRow {
  id: string;
  quantity: number;
  addedUnitPriceMinor: string | null;
  variantId: string;
  variantActive: boolean;
  sku: string;
  available: number;
  productId: string;
  productSlug: string;
  productName: string;
  productStatus: string;
  priceMinor: string;
  currency: string;
  measurementProfileId: string | null;
  clothingTypeName: string | null;
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  sizeActive: boolean;
  decisionId: string | null;
  decisionCustomerId: string | null;
  decisionProductId: string | null;
  decisionSelectedSizeId: string | null;
  decisionSelectionMode: string | null;
  decisionMethod: string | null;
  decisionFitPreference: string | null;
  decisionRecommendedCode: string | null;
  decisionRecommendedLabel: string | null;
  decisionSelectedLabel: string | null;
  decisionChartSnapshot: unknown;
  createdAt: Date;
}

export interface VariantOfferRow {
  variantId: string;
  variantActive: boolean;
  sizeActive: boolean;
  available: number;
  productStatus: string;
  priceMinor: string;
  currency: string;
  measurementProfileId: string | null;
}

export interface DecisionRefRow {
  id: string;
  customerId: string;
  productId: string;
  selectedSizeId: string;
}

/** The customer's active cart and its lines (the only cart per customer: DB unique index). */
export interface CartRepository {
  /** Active cart id, created on first use. `lock` locks the cart row (checkout, edits). */
  activeCartId(db: Database, customerId: string, lock?: boolean): Promise<string>;
  lines(db: Database, cartId: string): Promise<CartLineRow[]>;
  findLineVariant(
    db: Database,
    cartId: string,
    lineId: string,
  ): Promise<{ id: string; variantId: string; quantity: number; productId: string } | undefined>;
  findLineByVariant(
    db: Database,
    cartId: string,
    variantId: string,
  ): Promise<{ id: string; quantity: number } | undefined>;
  /** The product's variant in `sizeId` (any state), with what is needed to accept it. */
  offer(db: Database, productId: string, sizeId: string): Promise<VariantOfferRow | undefined>;
  productStatus(
    db: Database,
    productId: string,
  ): Promise<{ status: string; measurementProfileId: string | null } | undefined>;
  decision(db: Database, decisionId: string): Promise<DecisionRefRow | undefined>;
  insertLine(
    db: Database,
    line: {
      cartId: string;
      variantId: string;
      quantity: number;
      decisionId: string | null;
      priceMinor: string;
    },
  ): Promise<string>;
  updateLine(
    db: Database,
    lineId: string,
    changes: {
      quantity?: number;
      variantId?: string;
      decisionId?: string | null;
      priceMinor?: string;
    },
  ): Promise<void>;
  deleteLine(db: Database, cartId: string, lineId: string): Promise<boolean>;
  touch(db: Database, cartId: string): Promise<void>;
  /** The active cart id without creating one; `lock` locks the row. */
  findActiveCartId(db: Database, customerId: string, lock?: boolean): Promise<string | undefined>;
  /**
   * After a confirmed payment: takes the purchased quantities out of the cart (lines added later
   * stay). Marks the cart 'converted' only when it ends up empty. Returns the new cart status.
   */
  removePurchased(
    db: Database,
    cartId: string,
    purchased: readonly { variantId: string; quantity: number }[],
  ): Promise<'active' | 'converted'>;
}

export function createCartRepository(): CartRepository {
  return {
    async activeCartId(db, customerId, lock = false) {
      await sql`
        INSERT INTO carts (customer_id) VALUES (${customerId})
        ON CONFLICT (customer_id) WHERE status = 'active' AND customer_id IS NOT NULL DO NOTHING`.execute(
        db,
      );
      let query = db
        .selectFrom('carts')
        .select('id')
        .where('customer_id', '=', customerId)
        .where('status', '=', ACTIVE);
      if (lock) query = query.forUpdate();
      return (await query.executeTakeFirstOrThrow()).id;
    },

    async lines(db, cartId) {
      return db
        .selectFrom('cart_items as ci')
        .innerJoin('product_variants as v', 'v.id', 'ci.variant_id')
        .innerJoin('products as p', 'p.id', 'v.product_id')
        .innerJoin('sizes as s', 's.id', 'v.size_id')
        .leftJoin('clothing_type_translations as ctt', (join) =>
          join
            .onRef('ctt.clothing_type_id', '=', 'p.clothing_type_id')
            .on('ctt.language_code', '=', DEFAULT_LANGUAGE),
        )
        .leftJoin('blueprint_decisions as d', 'd.id', 'ci.blueprint_decision_id')
        .leftJoin('sizes as rs', 'rs.id', 'd.recommended_size_id')
        .leftJoin('sizes as ss', 'ss.id', 'd.selected_size_id')
        .select([
          'ci.id',
          'ci.quantity',
          'ci.added_unit_price_minor as addedUnitPriceMinor',
          'v.id as variantId',
          'v.is_active as variantActive',
          'v.sku',
          sql<number>`v.stock_on_hand - v.stock_reserved`.as('available'),
          'p.id as productId',
          'p.slug as productSlug',
          'p.name as productName',
          'p.status as productStatus',
          'p.price_minor as priceMinor',
          'p.currency',
          'p.measurement_profile_id as measurementProfileId',
          'ctt.name as clothingTypeName',
          's.id as sizeId',
          's.code as sizeCode',
          's.label as sizeLabel',
          's.is_active as sizeActive',
          'd.id as decisionId',
          'd.customer_id as decisionCustomerId',
          'd.product_id as decisionProductId',
          'd.selected_size_id as decisionSelectedSizeId',
          'd.selection_mode as decisionSelectionMode',
          'd.measurement_method as decisionMethod',
          'd.fit_preference as decisionFitPreference',
          'rs.code as decisionRecommendedCode',
          'rs.label as decisionRecommendedLabel',
          'ss.label as decisionSelectedLabel',
          'd.chart_snapshot as decisionChartSnapshot',
          'ci.created_at as createdAt',
        ])
        .where('ci.cart_id', '=', cartId)
        .orderBy('ci.created_at')
        .orderBy('ci.id')
        .execute();
    },

    async findLineVariant(db, cartId, lineId) {
      return db
        .selectFrom('cart_items as ci')
        .innerJoin('product_variants as v', 'v.id', 'ci.variant_id')
        .select(['ci.id', 'ci.variant_id as variantId', 'ci.quantity', 'v.product_id as productId'])
        .where('ci.cart_id', '=', cartId)
        .where('ci.id', '=', lineId)
        .executeTakeFirst();
    },

    async findLineByVariant(db, cartId, variantId) {
      return db
        .selectFrom('cart_items')
        .select(['id', 'quantity'])
        .where('cart_id', '=', cartId)
        .where('variant_id', '=', variantId)
        .executeTakeFirst();
    },

    async offer(db, productId, sizeId) {
      return db
        .selectFrom('product_variants as v')
        .innerJoin('products as p', 'p.id', 'v.product_id')
        .innerJoin('sizes as s', 's.id', 'v.size_id')
        .select([
          'v.id as variantId',
          'v.is_active as variantActive',
          's.is_active as sizeActive',
          sql<number>`v.stock_on_hand - v.stock_reserved`.as('available'),
          'p.status as productStatus',
          'p.price_minor as priceMinor',
          'p.currency',
          'p.measurement_profile_id as measurementProfileId',
        ])
        .where('v.product_id', '=', productId)
        .where('v.size_id', '=', sizeId)
        .executeTakeFirst();
    },

    async productStatus(db, productId) {
      return db
        .selectFrom('products')
        .select(['status', 'measurement_profile_id as measurementProfileId'])
        .where('id', '=', productId)
        .executeTakeFirst();
    },

    async decision(db, decisionId) {
      return db
        .selectFrom('blueprint_decisions')
        .select([
          'id',
          'customer_id as customerId',
          'product_id as productId',
          'selected_size_id as selectedSizeId',
        ])
        .where('id', '=', decisionId)
        .executeTakeFirst();
    },

    async insertLine(db, line) {
      const row = await db
        .insertInto('cart_items')
        .values({
          cart_id: line.cartId,
          variant_id: line.variantId,
          quantity: line.quantity,
          blueprint_decision_id: line.decisionId,
          added_unit_price_minor: line.priceMinor,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },

    async updateLine(db, lineId, changes) {
      await db
        .updateTable('cart_items')
        .set((eb) => ({
          ...(changes.quantity !== undefined && { quantity: changes.quantity }),
          ...(changes.variantId !== undefined && { variant_id: changes.variantId }),
          ...(changes.decisionId !== undefined && { blueprint_decision_id: changes.decisionId }),
          ...(changes.priceMinor !== undefined && { added_unit_price_minor: changes.priceMinor }),
          updated_at: eb.fn('now'),
        }))
        .where('id', '=', lineId)
        .execute();
    },

    async deleteLine(db, cartId, lineId) {
      const result = await db
        .deleteFrom('cart_items')
        .where('cart_id', '=', cartId)
        .where('id', '=', lineId)
        .executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    },

    async findActiveCartId(db, customerId, lock = false) {
      let query = db
        .selectFrom('carts')
        .select('id')
        .where('customer_id', '=', customerId)
        .where('status', '=', ACTIVE);
      if (lock) query = query.forUpdate();
      return (await query.executeTakeFirst())?.id;
    },

    async removePurchased(db, cartId, purchased) {
      for (const line of purchased) {
        await db
          .deleteFrom('cart_items')
          .where('cart_id', '=', cartId)
          .where('variant_id', '=', line.variantId)
          .where('quantity', '<=', line.quantity)
          .execute();
        await db
          .updateTable('cart_items')
          .set((eb) => ({ quantity: eb('quantity', '-', line.quantity), updated_at: eb.fn('now') }))
          .where('cart_id', '=', cartId)
          .where('variant_id', '=', line.variantId)
          .where('quantity', '>', line.quantity)
          .execute();
      }
      const left = await db
        .selectFrom('cart_items')
        .select('id')
        .where('cart_id', '=', cartId)
        .limit(1)
        .executeTakeFirst();
      if (left) return ACTIVE;
      await db.updateTable('carts').set({ status: CONVERTED }).where('id', '=', cartId).execute();
      return CONVERTED;
    },

    async touch(db, cartId) {
      await db
        .updateTable('carts')
        .set({ updated_at: sql`now()` })
        .where('id', '=', cartId)
        .execute();
    },
  };
}
