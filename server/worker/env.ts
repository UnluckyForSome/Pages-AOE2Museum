import type { ScenariosEnv } from "../scenarios/env";
import type { GifEnv } from "../gif/env";
import type { AuthEnv } from "../auth/env";
import type { HistoryEnv } from "../history/env";

export interface Env extends ScenariosEnv, GifEnv, AuthEnv, HistoryEnv {
  ASSETS: Fetcher;
  MINIMAPS: R2Bucket;
  MINIMAP_INDEX: KVNamespace;
  GIF_INDEX: KVNamespace;
  CAMPAIGNS_BUCKET: R2Bucket;
  AOCREC_ES_BASIC_AUTH: string;
}
