import type { Env } from "../worker/env";
import { json } from "../http/json";

const AOCREC_ES_URL = "https://es1.aocrec.com/mgxhub1/_search";
const AOCREC_ZIP_HOST = "static1.aocrec.com";
const AOCREC_ZIP_PATH_RE = /^\/record\/[a-f0-9]{32}\.zip$/i;
const AOCREC_RECENT_TTL_S = 60; // cache list briefly to cut ES load
const AOCREC_SEARCH_TTL_S = 60; // cache search briefly to cut ES load
const AOCREC_ZIP_TTL_S = 6 * 60 * 60; // 6h cache to cut repeat zip fetches
const AOCREC_SYNONYMS_TTL_S = 24 * 60 * 60;
const AOCREC_ZIP_MAX_BYTES = 25 * 1024 * 1024; // guardrail for Worker costs
const AOCREC_QUERY_MAX = 80;

// --- Zh ↔ EN (AOCRec Chinese locale ↔ English). Arrays allow duplicate ZH across civ vs map. ---

const AOCREC_CIV_SYNONYM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["阿兹特克", "Aztecs"],
  ["埃塞尔比亚", "Ethiopians"],
  ["柏柏尔", "Berbers"],
  ["拜占庭", "Byzantines"],
  ["波斯", "Persians"],
  ["不列颠", "Britons"],
  ["法兰克", "Franks"],
  ["高丽", "Koreans"],
  ["高棉", "Khmer"],
  ["哥特", "Goths"],
  ["凯尔特", "Celts"],
  ["马来", "Malay"],
  ["马里", "Malians"],
  ["马扎尔", "Magyars"],
  ["玛雅", "Mayans"],
  ["蒙古", "Mongols"],
  ["缅甸", "Burmese"],
  ["葡萄牙", "Portuguese"],
  ["日本", "Japanese"],
  ["萨拉森", "Saracens"],
  ["斯拉夫", "Slavs"],
  ["随机", "Random"],
  ["条顿", "Teutons"],
  ["土耳其", "Turks"],
  ["维京", "Vikings"],
  ["西班牙", "Spanish"],
  ["匈奴", "Huns"],
  ["意大利", "Italians"],
  ["印度", "Indians"],
  ["印加", "Incas"],
  ["越南", "Vietnamese"],
  ["中国", "Chinese"],
];

const AOCREC_MAP_SYNONYM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["阿拉伯半岛", "Arabia"],
  ["群岛", "Archipelago"],
  ["丛林竞技场", "Arena"],
  ["波罗的海", "Baltic"],
  ["黑森林", "Black Forest"],
  ["绝对随机地图", "Blind Random"],
  ["沿海", "Coastal"],
  ["大陆", "Continental"],
  ["火山湖", "Crater Lake"],
  ["定制", "Custom"],
  ["堡垒", "Fortress"],
  ["完全随机地图", "Full Random"],
  ["幽灵湖", "Ghost Lake"],
  ["淘金潮", "Gold Rush"],
  ["高地", "Highland"],
  ["岛屿", "Islands"],
  ["热带雨林", "Yucatan"],
  ["地中海", "Mediterranean"],
  ["移民", "Migration"],
  ["游牧", "Nomad"],
  ["北欧", "Nordic"],
  ["绿洲", "Oasis"],
  ["河流", "Rivers"],
  ["盐碱沼泽", "Salt Marsh"],
  ["斯堪的纳维亚", "Scandinavia"],
  ["团队岛屿", "Team Islands"],
  ["不列颠", "Britain"],
  ["拜占庭", "Byzantium"],
  ["中美洲", "Central America"],
  ["法兰西", "France"],
  ["伊比利亚", "Iberia"],
  ["意大利半岛", "Italy"],
  ["中东", "Middle East"],
  ["蒙古高原", "Mongolia"],
  ["日本海 (东海)", "Sea of Japan (East Sea)"],
  ["德克萨斯", "Texas"],
];

type EnPhraseDef = { key: string; zh: string };

