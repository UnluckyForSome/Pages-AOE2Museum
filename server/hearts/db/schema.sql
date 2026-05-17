CREATE TABLE IF NOT EXISTS hearts (
    user_id TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('scenario', 'campaign')),
    target_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS hearts_target_idx ON hearts(target_kind, target_id);
