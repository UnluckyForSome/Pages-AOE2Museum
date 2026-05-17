import type { AuthEnv } from "../auth/env";

export interface HistoryEnv extends AuthEnv {
  MINIMAPS: R2Bucket;
  GIFS: R2Bucket;
  MY_GALLERY_MAX_PER_KIND: string;
}
