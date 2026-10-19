-- 0011: pending product media replacements (admin simplification, 19 Oct 2026).
--
-- [CONFIRMED 19 Oct 2026] When an admin replaces a product's LIVE video or images with media
-- that is still processing, the old media stays live. The new asset ids are stored here and the
-- media worker swaps them in atomically once every asset is ready (old media retired, audit row
-- written in the requesting admin's name). If processing fails the row stays, nothing is
-- retired and the product keeps working; the admin can retry the failed asset.
-- New products, or slots without live media, attach immediately and never use this table.
-- Purely additive: no existing table or column changes.

CREATE TABLE product_pending_media (
  product_id    uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  slot          text        NOT NULL CHECK (slot IN ('video', 'images')),
  -- Asset ids in display order (exactly one for the video slot).
  asset_ids     uuid[]      NOT NULL CHECK (cardinality(asset_ids) >= 1),
  requested_by  uuid        NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, slot),
  CHECK (slot <> 'video' OR cardinality(asset_ids) = 1)
);

-- The worker looks up pending rows by the asset that just became ready.
CREATE INDEX ix_product_pending_media_assets ON product_pending_media USING gin (asset_ids);

COMMENT ON TABLE product_pending_media IS
  'One pending media replacement per product slot; applied by the media worker when all assets are ready.';
