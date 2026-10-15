-- 0005 - Storefront catalog indexes (Phase 4). Indexes only; no data changes.
-- Applied by `pnpm db:migrate` inside a transaction (no BEGIN/COMMIT here).
-- Search already uses the pg_trgm GIN indexes from schema_v2 (products.name / search_keywords,
-- clothing_types.search_keywords, clothing_type_translations.name).

-- Sort orders of GET /api/v1/catalog/products (only active products are listed).
CREATE INDEX ix_products_active_newest ON products (created_at DESC, id) WHERE status = 'active';
CREATE INDEX ix_products_active_price  ON products (price_minor, id)      WHERE status = 'active';
CREATE INDEX ix_products_active_name   ON products (name, id)             WHERE status = 'active';
