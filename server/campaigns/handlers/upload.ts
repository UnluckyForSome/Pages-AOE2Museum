import type { CampaignsEnv } from "../env";
import { isCampaignFile } from "../env";
import { requireVerifiedUser } from "../../auth/services/session";
import { getTurnstileSecretForRequest, verifyTurnstile } from "../../scenarios/services/turnstile";
import { computeMd5, getExtension, checkFileSize } from "../../scenarios/services/validation";
import { displayTitleFromFilename, usernameSuffixFilename } from "../../scenarios/services/filenames";
import { findCampaignStandaloneConflicts } from "../../scenarios/services/collisions";
import { extractCampaign } from "../services/extract";
import { verifyScenario, ScenarioVerifierUnavailableError } from "../../scenarios/services/verify-scenario";

const MAX_CAMPAIGN_SIZE = 50 * 1024 * 1024;

function getFormFile(formData: FormData): { name: string; arrayBuffer: () => Promise<ArrayBuffer> } | null {
  const file = formData.get("file");
  if (!file || typeof file === "string" || !("arrayBuffer" in file)) return null;
  return file as { name: string; arrayBuffer: () => Promise<ArrayBuffer> };
}

export async function handleCampaignUpload(
  request: Request,
  env: CampaignsEnv,
): Promise<Response> {
  const user = await requireVerifiedUser(request, env);
  if (user instanceof Response) return user;
  const formData = await request.formData();
  const turnstileToken = formData.get("cf-turnstile-response") as string | null;
  if (!turnstileToken) {
    return Response.json({ error: "Missing Turnstile token" }, { status: 400 });
  }
  const ip = request.headers.get("CF-Connecting-IP") ?? undefined;
  const valid = await verifyTurnstile(
    turnstileToken,
    getTurnstileSecretForRequest(request.url, env.TURNSTILE_SECRET),
    ip,
  );
  if (!valid) {
    return Response.json({ error: "Turnstile verification failed" }, { status: 403 });
  }

  const file = getFormFile(formData);
  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }
  if (!isCampaignFile(file.name)) {
    return Response.json(
      { error: "Invalid type. Use .cpn, .cpx, .aoecpn, or .aoe2campaign" },
      { status: 400 },
    );
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_CAMPAIGN_SIZE) {
    return Response.json({ error: "Campaign file too large (max 50 MB)" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = extractCampaign(buffer);
  } catch (e: unknown) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to parse campaign" },
      { status: 400 },
    );
  }

  const scenarioNames = parsed.scenarios.map((s) => s.fileName);
  const conflicts = await findCampaignStandaloneConflicts(env, scenarioNames, user.username);
  if (conflicts.length > 0) {
    return Response.json(
      {
        error: "Campaign upload rejected: filename conflicts with existing standalone scenarios",
        conflicts,
      },
      { status: 409 },
    );
  }

  const md5 = await computeMd5(buffer);
  const existing = await env.DB.prepare("SELECT id FROM campaigns WHERE sha256 = ?")
    .bind(md5)
    .first();
  if (existing) {
    return Response.json({ error: "Duplicate campaign file" }, { status: 409 });
  }

  for (const scen of parsed.scenarios) {
    try {
      const v = await verifyScenario(
        env,
        scen.fileName,
        scen.bytes.buffer as ArrayBuffer,
      );
      if (!v.valid) {
        return Response.json(
          { error: `Scenario "${scen.fileName}" failed verification: ${v.reason ?? "invalid"}` },
          { status: 400 },
        );
      }
    } catch (e) {
      if (e instanceof ScenarioVerifierUnavailableError) {
        return Response.json({ error: "Verifier unavailable" }, { status: 503 });
      }
      throw e;
    }
  }

  const ext = getExtension(file.name);
  const displayTitle = displayTitleFromFilename(file.name);
  const storedFilename = usernameSuffixFilename(file.name, user.username);
  const r2Key = storedFilename;

  await env.CAMPAIGNS_BUCKET.put(r2Key, buffer);

  const insertResult = await env.DB.prepare(
    `INSERT INTO campaigns (uploader_id, original_filename, stored_filename, display_title,
      ext, size, sha256, r2_key, visibility, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'public', 1)`,
  )
    .bind(user.id, file.name, storedFilename, displayTitle, ext, buffer.byteLength, md5, r2Key)
    .run();

  const campaignId = insertResult.meta.last_row_id as number;

  await env.DB.prepare(
    "INSERT INTO campaign_versions (campaign_id, version) VALUES (?, 1)",
  )
    .bind(campaignId)
    .run();

  for (const scen of parsed.scenarios) {
    const scenMd5 = await computeMd5(scen.bytes.buffer as ArrayBuffer);
    const scenStored = usernameSuffixFilename(scen.fileName, user.username);
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
        campaignId,
      )
      .run();

    const scenId = scenInsert.meta.last_row_id as number;

    await env.DB.prepare(
      "INSERT INTO campaign_scenarios (campaign_id, scenario_id) VALUES (?, ?)",
    )
      .bind(campaignId, scenId)
      .run();
  }

  return Response.json({ id: campaignId, stored_filename: storedFilename }, { status: 201 });
}
