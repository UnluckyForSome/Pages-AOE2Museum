import { json } from "../http/json";
import { decompressSync, strFromU8 } from "fflate";
import civsAoe2 from "./civs_aoe2.json";
import mapsAoe2 from "./maps_aoe2.json";
import updatesConfig from "./updates.json";

const MS_COMMUNITY_API_BASE = "https://aoe-api.worldsedgelink.com";
const MS_PROFILE_SEARCH_TTL_S = 60;
const MS_RECENT_MATCHES_TTL_S = 60;
const MS_REPLAY_ZIP_TTL_S = 6 * 60 * 60;
const MS_REPLAY_ZIP_MAX_BYTES = 35 * 1024 * 1024;

const MS_QUERY_MIN = 2;
const MS_QUERY_MAX = 64;
const MS_RESULTS_MAX = 20;
const MS_MATCHES_MAX = 20;

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
  mapLocationId?: number;
  maxPlayers?: number;
  matchTypeId?: number;
  matchup?: string;
  raceId?: number;
  civilizationName?: string;
  mappingVersion?: number;
};

type VersionedIdMap = Record<string, Record<string, number>>;

type UpdateVersion = {
  version: number;
  wentLiveOn?: string | null;
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanSearchQuery(raw: string | null): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length > MS_QUERY_MAX ? cleaned.slice(0, MS_QUERY_MAX) : cleaned;
}

