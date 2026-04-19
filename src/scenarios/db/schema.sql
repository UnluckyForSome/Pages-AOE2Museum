-- Scenarios archive schema. The production D1 database
-- (94e77071-f016-4073-9c1a-c9012424b48d, binding `DB`) is already populated
-- from the previous standalone `scenarios` Worker, so running this on
-- production would wipe ~3.9k rows. Re-run only on a fresh database.

DROP TABLE IF EXISTS scenarios;

CREATE TABLE scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    filetype TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    downloads INTEGER NOT NULL DEFAULT 0,
    r2_key TEXT NOT NULL
);
