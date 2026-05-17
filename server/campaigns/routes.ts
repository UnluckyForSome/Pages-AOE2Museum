import type { Env } from "../worker/env";
import { handleCampaignList } from "./handlers/list";
import { handleCampaignUpload } from "./handlers/upload";
import { handleCampaignDownload } from "./handlers/download";
import { handleCampaignDetail } from "./handlers/detail";
import { handleCampaignVisibility } from "./handlers/visibility";
import { handleCampaignDelete } from "./handlers/delete";
import { handleCampaignUpdate } from "./handlers/update";
import { requireVerifiedUser, getUserOrNull } from "../auth/services/session";

const CAMPAIGN_ID_RE = /^\/api\/campaigns\/(\d+)$/;
const CAMPAIGN_DOWNLOAD_RE = /^\/api\/campaigns\/download\/(\d+)$/;
const CAMPAIGN_VISIBILITY_RE = /^\/api\/campaigns\/(\d+)\/visibility$/;
const CAMPAIGN_UPDATE_RE = /^\/api\/campaigns\/(\d+)\/update$/;

export async function routeCampaigns(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/campaigns" && request.method === "GET") {
    return handleCampaignList(request, env);
  }

  if (pathname === "/api/campaigns/upload" && request.method === "POST") {
    return handleCampaignUpload(request, env);
  }

  const dl = pathname.match(CAMPAIGN_DOWNLOAD_RE);
  if (dl && request.method === "GET") {
    return handleCampaignDownload(dl[1], env, ctx);
  }

  const vis = pathname.match(CAMPAIGN_VISIBILITY_RE);
  if (vis && request.method === "PATCH") {
    const user = await requireVerifiedUser(request, env);
    if (user instanceof Response) return user;
    return handleCampaignVisibility(request, env, vis[1], user);
  }

  const upd = pathname.match(CAMPAIGN_UPDATE_RE);
  if (upd && request.method === "POST") {
    const user = await requireVerifiedUser(request, env);
    if (user instanceof Response) return user;
    return handleCampaignUpdate(request, env, upd[1], user);
  }

  const detail = pathname.match(CAMPAIGN_ID_RE);
  if (detail) {
    if (request.method === "GET") {
      return handleCampaignDetail(request, env, detail[1]);
    }
    if (request.method === "DELETE") {
      const user = await getUserOrNull(request, env);
      if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
      return handleCampaignDelete(env, detail[1], user);
    }
  }

  return null;
}
