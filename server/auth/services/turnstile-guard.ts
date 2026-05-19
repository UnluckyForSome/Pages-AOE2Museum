import type { AuthEnv } from "../env";
import { json } from "../../http/json";
import { getTurnstileSecretForRequest, verifyTurnstile } from "../../scenarios/services/turnstile";

export const TURNSTILE_AUTH_PATHS = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-in/username",
  "/api/auth/request-password-reset",
  "/api/auth/museum/register",
  "/api/auth/museum/complete-verification",
  "/api/auth/museum/resend-verification",
]);

export function isTurnstileProtectedAuthPath(pathname: string, method: string): boolean {
  return method === "POST" && TURNSTILE_AUTH_PATHS.has(pathname);
}

/** Verifies Turnstile on auth POST bodies; returns a new Request with the same JSON body. */
export async function verifyAuthTurnstileOrError(
  request: Request,
  env: AuthEnv,
): Promise<{ ok: true; request: Request } | { ok: false; response: Response }> {
  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return { ok: false, response: json({ error: "Invalid request body" }, { status: 400 }) };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return { ok: false, response: json({ error: "Invalid JSON" }, { status: 400 }) };
  }

  const token =
    typeof parsed["cf-turnstile-response"] === "string" ? parsed["cf-turnstile-response"] : "";
  if (!token) {
    return { ok: false, response: json({ error: "Missing Turnstile token" }, { status: 400 }) };
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? undefined;
  const valid = await verifyTurnstile(
    token,
    getTurnstileSecretForRequest(request.url, env.TURNSTILE_SECRET),
    ip,
  );
  if (!valid) {
    return { ok: false, response: json({ error: "Turnstile verification failed" }, { status: 403 }) };
  }

  delete parsed["cf-turnstile-response"];
  const nextRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(parsed),
  });
  return { ok: true, request: nextRequest };
}
