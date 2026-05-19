import type { AuthEnv } from "./env";
import { createAuth } from "./auth";
import { routePendingSignup } from "./handlers/pending-signup";
import { getSession } from "./services/session";
import {
  isTurnstileProtectedAuthPath,
  verifyAuthTurnstileOrError,
} from "./services/turnstile-guard";
import { json } from "../http/json";

export async function routeAuth(
  request: Request,
  env: AuthEnv,
  pathname: string,
): Promise<Response | null> {
  let authRequest = request;
  if (isTurnstileProtectedAuthPath(pathname, request.method)) {
    const turnstile = await verifyAuthTurnstileOrError(request, env);
    if (!turnstile.ok) return turnstile.response;
    authRequest = turnstile.request;
  }

  const pending = await routePendingSignup(authRequest, env, pathname);
  if (pending) return pending;

  if (pathname === "/api/auth/sign-up/email" && request.method === "POST") {
    return json(
      {
        error: "Use museum sign-up",
        redirect: "/?museum-auth=sign-up",
      },
      { status: 410 },
    );
  }

  if (pathname.startsWith("/api/auth")) {
    try {
      const auth = createAuth(env);
      return auth.handler(authRequest);
    } catch (err) {
      console.error("[auth] handler failed:", err);
      return json(
        {
          error:
            'Auth unavailable. Ensure wrangler.jsonc has compatibility_flags: ["nodejs_compat"] and restart wrangler dev.',
        },
        { status: 503 },
      );
    }
  }

  if (pathname === "/api/me" && request.method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ user: null });
    return json({
      user: {
        id: session.user.id,
        email: session.user.email,
        username: session.user.username,
        emailVerified: session.user.emailVerified,
        isAdmin: session.user.isAdmin,
      },
    });
  }

  const profileMatch = pathname.match(/^\/api\/users\/([a-zA-Z0-9_]+)$/);
  if (profileMatch && request.method === "GET") {
    const handle = profileMatch[1];
    const { results } = await env.DB.prepare(
      `SELECT username, createdAt FROM "user" WHERE username = ? COLLATE NOCASE`,
    )
      .bind(handle)
      .all<{
        username: string;
        createdAt: number;
      }>();
    const row = results?.[0];
    if (!row) return json({ error: "User not found" }, { status: 404 });
    return json({
      username: row.username,
      memberSince: row.createdAt,
    });
  }

  return null;
}
