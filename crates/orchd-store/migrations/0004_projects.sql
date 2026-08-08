-- A project is a named folder on disk, registered once and reused across
-- many sessions, so a session's `cwd` is resolved from its project rather
-- than accepted as arbitrary freeform client input (CLAUDE.md §6).
CREATE TABLE IF NOT EXISTS projects (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    path                TEXT NOT NULL UNIQUE,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);

-- Nullable for backward compatibility with sessions created before
-- projects existed; every session created going forward always has one
-- (enforced in `SessionRegistry::create_session`, not at the schema
-- level, since SQLite can't add a NOT NULL column without a default to an
-- existing table).
ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
