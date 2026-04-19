import type { ScenariosEnv } from "./scenarios/env";
import { handleList } from "./scenarios/handlers/list";
import { handleUpload } from "./scenarios/handlers/upload";
import { handleDownload } from "./scenarios/handlers/download";
import { handleSync } from "./scenarios/handlers/sync";

export interface Env extends ScenariosEnv {
  ASSETS: Fetcher;
  MINIMAPS: R2Bucket;
  MINIMAP_INDEX: KVNamespace;
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

    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await handleSync(env);
  },
};
