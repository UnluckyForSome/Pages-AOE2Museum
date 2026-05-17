import type { ScenariosEnv } from "../env";
import {
  altSuffixFilename,
  displayTitleFromFilename,
  normalizeStoredKey,
  usernameSuffixFilename,
} from "./filenames";
import { getExtension } from "./validation";

export interface ResolvedStandaloneName {
  storedFilename: string;
  displayTitle: string;
}

/**
 * Resolve stored filename for a standalone upload.
 * - Default: `Title by username.ext`
 * - If colliding with campaign mirror: `Title [altN] by username.ext`
 */
export async function resolveStandaloneFilename(
  env: ScenariosEnv,
  originalFilename: string,
  username: string,
  existingNames: Set<string>,
): Promise<ResolvedStandaloneName> {
  const ext = getExtension(originalFilename);
  const baseStem = displayTitleFromFilename(originalFilename);
  let candidate = usernameSuffixFilename(originalFilename, username);
  let altN = 0;

  while (existingNames.has(normalizeStoredKey(candidate))) {
    const row = await env.DB.prepare(
      "SELECT kind, campaign_id FROM scenarios WHERE lower(filename) = ? LIMIT 1",
    )
      .bind(normalizeStoredKey(candidate))
      .first<{ kind: string; campaign_id: number | null }>();

    if (row?.kind === "standalone") {
      break;
    }
    altN++;
    candidate = altSuffixFilename(baseStem, altN, username, ext);
  }

  existingNames.add(normalizeStoredKey(candidate));
  return {
    storedFilename: candidate,
    displayTitle: altN > 0 ? `${baseStem} [alt${altN}]` : baseStem,
  };
}

/** Check if campaign upload would collide with existing standalone scenarios. */
export async function findCampaignStandaloneConflicts(
  env: ScenariosEnv,
  scenarioNames: string[],
  username: string,
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const name of scenarioNames) {
    const stored = usernameSuffixFilename(name, username);
    const row = await env.DB.prepare(
      "SELECT kind FROM scenarios WHERE lower(filename) = ? LIMIT 1",
    )
      .bind(normalizeStoredKey(stored))
      .first<{ kind: string }>();
    if (row?.kind === "standalone") {
      conflicts.push(name);
    }
  }
  return conflicts;
}
