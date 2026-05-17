import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const libDir = dirname(fileURLToPath(import.meta.url));
const scriptsDir = resolve(libDir, "..");
export const museumRoot = resolve(scriptsDir, "..");
export const fetchPylibsPath = join(museumRoot, "scripts/fetch-pylibs.mjs");
export const lockPath = join(museumRoot, "scripts/museum-deps.lock.json");

/** Sibling repos under GITHUB_ROOT (override with MUSEUM_GITHUB_ROOT). */
export function githubRoot() {
  const env = process.env.MUSEUM_GITHUB_ROOT?.trim();
  if (env) return resolve(env);
  return resolve(museumRoot, "../..");
}

export function repoPath(...segments) {
  return join(githubRoot(), ...segments);
}

export const REPOS = {
  mcgeniescx: {
    id: "mcgeniescx",
    label: "AOE2-McGenieSCX",
    path: () => repoPath("Public", "AOE2-McGenieSCX"),
    branch: "main",
    remote: "origin",
    publish: "testpypi",
    versionFiles: [
      { kind: "pyproject", file: "pyproject.toml" },
    ],
    fetchPin: { pattern: /(AOE2_MCGENIESCX_VERSION\?\.trim\(\) \|\| ")([^"]+)(")/ },
  },
  mgz: {
    id: "mgz",
    label: "AOE2-McMGZ",
    path: () => repoPath("Forks", "AOE2-McMGZ"),
    branch: "master",
    remote: "origin",
    publish: "testpypi",
    versionFiles: [
      { kind: "setup_py", file: "setup.py", re: /version\s*=\s*['"]([^'"]+)['"]/ },
    ],
    fetchPin: { pattern: /(AOE2_MCMGZ_VERSION\?\.trim\(\) \|\| ")([^"]+)(")/ },
  },
  parser: {
    id: "parser",
    label: "AoE2ScenarioParser",
    path: () => repoPath("Forks", "AoE2ScenarioParser"),
    branch: "museum",
    remote: "origin",
    publish: "github",
    github: { owner: "UnluckyForSome", repo: "AoE2ScenarioParser", ref: "museum" },
  },
  minimap: {
    id: "minimap",
    label: "AOE2-McMinimap",
    path: () => repoPath("Public", "AOE2-McMinimap"),
    branch: "main",
    remote: "origin",
    publish: "testpypi",
    versionFiles: [
      { kind: "pyproject", file: "pyproject.toml" },
      {
        kind: "dunder_version",
        file: "aoe2_mcminimap/__init__.py",
        re: /__version__\s*=\s*["']([^"']+)["']/,
      },
    ],
    fetchPin: { pattern: /(AOE2_MCMINIMAP_VERSION\?\.trim\(\) \|\| ")([^"]+)(")/ },
  },
};

/** Publish order (McGenieSCX before parser consumers; McMinimap last). */
export const PUBLISH_ORDER = ["mcgeniescx", "mgz", "parser", "minimap"];

export function assertRepoExists(repo) {
  const dir = repo.path();
  if (!existsSync(dir)) {
    throw new Error(`${repo.label} not found at ${dir} (set MUSEUM_GITHUB_ROOT)`);
  }
  return dir;
}
