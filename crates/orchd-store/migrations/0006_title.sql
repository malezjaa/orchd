-- Session title, best-effort and adapter-dependent (CLAUDE.md addendum:
-- some agents name their own conversation, e.g. Claude Code's on-disk
-- transcript `ai-title` entries). NULL until the adapter reports one; the
-- UI falls back to the project/cwd until then.
ALTER TABLE sessions ADD COLUMN title TEXT;
