-- 0001 - Refresh-token rotation with reuse detection  [REC]
-- Each login starts a session "family". Every refresh revokes the presented row and inserts a
-- new row in the same family. Presenting an already-rotated token revokes the whole family.
-- Applied by `pnpm db:migrate` inside a transaction (no BEGIN/COMMIT here).

ALTER TABLE auth_sessions
  ADD COLUMN family_id      uuid,
  ADD COLUMN replaced_by    uuid REFERENCES auth_sessions(id),
  ADD COLUMN revoked_reason text CHECK (revoked_reason IN
               ('logout','rotated','reuse_detected','password_changed','password_reset','admin')),
  ADD COLUMN last_used_at   timestamptz;

UPDATE auth_sessions SET family_id = id WHERE family_id IS NULL;
ALTER TABLE auth_sessions ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX ix_auth_sessions_family ON auth_sessions (family_id) WHERE revoked_at IS NULL;
