-- 0015: deleting a size/variant = archive (tester fixes, 20 Oct 2026).
--
-- [CONFIRMED 20 Oct 2026] Variants are never physically removed: stock ledger rows, order items,
-- carts, reservations and returns reference them. "Delete" archives the variant: inactive, hidden
-- from the shop and the admin lists. Remaining stock is written off first through a ledger row
-- (stock_movements 'adjustment'), in the same transaction.
-- * archived_at / archived_by mark it (also audited in admin_audit_logs).
-- * The size-per-product and SKU uniqueness now apply to live variants only, so the same size can
--   be added again later and an SKU reused.

ALTER TABLE product_variants
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES admin_users(id) ON DELETE SET NULL;

ALTER TABLE product_variants
  ADD CONSTRAINT ck_variants_archived_empty
  CHECK (archived_at IS NULL OR (NOT is_active AND stock_on_hand = 0 AND stock_reserved = 0));

ALTER TABLE product_variants DROP CONSTRAINT product_variants_product_id_size_id_key;
ALTER TABLE product_variants DROP CONSTRAINT product_variants_sku_key;
CREATE UNIQUE INDEX ux_variants_product_size_live
  ON product_variants (product_id, size_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX ux_variants_sku_live
  ON product_variants (sku) WHERE archived_at IS NULL;

COMMENT ON COLUMN product_variants.archived_at IS
  'Deleted (archived) size: inactive, zero stock, hidden; ledger/orders/returns keep the row.';
