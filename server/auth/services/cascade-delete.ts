import type { AuthEnv } from "../env";

/** Permanently remove all user-owned content (PLAN.md account deletion). */
export async function cascadeDeleteUser(env: AuthEnv, userId: string): Promise<void> {
  const { results: scenarioRows } = await env.DB.prepare(
    "SELECT id, r2_key FROM scenarios WHERE uploader_id = ?",
  )
    .bind(userId)
    .all<{ id: number; r2_key: string }>();

  const { results: campaignRows } = await env.DB.prepare(
    "SELECT id, r2_key FROM campaigns WHERE uploader_id = ?",
  )
    .bind(userId)
    .all<{ id: number; r2_key: string }>();

  const { results: historyRows } = await env.DB.prepare(
    "SELECT id, r2_key, kind FROM generation_history WHERE user_id = ?",
  )
    .bind(userId)
    .all<{ id: string; r2_key: string; kind: string }>();

  const r2Deletes: Promise<unknown>[] = [];
  for (const s of scenarioRows ?? []) {
    r2Deletes.push(env.BUCKET.delete(s.r2_key).catch(() => {}));
  }
  for (const c of campaignRows ?? []) {
    r2Deletes.push(env.CAMPAIGNS_BUCKET.delete(c.r2_key).catch(() => {}));
  }
  for (const h of historyRows ?? []) {
    const bucket = h.kind === "gif" ? env.GIFS : env.MINIMAPS;
    r2Deletes.push(bucket.delete(h.r2_key).catch(() => {}));
  }
  await Promise.all(r2Deletes);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM hearts WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM generation_history WHERE user_id = ?").bind(userId),
    env.DB.prepare(
      "DELETE FROM scenarios WHERE uploader_id = ? OR campaign_id IN (SELECT id FROM campaigns WHERE uploader_id = ?)",
    ).bind(userId, userId),
    env.DB.prepare("DELETE FROM campaign_scenarios WHERE campaign_id IN (SELECT id FROM campaigns WHERE uploader_id = ?)").bind(userId),
    env.DB.prepare("DELETE FROM campaign_versions WHERE campaign_id IN (SELECT id FROM campaigns WHERE uploader_id = ?)").bind(userId),
    env.DB.prepare("DELETE FROM campaigns WHERE uploader_id = ?").bind(userId),
  ]);
}
