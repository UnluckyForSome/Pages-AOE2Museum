-- Tombstone keys deleted via the website so batch reconcile cannot resurrect them.

CREATE TABLE IF NOT EXISTS deleted_r2_keys (
    r2_key TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS deleted_r2_keys_deleted_at_idx ON deleted_r2_keys(deleted_at);
