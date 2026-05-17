import type { ScenariosEnv } from "../env";

import { getUserOrNull } from "../../auth/services/session";

import type { AuthEnv } from "../../auth/env";

import { isAdmin } from "../../auth/services/admin";

import { displayTitleFromFilename } from "../services/filenames";
import { PARSER_VERSION } from "./details";

import { GAME_ERA_LIST_SQL } from "../services/game-era";

const LIST_SELECT = `s.id, s.filename, s.original_filename, s.filetype, s.size,
            s.uploaded_at, s.downloads, s.visibility, s.hearts_count, s.kind,
            s.campaign_id, s.uploader_id, s.parsed_at, s.scenario_title,
            ${GAME_ERA_LIST_SQL} AS game_era,
            u.username AS uploader_username,
            c.visibility AS campaign_visibility`;

const FULL_LIST_SQL = `SELECT ${LIST_SELECT}
     FROM scenarios s
     LEFT JOIN "user" u ON s.uploader_id = u.id
     LEFT JOIN campaigns c ON s.campaign_id = c.id
     ORDER BY s.uploaded_at DESC`;

const UNPARSED_LIST_SQL = `SELECT ${LIST_SELECT}
     FROM scenarios s
     LEFT JOIN "user" u ON s.uploader_id = u.id
     LEFT JOIN campaigns c ON s.campaign_id = c.id
     WHERE s.parsed_at IS NULL
     ORDER BY s.uploaded_at DESC`;

const UNPARSED_LEGACY_SQL = `SELECT ${LIST_SELECT}
     FROM scenarios s
     LEFT JOIN "user" u ON s.uploader_id = u.id
     LEFT JOIN campaigns c ON s.campaign_id = c.id
     WHERE s.parsed_at IS NULL AND s.uploader_id IS NULL
     ORDER BY s.uploaded_at DESC`;

const STALE_LIST_SQL = `SELECT ${LIST_SELECT}
     FROM scenarios s
     LEFT JOIN "user" u ON s.uploader_id = u.id
     LEFT JOIN campaigns c ON s.campaign_id = c.id
     WHERE s.parsed_at IS NOT NULL
       AND (s.parser_version IS NULL OR s.parser_version != ?)
     ORDER BY s.uploaded_at DESC`;

const LEGACY_LIST_SQL = `SELECT id, filename, original_filename, filetype, size,
            uploaded_at, downloads
     FROM scenarios
     ORDER BY uploaded_at DESC`;

type FullRow = {
  id: number;
  filename: string;
  original_filename: string;
  filetype: string;
  size: number;
  uploaded_at: string;
  downloads: number;
  visibility: string;
  hearts_count: number;
  kind: string;
  campaign_id: number | null;
  uploader_id: string | null;
  uploader_username: string | null;
  campaign_visibility: string | null;
  parsed_at: string | null;
  scenario_title: string | null;
  game_era: string | null;
};

type LegacyRow = {
  id: number;
  filename: string;
  original_filename: string;
  filetype: string;
  size: number;
  uploaded_at: string;
  downloads: number;
};

function displayName(row: FullRow): string {
  const title = row.scenario_title?.trim();
  if (title) return title;
  return displayTitleFromFilename(row.original_filename || row.filename) || "—";
}

function canViewRow(
  row: FullRow,
  viewerId: string | null,
  viewerIsAdmin: boolean,
): boolean {
  const isOwner = Boolean(viewerId && row.uploader_id === viewerId);
  if (isOwner || viewerIsAdmin) return true;
  if (row.kind === "campaign_mirror") {
    if (row.campaign_visibility === "hidden") return false;
    return true;
  }
  return row.visibility !== "hidden";
}

function mapFullRow(row: FullRow, viewerId: string | null) {
  return {
    id: row.id,
    filename: row.filename,
    original_filename: row.original_filename,
    display_name: displayName(row),
    filetype: row.filetype,
    size: row.size,
    uploaded_at: row.uploaded_at,
    downloads: row.downloads,
    hearts_count: row.hearts_count,
    kind: row.kind,
    campaign_id: row.campaign_id,
    visibility: row.visibility,
    uploader:
      row.uploader_id == null
        ? "Legacy"
        : row.uploader_username ?? "Unknown",
    uploader_id: row.uploader_id,
    is_owner: Boolean(viewerId && row.uploader_id === viewerId),
    has_details: Boolean(row.parsed_at),
    game_era: row.game_era,
  };
}

export async function handleList(
  request: Request,
  env: ScenariosEnv & AuthEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const unparsedOnly = url.searchParams.get("unparsed") === "true";
  const staleOnly = url.searchParams.get("stale") === "true";
  const legacyOnly = url.searchParams.get("legacy") === "true";
  const limitParam = url.searchParams.get("limit");
  const limit =
    limitParam != null && /^\d+$/.test(limitParam)
      ? Math.min(500, Math.max(1, parseInt(limitParam, 10)))
      : null;

  const viewer = await getUserOrNull(request, env);
  const viewerId = viewer?.id ?? null;
  const viewerIsAdmin = viewer ? isAdmin(env, viewer) : false;

  let results: FullRow[] | LegacyRow[] | undefined;
  let legacy = false;

  try {
    let sql = FULL_LIST_SQL;
    let bind: unknown[] = [];
    if (staleOnly) {
      sql = STALE_LIST_SQL;
      bind = [PARSER_VERSION];
    } else if (unparsedOnly) {
      sql = legacyOnly ? UNPARSED_LEGACY_SQL : UNPARSED_LIST_SQL;
    }

    const stmt = env.DB.prepare(sql);
    const out =
      bind.length > 0
        ? await stmt.bind(...bind).all<FullRow>()
        : await stmt.all<FullRow>();

    results = out.results ?? [];
  } catch (err) {
    if (unparsedOnly || staleOnly) {
      console.warn("[scenarios] filtered list failed:", err);
      return Response.json(
        { error: "List filter requires db:migrate:scenarios:v3" },
        { status: 503 },
      );
    }
    console.warn("[scenarios] full list query failed, using legacy schema:", err);
    legacy = true;
    const out = await env.DB.prepare(LEGACY_LIST_SQL).all<LegacyRow>();
    results = out.results ?? [];
  }

  if (legacy) {
    let mapped = (results as LegacyRow[]).map((row) => ({
      id: row.id,
      filename: row.filename,
      original_filename: row.original_filename,
      display_name: displayTitleFromFilename(row.original_filename || row.filename) || "—",
      filetype: row.filetype,
      size: row.size,
      uploaded_at: row.uploaded_at,
      downloads: row.downloads,
      hearts_count: 0,
      kind: "standalone" as const,
      campaign_id: null,
      visibility: "public",
      uploader: "Legacy",
      uploader_id: null,
      is_owner: false,
      has_details: false,
      game_era: null,
    }));
    if (limit != null) mapped = mapped.slice(0, limit);
    return Response.json(mapped);
  }

  const fullRows = results as FullRow[];
  const filtered = fullRows.filter((row) => canViewRow(row, viewerId, viewerIsAdmin));

  let mapped = filtered.map((row) => mapFullRow(row, viewerId));
  if (limit != null) mapped = mapped.slice(0, limit);

  return Response.json(mapped);
}
