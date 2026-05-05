import type { Env } from "./env";
import { json } from "../http/json";
import { handleGalleryImage, handleGalleryList, handleGalleryPost } from "../minimap/gallery";
import {
  handleAocrecRecent,
  handleAocrecSearch,
  handleAocrecSynonyms,
  handleAocrecZip,
} from "../minimap/aocrec";
import { handleMsProfileSearch, handleMsRecentMatches, handleMsReplayZip } from "../minimap/microsoft";
import { handleModsSearch, handleModsZip } from "../minimap/mods";
import { routeScenarios } from "../scenarios/routes";
import { handleSync } from "../scenarios/handlers/sync";
import { routeGif } from "../gif/handlers";

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

    if (pathname === "/api/aocrec/synonyms" && request.method === "GET") {
      return handleAocrecSynonyms();
    }
    if (pathname === "/api/aocrec/recent" && request.method === "GET") {
      return handleAocrecRecent(request, env, ctx);
    }
    if (pathname === "/api/aocrec/search" && request.method === "GET") {
      return handleAocrecSearch(request, env, ctx);
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

    if (pathname === "/api/mods/search") {
      return handleModsSearch(request, ctx);
    }
    if (pathname === "/api/mods/zip" && request.method === "GET") {
      return handleModsZip(request, ctx);
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

