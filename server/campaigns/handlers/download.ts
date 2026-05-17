import type { CampaignsEnv } from "../env";

export async function handleCampaignDownload(
  id: string,
  env: CampaignsEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT r2_key, stored_filename, visibility, uploader_id FROM campaigns WHERE id = ?",
  )
    .bind(id)
    .first<{ r2_key: string; stored_filename: string; visibility: string }>();

  if (!row) return new Response("not found", { status: 404 });

  const obj = await env.CAMPAIGNS_BUCKET.get(row.r2_key);
  if (!obj) return new Response("not found", { status: 404 });

  ctx.waitUntil(
    env.DB.prepare("UPDATE campaigns SET downloads = downloads + 1 WHERE id = ?")
      .bind(id)
      .run(),
  );

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set(
    "content-disposition",
    `attachment; filename="${row.stored_filename.replace(/"/g, "")}"`,
  );
  return new Response(obj.body, { headers });
}
