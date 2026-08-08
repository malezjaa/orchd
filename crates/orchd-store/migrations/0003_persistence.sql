-- Phase 4: persistence & recovery hardening. `native_session_id` lets a
-- respawned actor resume the underlying agent CLI's own conversation state
-- (`claude --resume <id>`); `pgid` lets a fresh server boot find and kill
-- any subprocess a previous, now-dead `orchd` instance never reaped.
ALTER TABLE sessions ADD COLUMN native_session_id TEXT;
ALTER TABLE sessions ADD COLUMN pgid INTEGER;
