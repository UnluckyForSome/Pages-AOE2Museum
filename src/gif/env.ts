// Garage S3 config for the /gif/ app. Public config (endpoint, region,
// bucket names) is set via `vars` in wrangler.jsonc; credentials are set
// via `wrangler secret put GARAGE_ACCESS_KEY_ID / GARAGE_SECRET_ACCESS_KEY`.
export interface GifEnv {
  ASSETS: Fetcher;
  GARAGE_ENDPOINT: string;
  GARAGE_REGION: string;
  GARAGE_BUCKET_SLP: string;
  GARAGE_BUCKET_SLD: string;
  GARAGE_ACCESS_KEY_ID: string;
  GARAGE_SECRET_ACCESS_KEY: string;
}
