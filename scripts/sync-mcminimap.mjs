#!/usr/bin/env node
// Ensures the AOE2-McMinimap submodule is initialised and up to date.
// Idempotent: if the submodule is already populated at the pinned SHA, it no-ops.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const submodulePath = "mcminimap/vendor/aoe2mcminimap";
const submoduleDir = resolve(repoRoot, submodulePath);

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
}

function isPopulated() {
  if (!existsSync(submoduleDir)) return false;
  try {
    const entries = readdirSync(submoduleDir);
    return entries.some((f) => f === "McMinimap.py");
  } catch {
    return false;
  }
}

function getSubmoduleStatus() {
  try {
    const out = git(["submodule", "status", "--", submodulePath], { capture: true });
    return out.trim();
  } catch {
    return "";
  }
}

async function main() {
  const status = getSubmoduleStatus();

  if (!status || status.startsWith("-") || !isPopulated()) {
    console.log(`[sync-mcminimap] initialising submodule ${submodulePath}`);
    git(["submodule", "update", "--init", "--recursive", "--", submodulePath]);
    return;
  }

  if (status.startsWith("+")) {
    console.log(
      "[sync-mcminimap] submodule has uncommitted/differing SHA — leaving as-is (run `git submodule update` manually to reset).",
    );
    return;
  }

  console.log("[sync-mcminimap] submodule already at pinned SHA, skipping.");
}

main().catch((e) => {
  console.error("[sync-mcminimap] failed:", e);
  process.exit(1);
});