function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function inflateBase64ToString(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "";
  return strFromU8(decompressSync(base64ToBytes(input)));
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function parseMsOptions(rawOptions: unknown): Record<string, string> {
  try {
    const inflated = inflateBase64ToString(rawOptions);
    if (!inflated) return {};

    const outer = JSON.parse(inflated) as Record<string, unknown>;
    const stitched = Object.keys(outer)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
      .map((n) => {
        const value = outer[String(n)];
        return typeof value === "string" ? value : "";
      })
      .join("");

    const inner = base64ToBytes(stitched);
    const out: Record<string, string> = {};
    let offset = 1; // one-byte version/magic prefix (`B`, `K`, ...)
    while (offset + 4 <= inner.length) {
      const len = readU32LE(inner, offset);
      offset += 4;
      if (len > 5000 || offset + len > inner.length) break;
      const segment = strFromU8(inner.slice(offset, offset + len));
      offset += len;
      const colon = segment.indexOf(":");
      if (colon > 0) out[segment.slice(0, colon)] = segment.slice(colon + 1);
    }
    return out;
  } catch {
    return {};
  }
}

function parseMsSlotInfo(rawSlotInfo: unknown): unknown[] {
  try {
    const inflated = inflateBase64ToString(rawSlotInfo);
    if (!inflated) return [];

    const start = inflated.indexOf("[");
    if (start < 0) return [];

    let depth = 0;
    let end = -1;
    for (let i = start; i < inflated.length; i++) {
      const ch = inflated[i];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) return [];

    const parsed = JSON.parse(inflated.slice(start, end));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function msRaceIdForProfile(slots: unknown[], profileId: number): number | undefined {
  const row = slots.find((s: any) => Number(s?.["profileInfo.id"]) === profileId);
  const raceId = row != null ? Number((row as any).raceID) : NaN;
  return Number.isFinite(raceId) ? raceId : undefined;
}

function buildVersionedNameLookup(source: VersionedIdMap): Map<number, Map<number, string>> {
  const byVersion = new Map<number, Map<number, string>>();
  for (const [name, idsByVersion] of Object.entries(source)) {
    for (const [versionKey, rawId] of Object.entries(idsByVersion)) {
      const version = Number(versionKey);
      const id = Number(rawId);
      if (!Number.isFinite(version) || !Number.isFinite(id) || id < 0) continue;
      let namesById = byVersion.get(version);
      if (!namesById) {
        namesById = new Map<number, string>();
        byVersion.set(version, namesById);
      }
      if (!namesById.has(id)) namesById.set(id, name);
    }
  }
  return byVersion;
}

const MS_MAP_NAME_BY_VERSION_AND_LOCATION = buildVersionedNameLookup(mapsAoe2 as VersionedIdMap);
const MS_CIV_NAME_BY_VERSION_AND_RACE = buildVersionedNameLookup(civsAoe2 as VersionedIdMap);

const MS_UPDATE_VERSIONS = ((updatesConfig as { versions?: UpdateVersion[] }).versions || [])
  .map((v) => ({
    version: Number(v.version),
    liveAt: typeof v.wentLiveOn === "string" ? Date.parse(`${v.wentLiveOn}T00:00:00Z`) : NaN,
  }))
  .filter((v) => Number.isFinite(v.version) && Number.isFinite(v.liveAt))
  .sort((a, b) => (a.liveAt === b.liveAt ? a.version - b.version : a.liveAt - b.liveAt));

function msMappingVersionForStart(startedAtSeconds: number): number | undefined {
  const startedAtMs = startedAtSeconds * 1000;
  if (!Number.isFinite(startedAtMs)) return undefined;
  let selected: number | undefined;
  for (const version of MS_UPDATE_VERSIONS) {
    if (startedAtMs >= version.liveAt) selected = version.version;
    else break;
  }
  return selected;
}

function lookupVersionedName(
  lookup: Map<number, Map<number, string>>,
  version: number | undefined,
  id: number | undefined,
): string | undefined {
  if (version == null || id == null) return undefined;
  return lookup.get(version)?.get(id);
}

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

export async function handleMsProfileSearch(request: Request, ctx: ExecutionContext): Promise<Response> {
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
    headers: { "user-agent": "aoe2museum/1.0 (+mcminimap ms profile search proxy)" },
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

export async function handleMsRecentMatches(request: Request, ctx: ExecutionContext): Promise<Response> {
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
    headers: { "user-agent": "aoe2museum/1.0 (+mcminimap ms recent matches proxy)" },
  });
  if (!res.ok) {
    return json({ error: `ms upstream error: HTTP ${res.status}` }, { status: 502 });
  }

  const data = (await res.json()) as any;
  const rows = Array.isArray(data?.matchHistoryStats) ? data.matchHistoryStats : [];
  const mapped: MsRecentMatch[] = rows
    .map((m: any) => {
      const reports = Array.isArray(m?.matchhistoryreportresults) ? m.matchhistoryreportresults : [];
      const startedAtSeconds = Number(m?.startgametime);
      const mappingVersion = msMappingVersionForStart(startedAtSeconds);
      const options = parseMsOptions(m?.options);
      const mapLocationId = Number(options["10"]);
      const slots = parseMsSlotInfo(m?.slotinfo);
      const raceId = msRaceIdForProfile(slots, profileId);

      return {
        matchId: Number(m?.id),
        startedAt: startedAtSeconds * 1000,
        completedAt: Number(m?.completiontime) * 1000 || undefined,
        mapName: lookupVersionedName(
          MS_MAP_NAME_BY_VERSION_AND_LOCATION,
          mappingVersion,
          Number.isFinite(mapLocationId) ? mapLocationId : undefined,
        ),
        mapLocationId: Number.isFinite(mapLocationId) ? mapLocationId : undefined,
        maxPlayers: typeof m?.maxplayers === "number" ? m.maxplayers : undefined,
        matchTypeId: typeof m?.matchtype_id === "number" ? m.matchtype_id : undefined,
        matchup: msMatchupLabelFromReports(reports),
        raceId,
        civilizationName: lookupVersionedName(MS_CIV_NAME_BY_VERSION_AND_RACE, mappingVersion, raceId),
        mappingVersion,
      };
    })
    .filter((m: MsRecentMatch) => Number.isFinite(m.matchId) && m.matchId > 0 && Number.isFinite(m.startedAt));

  mapped.sort((a, b) => b.startedAt - a.startedAt);
  const items = mapped.slice(0, count);

  const response = json(items, {
    headers: { "cache-control": `public, max-age=0, s-maxage=${MS_RECENT_MATCHES_TTL_S}` },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export async function handleMsReplayZip(request: Request, ctx: ExecutionContext): Promise<Response> {
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
  headers.set("content-disposition", `attachment; filename=\"aoe2replay-${matchId}.zip\"`);

  const out = new Response(res.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

