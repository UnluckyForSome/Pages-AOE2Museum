import type { CampaignsEnv } from "../env";
import { getUserOrNull } from "../../auth/services/session";
import { isAdmin } from "../../auth/services/admin";

export async function handleCampaignDetail(
  request: Request,
  env: CampaignsEnv,
  id: string,
): Promise<Response> {
  const viewer = await getUserOrNull(request, env);

  const campaign = await env.DB.prepare(
    `SELECT c.*, u.username AS uploader_username
     FROM campaigns c
     LEFT JOIN "user" u ON c.uploader_id = u.id
     WHERE c.id = ?`,
  )
    .bind(id)
    .first();

  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });

  const c = campaign as {
    visibility: string;
    uploader_id: string;
    uploader_username: string | null;
  };
  const isOwner = viewer?.id === c.uploader_id;
  const viewerIsAdmin = viewer ? isAdmin(env, viewer) : false;
  if (c.visibility === "hidden" && !isOwner && !viewerIsAdmin) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const { results: scenarios } = await env.DB.prepare(
    `SELECT s.id, s.filename, s.original_filename, s.filetype, s.size, s.downloads
     FROM scenarios s
     INNER JOIN campaign_scenarios cs ON cs.scenario_id = s.id
     WHERE cs.campaign_id = ?
     ORDER BY s.id`,
  )
    .bind(id)
    .all();

  const { results: versions } = await env.DB.prepare(
    "SELECT version, updated_at FROM campaign_versions WHERE campaign_id = ? ORDER BY version",
  )
    .bind(id)
    .all();

  return Response.json({
    ...campaign,
    uploader: c.uploader_username ?? "Unknown",
    scenarios: scenarios ?? [],
    versions: versions ?? [],
  });
}
