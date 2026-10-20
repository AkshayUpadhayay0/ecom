-- 0013: content editor by content type (tester fixes, 20 Oct 2026). Additive.
--
-- * content_blocks.content_kind decides the admin editor: 'video' (home.hero: choose / upload the
--   hero video, unchanged behaviour) or 'text' (footer and policies: plain-text title + body,
--   English only; approved Pidgin copy is applied by developers).
-- * Makes sure the five public blocks exist.
-- * Untouched seed placeholders ("Content pending from client.") become empty, so the admin page
--   and the public API show "Pending client content" instead of serving placeholder copy as if
--   it were real. Real text never matches the exact seed placeholder and is left alone.
-- No copy is invented here.

ALTER TABLE content_blocks
  ADD COLUMN content_kind text NOT NULL DEFAULT 'text'
  CHECK (content_kind IN ('text', 'video'));

COMMENT ON COLUMN content_blocks.content_kind IS
  'Admin editor: video (hero media) or text (plain-text title/body, English). Data, not code.';

INSERT INTO content_blocks (block_key, content_kind) VALUES
  ('home.hero', 'video'),
  ('footer.about', 'text'),
  ('policy.privacy', 'text'),
  ('policy.terms', 'text'),
  ('policy.returns', 'text')
ON CONFLICT (block_key) DO NOTHING;

UPDATE content_blocks SET content_kind = 'video' WHERE block_key = 'home.hero';

-- Seed placeholder (db/seed_v2.sql) -> pending (NULL), only where it was never edited.
UPDATE content_block_translations t
SET title = NULL, body = NULL
FROM content_blocks b
WHERE b.id = t.content_block_id
  AND b.content_kind = 'text'
  AND t.body = 'Content pending from client.'
  AND t.title = initcap(replace(b.block_key, '.', ' '));
