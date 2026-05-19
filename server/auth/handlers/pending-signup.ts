import type { AuthEnv } from "../env";
import { json } from "../../http/json";
import {
  completePendingWithLinkToken,
  completePendingWithOtp,
  registerPendingSignup,
  resendPendingVerification,
} from "../services/pending-signup";

function readJson<T extends Record<string, unknown>>(request: Request): Promise<T | null> {
  return request.json().catch(() => null) as Promise<T | null>;
}

export async function routePendingSignup(
  request: Request,
  env: AuthEnv,
  pathname: string,
): Promise<Response | null> {
  if (pathname === "/api/auth/museum/register" && request.method === "POST") {
    const body = await readJson<{
      email?: string;
      username?: string;
      password?: string;
      museum_name?: string;
    }>(request);
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });

    const username = String(body.username ?? body.museum_name ?? "").trim();
    try {
      const result = await registerPendingSignup(env, {
        email: String(body.email ?? ""),
        username,
        password: String(body.password ?? ""),
      });
      if (!result.ok) return json({ error: result.error }, { status: result.status });
      return json({ ok: true });
    } catch (err) {
      console.error("[pending-signup] register failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("no such table: pending_signup")) {
        return json(
          {
            error:
              "Sign-up is not configured on this database yet (missing pending_signup table). Run: npm run db:migrate:all",
          },
          { status: 503 },
        );
      }
      return json({ error: "Sign up failed. Try again later." }, { status: 500 });
    }
  }

  if (pathname === "/api/auth/museum/complete-verification" && request.method === "POST") {
    const body = await readJson<{ email?: string; otp?: string }>(request);
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });

    const result = await completePendingWithOtp(
      env,
      String(body.email ?? ""),
      String(body.otp ?? ""),
    );
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ ok: true });
  }

  if (pathname === "/api/auth/museum/resend-verification" && request.method === "POST") {
    const body = await readJson<{ email?: string }>(request);
    if (!body) return json({ error: "Invalid JSON" }, { status: 400 });

    const result = await resendPendingVerification(env, String(body.email ?? ""));
    if (!result.ok) return json({ error: result.error }, { status: result.status });
    return json({ ok: true });
  }

  if (pathname === "/api/auth/museum/verify" && request.method === "GET") {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const result = await completePendingWithLinkToken(env, token);
    const origin = env.PUBLIC_BASE_URL.replace(/\/$/, "");
    if (!result.ok) {
      return Response.redirect(
        `${origin}/?museum-auth=verify-error&message=${encodeURIComponent(result.error)}`,
        302,
      );
    }
    return Response.redirect(`${origin}/?museum-auth=verified`, 302);
  }

  return null;
}
