import type { HistoryEnv } from "../env";
import type { MuseumUser } from "../../auth/services/session";

function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function maxPerKind(env: HistoryEnv): number {
  const n = parseInt(env.MY_GALLERY_MAX_PER_KIND || "20", 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

export async function handleHistorySave(
  request: Request,
  env: HistoryEnv,
  user: MuseumUser,
): Promise<Response> {
  const body = (await request.json()) as {
    kind?: string;
    source_filename?: string;
    settings?: Record<string, unknown>;
    visibility?: string;
    artifact_base64?: string;
    content_type?: string;
  };

  if (body.kind !== "minimap" && body.kind !== "gif") {
    return Response.json({ error: "kind must be minimap or gif" }, { status: 400 });
  }
  if (!body.source_filename?.trim()) {
    return Response.json({ error: "source_filename required" }, { status: 400 });
  }
  if (!body.artifact_base64) {
    return Response.json({ error: "artifact_base64 required" }, { status: 400 });
  }

  const visibility =
    body.visibility === "hidden" ? "hidden" : "public";

  let bytes: Uint8Array;
  try {
    const bin = atob(body.artifact_base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return Response.json({ error: "Invalid base64" }, { status: 400 });
  }

  const ext = body.kind === "gif" ? "gif" : "png";
  const id = newId();
  const r2Key = `history/${user.id}/${id}.${ext}`;
  const bucket = body.kind === "gif" ? env.GIFS : env.MINIMAPS;
  const contentType =
    body.content_type ||
    (body.kind === "gif" ? "image/gif" : "image/png");

  await bucket.put(r2Key, bytes, {
    httpMetadata: { contentType },
  });

  await env.DB.prepare(
    `INSERT INTO generation_history (id, user_id, kind, source_filename, settings_json, r2_key, visibility)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      body.kind,
      body.source_filename.trim(),
      JSON.stringify(body.settings ?? {}),
      r2Key,
      visibility,
    )
    .run();

  const cap = maxPerKind(env);
  const { results: allRows } = await env.DB.prepare(
    `SELECT id, r2_key FROM generation_history
     WHERE user_id = ? AND kind = ?
     ORDER BY created_at ASC`,
  )
    .bind(user.id, body.kind)
    .all<{ id: string; r2_key: string }>();

  const overflow =
    (allRows?.length ?? 0) > cap ? (allRows ?? []).slice(0, (allRows?.length ?? 0) - cap) : [];

  for (const row of overflow) {
    await bucket.delete(row.r2_key).catch(() => {});
    await env.DB.prepare("DELETE FROM generation_history WHERE id = ?").bind(row.id).run();
  }

  return Response.json({ id, r2_key: r2Key, visibility }, { status: 201 });
}
