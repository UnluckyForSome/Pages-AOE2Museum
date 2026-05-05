import type { Env } from "../worker/env";
import { json } from "../http/json";
import { handleList } from "./handlers/list";
import { handleUpload } from "./handlers/upload";
import { handleDownload } from "./handlers/download";
import { handleSync } from "./handlers/sync";

const SCENARIOS_DOWNLOAD_RE = /^\/api\/scenarios\/download\/(\d+)$/;

export async function routeScenarios(
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

