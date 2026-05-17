import type { Env } from "../worker/env";
import { json } from "../http/json";
import { getSession } from "../auth/services/session";

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

export async function handleGalleryPost(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (session && request.headers.get("x-skip-public-gallery") === "1") {
    return json({ id: null, skipped: true }, { status: 201 });
  }

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
    await Promise.all(evicted.map((e) => env.MINIMAPS.delete(r2Key(e.id)).catch(() => {})));
  }

  return json({ id }, { status: 201 });
}

export async function handleGalleryList(env: Env): Promise<Response> {
  const entries = await readIndex(env);
  return json(entries, { headers: { "cache-control": "no-store" } });
}

export async function handleGalleryImage(id: string, env: Env): Promise<Response> {
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

