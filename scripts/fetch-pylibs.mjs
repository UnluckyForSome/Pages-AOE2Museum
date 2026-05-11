#!/usr/bin/env node
// Downloads pinned pure-Python packages into sourcemodules/* for the McMinimap
// Pyodide bundle: transitive sdist deps for AOE2-McMGZ (construct,
// aocref), plus AOE2-McGenieSCX, AOE2-McCampaign, the AOE2-McMGZ package
// itself (import namespace `mgz`), and the AOE2-McMinimap application tree
// (McMinimap.py + aoe2_mcminimap/). The bundle script ships McMinimap sources
// plus pylibs/* into the tar.
//
// Why: `construct==2.8.16` (required by AOE2-McMGZ / mgz) was only ever
// published as an sdist on PyPI, so `micropip.install("construct==2.8.16")`
// errors out with:
//   ValueError: Can't find a pure Python 3 wheel for: 'construct==2.8.16'

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const PYLIBS = [
  {
    name: "construct",
    version: "2.8.16",
    url: "https://files.pythonhosted.org/packages/source/c/construct/construct-2.8.16.tar.gz",
    subpath: "construct-2.8.16/construct",
    destParent: join(repoRoot, "sourcemodules"),
  },
  {
    name: "aocref",
    version: "2.0.37",
    url: "https://files.pythonhosted.org/packages/0a/89/d5984391ce282fbc33f0584917f26b924b9e4a522c37a6323a033cdc4d79/aocref-2.0.37.tar.gz",
    subpath: "aocref-2.0.37/aocref",
    destParent: join(repoRoot, "sourcemodules"),
  },
  {
    name: "aoe2_geniescx",
    version: "0.1.0",
    pypiProject: "AOE2-McGenieSCX",
    /**
     * Warehouse JSON API host (no trailing slash).
     * Default TestPyPI until AOE2-McGenieSCX is on production PyPI; override with
     * AOE2_MCGENIESCX_PYPI_INDEX=https://pypi.org for releases only on pypi.org.
     */
    pypiIndexBase:
      process.env.AOE2_MCGENIESCX_PYPI_INDEX?.replace(/\/$/, "") || "https://test.pypi.org",
    /** sdist top-level dir matches tarball name, e.g. aoe2_mcgeniescx-0.1.0.tar.gz */
    subpathFromVersion: (v) => `aoe2_mcgeniescx-${v}/aoe2_geniescx`,
    destParent: join(repoRoot, "sourcemodules"),
  },
  {
    name: "aoe2_mccampaign",
    version: "0.1.0",
    pypiProject: "AOE2-McCampaign",
    /**
     * Default TestPyPI until AOE2-McCampaign is on production PyPI; override
     * with AOE2_MCCAMPAIGN_PYPI_INDEX=https://pypi.org once released there.
     */
    pypiIndexBase:
      process.env.AOE2_MCCAMPAIGN_PYPI_INDEX?.replace(/\/$/, "") || "https://test.pypi.org",
    subpathFromVersion: (v) => `aoe2_mccampaign-${v}/aoe2_mccampaign`,
    destParent: join(repoRoot, "sourcemodules"),
  },
  {
    name: "aoe2_mcmgz",
    version: process.env.AOE2_MCMGZ_VERSION?.trim() || "0.1.0",
    pypiProject: "AOE2-McMGZ",
    pypiIndexBase:
      process.env.AOE2_MCMGZ_PYPI_INDEX?.replace(/\/$/, "") || "https://test.pypi.org",
    subpathFromVersion: (v) => `aoe2_mcmgz-${v}/mgz`,
    destParent: join(repoRoot, "sourcemodules"),
    destDirName: "mgz",
  },
];

