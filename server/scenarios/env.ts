export interface ScenariosEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  TURNSTILE_SECRET: string;
  SYNC_SECRET: string;
}
