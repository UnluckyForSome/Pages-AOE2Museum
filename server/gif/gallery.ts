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
const MAX_GIF_BYTES = 8 * 1024 * 1024;
const ID_RE = /^[a-f0-9]{32}$/;
const SOURCE_NAME_MAX = 256;

function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function r2Key(id: string): string {
  return `gif/${id}.gif`;
}

async function readIndex(env: Env): Promise<GalleryEntry[]> {
  const raw = await env.GIF_INDEX.get(INDEX_KEY, "json");
  return Array.isArray(raw) ? (raw as GalleryEntry[]) : [];
}

async function writeIndex(env: Env, entries: GalleryEntry[]): Promise<void> {
  await env.GIF_INDEX.put(INDEX_KEY, JSON.stringify(entries));
}

function sanitizeSourceName(raw: string | null): string {
  if (!raw) return "unknown";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  const cleaned = decoded.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!cleaned) return "unknown";
  return cleaned.length > SOURCE_NAME_MAX ? cleaned.slice(0, SOURCE_NAME_MAX) : cleaned;
}

export async function handleGifGalleryPost(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (session && request.headers.get("x-skip-public-gallery") === "1") {
    return json({ id: null, skipped: true }, { status: 201 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (
    !contentType.toLowerCase().startsWith("image/gif") &&
    !contentType.toLowerCase().startsWith("image/png")
  ) {
    return json({ error: "content-type must be image/gif or image/png" }, { status: 415 });
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_GIF_BYTES) {
    return json({ error: "payload too large" }, { status: 413 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length === 0) return json({ error: "empty body" }, { status: 400 });
  if (body.length > MAX_GIF_BYTES) return json({ error: "payload too large" }, { status: 413 });

  const id = newId();
  const sourceName = sanitizeSourceName(request.headers.get("x-source-name"));
  const entry: GalleryEntry = {
    id,
    sourceName,
    createdAt: Date.now(),
    bytes: body.length,
  };

  const httpContentType = contentType.toLowerCase().startsWith("image/png")
    ? "image/png"
    : "image/gif";
  const key = httpContentType === "image/png" ? `gif/${id}.png` : r2Key(id);

  await env.GIFS.put(key, body, {
    httpMetadata: { contentType: httpContentType },
  });

  const current = await readIndex(env);
  const next = [entry, ...current].slice(0, MAX_ENTRIES);
  const evicted = [entry, ...current].slice(MAX_ENTRIES);
  await writeIndex(env, next);

  if (evicted.length > 0) {
    await Promise.all(
      evicted.map((e) =>
        Promise.all([
          env.GIFS.delete(r2Key(e.id)).catch(() => {}),
          env.GIFS.delete(`gif/${e.id}.png`).catch(() => {}),
        ]),
      ),
    );
  }

  return json({ id }, { status: 201 });
}

export async function handleGifGalleryList(env: Env): Promise<Response> {
  const entries = await readIndex(env);
  return json(entries, { headers: { "cache-control": "no-store" } });
}

export async function handleGifGalleryImage(id: string, env: Env): Promise<Response> {
  if (!ID_RE.test(id)) return new Response("not found", { status: 404 });
  let obj = await env.GIFS.get(r2Key(id));
  if (!obj) obj = await env.GIFS.get(`gif/${id}.png`);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", "image/gif");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}
