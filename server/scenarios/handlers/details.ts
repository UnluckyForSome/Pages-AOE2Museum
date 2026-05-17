import type { Env } from "../../worker/env";
import type { AuthEnv } from "../../auth/env";
import { getUserOrNull } from "../../auth/services/session";
import { isAdmin } from "../../auth/services/admin";
import { json } from "../../http/json";
import {
  analysisObjToColumnBindings,
  rowColumnsToAnalysis,
  rowUsesFlattenedColumns,
  type AnalysisColumnBindings,
} from "../services/analysis-columns";
import { displayTitleFromFilename } from "../services/filenames";

export const PARSER_VERSION = "pyodide-mcminimap-v7";

export function scenarioMinimapKey(id: number | string): string {
  return `scenario/${id}.webp`;
}

function minimapContentType(r2Key: string): string {
  return r2Key.endsWith(".webp") ? "image/webp" : "image/png";
}

type ScenarioRow = {
  id: number;
  filename: string;
  original_filename: string;
  filetype: string;
  size: number;
  uploaded_at: string;
  downloads: number;
  hearts_count: number;
  kind: string;
  campaign_id: number | null;
  uploader_id: string | null;
  visibility: string;
  uploader_username: string | null;
  campaign_visibility: string | null;
  analysis_json: string | null;
  minimap_r2_key: string | null;
  parsed_at: string | null;
  parser_version: string | null;
} & AnalysisColumnBindings;

const SCENARIO_SELECT = `SELECT s.id, s.filename, s.original_filename, s.filetype, s.size,
  s.uploaded_at, s.downloads, s.hearts_count, s.kind, s.campaign_id, s.uploader_id,
  s.visibility, s.analysis_json, s.minimap_r2_key, s.parsed_at, s.parser_version,
  s.edition, s.container_format, s.data_version, s.is_definitive_edition, s.game_era,
  s.detection_reason, s.parse_backend, s.game_version, s.scenario_version,
  s.map_dimension, s.tile_count, s.player_slots, s.active_player_count,
  s.player_object_count, s.gaia_object_count, s.trigger_count,
  s.scenario_title, s.scenario_instructions, s.scenario_hints, s.scenario_scout,
  s.players_json,
  u.username AS uploader_username,
  c.visibility AS campaign_visibility
 FROM scenarios s
 LEFT JOIN "user" u ON s.uploader_id = u.id
 LEFT JOIN campaigns c ON s.campaign_id = c.id
 WHERE s.id = ?`;

function canViewScenario(
  row: ScenarioRow,
  viewerId: string | null,
  viewerIsAdmin: boolean,
): boolean {
  const isOwner = Boolean(viewerId && row.uploader_id === viewerId);
  if (isOwner || viewerIsAdmin) return true;
  if (row.kind === "campaign_mirror") {
    return row.campaign_visibility !== "hidden";
  }
  return row.visibility !== "hidden";
}

function mapUploader(row: ScenarioRow): string {
  if (row.uploader_id == null) return "AOE2M";
  return row.uploader_username ?? "Unknown";
}

function resolveScenarioTitle(
  row: ScenarioRow,
  analysis: Record<string, unknown> | null,
): string {
  const fromColumn = row.scenario_title?.trim();
  if (fromColumn) return fromColumn;

  if (rowUsesFlattenedColumns(row, PARSER_VERSION)) {
    return displayTitleFromFilename(row.original_filename || row.filename) || "—";
  }

  const fromAnalysis =
    typeof analysis?.scenarioTitle === "string" ? analysis.scenarioTitle.trim() : "";
  if (fromAnalysis) return fromAnalysis;

  return displayTitleFromFilename(row.original_filename || row.filename) || "—";
}