function pairsToZhToEn(pairs: ReadonlyArray<readonly [string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const zh = String(pair[0] || "").trim();
    const en = String(pair[1] || "").trim();
    if (!zh || !en) continue;
    if (!out[zh]) out[zh] = en;
  }
  return out;
}

function normalizePhraseKey(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[/_]+/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function invertZhToEn(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (enRaw: string, zh: string) => {
    const aliases = String(enRaw || "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const en of aliases) {
      const keys = new Set<string>();
      keys.add(normalizePhraseKey(en));
      keys.add(normalizePhraseKey(en.replace(/[()]/g, " ")));

      for (const key of keys) {
        if (!key) continue;
        if (!out[key]) out[key] = zh;
      }
    }
  };

  for (const [zh, enRaw] of Object.entries(map)) {
    add(enRaw, zh);
  }
  return out;
}

function buildSortedEnglishPhraseDefs(enToZh: Record<string, string>): EnPhraseDef[] {
  const defs: EnPhraseDef[] = [];
  const seen = new Set<string>();
  for (const [enKey, zh] of Object.entries(enToZh)) {
    const k = String(enKey || "").trim();
    if (!k || !zh) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    defs.push({ key: k, zh: String(zh) });
  }
  defs.sort((a, b) => b.key.length - a.key.length);
  return defs;
}

const AOCREC_CIV_ZH_TO_EN = pairsToZhToEn(AOCREC_CIV_SYNONYM_PAIRS);
const AOCREC_MAP_ZH_TO_EN = pairsToZhToEn(AOCREC_MAP_SYNONYM_PAIRS);
const AOCREC_CIV_EN_TO_ZH = invertZhToEn(AOCREC_CIV_ZH_TO_EN);
const AOCREC_MAP_EN_TO_ZH = invertZhToEn(AOCREC_MAP_ZH_TO_EN);

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
  /** Search-only: players whose names matched the query tokens (see handleAocrecSearch). */
  matchHint?: string;
};

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function aocrecZipUrlFromGuid(guid: string): string {
  return `https://${AOCREC_ZIP_HOST}/record/${guid}.zip`;
}

function cleanAocrecQuery(raw: string | null): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  return cleaned.length > AOCREC_QUERY_MAX ? cleaned.slice(0, AOCREC_QUERY_MAX) : cleaned;
}

