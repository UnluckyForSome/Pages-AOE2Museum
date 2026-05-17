CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uploader_id TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL UNIQUE,
    display_title TEXT NOT NULL,
    ext TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    r2_key TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public',
    hearts_count INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS campaigns_uploader_id_idx ON campaigns(uploader_id);
CREATE INDEX IF NOT EXISTS campaigns_visibility_idx ON campaigns(visibility);

CREATE TABLE IF NOT EXISTS campaign_scenarios (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    scenario_id INTEGER NOT NULL UNIQUE REFERENCES scenarios(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, scenario_id)
);
CREATE INDEX IF NOT EXISTS campaign_scenarios_campaign_id_idx ON campaign_scenarios(campaign_id);

CREATE TABLE IF NOT EXISTS campaign_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS campaign_versions_campaign_id_idx ON campaign_versions(campaign_id);
