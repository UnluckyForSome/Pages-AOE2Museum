import type { CampaignsEnv } from "../env";
import type { MuseumUser } from "../../auth/services/session";
import { isAdmin } from "../../auth/services/admin";

export async function deleteCampaignById(
  env: CampaignsEnv,
  campaignId: number,
): Promise<void> {
  const { results: mirrors } = await env.DB.prepare(
    `SELECT s.id, s.r2_key FROM scenarios s
     INNER JOIN campaign_scenarios cs ON cs.scenario_id = s.id
     WHERE cs.campaign_id = ?`,
  )
    .bind(campaignId)
    .all<{ id: number; r2_key: string }>();

  const campaign = await env.DB.prepare("SELECT r2_key FROM campaigns WHERE id = ?")
    .bind(campaignId)
    .first<{ r2_key: string }>();

  const r2Deletes: Promise<unknown>[] = [];
  if (campaign) r2Deletes.push(env.CAMPAIGNS_BUCKET.delete(campaign.r2_key).catch(() => {}));
  for (const m of mirrors ?? []) {
    r2Deletes.push(env.BUCKET.delete(m.r2_key).catch(() => {}));
  }
  await Promise.all(r2Deletes);

  const mirrorIds = (mirrors ?? []).map((m) => m.id);
  const stmts = [
    env.DB.prepare("DELETE FROM hearts WHERE target_kind = 'campaign' AND target_id = ?").bind(
      campaignId,
    ),
    env.DB.prepare("DELETE FROM campaign_versions WHERE campaign_id = ?").bind(campaignId),
    env.DB.prepare("DELETE FROM campaign_scenarios WHERE campaign_id = ?").bind(campaignId),
  ];
  if (mirrorIds.length > 0) {
    const ph = mirrorIds.map(() => "?").join(",");
    stmts.push(
      env.DB.prepare(
        `DELETE FROM hearts WHERE target_kind = 'scenario' AND target_id IN (${ph})`,
      ).bind(...mirrorIds),
      env.DB.prepare(`DELETE FROM scenarios WHERE id IN (${ph})`).bind(...mirrorIds),
    );
  }
  stmts.push(env.DB.prepare("DELETE FROM campaigns WHERE id = ?").bind(campaignId));
  await env.DB.batch(stmts);
}

export async function handleCampaignDelete(
  env: CampaignsEnv,
  id: string,
  user: MuseumUser,
): Promise<Response> {
  const row = await env.DB.prepare("SELECT uploader_id FROM campaigns WHERE id = ?")
    .bind(id)
    .first<{ uploader_id: string }>();
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.uploader_id !== user.id && !isAdmin(env, user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  await deleteCampaignById(env, Number(id));
  return Response.json({ ok: true });
}
