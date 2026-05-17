import type { CampaignsEnv } from "../env";
import type { MuseumUser } from "../../auth/services/session";
import { isAdmin } from "../../auth/services/admin";
import { isCampaignFile } from "../env";
import { extractCampaign } from "../services/extract";
import { computeMd5, getExtension } from "../../scenarios/services/validation";
import { usernameSuffixFilename } from "../../scenarios/services/filenames";
import { findCampaignStandaloneConflicts } from "../../scenarios/services/collisions";
import { verifyScenario, ScenarioVerifierUnavailableError } from "../../scenarios/services/verify-scenario";
const MAX_CAMPAIGN_SIZE = 50 * 1024 * 1024;

function getFormFile(formData: FormData): { name: string; arrayBuffer: () => Promise<ArrayBuffer> } | null {
  const file = formData.get("file");
  if (!file || typeof file === "string" || !("arrayBuffer" in file)) return null;
  return file as { name: string; arrayBuffer: () => Promise<ArrayBuffer> };
}

export async function handleCampaignUpdate(
  request: Request,
  env: CampaignsEnv,
  id: string,
  user: MuseumUser,
): Promise<Response> {
  const campaign = await env.DB.prepare(
    "SELECT id, uploader_id, version, stored_filename, r2_key FROM campaigns WHERE id = ?",
  )
    .bind(id)
    .first<{
      id: number;
      uploader_id: string;
      version: number;
      stored_filename: string;
      r2_key: string;
    }>();

  if (!campaign) return Response.json({ error: "Not found" }, { status: 404 });
  if (campaign.uploader_id !== user.id && !isAdmin(env, user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = getFormFile(formData);
  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  if (!isCampaignFile(file.name)) {
    return Response.json({ error: "Invalid campaign file type" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_CAMPAIGN_SIZE) {
    return Response.json({ error: "File too large" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = extractCampaign(buffer);
  } catch (e: unknown) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Parse failed" },
      { status: 400 },
    );
  }

  const username = user.username;
  const newNames = new Set(parsed.scenarios.map((s) => s.fileName));
  const { results: oldMirrors } = await env.DB.prepare(
    `SELECT s.id, s.original_filename, s.r2_key FROM scenarios s
     INNER JOIN campaign_scenarios cs ON cs.scenario_id = s.id
     WHERE cs.campaign_id = ?`,
  )
    .bind(id)
    .all<{ id: number; original_filename: string; r2_key: string }>();

  const removed = (oldMirrors ?? []).filter((m) => !newNames.has(m.original_filename));
  const keptNames = new Set(
    (oldMirrors ?? [])
      .filter((m) => newNames.has(m.original_filename))
      .map((m) => m.original_filename),
  );
  const added = parsed.scenarios.filter((s) => !keptNames.has(s.fileName));

  const conflicts = await findCampaignStandaloneConflicts(
    env,
    added.map((s) => s.fileName),
    username,
  );
  if (conflicts.length > 0) {
    return Response.json({ error: "Standalone filename conflicts", conflicts }, { status: 409 });
  }

  for (const scen of parsed.scenarios) {
    try {
      const v = await verifyScenario(
        env,
        scen.fileName,
        scen.bytes.buffer as ArrayBuffer,
      );
      if (!v.valid) {
        return Response.json({ error: `Invalid scenario: ${scen.fileName}` }, { status: 400 });
      }
    } catch (e) {
      if (e instanceof ScenarioVerifierUnavailableError) {
        return Response.json({ error: "Verifier unavailable" }, { status: 503 });
      }
      throw e;
    }
  }

  for (const m of removed) {
    await env.BUCKET.delete(m.r2_key).catch(() => {});
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM hearts WHERE target_kind = 'scenario' AND target_id = ?",
      ).bind(m.id),
      env.DB.prepare("DELETE FROM campaign_scenarios WHERE scenario_id = ?").bind(m.id),
      env.DB.prepare("DELETE FROM scenarios WHERE id = ?").bind(m.id),
    ]);
  }

  await env.CAMPAIGNS_BUCKET.put(campaign.r2_key, buffer);
  const md5 = await computeMd5(buffer);
  const newVersion = campaign.version + 1;

  await env.DB.prepare(
    `UPDATE campaigns SET size = ?, sha256 = ?, version = ?, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(buffer.byteLength, md5, newVersion, id)
    .run();

  await env.DB.prepare(
    "INSERT INTO campaign_versions (campaign_id, version) VALUES (?, ?)",
  )
    .bind(id, newVersion)
    .run();

  for (const scen of parsed.scenarios) {
    if (keptNames.has(scen.fileName)) continue;
    const scenMd5 = await computeMd5(scen.bytes.buffer as ArrayBuffer);
    const scenStored = usernameSuffixFilename(scen.fileName, username);
    const scenExt = getExtension(scen.fileName);
    await env.BUCKET.put(scenStored, scen.bytes);
    const scenInsert = await env.DB.prepare(
      `INSERT INTO scenarios (filename, original_filename, filetype, size, sha256, r2_key,
        uploader_id, visibility, kind, campaign_id, hearts_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'public', 'campaign_mirror', ?, 0)`,
    )
      .bind(
        scenStored,
        scen.fileName,
        scenExt,
        scen.bytes.byteLength,
        scenMd5,
        scenStored,
        user.id,
        id,
      )
      .run();

    await env.DB.prepare(
      "INSERT INTO campaign_scenarios (campaign_id, scenario_id) VALUES (?, ?)",
    )
      .bind(id, scenInsert.meta.last_row_id)
      .run();
  }

  return Response.json({ ok: true, version: newVersion });
}
