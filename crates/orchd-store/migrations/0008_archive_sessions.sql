-- Mirrors 0007's project archiving: hides a session from the default list
-- without touching its lifecycle `status` or killing a still-running
-- process. NULL means active.
ALTER TABLE sessions ADD COLUMN archived_at INTEGER;
