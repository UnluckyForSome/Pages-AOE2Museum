-- Additive migration for existing scenarios table. Run once on production.
-- Existing rows keep uploader_id NULL (displayed as "Uploader: Legacy").

ALTER TABLE scenarios ADD COLUMN uploader_id TEXT NULL;
ALTER TABLE scenarios ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE scenarios ADD COLUMN hearts_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scenarios ADD COLUMN kind TEXT NOT NULL DEFAULT 'standalone';
ALTER TABLE scenarios ADD COLUMN campaign_id INTEGER NULL;

CREATE INDEX IF NOT EXISTS scenarios_uploader_id_idx ON scenarios(uploader_id);
CREATE INDEX IF NOT EXISTS scenarios_kind_idx ON scenarios(kind);
CREATE INDEX IF NOT EXISTS scenarios_campaign_id_idx ON scenarios(campaign_id);
CREATE INDEX IF NOT EXISTS scenarios_visibility_idx ON scenarios(visibility);
