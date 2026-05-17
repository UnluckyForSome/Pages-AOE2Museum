import type { HistoryEnv } from "../env";
import type { MuseumUser } from "../../auth/services/session";

export async function handleHistoryDelete(
  env: HistoryEnv,
  id: string,
  user: MuseumUser,
): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT user_id, r2_key, kind FROM generation_history WHERE id = ?",
  )
    .bind(id)
    .first<{ user_id: string; r2_key: string; kind: string }>();

  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  if (row.user_id !== user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const bucket = row.kind === "gif" ? env.GIFS : env.MINIMAPS;
  await bucket.delete(row.r2_key).catch(() => {});
  await env.DB.prepare("DELETE FROM generation_history WHERE id = ?").bind(id).run();
  return Response.json({ ok: true });
}
