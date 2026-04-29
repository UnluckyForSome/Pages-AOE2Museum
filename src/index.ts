import type { ScenariosEnv } from "./scenarios/env";
import { handleList } from "./scenarios/handlers/list";
import { handleUpload } from "./scenarios/handlers/upload";
import { handleDownload } from "./scenarios/handlers/download";
import { handleSync } from "./scenarios/handlers/sync";
import type { GifEnv } from "./gif/env";
import { routeGif } from "./gif/handlers";
import aocDataset from "../vendor/aoe2mcminimap/data/aoc_dataset_100.json";

export interface Env extends ScenariosEnv, GifEnv {
  ASSETS: Fetcher;
  MINIMAPS: R2Bucket;
  MINIMAP_INDEX: KVNamespace;
  AOCREC_ES_BASIC_AUTH: string;
}

interface GalleryEntry {
  id: string;
  sourceName: string;
  createdAt: number;
  bytes: number;
}

const INDEX_KEY = "index";
const MAX_ENTRIES = 20;
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const ID_RE = /^[a-f0-9]{32}$/;
const SOURCE_NAME_MAX = 256;

const AOCREC_ES_URL = "https://es1.aocrec.com/mgxhub1/_search";
const AOCREC_ZIP_HOST = "static1.aocrec.com";
const AOCREC_ZIP_PATH_RE = /^\/record\/[a-f0-9]{32}\.zip$/i;
const AOCREC_RECENT_TTL_S = 60; // cache list briefly to cut ES load
const AOCREC_ZIP_TTL_S = 6 * 60 * 60; // 6h cache to cut repeat zip fetches
const AOCREC_ZIP_MAX_BYTES = 25 * 1024 * 1024; // guardrail for Worker costs

const MS_COMMUNITY_API_BASE = "https://aoe-api.worldsedgelink.com";
const MS_PROFILE_SEARCH_TTL_S = 60;
const MS_RECENT_MATCHES_TTL_S = 60;
const MS_REPLAY_ZIP_TTL_S = 6 * 60 * 60;
const MS_REPLAY_ZIP_MAX_BYTES = 35 * 1024 * 1024;

const MS_QUERY_MIN = 2;
const MS_QUERY_MAX = 64;
const MS_RESULTS_MAX = 20;
const MS_MATCHES_MAX = 20;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function r2Key(id: string): string {
  return `minimap/${id}.png`;
}

async function readIndex(env: Env): Promise<GalleryEntry[]> {
  const raw = await env.MINIMAP_INDEX.get(INDEX_KEY, "json");
  return Array.isArray(raw) ? (raw as GalleryEntry[]) : [];
}

async function writeIndex(env: Env, entries: GalleryEntry[]): Promise<void> {
  await env.MINIMAP_INDEX.put(INDEX_KEY, JSON.stringify(entries));
}

function sanitizeSourceName(raw: string | null): string {
  if (!raw) return "unknown";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // fall through with the raw value
  }
  const cleaned = decoded.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!cleaned) return "unknown";
  return cleaned.length > SOURCE_NAME_MAX ? cleaned.slice(0, SOURCE_NAME_MAX) : cleaned;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanSearchQuery(raw: string | null): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length > MS_QUERY_MAX ? cleaned.slice(0, MS_QUERY_MAX) : cleaned;
}

// ---------- gallery handlers ---------------------------------------------

