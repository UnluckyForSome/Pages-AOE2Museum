import type { CampaignsEnv } from "../env";
import { getUserOrNull } from "../../auth/services/session";
import { isAdmin } from "../../auth/services/admin";

export async function handleCampaignList(
  request: Request,
  env: CampaignsEnv,
): Promise<Response> {
  const viewer = await getUserOrNull(request, env);
  const viewerId = viewer?.id ?? null;
  const viewerIsAdmin = viewer ? isAdmin(env, viewer) : false;

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.original_filename, c.stored_filename, c.display_title, c.ext,
            c.size, c.uploaded_at, c.updated_at, c.downloads, c.visibility,
            c.hearts_count, c.version, c.uploader_id,
            u.username AS uploader_username
     FROM campaigns c
     LEFT JOIN "user" u ON c.uploader_id = u.id
     ORDER BY c.uploaded_at DESC`,
  ).all<{
    visibility: string;
    uploader_id: string;
  }>();

  const filtered = (results ?? []).filter((row) => {
    const isOwner = viewerId && row.uploader_id === viewerId;
    if (isOwner || viewerIsAdmin) return true;
    return row.visibility !== "hidden";
  });

  return Response.json(filtered);
}