async function resolvePypiSdistUrl(project, version, indexBase = "https://pypi.org") {
  const base = indexBase.replace(/\/$/, "");
  const res = await fetch(`${base}/pypi/${encodeURIComponent(project)}/json`, {
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${base} project ${project}: HTTP ${res.status}`);
  const data = await res.json();
  const files = data.releases?.[version];
  if (!files?.length) {
    const avail = Object.keys(data.releases || {}).sort();
    const hint = avail.length ? ` Available versions include: ${avail.slice(-8).join(", ")}.` : "";
    throw new Error(`No PyPI release files for ${project}==${version}.${hint}`);
  }
  const sdist = files.find((u) => u.packagetype === "sdist");
  if (!sdist?.url) throw new Error(`No sdist URL for ${project}==${version}`);
  return sdist.url;
}

function versionMarkerPath(pkg) {
  return join(pkg.destParent, pkg.destDirName || pkg.name, ".version");
}

function isUpToDate(pkg) {
  const marker = versionMarkerPath(pkg);
  if (!existsSync(marker)) return false;
  try {
    return readFileSync(marker, "utf8").trim() === pkg.version;
  } catch {
    return false;
  }
}

async function downloadToFile(url, destPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
}

function extractTarGz(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", destDir], { stdio: "inherit" });
}

async function fetchOne(pkg) {
  if (isUpToDate(pkg)) {
    console.log(`[fetch-pylibs] ${pkg.name} ${pkg.version} already present, skipping.`);
    return;
  }

  let url = pkg.url;
  let subpath = pkg.subpath;
  if (pkg.pypiProject) {
    const indexBase = pkg.pypiIndexBase || "https://pypi.org";
    url = await resolvePypiSdistUrl(pkg.pypiProject, pkg.version, indexBase);
    subpath = pkg.subpathFromVersion(pkg.version);
  }

  console.log(`[fetch-pylibs] downloading ${pkg.name} ${pkg.version}`);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpArchive = join(tmpdir(), `${pkg.name}-${pkg.version}-${stamp}.tar.gz`);
  const tmpExtract = join(tmpdir(), `${pkg.name}-extract-${stamp}`);

  try {
    await downloadToFile(url, tmpArchive);
    extractTarGz(tmpArchive, tmpExtract);

    const extracted = join(tmpExtract, subpath);
    if (!existsSync(extracted)) {
      throw new Error(`expected package dir missing after extract: ${extracted}`);
    }

    const out = join(pkg.destParent, pkg.destDirName || pkg.name);
    if (existsSync(out)) rmSync(out, { recursive: true, force: true });
    mkdirSync(pkg.destParent, { recursive: true });
    renameSync(extracted, out);
    writeFileSync(versionMarkerPath(pkg), pkg.version + "\n");

    console.log(`[fetch-pylibs] ${pkg.name} ${pkg.version} -> ${out}`);
  } finally {
    try {
      rmSync(tmpArchive, { force: true });
    } catch {}
    try {
      rmSync(tmpExtract, { recursive: true, force: true });
    } catch {}
  }
}

function findAoe2McMinimapSdistRoot(extractDir) {
  /** setuptools sdists ship `aoe2_mcminimap/`; legacy repo layout may also have top-level McMinimap.py */
  function walk(dir) {
    if (existsSync(join(dir, "aoe2_mcminimap", "__init__.py"))) return dir;
    let found = null;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (!statSync(p).isDirectory()) continue;
      found = walk(p);
      if (found) return found;
    }
    return null;
  }
  const root = walk(extractDir);
  if (!root) {
    throw new Error(`[fetch-pylibs] could not find aoe2_mcminimap package under ${extractDir}`);
  }
  return root;
}

/**
 * Vendor McMinimap CLI/package tree from an sdist (TestPyPI by default).
 * Override: AOE2_MCMINIMAP_VERSION, AOE2_MCMINIMAP_PYPI_INDEX (e.g. https://pypi.org).
 */
async function fetchAoe2McMinimap() {
  const version = process.env.AOE2_MCMINIMAP_VERSION?.trim() || "0.1.0";
  const indexBase =
    process.env.AOE2_MCMINIMAP_PYPI_INDEX?.replace(/\/$/, "") || "https://test.pypi.org";
  const dest = join(repoRoot, "sourcemodules/aoe2mcminimap");
  const marker = join(dest, ".version");
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === version) {
    console.log(`[fetch-pylibs] AOE2-McMinimap ${version} already present, skipping.`);
    return;
  }

  console.log(`[fetch-pylibs] downloading AOE2-McMinimap ${version} from ${indexBase}`);
  const url = await resolvePypiSdistUrl("aoe2-mcminimap", version, indexBase);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpArchive = join(tmpdir(), `aoe2-mcminimap-${version}-${stamp}.tar.gz`);
  const tmpExtract = join(tmpdir(), `aoe2-mcminimap-extract-${stamp}`);

  try {
    await downloadToFile(url, tmpArchive);
    extractTarGz(tmpArchive, tmpExtract);
    const root = findAoe2McMinimapSdistRoot(tmpExtract);

    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const legacyCli = join(root, "McMinimap.py");
    if (existsSync(legacyCli)) {
      cpSync(legacyCli, join(dest, "McMinimap.py"));
    }
    cpSync(join(root, "aoe2_mcminimap"), join(dest, "aoe2_mcminimap"), { recursive: true });
    writeFileSync(marker, `${version}\n`);

    console.log(`[fetch-pylibs] AOE2-McMinimap ${version} -> ${dest}`);
  } finally {
    try {
      rmSync(tmpArchive, { force: true });
    } catch {}
    try {
      rmSync(tmpExtract, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  for (const pkg of PYLIBS) await fetchOne(pkg);
  await fetchAoe2McMinimap();
}

main().catch((e) => {
  console.error("[fetch-pylibs] failed:", e);
  process.exit(1);
});
