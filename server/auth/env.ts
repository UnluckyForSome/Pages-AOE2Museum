export interface AuthEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  MINIMAPS: R2Bucket;
  GIFS: R2Bucket;
  CAMPAIGNS_BUCKET: R2Bucket;
  AUTH_SECRET: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  PUBLIC_BASE_URL: string;
  ADMIN_EMAILS: string;
}
