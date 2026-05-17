import type { Env } from "../worker/env";
import { requireVerifiedUser, getUserOrNull } from "../auth/services/session";
import { handleHistorySave } from "./handlers/save";
import { handleHistoryMine, handleHistoryPublic, handleHistoryArtifact } from "./handlers/list";
import { handleHistoryDelete } from "./handlers/delete";

const HISTORY_ID_RE = /^\/api\/history\/([a-f0-9-]+)$/;

export async function routeHistory(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/history/save" && request.method === "POST") {
    const user = await requireVerifiedUser(request, env);
    if (user instanceof Response) return user;
    return handleHistorySave(request, env, user);
  }

  if (pathname === "/api/history/mine" && request.method === "GET") {
    return handleHistoryMine(request, env);
  }

  if (pathname === "/api/history/public" && request.method === "GET") {
    return handleHistoryPublic(request, env);
  }

  const artifact = pathname.match(HISTORY_ID_RE);
  if (artifact) {
    if (request.method === "GET") {
      return handleHistoryArtifact(artifact[1], env, request);
    }
    if (request.method === "DELETE") {
      const user = await getUserOrNull(request, env);
      if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
      return handleHistoryDelete(env, artifact[1], user);
    }
  }

  return null;
}