function escapeQueryStringTerm(q: string): string {
  // Escape reserved characters for ES query_string.
  // Ref: + - = && || > < ! ( ) { } [ ] ^ " ~ * ? : \ /
  return q.replace(/[+\-=!(){}[\]^"~*?:\\/<>|]/g, "\\$&");
}

const AOCREC_MAP_ZH_TO_EN_INVERTED = invertZhToEn(AOCREC_MAP_ZH_TO_EN);

const AOCREC_CIV_EN_PHRASES: EnPhraseDef[] = buildSortedEnglishPhraseDefs(AOCREC_CIV_EN_TO_ZH);

const AOCREC_MAP_EN_PHRASES: EnPhraseDef[] = buildSortedEnglishPhraseDefs(AOCREC_MAP_EN_TO_ZH);

function trimTrailingMapSuffix(enPhraseKey: string): string | null {
  const k = String(enPhraseKey || "").trim();
  if (!k) return null;
  const spaced = k.replace(/\s+/g, " ").trim();
  const stripped = spaced.replace(/\s+map\s*$/i, "").trim();
  return stripped && stripped !== spaced ? stripped : null;
}

function phraseTokensFromRawQuery(rawQuery: string): string[] {
  const raw = String(rawQuery || "").trim();
  if (!raw) return [];

  const pieces = raw.replace(/\s+/g, " ").split(" ").filter(Boolean);
  const out: string[] = [];

  for (const piece of pieces) {
    if (/[\u4e00-\u9fff]/.test(piece)) {
      out.push(piece);
      continue;
    }

    const nk = normalizePhraseKey(piece);
    if (!nk) continue;
    for (const t of nk.split(" ").filter(Boolean)) out.push(t);
  }

  return out;
}

function consumeLeadingPhraseFromTokens(
  defs: EnPhraseDef[],
  phraseTokens: string[],
): EnPhraseDef | null {
  const joined = phraseTokens.join(" ").trim();
  if (!joined) return null;

  // Prefer longer phrases first (defs are sorted), first match wins.
  for (const def of defs) {
    if (!def.key) continue;

    // Plain phrase match.
    if (joined === def.key || joined.startsWith(def.key + " ")) {
      return def;
    }

    // Allow suffix like "... map" for geography-only collisions where civ names reuse similar spellings.
    const trimmed = trimTrailingMapSuffix(def.key);
    if (trimmed && (joined === trimmed || joined.startsWith(trimmed + " "))) {
      return def;
    }
  }

  return null;
}

function stripConsumedPhrase(def: EnPhraseDef, phraseTokens: string[]): void {
  const parts = def.key.split(" ").filter(Boolean);
  if (phraseTokens.length < parts.length) return;
  for (let i = 0; i < parts.length; i++) {
    if (phraseTokens[i] !== parts[i]) return;
  }
  phraseTokens.splice(0, parts.length);
}

function extractAocrecFilters(rawQuery: string): {
  remaining: string;
  civs: string[];
  mapZhSynonyms: string[];
} {
  const phraseTokens = phraseTokensFromRawQuery(rawQuery);
  const civs: string[] = [];
  const mapZhSynonyms: string[] = [];

  const civZhValues = new Set(Object.keys(AOCREC_CIV_ZH_TO_EN));

  while (phraseTokens.length > 0) {
    const civHit = consumeLeadingPhraseFromTokens(AOCREC_CIV_EN_PHRASES, phraseTokens);
    if (civHit) {
      civs.push(civHit.zh);
      stripConsumedPhrase(civHit, phraseTokens);
      continue;
    }

    const mapHit = consumeLeadingPhraseFromTokens(AOCREC_MAP_EN_PHRASES, phraseTokens);
    if (mapHit) {
      mapZhSynonyms.push(mapHit.zh);
      stripConsumedPhrase(mapHit, phraseTokens);
      continue;
    }

    const t0 = phraseTokens[0];
    if (civZhValues.has(t0)) {
      civs.push(t0);
      phraseTokens.shift();
      continue;
    }

    break;
  }

  const remaining = phraseTokens.join(" ").trim();
  return {
    remaining,
    civs: Array.from(new Set(civs)),
    mapZhSynonyms: Array.from(new Set(mapZhSynonyms)),
  };
}

function applyPhraseSynonyms(raw: string): string {
  // Collapse known multi-word phrases into single tokens so wildcard queries behave predictably.
  let out = String(raw || "").toLowerCase();

  const phrases = [
    "black forest",
    "ghost lake",
    "gold rush",
    "salt marsh",
    "blind random",
    "full random",
    "team islands",
    "crater lake",
    "jungle arena",
    "custom (game setting)",
    "sea of japan (east sea)",
    "central america",
  ];

  for (const ph of phrases) {
    const esc = ph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`, "g");
    out = out.replace(re, normalizePhraseKey(ph).replace(/\s+/g, ""));
  }

  return out;
}

function expandTokenSynonyms(tokenLower: string): string[] {
  const syn: string[] = [];

  const mapZh = AOCREC_MAP_EN_TO_ZH[tokenLower];
  if (mapZh) syn.push(mapZh);

  const civZh = AOCREC_CIV_EN_TO_ZH[tokenLower];
  if (civZh) syn.push(civZh);

  const invertedMapZh = AOCREC_MAP_ZH_TO_EN_INVERTED[tokenLower];
  if (invertedMapZh) syn.push(invertedMapZh);

  return Array.from(new Set(syn.filter(Boolean)));
}

/** One AND-required clause each; caller crosses matchup/map vs nested player names per clause. */
function buildAocrecTokenQueries(rawQuery: string, mapZhSynonyms: string[]): string[] {
  const lowered = applyPhraseSynonyms(String(rawQuery || ""));
  const safe = escapeQueryStringTerm(lowered);
  const tokens = safe.split(" ").filter(Boolean);

  const extraZh = Array.from(new Set((mapZhSynonyms || []).filter(Boolean)));
  if (tokens.length === 0) {
    if (extraZh.length === 0) return [];
    return ["(" + extraZh.map((s) => `*${escapeQueryStringTerm(s)}*`).join(" OR ") + ")"];
  }

  return tokens.map((t) => {
    const lower = t.toLowerCase();
    const syn = expandTokenSynonyms(lower);
    // Be forgiving: allow substring matches for player names / maps.
    const base = t.length >= 2 ? `*${t}*` : t;
    if (!syn || syn.length === 0) return base;
    const expanded = [base, ...syn.map((s) => `*${escapeQueryStringTerm(s)}*`)];
    return "(" + expanded.join(" OR ") + ")";
  });
}

/** Substrings inside wildcards from buildAocrecTokenQueries — used to explain player hits in UI. */
function explainTermsFromTokenQueries(tokenQueries: string[]): string[] {
  const set = new Set<string>();
  for (const tq of tokenQueries) {
    const re = /\*([^*]+)\*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tq)) !== null) {
      const inner = String(m[1] || "").trim();
      if (!inner) continue;
      const nk = normalizePhraseKey(inner);
      if (!nk) continue;
      if (nk.length >= 2 || /[\u4e00-\u9fff]/.test(inner)) set.add(nk);
    }
  }
  return Array.from(set);
}

function playerNameMatchesExplainTerm(displayName: string, term: string): boolean {
  const raw = String(displayName || "").trim();
  if (!raw || !term) return false;
  const lower = raw.toLowerCase();
  const nk = normalizePhraseKey(raw);
  const compact = nk.replace(/\s+/g, "");
  const tcompact = term.replace(/\s+/g, "");
  if (lower.includes(term)) return true;
  if (nk.includes(term) || compact.includes(tcompact)) return true;
  return false;
}

function formatPlayerMatchHint(
  explainTerms: string[],
  players?: Array<{ name?: string; civ?: string }>,
): string | undefined {
  if (!explainTerms.length || !players?.length) return undefined;
  // ES/rec payload often repeats the same player name on multiple nested rows; keep one slot per distinct name.
  const bestByNorm = new Map<string, { name: string; slot: number }>();
  for (let i = 0; i < players.length; i++) {
    const nm = players[i]?.name;
    if (typeof nm !== "string" || !nm.trim()) continue;
    const hit = explainTerms.some((t) => playerNameMatchesExplainTerm(nm, t));
    if (!hit) continue;
    const display = nm.trim();
    const key = normalizePhraseKey(display);
    if (!key) continue;
    const slot = i + 1;
    const prev = bestByNorm.get(key);
    if (!prev || slot < prev.slot) bestByNorm.set(key, { name: display, slot });
  }
  if (!bestByNorm.size) return undefined;
  const matched = Array.from(bestByNorm.values()).sort((a, b) => a.slot - b.slot);
  return matched.map((m) => `${m.name} P${m.slot}`).join(", ");
}

function aocrecTextMatchClause(tokenQuery: string): Record<string, unknown> {
  // ES indexes `players` as nested; root-level query_string does not see players.* (same reason civ post-filters exist).
  // Each token must match matchup/map metadata OR a nested player object — combine with bool.must across tokens for AND.
  return {
    bool: {
      should: [
        {
          query_string: {
            query: tokenQuery,
            fields: ["matchup^2", "mapname^2", "guid", "ver"],
            default_operator: "AND",
            analyze_wildcard: true,
            lenient: true,
          },
        },
        {
          nested: {
            path: "players",
            ignore_unmapped: true,
            query: {
              query_string: {
                query: tokenQuery,
                fields: ["players.name^3"],
                default_operator: "AND",
                analyze_wildcard: true,
                lenient: true,
              },
            },
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}

function mapAocrecHits(hits: any[]): AocrecRecentItem[] {
  return hits.map((h: any) => {
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
        ? typeof src.players[recorderIndex].name === "string"
          ? src.players[recorderIndex].name
          : undefined
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
}

/** Public synonym tables for mcminimap (same shapes as former static JSON). */
export function handleAocrecSynonyms(): Response {
  return json(
    { civ: AOCREC_CIV_SYNONYM_PAIRS, map: AOCREC_MAP_SYNONYM_PAIRS },
    {
      headers: {
        "cache-control": `public, max-age=${AOCREC_SYNONYMS_TTL_S}, s-maxage=${AOCREC_SYNONYMS_TTL_S}`,
      },
    },
  );
}

export async function handleAocrecRecent(
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
  const hits = data && data.hits && Array.isArray(data.hits.hits) ? data.hits.hits : [];
  const items: AocrecRecentItem[] = mapAocrecHits(hits);

  const response = json(items, {
    headers: { "cache-control": `public, max-age=0, s-maxage=${AOCREC_RECENT_TTL_S}` },
  });
  // Best-effort cache; if it fails we still return the live response.
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export async function handleAocrecSearch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const q = cleanAocrecQuery(url.searchParams.get("q"));
  const size = clampInt(Number(url.searchParams.get("size") || "50"), 1, 50);

  if (!q) {
    return json([], { headers: { "cache-control": "no-store" } });
  }

  if (!env.AOCREC_ES_BASIC_AUTH || !env.AOCREC_ES_BASIC_AUTH.toLowerCase().startsWith("basic ")) {
    return json(
      { error: "AOCREC_ES_BASIC_AUTH is not configured" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const { remaining, civs, mapZhSynonyms } = extractAocrecFilters(q);
  const tokenQueries = buildAocrecTokenQueries(remaining, mapZhSynonyms);
  const explainTerms = explainTermsFromTokenQueries(tokenQueries);

  const must: any[] = [
    { range: { duration: { gte: 600000 } } },
    { bool: { must_not: { term: { include_ai: true } } } },
  ];
  if (tokenQueries.length > 0) {
    must.push({
      bool: {
        must: tokenQueries.map((tq) => aocrecTextMatchClause(tq)),
      },
    });
  }

  const body = {
    from: 0,
    // Fetch a bit more, then filter client-side (civs are nested and not reliably searchable).
    size: Math.max(size, 80),
    query: {
      bool: {
        must,
      },
    },
    sort: [{ lastmod: "desc" }, { created_at: "desc" }, { duration: "desc" }],
    collapse: { field: "guid" },
  };

  const res = await fetch(AOCREC_ES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: env.AOCREC_ES_BASIC_AUTH,
      "user-agent": "aoe2museum/1.0 (+mcminimap aocrec search proxy)",
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
  const hits = data && data.hits && Array.isArray(data.hits.hits) ? data.hits.hits : [];
  let items: AocrecRecentItem[] = mapAocrecHits(hits);
  if (civs.length > 0) {
    const wanted = new Set(civs);
    items = items.filter((it) => {
      const ps = it.players || [];
      return ps.some((p) => p && p.civ && wanted.has(String(p.civ)));
    });
  }
  items = items.slice(0, size);

  if (explainTerms.length > 0) {
    items = items.map((it) => {
      const hint = formatPlayerMatchHint(explainTerms, it.players);
      return hint ? { ...it, matchHint: hint } : it;
    });
  }

  const response = json(items, {
    headers: { "cache-control": `public, max-age=0, s-maxage=${AOCREC_SEARCH_TTL_S}` },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export async function handleAocrecZip(request: Request, ctx: ExecutionContext): Promise<Response> {
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
  const cacheKey = new Request(
    "https://aoe2museum.internal/aocreczip?u=" + encodeURIComponent(upstream.toString()),
  );
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