function resolveAnalysis(row: ScenarioRow): Record<string, unknown> | null {
  if (!row.parsed_at) return null;

  if (rowUsesFlattenedColumns(row, PARSER_VERSION)) {
    return rowColumnsToAnalysis(row);
  }

  if (!row.analysis_json) return null;
  try {
    return JSON.parse(row.analysis_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const FLATTENED_UPDATE_SET = `edition = ?, container_format = ?, data_version = ?,
  is_definitive_edition = ?, game_era = ?, detection_reason = ?, parse_backend = ?, game_version = ?,
  scenario_version = ?, map_dimension = ?, tile_count = ?, player_slots = ?,
  active_player_count = ?, player_object_count = ?, gaia_object_count = ?,
  trigger_count = ?, scenario_title = ?, scenario_instructions = ?, scenario_hints = ?,
  scenario_scout = ?, players_json = ?`;

export async function handleScenarioDetails(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const viewer = await getUserOrNull(request, env);
  const viewerId = viewer?.id ?? null;
  const viewerIsAdmin = viewer ? isAdmin(env, viewer) : false;

  let row: ScenarioRow | null;
  try {
    row = await env.DB.prepare(SCENARIO_SELECT)
      .bind(id)
      .first<ScenarioRow>();
  } catch (err) {
    console.warn("[scenarios] details query failed (v4 columns missing?):", err);
    return json(
      { error: "Scenario details unavailable. Run db:migrate:scenarios:v4." },
      { status: 503 },
    );
  }

  if (!row) {
    return json({ error: "Scenario not found" }, { status: 404 });
  }

  if (!canViewScenario(row, viewerId, viewerIsAdmin)) {
    return json({ error: "Scenario not found" }, { status: 404 });
  }

  const parsed = Boolean(row.parsed_at && (row.analysis_json || rowUsesFlattenedColumns(row, PARSER_VERSION)));
  const analysis = parsed ? resolveAnalysis(row) : null;

  const minimapUrl = parsed
    ? `/api/scenarios/${row.id}/minimap.png`
    : null;

  let viewerHearted = false;
  if (viewerId) {
    let heartKind: "scenario" | "campaign" = "scenario";
    let heartTargetId = row.id;
    if (row.kind === "campaign_mirror" && row.campaign_id) {
      heartKind = "campaign";
      heartTargetId = row.campaign_id;
    }
    const heartRow = await env.DB.prepare(
      "SELECT 1 FROM hearts WHERE user_id = ? AND target_kind = ? AND target_id = ?",
    )
      .bind(viewerId, heartKind, heartTargetId)
      .first();
    viewerHearted = Boolean(heartRow);
  }

  return json({
    id: row.id,
    title: resolveScenarioTitle(row, analysis),
    filename: row.filename,
    original_filename: row.original_filename,
    filetype: row.filetype,
    size: row.size,
    uploaded_at: row.uploaded_at,
    downloads: row.downloads,
    hearts_count: row.hearts_count,
    kind: row.kind,
    campaign_id: row.campaign_id,
    uploader: mapUploader(row),
    uploader_id: row.uploader_id,
    is_owner: Boolean(viewerId && row.uploader_id === viewerId),
    viewer_hearted: viewerHearted,
    parsed,
    analysis,
    minimap_url: minimapUrl,
    parsed_at: row.parsed_at,
  });
}

export async function handleScenarioMinimap(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const viewer = await getUserOrNull(request, env);
  const viewerId = viewer?.id ?? null;
  const viewerIsAdmin = viewer ? isAdmin(env, viewer) : false;

  let row: ScenarioRow | null;
  try {
    row = await env.DB.prepare(SCENARIO_SELECT)
      .bind(id)
      .first<ScenarioRow>();
  } catch {
    return new Response("Not found", { status: 404 });
  }

  if (!row || !canViewScenario(row, viewerId, viewerIsAdmin)) {
    return new Response("Not found", { status: 404 });
  }

  if (!row.parsed_at || !row.minimap_r2_key) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.MINIMAPS.get(row.minimap_r2_key!);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", minimapContentType(row.minimap_r2_key!));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}

export async function handleScenarioDetailsPut(
  request: Request,
  env: Env & AuthEnv,
  id: string,
): Promise<Response> {
  const viewer = await getUserOrNull(request, env);
  if (!viewer || !isAdmin(env, viewer)) {
    return json({ error: "Admin required" }, { status: 403 });
  }

  const exists = await env.DB.prepare("SELECT id FROM scenarios WHERE id = ?")
    .bind(id)
    .first<{ id: number }>();
  if (!exists) {
    return json({ error: "Scenario not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const analysisRaw = formData.get("analysis");
  const minimapFile = formData.get("minimap");

  if (typeof analysisRaw !== "string" || !analysisRaw.trim()) {
    return json({ error: "Missing analysis JSON field" }, { status: 400 });
  }
  const minimapBlob = minimapFile as File | Blob | null;
  if (
    !minimapBlob ||
    typeof minimapBlob !== "object" ||
    typeof (minimapBlob as Blob).arrayBuffer !== "function" ||
    (minimapBlob as File).size === 0
  ) {
    return json({ error: "Missing minimap image field" }, { status: 400 });
  }

  let analysisObj: Record<string, unknown>;
  try {
    analysisObj = JSON.parse(analysisRaw) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid analysis JSON" }, { status: 400 });
  }

  const cols = analysisObjToColumnBindings(analysisObj);
  const minimapKey = scenarioMinimapKey(id);
  const imageBuffer = await (minimapBlob as Blob).arrayBuffer();
  const contentType =
    minimapKey.endsWith(".webp") ? "image/webp" : "image/png";

  await env.MINIMAPS.put(minimapKey, imageBuffer, {
    httpMetadata: { contentType },
  });

  const parsedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE scenarios SET analysis_json = ?, minimap_r2_key = ?, parsed_at = ?, parser_version = ?,
     ${FLATTENED_UPDATE_SET}
     WHERE id = ?`,
  )
    .bind(
      JSON.stringify(analysisObj),
      minimapKey,
      parsedAt,
      PARSER_VERSION,
      cols.edition,
      cols.container_format,
      cols.data_version,
      cols.is_definitive_edition,
      cols.game_era,
      cols.detection_reason,
      cols.parse_backend,
      cols.game_version,
      cols.scenario_version,
      cols.map_dimension,
      cols.tile_count,
      cols.player_slots,
      cols.active_player_count,
      cols.player_object_count,
      cols.gaia_object_count,
      cols.trigger_count,
      cols.scenario_title,
      cols.scenario_instructions,
      cols.scenario_hints,
      cols.scenario_scout,
      cols.players_json,
      id,
    )
    .run();

  return json({
    ok: true,
    id: Number(id),
    minimap_r2_key: minimapKey,
    parsed_at: parsedAt,
    parser_version: PARSER_VERSION,
  });
}
