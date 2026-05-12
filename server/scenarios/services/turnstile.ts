const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEV_TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function getTurnstileSecretForRequest(requestUrl: string, prodSecret: string): string {
  try {
    const hostname = new URL(requestUrl).hostname;
    if (LOCAL_DEV_HOSTS.has(hostname)) {
      return DEV_TURNSTILE_SECRET;
    }
  } catch {
    // Fall through to the configured production secret.
  }
  return prodSecret;
}

export async function verifyTurnstile(
  token: string,
  secret: string,
  ip?: string,
): Promise<boolean> {
  const body: Record<string, string> = {
    secret,
    response: token,
  };
  if (ip) body.remoteip = ip;

  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as { success: boolean };
  return data.success;
}
