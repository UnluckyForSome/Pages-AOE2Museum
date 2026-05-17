-- Flatten parsed scenario analysis into typed columns. Safe to re-run on production.

ALTER TABLE scenarios ADD COLUMN edition TEXT NULL;
ALTER TABLE scenarios ADD COLUMN container_format TEXT NULL;
ALTER TABLE scenarios ADD COLUMN data_version REAL NULL;
ALTER TABLE scenarios ADD COLUMN is_definitive_edition INTEGER NULL;
ALTER TABLE scenarios ADD COLUMN detection_reason TEXT NULL;
ALTER TABLE scenarios ADD COLUMN parse_backend TEXT NULL;
ALTER TABLE scenarios ADD COLUMN game_version TEXT NULL;
ALTER TABLE scenarios ADD COLUMN scenario_version TEXT NULL;

ALTER TABLE scenarios ADD COLUMN map_dimension INTEGER NULL;
ALTER TABLE scenarios ADD COLUMN tile_count INTEGER NULL;
ALTER TABLE scenarios ADD COLUMN player_slots INTEGER NULL;
ALTER TABLE scenarios ADD COLUMN active_player_count INTEGER NULL;
ALTER TABLE scenarios ADD COLUMN player_object_count INTEGER NULL;
ALTER TABLE scenarios ADD COLUMN gaia_object_count INTEGER NULL;
ALTER TABLE scenarios ADD COLUMN trigger_count INTEGER NULL;

ALTER TABLE scenarios ADD COLUMN scenario_title TEXT NULL;
ALTER TABLE scenarios ADD COLUMN scenario_instructions TEXT NULL;
ALTER TABLE scenarios ADD COLUMN scenario_hints TEXT NULL;
ALTER TABLE scenarios ADD COLUMN scenario_scout TEXT NULL;

ALTER TABLE scenarios ADD COLUMN players_json TEXT NULL;
