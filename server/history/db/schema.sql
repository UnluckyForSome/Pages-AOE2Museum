CREATE TABLE IF NOT EXISTS generation_history (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('minimap', 'gif')),
    source_filename TEXT NOT NULL,
    settings_json TEXT NOT NULL DEFAULT '{}',
    r2_key TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS generation_history_user_kind_idx ON generation_history(user_id, kind, created_at);
CREATE INDEX IF NOT EXISTS generation_history_visibility_idx ON generation_history(visibility);
