import { json } from "../http/json";

const MODS_API_URL = "https://mods.aoe2.se/api/v1/mods";
const MODS_SEARCH_TTL_S = 60;

const MODS_CDN_HOST = "cdn.ageofempires.com";
const MODS_ZIP_TTL_S = 6 * 60 * 60;
/** Campaign / scenario mods can exceed 35 MB once assets are bundled; align with scenarios ZIP cap (100 MB). */
const MODS_ZIP_MAX_BYTES = 100 * 1024 * 1024;
const MODS_ZIP_PATH_RE = /^\/aoe-mods\/\d+\/\d+\/[a-f0-9]{32,}\.zip$/i;

type ModsSearchRequest = {
  page?: number;
  sortColumn?: string;
  sortDirection?: "ASC" | "DESC";
  modCategories?: number[];
  searchTerm?: string;
  civbuilder?: boolean;
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanSearchTerm(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return s.replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function handleModsSearch(request: Request, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  }

  let incoming: ModsSearchRequest = {};
  try {
    incoming = (await request.json()) as ModsSearchRequest;
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }

  const body: ModsSearchRequest = {
    page: clampInt(Number(incoming.page ?? 1), 1, 2000),
    sortColumn: typeof incoming.sortColumn === "string" ? incoming.sortColumn : "createDate",
    sortDirection: incoming.sortDirection === "ASC" ? "ASC" : "DESC",
    // If the client omits modCategories, do not apply a category filter.
    // (Some upstream APIs treat an empty array as "match nothing".)
    modCategories:
      Array.isArray(incoming.modCategories) && incoming.modCategories.length
        ? incoming.modCategories.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : undefined,
    searchTerm: cleanSearchTerm(incoming.searchTerm),
    civbuilder: Boolean(incoming.civbuilder),
  };

  const cacheKey = new Request("https://aoe2museum.internal/mods?q=" + encodeURIComponent(JSON.stringify(body)));
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const res = await fetch(MODS_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "aoe2museum/1.0 (+mcminimap mods proxy)",
      referer: "https://mods.aoe2.se/",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return json({ error: `mods upstream error: HTTP ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  const out = json(data, {
    headers: {
      "cache-control": `public, max-age=0, s-maxage=${MODS_SEARCH_TTL_S}`,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

export async function handleModsZip(request: Request, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405, headers: { allow: "GET" } });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("url") || "";
  if (!raw) return json({ error: "missing url" }, { status: 400 });

  let upstream: URL;
  try {
    upstream = new URL(raw);
  } catch {
    return json({ error: "invalid url" }, { status: 400 });
  }

  if (upstream.protocol !== "https:" || upstream.hostname !== MODS_CDN_HOST) {
    return json({ error: "url not allowed" }, { status: 403 });
  }
  if (!MODS_ZIP_PATH_RE.test(upstream.pathname)) {
    return json({ error: "url path not allowed" }, { status: 403 });
  }

  const cacheKey = new Request("https://aoe2museum.internal/modzip?u=" + encodeURIComponent(upstream.toString()));
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const res = await fetch(upstream.toString(), {
    cf: { cacheTtl: MODS_ZIP_TTL_S, cacheEverything: true } as any,
    headers: {
      "user-agent": "aoe2museum/1.0 (+mcminimap mods zip proxy)",
      referer: "https://mods.aoe2.se/",
    },
  });
  if (!res.ok || !res.body) {
    return json({ error: `zip fetch failed: HTTP ${res.status}` }, { status: 502 });
  }

  const len = res.headers.get("content-length");
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n > MODS_ZIP_MAX_BYTES) {
      return json({ error: "zip too large" }, { status: 413 });
    }
  }

  const headers = new Headers();
  headers.set("content-type", "application/zip");
  if (len) headers.set("content-length", len);
  headers.set("cache-control", `public, max-age=0, s-maxage=${MODS_ZIP_TTL_S}`);

  const out = new Response(res.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, out.clone()));
  return out;
}

