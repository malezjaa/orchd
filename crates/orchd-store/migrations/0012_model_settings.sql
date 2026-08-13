-- Keep model defaults in the same single-owner settings row as the rest of
-- the application preferences. Existing installations receive these columns
-- through this additive migration.
ALTER TABLE settings ADD COLUMN model TEXT;
ALTER TABLE settings ADD COLUMN reasoning_effort TEXT;
