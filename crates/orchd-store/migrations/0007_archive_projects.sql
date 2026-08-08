-- Archiving a project hides it (and, by extension, its sessions) from the
-- default project list without deleting anything — unlike `delete_project`,
-- which is rejected outright while sessions still reference it. NULL means
-- active; a project is archived by stamping the timestamp it happened at.
ALTER TABLE projects ADD COLUMN archived_at INTEGER;
