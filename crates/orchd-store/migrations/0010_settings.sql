-- orchd is single-owner (CLAUDE.md §8), so app-wide settings live in one
-- fixed row (id = 1) rather than being keyed per tenant/device. Columns are
-- nullable so an unset setting falls back to the client's own default
-- instead of needing a migration every time a new default is picked.
CREATE TABLE IF NOT EXISTS settings (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    interface_font      TEXT,
    interface_font_size TEXT,
    mono_font           TEXT,
    mono_font_size      TEXT,
    time_format         TEXT,
    code_theme          TEXT,
    updated_at          INTEGER NOT NULL
);
