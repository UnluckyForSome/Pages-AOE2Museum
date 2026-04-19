#!/usr/bin/env node
// Downloads pinned pure-Python packages that micropip cannot resolve as
// wheels and vendors their source into vendor/pylibs/. The bundle
// script then ships them alongside the renderer and bootstrap.py adds
// `pylibs/` to sys.path so `import construct` Just Works.
//
// Why: `construct==2.8.16` (pinned by the vendored happyleaves mgz tree)
// was only ever published as an sdist on PyPI, so
// `micropip.install("construct==2.8.16")` errors out with:
//   ValueError: Can't find a pure Python 3 wheel for: 'construct==2.8.16'

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
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
    // Path of the package directory *inside* the extracted sdist.
    subpath: "construct-2.8.16/construct",
  },
  {
    // aocref ships only sdists on PyPI, so micropip can't install it. The
    // vendored legacy/mgz_legacy/reference.py calls
    // `pkgutil.get_data('aocref', 'data/datasets/<id>.json')`, which requires
    // the whole `aocref/data/**` tree to be on sys.path as a package.
    name: "aocref",
    version: "2.0.37",
    url: "https://files.pythonhosted.org/packages/0a/89/d5984391ce282fbc33f0584917f26b924b9e4a522c37a6323a033cdc4d79/aocref-2.0.37.tar.gz",
    subpath: "aocref-2.0.37/aocref",
  },
];

const pylibsRoot = join(repoRoot, "vendor/pylibs");

function versionMarkerPath(pkg) {
  return join(pylibsRoot, pkg.name, ".version");
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

  console.log(`[fetch-pylibs] downloading ${pkg.name} ${pkg.version}`);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpArchive = join(tmpdir(), `${pkg.name}-${pkg.version}-${stamp}.tar.gz`);
  const tmpExtract = join(tmpdir(), `${pkg.name}-extract-${stamp}`);

  try {
    await downloadToFile(pkg.url, tmpArchive);
    extractTarGz(tmpArchive, tmpExtract);

    const extracted = join(tmpExtract, pkg.subpath);
    if (!existsSync(extracted)) {
      throw new Error(`expected package dir missing after extract: ${extracted}`);
    }

    const out = join(pylibsRoot, pkg.name);
    if (existsSync(out)) rmSync(out, { recursive: true, force: true });
    mkdirSync(pylibsRoot, { recursive: true });
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

async function main() {
  for (const pkg of PYLIBS) await fetchOne(pkg);
}

main().catch((e) => {
  console.error("[fetch-pylibs] failed:", e);
  process.exit(1);
});
