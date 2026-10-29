-- 0017: hard cap on video length (decision 29 Oct 2026).
--
-- [TEAM DESIGN] media.max_video_seconds: longest accepted video, enforced by the API/worker when the
-- file is probed (the API cannot know the length earlier). Editable by super_admin only (it is not in
-- ADMIN_EDITABLE_SETTING_KEYS). The size cap media.max_video_bytes already exists (migration 0004).
INSERT INTO app_settings (setting_key, value, description) VALUES
  ('media.max_video_seconds', '120', '[TEAM DESIGN] longest accepted video, seconds (2 minutes)')
ON CONFLICT (setting_key) DO NOTHING;
