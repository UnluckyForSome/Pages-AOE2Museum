import type { Env } from "../worker/env";
import { requireVerifiedUser } from "../auth/services/session";

type TargetKind = "scenario" | "campaign";

export async function handleHeartToggle(
  request: Request,
  env: Env,
): Promise<Response> {
  const user = await requireVerifiedUser(request, env);
  if (user instanceof Response) return user;

  const body = (await request.json()) as { kind?: TargetKind; id?: number };
  if (body.kind !== "scenario" && body.kind !== "campaign") {
    return Response.json({ error: "kind must be scenario or campaign" }, { status: 400 });
  }
  if (typeof body.id !== "number" && typeof body.id !== "string") {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  const targetId = Number(body.id);

  let kind: TargetKind = body.kind;
  let actualTargetId = targetId;

  if (kind === "scenario") {
    const row = await env.DB.prepare(
      "SELECT kind, campaign_id FROM scenarios WHERE id = ?",
    )
      .bind(targetId)
      .first<{ kind: string; campaign_id: number | null }>();
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    if (row.kind === "campaign_mirror" && row.campaign_id) {
      kind = "campaign";
      actualTargetId = row.campaign_id;
    }
  }

  const existing = await env.DB.prepare(
    "SELECT 1 FROM hearts WHERE user_id = ? AND target_kind = ? AND target_id = ?",
  )
    .bind(user.id, kind, actualTargetId)
    .first();

  if (existing) {
    await env.DB.prepare(
      "DELETE FROM hearts WHERE user_id = ? AND target_kind = ? AND target_id = ?",
    )
      .bind(user.id, kind, actualTargetId)
      .run();
    await adjustHeartCount(env, kind, actualTargetId, -1);
    return Response.json({ hearted: false });
  }

  await env.DB.prepare(
    "INSERT INTO hearts (user_id, target_kind, target_id) VALUES (?, ?, ?)",
  )
    .bind(user.id, kind, actualTargetId)
    .run();
  await adjustHeartCount(env, kind, actualTargetId, 1);
  return Response.json({ hearted: true });
}

async function adjustHeartCount(
  env: Env,
  kind: TargetKind,
  id: number,
  delta: number,
): Promise<void> {
  const table = kind === "campaign" ? "campaigns" : "scenarios";
  await env.DB.prepare(
    `UPDATE ${table} SET hearts_count = MAX(0, hearts_count + ?) WHERE id = ?`,
  )
    .bind(delta, id)
    .run();
}
