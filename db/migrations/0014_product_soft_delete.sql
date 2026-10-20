-- 0014: product deletion = soft delete (tester fixes, 20 Oct 2026).
--
-- [CONFIRMED 20 Oct 2026] Products are never physically deleted: order items, snapshots,
-- payments, returns, stock ledger rows and Blueprint decisions keep referencing them. A deleted
-- product disappears from the shop, catalogue, search, admin lists and pickers.
-- * deleted_at / deleted_by mark the deletion (audited in admin_audit_logs as well).
-- * The slug becomes unique among LIVE products only, so a deleted product's slug can be reused.
-- * A deleted product is always 'archived', so every existing status filter hides it too.

ALTER TABLE products
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN deleted_by uuid REFERENCES admin_users(id) ON DELETE SET NULL;

ALTER TABLE products
  ADD CONSTRAINT ck_products_deleted_archived CHECK (deleted_at IS NULL OR status = 'archived');

-- Replace the global unique slug with a partial unique index over live products.
ALTER TABLE products DROP CONSTRAINT products_slug_key;
CREATE UNIQUE INDEX ux_products_slug_live ON products (slug) WHERE deleted_at IS NULL;

COMMENT ON COLUMN products.deleted_at IS
  'Soft delete: hidden everywhere; history (orders, ledger, returns, Blueprint) keeps the row.';
