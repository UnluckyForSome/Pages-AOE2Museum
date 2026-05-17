import type { ScenariosEnv } from "../env";
import type { MuseumUser } from "../../auth/services/session";
import { isAdmin } from "../../auth/services/admin";
import type { AuthEnv } from "../../auth/env";

export async function handleScenarioVisibility(
  request: Request,
  env: ScenariosEnv & AuthEnv,
  id: string,
  user: MuseumUser,
): Promise<Response> {
  const body = (await request.json()) as { visibility?: string };
  if (body.visibility !== "public" && body.visibility !== "hidden") {
    return Response.json({ error: "visibility must be public or hidden" }, { status: 400 });
  }

  const row = await env.DB.prepare(
    "SELECT id, uploader_id, kind FROM scenarios WHERE id = ?",
  )
    .bind(id)
    .first<{ id: number; uploader_id: string | null; kind: string }>();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.kind === "campaign_mirror") {
    return Response.json(
      { error: "Campaign-owned scenarios inherit parent campaign visibility" },
      { status: 400 },
    );
  }
  if (row.uploader_id !== user.id && !isAdmin(env, user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await env.DB.prepare("UPDATE scenarios SET visibility = ? WHERE id = ?")
    .bind(body.visibility, id)
    .run();

  return Response.json({ ok: true, visibility: body.visibility });
}
