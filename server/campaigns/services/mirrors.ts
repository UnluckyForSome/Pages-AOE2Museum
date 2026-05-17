import type { CampaignsEnv } from "../env";

export async function deleteCampaignMirrorsOnly(
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

  for (const m of mirrors ?? []) {
    await env.BUCKET.delete(m.r2_key).catch(() => {});
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM hearts WHERE target_kind = 'scenario' AND target_id = ?",
      ).bind(m.id),
      env.DB.prepare("DELETE FROM campaign_scenarios WHERE scenario_id = ?").bind(m.id),
      env.DB.prepare("DELETE FROM scenarios WHERE id = ?").bind(m.id),
    ]);
  }
}
