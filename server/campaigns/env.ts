import type { ScenariosEnv } from "../scenarios/env";
import type { AuthEnv } from "../auth/env";

export interface CampaignsEnv extends ScenariosEnv, AuthEnv {
  CAMPAIGNS_BUCKET: R2Bucket;
}

export const CAMPAIGN_EXTENSIONS = ["cpn", "cpx", "aoecpn", "aoe2campaign"] as const;

export function isCampaignFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return (CAMPAIGN_EXTENSIONS as readonly string[]).includes(ext);
}
