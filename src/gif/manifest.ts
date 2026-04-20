// Build the /gif/ dropdown manifests by intersecting the shipped mapping JSONs
// ("the universe of known sprites") with what actually exists in Garage S3.
//
// Mappings are fetched once per isolate via env.ASSETS and memoised on
// globalThis, since they are static assets baked into the Worker deploy and
// are identical for every request in a given deploy.

import type { GifEnv } from "./env";

export interface SlpMappingRow {
  Unit: string;
  Action: string;
  SLP: number;
}
export type SlpMapping = SlpMappingRow[];

export interface SldMappingEntry {
  unit: string;
  action: string;
  zoom: string;
}
export type SldMapping = Record<string, SldMappingEntry>;

export interface SlpManifest {
  // units[unit][action] = SLP id (integer)
  units: Record<string, Record<string, number>>;
  total: number;
}

export interface SldManifest {
  // units[unit][action][zoom] = filename key (e.g. "a_alfred_deathA_x2")
  units: Record<string, Record<string, Record<string, string>>>;
  total: number;
}

interface MemoRoot {
  __aoe2museum_gif?: {
    slpMapping?: Promise<SlpMapping>;
    sldMapping?: Promise<SldMapping>;
    slpIds?: Set<number>;
  };
}

function memo(): NonNullable<MemoRoot["__aoe2museum_gif"]> {
  const g = globalThis as MemoRoot;
  if (!g.__aoe2museum_gif) g.__aoe2museum_gif = {};
  return g.__aoe2museum_gif;
}

async function fetchAsset<T>(assets: Fetcher, path: string): Promise<T> {
  // env.ASSETS is bound to the static-asset handler and accepts any URL; the
  // host portion is ignored, only the pathname is used for lookup.
  const res = await assets.fetch(new Request("https://assets.invalid" + path));
  if (!res.ok) {
    throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export function loadSlpMapping(env: GifEnv): Promise<SlpMapping> {
  const m = memo();
  if (!m.slpMapping) {
    m.slpMapping = fetchAsset<SlpMapping>(env.ASSETS, "/gif/sourcefiles/slp_mapping.json");
  }
  return m.slpMapping;
}

export function loadSldMapping(env: GifEnv): Promise<SldMapping> {
  const m = memo();
  if (!m.sldMapping) {
    m.sldMapping = fetchAsset<SldMapping>(env.ASSETS, "/gif/sourcefiles/sld/sld_mapping.json");
  }
  return m.sldMapping;
}

export async function slpIdsInMapping(env: GifEnv): Promise<Set<number>> {
  const m = memo();
  if (!m.slpIds) {
    const mapping = await loadSlpMapping(env);
    m.slpIds = new Set(mapping.map((r) => r.SLP).filter((n) => typeof n === "number"));
  }
  return m.slpIds;
}

// Parse "123.slp" / "123" -> 123 (integer). Returns null on malformed input.
function parseSlpId(key: string): number | null {
  const base = key.replace(/^.*\//, ""); // strip any prefix just in case
  const m = /^(\d+)\.slp$/i.exec(base);
  if (!m) return null;
  return parseInt(m[1], 10);
}

// Parse "a_alfred_deathA_x2.sld" -> "a_alfred_deathA_x2".
function parseSldKey(key: string): string | null {
  const base = key.replace(/^.*\//, "");
  const m = /^([a-z0-9_]+)\.sld$/i.exec(base);
  if (!m) return null;
  return m[1];
}

export function buildSlpManifest(bucketKeys: string[], mapping: SlpMapping): SlpManifest {
  const available = new Set<number>();
  for (const k of bucketKeys) {
    const id = parseSlpId(k);
    if (id !== null) available.add(id);
  }
  const units: Record<string, Record<string, number>> = {};
  let total = 0;
  for (const row of mapping) {
    if (!row || typeof row.SLP !== "number") continue;
    if (!available.has(row.SLP)) continue;
    const unit = String(row.Unit || "").trim();
    const action = String(row.Action || "").trim();
    if (!unit || !action) continue;
    if (!units[unit]) units[unit] = {};
    // Preserve the first SLP id for a given (unit, action) pair, matching
    // the client's existing "first wins" behaviour in loadMapping().
    if (!(action in units[unit])) {
      units[unit][action] = row.SLP;
      total++;
    }
  }
  return { units, total };
}

export function buildSldManifest(bucketKeys: string[], mapping: SldMapping): SldManifest {
  const available = new Set<string>();
  for (const k of bucketKeys) {
    const key = parseSldKey(k);
    if (key !== null) available.add(key);
  }
  const units: Record<string, Record<string, Record<string, string>>> = {};
  let total = 0;
  for (const [key, entry] of Object.entries(mapping)) {
    if (!entry) continue;
    if (!available.has(key)) continue;
    const unit = String(entry.unit || "").trim();
    const action = String(entry.action || "").trim();
    const zoom = String(entry.zoom || "").trim();
    if (!unit || !action || !zoom) continue;
    if (!units[unit]) units[unit] = {};
    if (!units[unit][action]) units[unit][action] = {};
    if (!(zoom in units[unit][action])) {
      units[unit][action][zoom] = key;
      total++;
    }
  }
  return { units, total };
}

// Server-side validation helpers used by the file-proxy handlers so we can
// reject crafted paths before signing an S3 request.
export async function isKnownSlpId(env: GifEnv, id: number): Promise<boolean> {
  const ids = await slpIdsInMapping(env);
  return ids.has(id);
}

export async function isKnownSldKey(env: GifEnv, key: string): Promise<boolean> {
  const mapping = await loadSldMapping(env);
  return Object.prototype.hasOwnProperty.call(mapping, key);
}
