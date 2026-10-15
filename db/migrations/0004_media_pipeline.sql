-- 0004 - Media pipeline (Phase 3): direct-to-storage uploads, processing worker, purge.
-- Applied by `pnpm db:migrate` inside a transaction (no BEGIN/COMMIT here). Additive only.

-- Upload lifecycle: pending (URL issued) -> uploaded (object verified, queued) -> processing ->
-- ready | failed. 'uploaded' is new.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_processing_status_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_processing_status_check
  CHECK (processing_status IN ('pending','uploaded','processing','ready','failed'));

ALTER TABLE media_assets
  ADD COLUMN original_filename     text,          -- sanitised, display only (never used in keys)
  ADD COLUMN upload_expires_at     timestamptz,   -- presigned URL expiry
  ADD COLUMN uploaded_at           timestamptz,   -- object verified by /complete
  ADD COLUMN processing_attempts   int NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
  ADD COLUMN next_attempt_at       timestamptz,   -- worker backoff
  ADD COLUMN processing_started_at timestamptz,   -- worker lease (stale leases are reclaimed)
  ADD COLUMN processing_error      text,
  ADD COLUMN dominant_color        text CHECK (dominant_color IS NULL OR dominant_color ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN purged_at             timestamptz,   -- storage objects deleted; row kept for history
  ADD CONSTRAINT ck_media_purged_only_retired CHECK (purged_at IS NULL OR retired_at IS NOT NULL);

-- Worker queue: claim with FOR UPDATE SKIP LOCKED.
CREATE INDEX ix_media_processing_queue ON media_assets (next_attempt_at NULLS FIRST, created_at)
  WHERE processing_status = 'uploaded';
CREATE INDEX ix_media_processing_lease ON media_assets (processing_started_at)
  WHERE processing_status = 'processing';

-- [TEAM DESIGN] media limits and processing settings (video upload limits/formats are an open team
-- decision). Changeable from the admin settings API; the code never hard-codes them.
INSERT INTO app_settings (setting_key, value, description) VALUES
  ('media.max_video_bytes',          '524288000',          '[TEAM DESIGN] largest accepted video upload, bytes (500 MB)'),
  ('media.max_image_bytes',          '20971520',           '[TEAM DESIGN] largest accepted image upload, bytes (20 MB)'),
  ('media.upload_url_ttl_seconds',   '900',                'Lifetime of a presigned upload URL'),
  ('media.private_url_ttl_seconds',  '300',                'Lifetime of a signed URL for private media (e.g. return evidence)'),
  ('media.processing_max_attempts',  '3',                  'Processing attempts before an asset is marked failed'),
  ('media.processing_backoff_seconds','60',                'Base retry delay; doubles after each failed attempt'),
  ('media.processing_lease_seconds', '900',                'A processing job older than this is considered abandoned and retried'),
  ('media.video_heights',            '[480, 720, 1080]',   '[TEAM DESIGN] MP4 rendition heights (never upscaled)'),
  ('media.preview_seconds',          '6',                  '[TEAM DESIGN] length of the muted grid preview loop'),
  ('media.image_widths',             '[320, 640, 1280, 1920]', '[TEAM DESIGN] WebP variant widths (never upscaled)')
ON CONFLICT (setting_key) DO NOTHING;
