-- Parsed scenario details (minimap PNG + analysis JSON). Safe to re-run on production.

ALTER TABLE scenarios ADD COLUMN analysis_json TEXT NULL;
ALTER TABLE scenarios ADD COLUMN minimap_r2_key TEXT NULL;
ALTER TABLE scenarios ADD COLUMN parsed_at TEXT NULL;
ALTER TABLE scenarios ADD COLUMN parser_version TEXT NULL;

CREATE INDEX IF NOT EXISTS scenarios_parsed_at_idx ON scenarios(parsed_at);
