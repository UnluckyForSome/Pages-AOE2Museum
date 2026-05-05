import type { ScenariosEnv } from "../env";

export async function handleDownload(
  id: string,
  env: ScenariosEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT filename, r2_key FROM scenarios WHERE id = ?",
  )
    .bind(id)
    .first<{ filename: string; r2_key: string }>();

  if (!row) {
    return Response.json({ error: "Scenario not found" }, { status: 404 });
  }

  const object = await env.BUCKET.get(row.r2_key);
  if (!object) {
    return Response.json({ error: "File missing from storage" }, { status: 404 });
  }

  const { readable, writable } = new TransformStream();

  ctx.waitUntil(
    object.body
      .pipeTo(writable)
      .then(() =>
        env.DB.prepare(
          "UPDATE scenarios SET downloads = downloads + 1 WHERE id = ?",
        )
          .bind(id)
          .run(),
      )
      .catch(() => {}),
  );

  return new Response(readable, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${row.filename}"`,
      "Content-Length": String(object.size),
    },
  });
}
