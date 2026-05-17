import type { HistoryEnv } from "../env";
import { getUserOrNull, requireVerifiedUser } from "../../auth/services/session";

export async function handleHistoryMine(
  request: Request,
  env: HistoryEnv,
): Promise<Response> {
  const user = await requireVerifiedUser(request, env);
  if (user instanceof Response) return user;

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  if (kind !== "minimap" && kind !== "gif") {
    return Response.json({ error: "kind=minimap|gif required" }, { status: 400 });
  }

  const { results } = await env.DB.prepare(
    `SELECT id, kind, source_filename, settings_json, r2_key, visibility, created_at
     FROM generation_history
     WHERE user_id = ? AND kind = ?
     ORDER BY created_at DESC`,
  )
    .bind(user.id, kind)
    .all();

  return Response.json(results ?? []);
}

export async function handleHistoryPublic(
  request: Request,
  env: HistoryEnv,
): Promise<Response> {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const username = url.searchParams.get("user");
  if (kind !== "minimap" && kind !== "gif") {
    return Response.json({ error: "kind=minimap|gif required" }, { status: 400 });
  }

  let query = `SELECT h.id, h.kind, h.source_filename, h.settings_json, h.visibility, h.created_at,
                      u.username
               FROM generation_history h
               INNER JOIN "user" u ON h.user_id = u.id
               WHERE h.kind = ? AND h.visibility = 'public'`;
  const binds: string[] = [kind];

  if (username) {
    query += " AND u.username = ? COLLATE NOCASE";
    binds.push(username);
  }
  query += " ORDER BY h.created_at DESC LIMIT 100";

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return Response.json(results ?? []);
}

export async function handleHistoryArtifact(
  id: string,
  env: HistoryEnv,
  request: Request,
): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT r2_key, kind, user_id, visibility FROM generation_history WHERE id = ?",
  )
    .bind(id)
    .first<{
      r2_key: string;
      kind: string;
      user_id: string;
      visibility: string;
    }>();

  if (!row) return new Response("not found", { status: 404 });

  const viewer = await getUserOrNull(request, env);
  if (row.visibility === "hidden" && viewer?.id !== row.user_id) {
    return new Response("not found", { status: 404 });
  }

  const bucket = row.kind === "gif" ? env.GIFS : env.MINIMAPS;
  const obj = await bucket.get(row.r2_key);
  if (!obj) return new Response("not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(obj.body, { headers });
}
