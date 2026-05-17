import type { CampaignsEnv } from "../env";
import type { MuseumUser } from "../../auth/services/session";
import { isAdmin } from "../../auth/services/admin";

export async function handleCampaignVisibility(
  request: Request,
  env: CampaignsEnv,
  id: string,
  user: MuseumUser,
): Promise<Response> {
  const body = (await request.json()) as { visibility?: string };
  if (body.visibility !== "public" && body.visibility !== "hidden") {
    return Response.json({ error: "visibility must be public or hidden" }, { status: 400 });
  }

  const row = await env.DB.prepare("SELECT uploader_id FROM campaigns WHERE id = ?")
    .bind(id)
    .first<{ uploader_id: string }>();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.uploader_id !== user.id && !isAdmin(env, user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await env.DB.prepare(
    "UPDATE campaigns SET visibility = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(body.visibility, id)
    .run();

  return Response.json({ ok: true, visibility: body.visibility });
}
