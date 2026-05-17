import type { Env } from "../worker/env";
import { json } from "../http/json";
import { handleList } from "./handlers/list";
import { handleUpload } from "./handlers/upload";
import { handleDownload } from "./handlers/download";
import { handleSync } from "./handlers/sync";
import { handleScenarioVisibility } from "./handlers/visibility";
import { handleScenarioDelete } from "./handlers/delete";
import {
  handleScenarioDetails,
  handleScenarioDetailsPut,
  handleScenarioMinimap,
} from "./handlers/details";
import { requireVerifiedUser, getUserOrNull } from "../auth/services/session";

const SCENARIOS_DOWNLOAD_RE = /^\/api\/scenarios\/download\/(\d+)$/;
const SCENARIOS_VISIBILITY_RE = /^\/api\/scenarios\/(\d+)\/visibility$/;
const SCENARIOS_DETAILS_RE = /^\/api\/scenarios\/(\d+)\/details$/;
const SCENARIOS_MINIMAP_RE = /^\/api\/scenarios\/(\d+)\/minimap\.png$/;
const SCENARIOS_DELETE_RE = /^\/api\/scenarios\/(\d+)$/;

export async function routeScenarios(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/scenarios" && request.method === "GET") {
    return handleList(request, env);
  }

  if (pathname === "/api/scenarios/upload" && request.method === "POST") {
    return handleUpload(request, env);
  }

  const vis = pathname.match(SCENARIOS_VISIBILITY_RE);
  if (vis && request.method === "PATCH") {
    const user = await requireVerifiedUser(request, env);
    if (user instanceof Response) return user;
    return handleScenarioVisibility(request, env, vis[1], user);
  }

  const details = pathname.match(SCENARIOS_DETAILS_RE);
  if (details) {
    if (request.method === "GET") {
      return handleScenarioDetails(request, env, details[1]);
    }
    if (request.method === "PUT") {
      return handleScenarioDetailsPut(request, env, details[1]);
    }
  }

  const minimap = pathname.match(SCENARIOS_MINIMAP_RE);
  if (minimap && request.method === "GET") {
    return handleScenarioMinimap(request, env, minimap[1]);
  }

  const del = pathname.match(SCENARIOS_DELETE_RE);
  if (del && request.method === "DELETE") {
    const user = await getUserOrNull(request, env);
    if (!user) return json({ error: "Sign in required" }, { status: 401 });
    return handleScenarioDelete(env, del[1], user, env);
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
