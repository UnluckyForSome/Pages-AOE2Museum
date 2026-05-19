/** Canonical public site URL (keep in sync with PUBLIC_BASE_URL in wrangler.jsonc). */
export const PRODUCTION_SITE_URL = "https://aoe2museum.com";

export const PRODUCTION_SITE_ORIGINS = [
  PRODUCTION_SITE_URL,
  "https://www.aoe2museum.com",
] as const;
