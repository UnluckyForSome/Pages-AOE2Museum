import type { ScenariosEnv } from "../env";

export async function handleList(env: ScenariosEnv): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, filename, filetype, size, uploaded_at, downloads FROM scenarios ORDER BY uploaded_at DESC",
  ).all();

  return Response.json(results);
}