async function handleGalleryPost(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/png")) {
    return json({ error: "content-type must be image/png" }, { status: 415 });
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_PNG_BYTES) {
    return json({ error: "payload too large" }, { status: 413 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length === 0) return json({ error: "empty body" }, { status: 400 });
  if (body.length > MAX_PNG_BYTES) return json({ error: "payload too large" }, { status: 413 });
  if (
    body.length < 4 ||
    body[0] !== PNG_MAGIC[0] ||
    body[1] !== PNG_MAGIC[1] ||
    body[2] !== PNG_MAGIC[2] ||
    body[3] !== PNG_MAGIC[3]
  ) {
    return json({ error: "not a PNG" }, { status: 400 });
  }

  const id = newId();
  const sourceName = sanitizeSourceName(request.headers.get("x-source-name"));
  const entry: GalleryEntry = {
    id,
    sourceName,
    createdAt: Date.now(),
    bytes: body.length,
  };

  await env.MINIMAPS.put(r2Key(id), body, {
    httpMetadata: { contentType: "image/png" },
  });

  const current = await readIndex(env);
  const next = [entry, ...current].slice(0, MAX_ENTRIES);
  const evicted = [entry, ...current].slice(MAX_ENTRIES);
  await writeIndex(env, next);

  if (evicted.length > 0) {
    await Promise.all(
      evicted.map((e) => env.MINIMAPS.delete(r2Key(e.id)).catch(() => {})),
    );
  }

  return json({ id }, { status: 201 });
}

async function handleGalleryList(env: Env): Promise<Response> {
  const entries = await readIndex(env);
  return json(entries, { headers: { "cache-control": "no-store" } });
}

async function handleGalleryImage(id: string, env: Env): Promise<Response> {
  if (!ID_RE.test(id)) return new Response("not found", { status: 404 });
  const obj = await env.MINIMAPS.get(r2Key(id));
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", "image/png");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
}

// ---------- aocrec proxy -------------------------------------------------

type AocrecRecentItem = {
  id: string;
  guid?: string;
  uploadedAt?: string | number;
  gameDate?: string | number;
  durationMs?: number;
  ver?: string;
  matchup?: string;
  mapName?: string;
  uploadedBy?: string;
  players?: Array<{ name?: string; civ?: string }>;
  zipUrl?: string;
};

function aocrecZipUrlFromGuid(guid: string): string {
  return `https://${AOCREC_ZIP_HOST}/record/${guid}.zip`;
}

async function handleAocrecRecent(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const size = clampInt(Number(url.searchParams.get("size") || "20"), 1, 50);

  if (!env.AOCREC_ES_BASIC_AUTH || !env.AOCREC_ES_BASIC_AUTH.toLowerCase().startsWith("basic ")) {
    return json(
      { error: "AOCREC_ES_BASIC_AUTH is not configured" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  // Cache by URL (includes size). This endpoint is safe to cache since it
  // returns only public metadata, and we keep TTL short.
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const body = {
    from: 0,
    size,
    query: {
      bool: {
        must: [
          { range: { duration: { gte: 600000 } } },
          { bool: { must_not: { term: { include_ai: true } } } },
        ],
      },
    },
    sort: [
      // Prefer newest games (游戏日期) rather than newest uploads.
      { lastmod: "desc" },
      { created_at: "desc" },
      { duration: "desc" },
    ],
    collapse: { field: "guid" },
  };

  const res = await fetch(AOCREC_ES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // IMPORTANT: keep this server-side only.
      Authorization: env.AOCREC_ES_BASIC_AUTH,
      // Some origins are pickier without a UA/Referer; also helps debugging upstream logs.
      "user-agent": "aoe2museum/1.0 (+mcminimap aocrec proxy)",
      referer: "https://aocrec.com/",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return json(
      { error: `aocrec upstream error: HTTP ${res.status}` },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }

  const data = (await res.json()) as any;
  const hits = (data && data.hits && Array.isArray(data.hits.hits)) ? data.hits.hits : [];
  const items: AocrecRecentItem[] = hits.map((h: any) => {
    const src = (h && h._source) || {};
    const guid = typeof src.guid === "string" ? src.guid : "";
    const id = typeof h._id === "string" ? h._id : guid || crypto.randomUUID();
    const uploadedAt = src.created_at ?? null;
    // aocrec UI's 游戏日期 appears to align with `lastmod` (ms since epoch).
    const gameDate = src.lastmod ?? null;
    const durationMs = typeof src.duration === "number" ? src.duration : undefined;
    const mapName = typeof src.mapname === "string" ? src.mapname : undefined;
    const players = Array.isArray(src.players)
      ? src.players.map((p: any) => ({ name: p && p.name, civ: p && p.civ }))
      : undefined;
    const recorderIndex = typeof src.recorder === "number" ? src.recorder : null;
    const uploadedBy =
      recorderIndex != null && Array.isArray(src.players) && src.players[recorderIndex]
        ? (typeof src.players[recorderIndex].name === "string" ? src.players[recorderIndex].name : undefined)
        : undefined;
    return {
      id,
      guid: guid || undefined,
      uploadedAt: uploadedAt ?? undefined,
      gameDate: gameDate ?? undefined,
      durationMs,
      ver: typeof src.ver === "string" ? src.ver : undefined,
      matchup: typeof src.matchup === "string" ? src.matchup : undefined,
      mapName,
      uploadedBy,
      players,
      // Empirically, the downloadable zip key matches the ES hit _id, not `guid`.
      zipUrl: id ? aocrecZipUrlFromGuid(id) : undefined,
    };
  });

  const response = json(items, {
    headers: {
      "cache-control": `public, max-age=0, s-maxage=${AOCREC_RECENT_TTL_S}`,
    },
  });
  // Best-effort cache; if it fails we still return the live response.
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleAocrecZip(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get("url") || "";
  if (!raw) return json({ error: "missing url" }, { status: 400 });

  let upstream: URL;
  try {
    upstream = new URL(raw);
  } catch {
    return json({ error: "invalid url" }, { status: 400 });
  }

  if (upstream.protocol !== "https:" || upstream.hostname !== AOCREC_ZIP_HOST) {
    return json({ error: "url not allowed" }, { status: 403 });
  }
  if (!AOCREC_ZIP_PATH_RE.test(upstream.pathname)) {
    return json({ error: "url path not allowed" }, { status: 403 });
  }

  // Cache zips by upstream URL. This drastically reduces both aocrec load and
  // our egress when multiple users click the same recording.
  const cacheKey = new Request("https://aoe2museum.internal/aocreczip?u=" + encodeURIComponent(upstream.toString()));
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const res = await fetch(upstream.toString(), {
    cf: { cacheTtl: AOCREC_ZIP_TTL_S, cacheEverything: true } as any,
    headers: {
      "user-agent": "aoe2museum/1.0 (+mcminimap aocrec zip proxy)",
      referer: "https://aocrec.com/",
    },
  });
  if (!res.ok || !res.body) {
    return json({ error: `zip fetch failed: HTTP ${res.status}` }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("content-type", "application/zip");
  // Help browsers show some progress even if upstream lacks length.
  const len = res.headers.get("content-length");
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n > AOCREC_ZIP_MAX_BYTES) {
      return json({ error: "zip too large" }, { status: 413 });
    }
    headers.set("content-length", len);
  }
  headers.set("cache-control", `public, max-age=0, s-maxage=${AOCREC_ZIP_TTL_S}`);

  const out = new Response(res.body, { headers });
  // Cache the proxied response. Note: Cache API stores full body; that's OK
  // here because we cap size.
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// ---------- Microsoft (LibreMatch Community API) proxy --------------------

type MsProfile = {
  profileId: number;
  alias: string;
  platformName?: string;
  country?: string;
};

type MsRecentMatch = {
  matchId: number;
  startedAt: number;
  completedAt?: number;
  mapName?: string;
  maxPlayers?: number;
  matchTypeId?: number;
  matchup?: string;
  civilizationId?: number;
  civilizationName?: string;
};

function buildMsCivilizationNameByGameId(dataset: typeof aocDataset): Map<number, string> {
  const map = new Map<number, string>();
  const civs = (dataset as any)?.civilizations;
  if (!civs || typeof civs !== "object") return map;
  for (const k of Object.keys(civs)) {
    const entry = (civs as any)[k];
    const id = Number(entry?.id);
    const name = typeof entry?.name === "string" ? entry.name : "";
    if (!Number.isFinite(id) || id <= 0 || !name) continue;
    if (!map.has(id)) map.set(id, name);
  }
  return map;
}

const MS_CIV_NAME_BY_ID = buildMsCivilizationNameByGameId(aocDataset);

function msMatchupLabelFromReports(reports: Array<{ teamid?: unknown }>): string {
  if (!Array.isArray(reports) || reports.length === 0) return "";
  const n = reports.length;
  // Two-player games are almost always head-to-head; upstream sometimes reports both players on team `0`.
  if (n === 2) return "1v1";

  const teamCounts = new Map<number, number>();
  for (const r of reports) {
    const t = Number(r?.teamid);
    if (!Number.isFinite(t)) continue;
    teamCounts.set(t, (teamCounts.get(t) || 0) + 1);
  }
  if (teamCounts.size === 0) return "";
  const counts = Array.from(teamCounts.values());
  const uniqueTeams = teamCounts.size;
  const allSolo = counts.every((c) => c === 1);

  // 3+ players, nobody shares a team → FFA
  if (n >= 3 && allSolo) return "FFA";

  if (uniqueTeams === 2 && counts.length === 2) {
    const sorted = counts.slice().sort((a, b) => b - a);
    return `${sorted[0]}v${sorted[1]}`;
  }

  if (uniqueTeams >= 3) {
    return counts
      .slice()
      .sort((a, b) => b - a)
      .join("v");
  }

  if (uniqueTeams === 1 && n > 0) {
    return `${n} players`;
  }

  return "";
}

function msCivilizationForProfile(reports: unknown[], profileId: number): number | undefined {
  if (!Array.isArray(reports)) return undefined;
  const row = reports.find((r: any) => Number(r?.profile_id) === profileId);
  const cid = row != null ? Number((row as any).civilization_id) : NaN;
  return Number.isFinite(cid) ? cid : undefined;
}

async function handleMsProfileSearch(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const q = cleanSearchQuery(url.searchParams.get("q"));

  if (q.length < MS_QUERY_MIN) {
    return json([], { headers: { "cache-control": "no-store" } });
  }

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = new URL(MS_COMMUNITY_API_BASE + "/community/leaderboard/GetPersonalStat");
  upstream.searchParams.set("title", "age2");
  upstream.searchParams.set("aliases", JSON.stringify([q]));

  const res = await fetch(upstream.toString(), {
    headers: {
      "user-agent": "aoe2museum/1.0 (+mcminimap ms profile search proxy)",
    },
  });
  if (!res.ok) {
    return json({ error: `ms upstream error: HTTP ${res.status}` }, { status: 502 });
  }

  const data = (await res.json()) as any;
  const groups = Array.isArray(data?.statGroups) ? data.statGroups : [];
  const members = groups.flatMap((g: any) => (Array.isArray(g?.members) ? g.members : []));

  const out: MsProfile[] = [];
  const seen = new Set<number>();
  for (const m of members) {
    const profileId = Number(m?.profile_id);
    const alias = typeof m?.alias === "string" ? m.alias : "";
    if (!Number.isFinite(profileId) || !alias) continue;
    if (seen.has(profileId)) continue;
    seen.add(profileId);
    out.push({
      profileId,
      alias,
      platformName: typeof m?.name === "string" ? m.name : undefined,
      country: typeof m?.country === "string" ? m.country : undefined,
    });
    if (out.length >= MS_RESULTS_MAX) break;
  }

  const response = json(out, {
    headers: { "cache-control": `public, max-age=0, s-maxage=${MS_PROFILE_SEARCH_TTL_S}` },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleMsRecentMatches(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const profileId = Number(url.searchParams.get("profileId") || "");
  const count = clampInt(Number(url.searchParams.get("count") || "20"), 1, MS_MATCHES_MAX);

  if (!Number.isFinite(profileId) || profileId <= 0) {
    return json({ error: "invalid profileId" }, { status: 400 });
  }

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = new URL(MS_COMMUNITY_API_BASE + "/community/leaderboard/getRecentMatchHistory");
  upstream.searchParams.set("title", "age2");
  upstream.searchParams.set("profile_ids", JSON.stringify([profileId]));

  const res = await fetch(upstream.toString(), {
    headers: {
      "user-agent": "aoe2museum/1.0 (+mcminimap ms recent matches proxy)",
    },
  });
  if (!res.ok) {
    return json({ error: `ms upstream error: HTTP ${res.status}` }, { status: 502 });
  }

  const data = (await res.json()) as any;
  const rows = Array.isArray(data?.matchHistoryStats) ? data.matchHistoryStats : [];
  const mapped: MsRecentMatch[] = rows.map((m: any) => {
    const reports = Array.isArray(m?.matchhistoryreportresults) ? m.matchhistoryreportresults : [];
    const civId = msCivilizationForProfile(reports, profileId);
    const civName = civId != null ? MS_CIV_NAME_BY_ID.get(civId) : undefined;
    return {
      matchId: Number(m?.id),
      startedAt: Number(m?.startgametime) * 1000,
      completedAt: Number(m?.completiontime) * 1000 || undefined,
      mapName: typeof m?.mapname === "string" ? m.mapname : undefined,
      maxPlayers: typeof m?.maxplayers === "number" ? m.maxplayers : undefined,
      matchTypeId: typeof m?.matchtype_id === "number" ? m.matchtype_id : undefined,
      matchup: msMatchupLabelFromReports(reports),
      civilizationId: civId,
      civilizationName: civName,
    };
  }).filter((m: MsRecentMatch) => Number.isFinite(m.matchId) && m.matchId > 0 && Number.isFinite(m.startedAt));

  mapped.sort((a, b) => b.startedAt - a.startedAt);
  const items = mapped.slice(0, count);

  const response = json(items, {
    headers: { "cache-control": `public, max-age=0, s-maxage=${MS_RECENT_MATCHES_TTL_S}` },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function handleMsReplayZip(request: Request, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const matchId = Number(url.searchParams.get("matchId") || "");
  const profileId = Number(url.searchParams.get("profileId") || "");

  if (!Number.isFinite(matchId) || matchId <= 0 || !Number.isFinite(profileId) || profileId <= 0) {
    return json({ error: "invalid matchId/profileId" }, { status: 400 });
  }

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = new URL("https://aoe.ms/replay/");
  upstream.searchParams.set("gameId", String(matchId));
  upstream.searchParams.set("profileId", String(profileId));

  const res = await fetch(upstream.toString(), {
    cf: { cacheTtl: MS_REPLAY_ZIP_TTL_S, cacheEverything: true } as any,
    headers: {
      "user-agent": "aoe2museum/1.0 (+mcminimap ms replay zip proxy)",
      referer: "https://aoe.ms/",
    },
  });
  if (!res.ok || !res.body) {
    return json({ error: `replay zip fetch failed: HTTP ${res.status}` }, { status: 502 });
  }

  const len = res.headers.get("content-length");
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n > MS_REPLAY_ZIP_MAX_BYTES) {
      return json({ error: "zip too large" }, { status: 413 });
    }
  }

  const headers = new Headers();
  headers.set("content-type", "application/zip");
  if (len) headers.set("content-length", len);
  headers.set("cache-control", `public, max-age=0, s-maxage=${MS_REPLAY_ZIP_TTL_S}`);
  headers.set("content-disposition", `attachment; filename="aoe2replay-${matchId}.zip"`);

  const out = new Response(res.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

// ---------- scenarios routing --------------------------------------------

const SCENARIOS_DOWNLOAD_RE = /^\/api\/scenarios\/download\/(\d+)$/;

async function routeScenarios(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/scenarios" && request.method === "GET") {
    return handleList(env);
  }

  if (pathname === "/api/scenarios/upload" && request.method === "POST") {
    return handleUpload(request, env);
  }

  const dl = pathname.match(SCENARIOS_DOWNLOAD_RE);
  if (dl && request.method === "GET") {
    return handleDownload(dl[1], env, ctx);
  }

  if (pathname === "/api/scenarios/sync" && request.method === "POST") {
    const token = request.headers.get("Authorization");
    if (!token || token !== `Bearer ${env.SYNC_SECRET}`) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }
    await handleSync(env);
    return json({ ok: true });
  }

  return null;
}

// ---------- main fetch ---------------------------------------------------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/health") {
      return json({ ok: true, service: "aoe2museum" });
    }

    if (pathname === "/api/gallery") {
      if (request.method === "POST") return handleGalleryPost(request, env);
      if (request.method === "GET") return handleGalleryList(env);
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "GET, POST" },
      });
    }

    if (pathname.startsWith("/api/gallery/")) {
      if (request.method !== "GET") {
        return new Response("method not allowed", {
          status: 405,
          headers: { allow: "GET" },
        });
      }
      return handleGalleryImage(pathname.slice("/api/gallery/".length), env);
    }

    if (pathname === "/api/scenarios" || pathname.startsWith("/api/scenarios/")) {
      const res = await routeScenarios(request, env, ctx, pathname);
      if (res) return res;
      return new Response("not found", { status: 404 });
    }

    if (pathname === "/api/aocrec/recent" && request.method === "GET") {
      return handleAocrecRecent(request, env, ctx);
    }
    if (pathname === "/api/aocrec/zip" && request.method === "GET") {
      return handleAocrecZip(request, ctx);
    }

    if (pathname === "/api/ms/profile-search" && request.method === "GET") {
      return handleMsProfileSearch(request, ctx);
    }
    if (pathname === "/api/ms/recent-matches" && request.method === "GET") {
      return handleMsRecentMatches(request, ctx);
    }
    if (pathname === "/api/ms/replay-zip" && request.method === "GET") {
      return handleMsReplayZip(request, ctx);
    }

    if (pathname.startsWith("/api/gif/")) {
      const res = await routeGif(request, env, ctx, pathname);
      if (res) return res;
      return new Response("not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleSync(env);
  },
};
