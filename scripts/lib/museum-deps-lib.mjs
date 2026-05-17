import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function run(cmd, args, opts = {}) {
  const cwd = opts.cwd;
  const dry = opts.dryRun;
  const label = opts.label || `${cmd} ${args.join(" ")}`;
  if (dry) {
    console.log(`[dry-run] ${label}${cwd ? `  (cwd: ${cwd})` : ""}`);
    return "";
  }
  if (opts.inherit) {
    const shell = process.platform === "win32";
    execSync([cmd, ...args].join(" "), {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...opts.env },
      shell,
    });
    return "";
  }
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
  }).trim();
}

export function git(cwd, ...args) {
  return run("git", args, { cwd });
}

export function gitPorcelain(cwd) {
  return git(cwd, "status", "--porcelain");
}

export function gitBranch(cwd) {
  return git(cwd, "branch", "--show-current");
}

/** Latest annotated tag like v1.2.3, or null. */
export function latestVersionTag(cwd) {
  try {
    const tag = git(cwd, "describe", "--tags", "--abbrev=0", "--match", "v*");
    return tag?.startsWith("v") ? tag : null;
  } catch {
    return null;
  }
}

/** True when there are commits on HEAD not contained in `tag`. */
export function hasCommitsSinceTag(cwd, tag) {
  if (!tag) return false;
  try {
    const n = parseInt(git(cwd, "rev-list", `${tag}..HEAD`, "--count"), 10);
    return Number.isFinite(n) && n > 0;
  } catch {
    return false;
  }
}

/** True when local branch is ahead of remote (unpushed commits). */
export function hasUnpushedCommits(cwd, remote, branch) {
  try {
    const n = parseInt(git(cwd, "rev-list", `${remote}/${branch}..HEAD`, "--count"), 10);
    return Number.isFinite(n) && n > 0;
  } catch {
    return true;
  }
}

/**
 * Whether this repo needs a new release (push/tag/publish).
 * Unchanged = clean tree, no unpushed commits, no commits since v{version} tag.
 */
function workingTreeDirty(cwd) {
  return Boolean(gitPorcelain(cwd)?.trim());
}

export function repoNeedsRelease(repo, repoDir, { version, remote, branch, force }) {
  if (force) return true;
  if (workingTreeDirty(repoDir)) return true;
  if (hasUnpushedCommits(repoDir, remote, branch)) return true;
  const tag = version ? `v${version}` : latestVersionTag(repoDir);
  if (hasCommitsSinceTag(repoDir, tag)) return true;
  return false;
}

export function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`not semver: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: m[0] };
}

export function bumpSemver(v, kind = "patch") {
  const s = parseSemver(v);
  if (kind === "minor") return `${s.major}.${s.minor + 1}.0`;
  if (kind === "major") return `${s.major + 1}.0.0`;
  return `${s.major}.${s.minor}.${s.patch + 1}`;
}

export function readPyprojectVersion(filePath) {
  const text = readFileSync(filePath, "utf8");
  const m = /^version\s*=\s*["']([^"']+)["']/m.exec(text);
  if (!m) throw new Error(`version not found in ${filePath}`);
  return m[1];
}

export function writePyprojectVersion(filePath, version) {
  const text = readFileSync(filePath, "utf8");
  const next = text.replace(/^version\s*=\s*["'][^"']+["']/m, `version = "${version}"`);
  writeFileSync(filePath, next);
}

export function readSetupPyVersion(filePath) {
  const text = readFileSync(filePath, "utf8");
  const m = /version\s*=\s*['"]([^'"]+)['"]/.exec(text);
  if (!m) throw new Error(`version not found in ${filePath}`);
  return m[1];
}

export function writeSetupPyVersion(filePath, version) {
  const text = readFileSync(filePath, "utf8");
  const next = text.replace(/version\s*=\s*['"][^'"]+['"]/, `version='${version}'`);
  writeFileSync(filePath, next);
}

export function readDunderVersion(filePath) {
  const text = readFileSync(filePath, "utf8");
  const m = /__version__\s*=\s*["']([^"']+)["']/.exec(text);
  if (!m) throw new Error(`__version__ not found in ${filePath}`);
  return m[1];
}

export function writeDunderVersion(filePath, version) {
  const text = readFileSync(filePath, "utf8");
  const next = text.replace(/__version__\s*=\s*["'][^"']+["']/, `__version__ = "${version}"`);
  writeFileSync(filePath, next);
}

export function readRepoVersion(repo, repoDir) {
  if (!repo.versionFiles?.length) return null;
  for (const vf of repo.versionFiles) {
    const p = join(repoDir, vf.file);
    if (vf.kind === "pyproject") return readPyprojectVersion(p);
    if (vf.kind === "setup_py") return readSetupPyVersion(p);
    if (vf.kind === "dunder_version") return readDunderVersion(p);
  }
  return null;
}

export function writeRepoVersion(repo, repoDir, version) {
  for (const vf of repo.versionFiles || []) {
    const p = join(repoDir, vf.file);
    if (vf.kind === "pyproject") writePyprojectVersion(p, version);
    else if (vf.kind === "setup_py") writeSetupPyVersion(p, version);
    else if (vf.kind === "dunder_version") writeDunderVersion(p, version);
  }
}

export async function resolveParserSha(repo) {
  const { owner, repo: name, ref } = repo.github;
  const url = `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "update-museum-dependencies" },
  });
  if (!res.ok) throw new Error(`GitHub ${owner}/${name}@${ref}: HTTP ${res.status}`);
  const data = await res.json();
  return String(data.sha || ref).slice(0, 12);
}

export function updateFetchPylibsPin(content, pattern, version) {
  if (!pattern.test(content)) {
    throw new Error(`fetch-pylibs pin pattern not found: ${pattern}`);
  }
  return content.replace(pattern, `$1${version}$3`);
}

export function readLock(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function writeLock(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
