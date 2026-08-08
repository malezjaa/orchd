-- Single-owner, multi-device auth (CLAUDE.md §8). Only token *hashes* are
-- ever persisted — the raw token is returned to the caller once, at
-- creation/exchange time, and never stored or logged again.

-- One-time, short-lived credentials exchanged for a client session. Minted
-- at daemon boot (pairs the first device) and on demand by an already
-- paired device (`POST /auth/pairing-tokens`, pairs additional devices).
CREATE TABLE IF NOT EXISTS pairing_tokens (
    token_hash          TEXT PRIMARY KEY,
    created_at          INTEGER NOT NULL,
    expires_at          INTEGER NOT NULL,
    used_at             INTEGER
);

-- A paired device. Long-lived relative to a pairing token, individually
-- labeled/revocable so one leaked or retired device doesn't require
-- rotating everyone else's access.
CREATE TABLE IF NOT EXISTS client_sessions (
    id                  TEXT PRIMARY KEY,
    token_hash          TEXT NOT NULL UNIQUE,
    device_label        TEXT,
    created_at          INTEGER NOT NULL,
    last_seen_at        INTEGER NOT NULL,
    expires_at          INTEGER NOT NULL,
    revoked_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_client_sessions_token_hash ON client_sessions(token_hash);

-- Short-lived, single-use tokens for attaching a WebSocket connection.
-- Browsers can't set custom headers on a WS upgrade request, so the
-- long-lived session bearer token/cookie is exchanged for one of these
-- instead of ever being placed in a socket URL.
CREATE TABLE IF NOT EXISTS ws_tickets (
    token_hash          TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL REFERENCES client_sessions(id),
    created_at          INTEGER NOT NULL,
    expires_at          INTEGER NOT NULL,
    used_at             INTEGER
);
