import type { AuthEnv } from "../env";
import { createAuth } from "../auth";
import { isAdmin } from "./admin";
import { getMuseumUsername } from "./museum-name";

export interface MuseumUser {
  id: string;
  email: string;
  /** Public account name (3–20 chars); used in UI and upload filenames. */
  username: string;
  emailVerified: boolean;
  isAdmin: boolean;
}

export async function getSession(
  request: Request,
  env: AuthEnv,
): Promise<{ user: MuseumUser; session: { id: string } } | null> {
  let session;
  try {
    const auth = createAuth(env);
    session = await auth.api.getSession({ headers: request.headers });
  } catch (err) {
    console.error("[auth] getSession failed:", err);
    return null;
  }
  if (!session?.user) return null;
  const u = session.user as typeof session.user & {
    username?: string | null;
    name?: string | null;
  };
  const handle = getMuseumUsername(u);
  if (!handle) return null;
  return {
    user: {
      id: u.id,
      email: u.email,
      username: handle,
      emailVerified: Boolean(u.emailVerified),
      isAdmin: isAdmin(env, { email: u.email }),
    },
    session: { id: session.session.id },
  };
}

export async function requireUser(
  request: Request,
  env: AuthEnv,
): Promise<MuseumUser | Response> {
  const session = await getSession(request, env);
  if (!session) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  return session.user;
}

export async function requireVerifiedUser(
  request: Request,
  env: AuthEnv,
): Promise<MuseumUser | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;
  if (!user.emailVerified) {
    return Response.json(
      { error: "Email verification required. Check your inbox." },
      { status: 403 },
    );
  }
  return user;
}

export async function getUserOrNull(
  request: Request,
  env: AuthEnv,
): Promise<MuseumUser | null> {
  const session = await getSession(request, env);
  return session?.user ?? null;
}
