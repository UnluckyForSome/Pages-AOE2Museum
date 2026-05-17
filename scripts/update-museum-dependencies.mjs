#!/usr/bin/env node
/**
 * UpdateMuseumDependencies — publish upstream packages and refresh the museum bundle.
 *
 * Order: AOE2-McGenieSCX → AOE2-McMGZ → AoE2ScenarioParser (museum branch) → AOE2-McMinimap
 *        → fetch-pylibs → build-mcminimap-bundle → optional wrangler deploy
 *
 * Requires: git, gh (for TestPyPI via GitHub Release), npm, python (for __pycache__ cleanup)
 *
 * Environment:
 *   MUSEUM_GITHUB_ROOT  — parent of Public/, Forks/ (default: museum/../.. → Github)
 *
 * Examples:
 *   node scripts/update-museum-dependencies.mjs --dry-run
 *   node scripts/update-museum-dependencies.mjs --only parser,minimap
 *   node scripts/update-museum-dependencies.mjs --skip-publish --skip-deploy
 *   node scripts/update-museum-dependencies.mjs --deploy
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPOS,
  PUBLISH_ORDER,
  assertRepoExists,
  museumRoot,
  fetchPylibsPath,
  lockPath,
} from "./lib/museum-deps-config.mjs";
import {
  run,
  git,
  gitPorcelain,
  gitBranch,
  bumpSemver,
  readRepoVersion,
  writeRepoVersion,
  resolveParserSha,
  updateFetchPylibsPin,
  readLock,
  writeLock,
  repoNeedsRelease,
  hasUnpushedCommits,
} from "./lib/museum-deps-lib.mjs";

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    skipPublish: false,
    skipDeploy: true,
    bump: "patch",
    only: null,
    force: false,
    allowDirty: false,
    changedOnly: true,
    message: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--skip-publish") opts.skipPublish = true;
    else if (a === "--deploy") opts.skipDeploy = false;
    else if (a === "--skip-deploy") opts.skipDeploy = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--publish-unchanged") opts.changedOnly = false;
    else if (a === "--changed-only") opts.changedOnly = true;
    else if (a === "--allow-dirty") opts.allowDirty = true;
    else if (a === "--no-bump") opts.bump = null;
    else if (a.startsWith("--bump=")) opts.bump = a.slice(7);
    else if (a === "--bump" && argv[i + 1]) opts.bump = argv[++i];
    else if (a.startsWith("--only=")) opts.only = a.slice(7).split(",");
    else if (a === "--only" && argv[i + 1]) opts.only = argv[++i].split(",");
    else if (a.startsWith("--message=")) opts.message = a.slice(10);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/update-museum-dependencies.mjs [options]

Options:
  --dry-run           Print steps only
  --only a,b,c        Subset: mcgeniescx, mgz, parser, minimap, museum
  --bump patch|minor  Version bump for TestPyPI packages (default: patch)
  --no-bump           Keep current package versions; still push / refresh museum
  --skip-publish      Git push only; no gh release
  --deploy            Run npm run deploy after bundle rebuild
  --skip-deploy       Default; do not deploy Worker
  --force             Publish even when git reports no new commits
  --changed-only      Default: skip packages with no git changes (on by default)
  --publish-unchanged With --bump, publish every package even if unchanged
  --allow-dirty       Allow uncommitted changes (commits them with --message)
  --message TEXT      Commit message for version bumps
`);
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
}

function step(title) {
  console.log(`\n=== ${title} ===\n`);
}

function repoDirty(cwd) {
  return Boolean(gitPorcelain(cwd)?.trim());
}

function ensureBranch(cwd, expected, dryRun) {
  const current = gitBranch(cwd);
  if (current !== expected) {
    throw new Error(`expected branch ${expected}, on ${current} (${cwd})`);
  }
}

function cleanPycache(repoDir, dryRun) {
  if (process.platform === "win32") {
    run(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Get-ChildItem -Path '${repoDir.replace(/'/g, "''")}' -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`,
      ],
      { dryRun, label: "remove __pycache__" },
    );
  } else {
    run(
      "find",
      [repoDir, "-type", "d", "-name", "__pycache__", "-exec", "rm", "-rf", "{}", "+"],
      { dryRun, label: "remove __pycache__" },
    );
  }
}

async function publishTestPyPI(repo, repoDir, version, opts) {
  const tag = `v${version}`;
  cleanPycache(repoDir, opts.dryRun);
  const msg = opts.message || `chore(release): ${repo.label} ${version}`;
  if (repoDirty(repoDir) && opts.allowDirty) {
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-m", msg);
  }
  git(repoDir, "push", repo.remote, repo.branch);
  if (opts.skipPublish) {
    console.log(`[skip-publish] would create GitHub release ${tag}`);
    return;
  }
  run("gh", ["release", "create", tag, "--title", tag, "--generate-notes"], {
    cwd: repoDir,
    inherit: true,
    dryRun: opts.dryRun,
  });
  console.log(
    `Published ${repo.label} ${tag} — TestPyPI workflow should run on GitHub Actions.`,
  );
}

async function publishParser(repo, repoDir, opts, lock) {
  ensureBranch(repoDir, repo.branch, opts.dryRun);
  const dirty = repoDirty(repoDir);
  if (dirty && !opts.allowDirty && !opts.dryRun && !opts.force) {
    throw new Error(`${repo.label}: uncommitted changes on ${repo.branch}`);
  }
  const remoteSha = await resolveParserSha(repo);
  const unchanged =
    opts.changedOnly &&
    !opts.force &&
    !dirty &&
    !hasUnpushedCommits(repoDir, repo.remote, repo.branch) &&
    lock?.parser === remoteSha;
  if (unchanged) {
    console.log(`${repo.label}: unchanged (${remoteSha}); skipping push.`);
    return remoteSha;
  }
  if (!dirty && !opts.force && !opts.bump) {
    console.log(`No local changes for ${repo.label}; skipping push.`);
    return remoteSha;
  }
  if (dirty && opts.allowDirty) {
    const msg = opts.message || "chore: museum parser updates";
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-m", msg);
  }
  git(repoDir, "push", repo.remote, repo.branch);
  const sha = await resolveParserSha(repo);
  console.log(`${repo.label} museum @ ${sha}`);
  return sha;
}

function shouldRun(id, only) {
  if (!only) return true;
  return only.includes(id);
}

async function processPackage(id, opts, versions) {
  const repo = REPOS[id];
  if (!shouldRun(id, opts.only)) return;

  const repoDir = assertRepoExists(repo);
  step(repo.label);

  const lock = readLock(lockPath);

  if (id === "parser") {
    const sha = await publishParser(repo, repoDir, opts, lock);
    versions.parser = sha;
    return;
  }

  const current = readRepoVersion(repo, repoDir);
  let version = current;
  const dirty = repoDirty(repoDir);

  if (dirty && !opts.allowDirty && !opts.dryRun) {
    throw new Error(`${repo.label}: uncommitted changes — commit first or use --allow-dirty`);
  }

  const wantsBump = Boolean(opts.force || opts.bump);
  if (!wantsBump) {
    console.log(`Skipping publish for ${repo.label} (${current}); use --bump or --force.`);
    versions[id] = current;
    return;
  }

  const changed = repoNeedsRelease(repo, repoDir, {
    version: current,
    remote: repo.remote,
    branch: repo.branch,
    force: !opts.changedOnly || opts.force,
  });
  if (opts.changedOnly && !changed) {
    console.log(`${repo.label}: no git changes since v${current}; skipping publish.`);
    versions[id] = current;
    return;
  }

  version = bumpSemver(current, opts.bump || "patch");
  console.log(`Bumping ${repo.label}: ${current} → ${version}`);
  if (!opts.dryRun) writeRepoVersion(repo, repoDir, version);

  await publishTestPyPI(repo, repoDir, version, opts);
  versions[id] = version;
}

function updateMuseumPins(versions, opts) {
  if (!shouldRun("museum", opts.only) && opts.only) {
    const onlyMuseum = opts.only.length === 1 && opts.only[0] === "museum";
    if (!onlyMuseum && !opts.only.includes("museum")) {
      // still refresh pins when any upstream ran
    }
  }

  step("Museum — update fetch-pylibs pins");
  let content = readFileSync(fetchPylibsPath, "utf8");
  if (versions.mcgeniescx && REPOS.mcgeniescx.fetchPin) {
    content = updateFetchPylibsPin(content, REPOS.mcgeniescx.fetchPin.pattern, versions.mcgeniescx);
  }
  if (versions.mgz && REPOS.mgz.fetchPin) {
    content = updateFetchPylibsPin(content, REPOS.mgz.fetchPin.pattern, versions.mgz);
  }
  if (versions.minimap && REPOS.minimap.fetchPin) {
    content = updateFetchPylibsPin(content, REPOS.minimap.fetchPin.pattern, versions.minimap);
  }
  if (!opts.dryRun) writeFileSync(fetchPylibsPath, content);
  console.log("Updated scripts/fetch-pylibs.mjs version pins.");
}

async function refreshMuseumBundle(opts) {
  step("Museum — fetch pylibs + rebuild Pyodide bundle");
  run("npm", ["run", "build:mcminimap"], {
    cwd: museumRoot,
    inherit: true,
    dryRun: opts.dryRun,
  });
}

async function deployMuseum(opts) {
  if (opts.skipDeploy) return;
  step("Museum — deploy Worker + assets");
  run("npm", ["run", "deploy"], { cwd: museumRoot, inherit: true, dryRun: opts.dryRun });
}

async function main() {
  const opts = parseArgs(process.argv);
  const only = opts.only?.map((s) => s.trim().toLowerCase()).filter(Boolean) ?? null;
  opts.only = only;

  console.log("UpdateMuseumDependencies");
  console.log(`  github root: ${process.env.MUSEUM_GITHUB_ROOT || "(default ../../..)"}`);
  console.log(`  museum root: ${museumRoot}`);
  if (opts.dryRun) console.log("  mode: DRY RUN");
  if (opts.changedOnly && opts.bump) console.log("  publish: changed packages only");

  const versions = { ...readLock(lockPath) };

  for (const id of PUBLISH_ORDER) {
    await processPackage(id, opts, versions);
  }

  const runMuseum =
    !only || only.includes("museum") || only.some((x) => PUBLISH_ORDER.includes(x));
  if (runMuseum) {
    // Fill versions from repos when upstream steps were skipped
    for (const id of ["mcgeniescx", "mgz", "minimap"]) {
      if (!versions[id] && REPOS[id].versionFiles) {
        versions[id] = readRepoVersion(REPOS[id], assertRepoExists(REPOS[id]));
      }
    }
    if (!versions.parser) {
      versions.parser = await resolveParserSha(REPOS.parser);
    }
    updateMuseumPins(versions, opts);
    await refreshMuseumBundle(opts);
    await deployMuseum(opts);
  }

  versions.updatedAt = new Date().toISOString();
  if (!opts.dryRun) writeLock(lockPath, versions);

  step("Done");
  console.log(JSON.stringify(versions, null, 2));
  console.log("\nNext: verify TestPyPI releases finished, then hard-refresh the live site.");
}

main().catch((err) => {
  console.error("\n[UpdateMuseumDependencies] failed:", err.message || err);
  process.exit(1);
});
