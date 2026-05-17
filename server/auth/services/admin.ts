import type { AuthEnv } from "../env";

export function isAdmin(
  env: AuthEnv,
  user: { email: string },
): boolean {
  const list = (env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return list.includes(user.email.toLowerCase());
}
