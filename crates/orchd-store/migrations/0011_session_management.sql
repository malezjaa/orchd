-- Session-level metadata used by the sidebar and session header actions.
-- NULL means a session is not pinned.
ALTER TABLE sessions ADD COLUMN pinned_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_sessions_pinned
  ON sessions(pinned_at, created_at);
