import type { Env } from "./env";
import { json } from "../http/json";
import { handleGalleryImage, handleGalleryList, handleGalleryPost } from "../minimap/gallery";
import {
  handleGifGalleryImage,
  handleGifGalleryList,
  handleGifGalleryPost,
} from "../gif/gallery";
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
import { routeAuth } from "../auth/routes";
import { routeCampaigns } from "../campaigns/routes";
import { routeHearts } from "../hearts/routes";
import { routeHistory } from "../history/routes";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    const pagePrefixes = [
      "minimap",
      "gif",
      "scenarios",
      "campaigns",
      "campaignmanager",
      "account",
      "originalmods",
      "contact",
      "home",
    ];

    const accept = request.headers.get("accept") || "";
    const isHtmlRequest =
      (request.method === "GET" || request.method === "HEAD") &&
      (accept.includes("text/html") || accept.includes("application/xhtml+xml"));
    const shellPaths = new Set([
      "/",
      "/home",
      "/home/",
      "/minimap",
      "/minimap/",
      "/gif",
      "/gif/",
      "/scenarios",
      "/scenarios/",
      "/campaigns",
      "/campaigns/",
      "/campaignmanager",
      "/campaignmanager/",
      "/account",
      "/account/",
      "/originalmods",
      "/originalmods/",
      "/contact",
      "/contact/",
      "/contact.html",
    ]);

    if (isHtmlRequest && shellPaths.has(pathname)) {
      const nextUrl = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(nextUrl, request));
    }

    for (const p of pagePrefixes) {
      const prefix = "/" + p;
      if (pathname.startsWith(prefix + "/")) {
        const nextUrl = new URL("/pages" + pathname, url);
        return env.ASSETS.fetch(new Request(nextUrl, request));
      }
    }

    if (pathname === "/health") {
      return json({ ok: true, service: "aoe2museum" });
    }

    const authRes = await routeAuth(request, env, pathname);
    if (authRes) return authRes;

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

    if (pathname === "/api/gif/gallery") {
      if (request.method === "POST") return handleGifGalleryPost(request, env);
      if (request.method === "GET") return handleGifGalleryList(env);
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "GET, POST" },
      });
    }

    if (pathname.startsWith("/api/gif/gallery/")) {
      if (request.method !== "GET") {
        return new Response("method not allowed", {
          status: 405,
          headers: { allow: "GET" },
        });
      }
      return handleGifGalleryImage(pathname.slice("/api/gif/gallery/".length), env);
    }

    if (pathname === "/api/scenarios" || pathname.startsWith("/api/scenarios/")) {
      const res = await routeScenarios(request, env, ctx, pathname);
      if (res) return res;
      return new Response("not found", { status: 404 });
    }

    if (pathname === "/api/campaigns" || pathname.startsWith("/api/campaigns/")) {
      const res = await routeCampaigns(request, env, ctx, pathname);
      if (res) return res;
      return new Response("not found", { status: 404 });
    }

    const heartsRes = await routeHearts(request, env, pathname);
    if (heartsRes) return heartsRes;

    if (pathname.startsWith("/api/history")) {
      const res = await routeHistory(request, env, pathname);
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
