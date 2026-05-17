// @ts-expect-error — plain JS module
import { readCampaign } from "../lib/rge-campaign.js";

export interface ExtractedScenario {
  index: number;
  name: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface ExtractedCampaign {
  format: string;
  versionString: string;
  name: string;
  scenarios: ExtractedScenario[];
}

export function extractCampaign(bytes: ArrayBuffer): ExtractedCampaign {
  const parsed = readCampaign(new Uint8Array(bytes), { extract: true });
  const scenarios: ExtractedScenario[] = [];
  for (const s of parsed.scenarios) {
    if (!s.bytes) throw new Error(`Scenario "${s.fileName}" has no payload`);
    scenarios.push({
      index: s.index,
      name: s.name,
      fileName: s.fileName,
      bytes: s.bytes,
    });
  }
  return {
    format: parsed.format,
    versionString: parsed.versionString,
    name: parsed.name,
    scenarios,
  };
}
