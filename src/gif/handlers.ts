// HTTP handlers for the /api/gif/* routes. The manifest endpoints build a
// dropdown-ready index by intersecting the shipped mapping JSON with a live
// Garage S3 listing. The object endpoints stream a signed GetObject through
// the Worker so the browser never sees our AWS-style credentials.

import type { GifEnv } from "./env";
import { getObject, listAllKeys } from "./s3";
import {
  buildSldManifest,
  buildSlpManifest,
  isKnownSldKey,
  isKnownSlpId,
  loadSldMapping,
  loadSlpMapping,
} from "./manifest";

const MANIFEST_CACHE_HEADERS: HeadersInit = {
  "content-type": "application/json; charset=utf-8",
  // Browser keeps the manifest 5 minutes; edge caches it an hour and can
  // serve stale for a day while we refresh.
  "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
};

const OBJECT_CACHE_HEADERS: HeadersInit = {
  "content-type": "application/octet-stream",
  // SLP/SLD payloads are content-addressed (filename includes the id/key)
  // so they are safe to treat as immutable.
  "cache-control": "public, max-age=31536000, immutable",
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const merged: ResponseInit = {
    ...init,
    headers: { ...MANIFEST_CACHE_HEADERS, ...(init?.headers || {}) },
  };
  return new Response(JSON.stringify(body), merged);
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Cache API is keyed on the incoming request URL, so a bare URL string works.
async function cachedManifest(
  request: Request,
  ctx: ExecutionContext,
  build: () => Promise<Response>
): Promise<Response> {
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const fresh = await build();
  if (fresh.ok) {
    // Clone before returning so the cache can consume one body.
    ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  }
  return fresh;
}

export async function handleSlpManifest(
  request: Request,
  env: GifEnv,
  ctx: ExecutionContext
): Promise<Response> {
  return cachedManifest(request, ctx, async () => {
    try {
      const [keys, mapping] = await Promise.all([
        listAllKeys(env, env.GARAGE_BUCKET_SLP),
        loadSlpMapping(env),
      ]);
      return jsonResponse(buildSlpManifest(keys, mapping));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(502, `SLP manifest failed: ${message}`);
    }
  });
}

export async function handleSldManifest(
  request: Request,
  env: GifEnv,
  ctx: ExecutionContext
): Promise<Response> {
  return cachedManifest(request, ctx, async () => {
    try {
      const [keys, mapping] = await Promise.all([
        listAllKeys(env, env.GARAGE_BUCKET_SLD),
        loadSldMapping(env),
      ]);
      return jsonResponse(buildSldManifest(keys, mapping));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(502, `SLD manifest failed: ${message}`);
    }
  });
}

// Keep the signed response's interesting headers (status, length, range,
// etag) but substitute our own cache-control and content-type so nothing
// AWS-flavoured leaks out to the client.
function proxyResponse(upstream: Response, filename: string): Response {
  const headers = new Headers(OBJECT_CACHE_HEADERS);
  const passthrough = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"];
  for (const h of passthrough) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("content-disposition", `inline; filename="${filename}"`);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function cachedObject(
  request: Request,
  ctx: ExecutionContext,
  build: () => Promise<Response>
): Promise<Response> {
  // Range requests bypass the cache: partial responses are awkward to cache
  // and the client-side code does a single full-file fetch anyway.
  if (request.headers.get("range")) return build();
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const fresh = await build();
  if (fresh.ok) ctx.waitUntil(cache.put(cacheKey, fresh.clone()));
  return fresh;
}

export async function handleSlpObject(
  request: Request,
  env: GifEnv,
  ctx: ExecutionContext,
  rawId: string
): Promise<Response> {
  if (!/^\d+$/.test(rawId)) return errorResponse(400, "Bad SLP id");
  const id = parseInt(rawId, 10);
  if (!(await isKnownSlpId(env, id))) return errorResponse(404, "Unknown SLP id");

  return cachedObject(request, ctx, async () => {
    try {
      const upstream = await getObject(env, env.GARAGE_BUCKET_SLP, `${id}.slp`, request.headers);
      if (upstream.status === 404) return errorResponse(404, `SLP ${id} not in bucket`);
      if (!upstream.ok && upstream.status !== 206) {
        return errorResponse(502, `Garage GetObject failed: ${upstream.status}`);
      }
      return proxyResponse(upstream, `${id}.slp`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(502, `SLP fetch failed: ${message}`);
    }
  });
}

export async function handleSldObject(
  request: Request,
  env: GifEnv,
  ctx: ExecutionContext,
  rawKey: string
): Promise<Response> {
  if (!/^[a-z0-9_]+$/i.test(rawKey)) return errorResponse(400, "Bad SLD key");
  if (!(await isKnownSldKey(env, rawKey))) return errorResponse(404, "Unknown SLD key");

  return cachedObject(request, ctx, async () => {
    try {
      const upstream = await getObject(env, env.GARAGE_BUCKET_SLD, `${rawKey}.sld`, request.headers);
      if (upstream.status === 404) return errorResponse(404, `${rawKey}.sld not in bucket`);
      if (!upstream.ok && upstream.status !== 206) {
        return errorResponse(502, `Garage GetObject failed: ${upstream.status}`);
      }
      return proxyResponse(upstream, `${rawKey}.sld`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(502, `SLD fetch failed: ${message}`);
    }
  });
}

// Dispatch table used by src/index.ts. Returns null if the request doesn't
// match any /api/gif/* route so the caller can fall through to the next
// router.
export async function routeGif(
  request: Request,
  env: GifEnv,
  ctx: ExecutionContext,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith("/api/gif/")) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(405, "Method not allowed");
  }

  if (pathname === "/api/gif/slp/manifest") return handleSlpManifest(request, env, ctx);
  if (pathname === "/api/gif/sld/manifest") return handleSldManifest(request, env, ctx);

  const slpMatch = /^\/api\/gif\/slp\/([^/]+)$/.exec(pathname);
  if (slpMatch) {
    const base = slpMatch[1];
    const id = base.endsWith(".slp") ? base.slice(0, -4) : base;
    return handleSlpObject(request, env, ctx, id);
  }

  const sldMatch = /^\/api\/gif\/sld\/([^/]+)$/.exec(pathname);
  if (sldMatch) {
    const base = sldMatch[1];
    const key = base.endsWith(".sld") ? base.slice(0, -4) : base;
    return handleSldObject(request, env, ctx, key);
  }

  return errorResponse(404, "Not found");
}
