export interface ScenariosEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  PARSER_VERIFY_BASE_URL: string;
  PARSER_VERIFY_TOKEN: string;
  TURNSTILE_SECRET: string;
  SYNC_SECRET: string;
}
