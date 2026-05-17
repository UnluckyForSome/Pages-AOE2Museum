import type { ScenariosEnv } from "../env";
import type { MuseumUser } from "../../auth/services/session";
import { isAdmin } from "../../auth/services/admin";
import type { AuthEnv } from "../../auth/env";

export async function handleScenarioDelete(
  env: ScenariosEnv,
  id: string,
  user: MuseumUser,
  authEnv: AuthEnv,
): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT id, uploader_id, kind, r2_key, campaign_id, minimap_r2_key FROM scenarios WHERE id = ?",
  )
    .bind(id)
    .first<{
      id: number;
      uploader_id: string | null;
      kind: string;
      r2_key: string;
      campaign_id: number | null;
      minimap_r2_key: string | null;
    }>();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.kind === "campaign_mirror") {
    return Response.json(
      { error: "Delete the parent campaign instead" },
      { status: 400 },
    );
  }
  if (row.uploader_id !== user.id && !isAdmin(authEnv, user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await env.DB.prepare(
    "INSERT OR IGNORE INTO deleted_r2_keys (r2_key, deleted_at) VALUES (?, datetime('now'))",
  )
    .bind(row.r2_key)
    .run();

  await env.BUCKET.delete(row.r2_key).catch(() => {});
  if (row.minimap_r2_key) {
    await env.MINIMAPS.delete(row.minimap_r2_key).catch(() => {});
  }
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM hearts WHERE target_kind = 'scenario' AND target_id = ?",
    ).bind(id),
    env.DB.prepare("DELETE FROM campaign_scenarios WHERE scenario_id = ?").bind(id),
    env.DB.prepare("DELETE FROM scenarios WHERE id = ?").bind(id),
  ]);

  return Response.json({ ok: true });
}
