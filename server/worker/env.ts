import type { ScenariosEnv } from "../scenarios/env";
import type { GifEnv } from "../gif/env";

export interface Env extends ScenariosEnv, GifEnv {
  ASSETS: Fetcher;
  MINIMAPS: R2Bucket;
  MINIMAP_INDEX: KVNamespace;
  AOCREC_ES_BASIC_AUTH: string;
}

