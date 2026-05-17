/**
 * Maps parsed scenario analysis JSON (camelCase, Pyodide) ↔ D1 flattened columns.
 */

import { deriveGameEra } from "./game-era";

export type AnalysisColumnBindings = {
  edition: string | null;
  container_format: string | null;
  data_version: number | null;
  is_definitive_edition: number | null;
  game_era: string | null;
  detection_reason: string | null;
  parse_backend: string | null;
  game_version: string | null;
  scenario_version: string | null;
  map_dimension: number | null;
  tile_count: number | null;
  player_slots: number | null;
  active_player_count: number | null;
  player_object_count: number | null;
  gaia_object_count: number | null;
  trigger_count: number | null;
  scenario_title: string | null;
  scenario_instructions: string | null;
  scenario_hints: string | null;
  scenario_scout: string | null;
  players_json: string | null;
};

export type ScenarioAnalysisRow = AnalysisColumnBindings & {
  analysis_json: string | null;
  parsed_at: string | null;
  parser_version: string | null;
};

function str(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const t = val.trim();
  return t.length > 0 ? t : null;
}

function int(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function real(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function normalizeDataVersion(n: number): number {
  return Math.round(n * 100) / 100;
}

function bool01(val: unknown): number | null {
  if (val === true || val === 1) return 1;
  if (val === false || val === 0) return 0;
  return null;
}

function objectivesText(
  analysis: Record<string, unknown>,
  key: "instructions" | "hints" | "scout",
): string | null {
  const objectives = analysis.objectives;
  if (!objectives || typeof objectives !== "object") return null;
  return str((objectives as Record<string, unknown>)[key]);
}

export function analysisObjToColumnBindings(
  analysis: Record<string, unknown>,
): AnalysisColumnBindings {
  const players = analysis.players;
  const edition = str(analysis.edition);
  const container_format = str(analysis.containerFormat);
  const rawDataVersion = real(analysis.dataVersion);
  const data_version =
    rawDataVersion != null ? normalizeDataVersion(rawDataVersion) : null;
  const is_definitive_edition = bool01(analysis.isDefinitiveEdition);
  return {
    edition,
    container_format,
    data_version,
    is_definitive_edition,
    game_era: deriveGameEra({
      container_format,
      data_version,
      is_definitive_edition,
    }),
    detection_reason: str(analysis.detectionReason),
    parse_backend: str(analysis.parseBackend),
    game_version: str(analysis.gameVersion),
    scenario_version: str(analysis.scenarioVersion),
    map_dimension: int(analysis.mapDimension),
    tile_count: int(analysis.tileCount),
    player_slots: int(analysis.playerSlots),
    active_player_count: int(analysis.activePlayerCount),
    player_object_count: int(analysis.playerObjectCount),
    gaia_object_count: int(analysis.gaiaObjectCount),
    trigger_count: int(analysis.triggerCount),
    scenario_title: str(analysis.scenarioTitle),
    scenario_instructions: objectivesText(analysis, "instructions"),
    scenario_hints: objectivesText(analysis, "hints"),
    scenario_scout: objectivesText(analysis, "scout"),
    players_json: Array.isArray(players) ? JSON.stringify(players) : null,
  };
}

function buildObjectives(
  row: AnalysisColumnBindings,
): Record<string, string> | undefined {
  const objectives: Record<string, string> = {};
  if (row.scenario_instructions) objectives.instructions = row.scenario_instructions;
  if (row.scenario_hints) objectives.hints = row.scenario_hints;
  if (row.scenario_scout) objectives.scout = row.scenario_scout;
  return Object.keys(objectives).length > 0 ? objectives : undefined;
}

export function rowColumnsToAnalysis(
  row: AnalysisColumnBindings,
): Record<string, unknown> {
  const analysis: Record<string, unknown> = {};

  if (row.edition != null) analysis.edition = row.edition;
  if (row.container_format != null) analysis.containerFormat = row.container_format;
  if (row.data_version != null) analysis.dataVersion = row.data_version;
  if (row.is_definitive_edition != null) {
    analysis.isDefinitiveEdition = row.is_definitive_edition === 1;
  }
  const game_era =
    row.game_era ??
    deriveGameEra({
      container_format: row.container_format,
      data_version: row.data_version,
      is_definitive_edition: row.is_definitive_edition,
    });
  if (game_era) analysis.gameEra = game_era;
  if (row.detection_reason != null) analysis.detectionReason = row.detection_reason;
  if (row.parse_backend != null) analysis.parseBackend = row.parse_backend;
  if (row.game_version != null) analysis.gameVersion = row.game_version;
  if (row.scenario_version != null) analysis.scenarioVersion = row.scenario_version;

  if (row.map_dimension != null) analysis.mapDimension = row.map_dimension;
  if (row.tile_count != null) analysis.tileCount = row.tile_count;
  if (row.player_slots != null) analysis.playerSlots = row.player_slots;
  if (row.active_player_count != null) {
    analysis.activePlayerCount = row.active_player_count;
  }
  if (row.player_object_count != null) {
    analysis.playerObjectCount = row.player_object_count;
  }
  if (row.gaia_object_count != null) analysis.gaiaObjectCount = row.gaia_object_count;
  if (row.trigger_count != null) analysis.triggerCount = row.trigger_count;
  if (row.scenario_title != null) analysis.scenarioTitle = row.scenario_title;

  if (row.players_json) {
    try {
      analysis.players = JSON.parse(row.players_json);
    } catch {
      analysis.players = [];
    }
  }

  const objectives = buildObjectives(row);
  if (objectives) analysis.objectives = objectives;

  return analysis;
}

export function rowUsesFlattenedColumns(
  row: Pick<ScenarioAnalysisRow, "parsed_at" | "parser_version">,
  currentParserVersion: string,
): boolean {
  return Boolean(
    row.parsed_at && row.parser_version === currentParserVersion,
  );
}
