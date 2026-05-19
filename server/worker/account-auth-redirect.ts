/** Legacy /account/*.html auth URLs → home with museum-auth query (modal). */
const REDIRECTS: Record<string, string> = {
  "/account/login.html": "sign-in",
  "/account/signup.html": "sign-up",
  "/account/reset-password.html": "reset-password",
  "/account/check-email.html": "verify-pending",
  "/account/verify.html": "verify-pending",
  "/account/verified.html": "verified",
  "/account/profile.html": "profile",
  "/account/delete.html": "delete",
};

const FORWARD_PARAMS = ["token", "error", "email", "message"] as const;

export function accountAuthRedirectResponse(url: URL): Response | null {
  let view = REDIRECTS[url.pathname];
  if (!view) return null;

  if (url.pathname === "/account/verify.html" && url.searchParams.get("token")) {
    view = "verify-link";
  }

  const dest = new URL("/", url.origin);
  dest.searchParams.set("museum-auth", view);
  for (const key of FORWARD_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) dest.searchParams.set(key, value);
  }
  return Response.redirect(dest.toString(), 302);
}
