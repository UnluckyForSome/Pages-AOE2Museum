export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "aoe2museum" });
    }

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AOE2 Museum</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 1.5rem; }
      main { max-width: 40rem; text-align: center; }
      h1 { font-size: clamp(1.5rem, 4vw, 2.25rem); margin: 0 0 0.5rem; }
      p { margin: 0; opacity: 0.85; line-height: 1.5; }
      code { font-size: 0.95em; }
    </style>
  </head>
  <body>
    <main>
      <h1>AOE2 Museum</h1>
      <p>Worker is live. Replace this placeholder with routes, APIs, or HTML generation as you build the museum.</p>
      <p style="margin-top:1rem"><code>GET /health</code> returns JSON for uptime checks.</p>
    </main>
  </body>
</html>`;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  },
};
