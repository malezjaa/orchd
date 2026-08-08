CREATE TABLE IF NOT EXISTS sessions (
    id                  TEXT PRIMARY KEY,
    agent_kind          TEXT NOT NULL,
    cwd                 TEXT NOT NULL,
    status              TEXT NOT NULL,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);

-- Append-only transcript: the source of truth for replay and reconnection.
-- (session_id, seq) is assigned by the single-writer session actor, so it
-- is always gap-free and strictly increasing per session.
CREATE TABLE IF NOT EXISTS events (
    session_id          TEXT NOT NULL,
    seq                 INTEGER NOT NULL,
    ts                  INTEGER NOT NULL,
    turn                TEXT NOT NULL,
    payload             TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
);
