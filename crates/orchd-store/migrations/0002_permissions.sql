-- Audit trail for permission requests: one row per `PermissionRequest`,
-- updated in place when it's resolved (auto or human).
CREATE TABLE IF NOT EXISTS approvals (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    request             TEXT NOT NULL,
    status              TEXT NOT NULL,
    created_at          INTEGER NOT NULL,
    decided_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_approvals_session ON approvals(session_id);

-- One row per session: the ordered allow/deny rule list, reloaded when a
-- session actor starts so `AllowAlways` grants survive an actor restart.
CREATE TABLE IF NOT EXISTS policies (
    session_id          TEXT PRIMARY KEY,
    rules               TEXT NOT NULL,
    updated_at          INTEGER NOT NULL
);
