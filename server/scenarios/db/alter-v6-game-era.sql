-- Game era for browse table (aok | aoc | hd | de). Set at parse/backfill from data_version + container_format.

ALTER TABLE scenarios ADD COLUMN game_era TEXT NULL;

CREATE INDEX IF NOT EXISTS scenarios_game_era_idx ON scenarios(game_era);
