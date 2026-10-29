-- 0016: a video is PLAYABLE before it is fully processed (decision 29 Oct 2026).
--
-- [CONFIRMED] processing_status keeps its meaning: 'ready' = every rendition is complete. The new
-- column playable_at is a separate fact: the poster, the grid preview and the smallest rendition
-- exist, so the storefront may already show the video with the renditions that exist. The worker
-- appends the other sizes as they finish and sets 'ready' last.
-- * playable_at stays set when a later rendition fails or a retry starts (the video keeps playing
--   with what exists; processing_error carries the warning shown in the admin).
-- * Images and every asset that was already 'ready' are playable from the time they were uploaded.

ALTER TABLE media_assets ADD COLUMN playable_at timestamptz;

UPDATE media_assets
SET playable_at = COALESCE(uploaded_at, created_at)
WHERE processing_status = 'ready';
