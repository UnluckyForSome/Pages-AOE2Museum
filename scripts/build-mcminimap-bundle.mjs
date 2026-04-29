#!/usr/bin/env node
// Packs the runtime-needed slice of the AOE2-McMinimap submodule (repo-root
// vendor/aoe2mcminimap) plus vendor/pylibs into a single tar at
// public/mcminimap/vendor/aoe2mcminimap.tar, plus a manifest.json describing
// the source SHAs and contents.
//
// Cache-gated: if the submodule HEAD SHA and every vendored pylib version
// match what's in manifest.json and the tar already exists, we skip work.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const submoduleDir = resolve(repoRoot, "vendor/aoe2mcminimap");
const pylibsDir = resolve(repoRoot, "vendor/pylibs");
const outDir = resolve(repoRoot, "public/mcminimap/vendor");
const tarPath = join(outDir, "aoe2mcminimap.tar");
const manifestPath = join(outDir, "manifest.json");

// Bump when packaging rules change (submodule SHA alone is not enough to invalidate).
const BUNDLE_SPEC_VERSION = 2;

// Submodule top-level entries to ship to the browser.
const SUBMODULE_INCLUDE = ["McMinimap.py", "data", "emblems", "legacy"];
// Inside `legacy`, ship mgz_legacy (recordings) plus agescx_legacy (.scn / .scx classic scenarios).
const LEGACY_KEEP = new Set(["mgz_legacy", "agescx_legacy.py"]);

const SKIP_DIRS = new Set(["__pycache__", ".git", "examples", "tests"]);

function getSubmoduleSha() {
  return execFileSync("git", ["-C", submoduleDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function readPylibVersions() {
  // Map each pylib to its version marker (written by fetch-pylibs.mjs).
  if (!existsSync(pylibsDir)) return {};
  const out = {};
  for (const name of readdirSync(pylibsDir)) {
    const marker = join(pylibsDir, name, ".version");
    if (!existsSync(marker)) continue;
    try {
      out[name] = readFileSync(marker, "utf8").trim();
    } catch {
      // ignore
    }
  }
  return out;
}

function readManifest() {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function collectFiles() {
  const files = [];

  for (const top of SUBMODULE_INCLUDE) {
    const abs = join(submoduleDir, top);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isFile()) {
      files.push({ abs, rel: top });
    } else if (st.isDirectory()) {
      walk(abs, top, files, top === "legacy" ? LEGACY_KEEP : null);
    }
  }

  if (existsSync(pylibsDir)) {
    for (const name of readdirSync(pylibsDir)) {
      const abs = join(pylibsDir, name);
      if (!statSync(abs).isDirectory()) continue;
      walk(abs, posix.join("pylibs", name), files, null);
    }
  }

  return files;
}

function walk(dirAbs, dirRel, files, topLevelFilter) {
  for (const name of readdirSync(dirAbs)) {
    if (dirRel === "legacy" && topLevelFilter && !topLevelFilter.has(name)) continue;
    if (SKIP_DIRS.has(name)) continue;
    if (name === ".version") continue;
    const abs = join(dirAbs, name);
    const rel = posix.join(dirRel, name);
    const st = statSync(abs);
    if (st.isFile()) {
      if (name.endsWith(".pyc")) continue;
      files.push({ abs, rel });
    } else if (st.isDirectory()) {
      walk(abs, rel, files, null);
    }
  }
}

// --- minimal USTAR writer (512-byte blocks, no GNU extensions) ---------------

function octal(num, length) {
  return num.toString(8).padStart(length - 1, "0") + "\0";
}

function writeField(buf, str, offset, length) {
  const bytes = Buffer.from(str, "utf8");
  if (bytes.length > length) throw new Error(`tar field too long: ${JSON.stringify(str)}`);
  bytes.copy(buf, offset);
}

function tarHeader(name, size, mtime, typeflag) {
  if (Buffer.byteLength(name, "utf8") > 100) {
    throw new Error(`tar path too long for USTAR: ${name}`);
  }
  const header = Buffer.alloc(512);
  writeField(header, name, 0, 100);
  writeField(header, octal(0o644, 8), 100, 8);
  writeField(header, octal(0, 8), 108, 8);
  writeField(header, octal(0, 8), 116, 8);
  writeField(header, octal(size, 12), 124, 12);
  writeField(header, octal(Math.floor(mtime / 1000), 12), 136, 12);
  header.write("        ", 148, 8, "ascii");
  header.write(typeflag, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  const checksum = sum.toString(8).padStart(6, "0") + "\0 ";
  header.write(checksum, 148, 8, "ascii");

  return header;
}

function writeTar(files, outPath) {
  const fd = openSync(outPath, "w");
  try {
    for (const f of files) {
      const data = readFileSync(f.abs);
      const mtime = statSync(f.abs).mtimeMs;
      const header = tarHeader(f.rel, data.length, mtime, "0");
      writeSync(fd, header);
      writeSync(fd, data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) writeSync(fd, Buffer.alloc(pad));
    }
    writeSync(fd, Buffer.alloc(1024));
  } finally {
    closeSync(fd);
  }
}

// -----------------------------------------------------------------------------

function shallowEqual(a, b) {
  const ak = Object.keys(a || {});
  const bk = Object.keys(b || {});
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

function main() {
  if (!existsSync(join(submoduleDir, "McMinimap.py"))) {
    console.error(
      "[build-mcminimap-bundle] submodule not populated — run `npm run sync:mcminimap` first.",
    );
    process.exit(1);
  }

  const sha = getSubmoduleSha();
  const pylibs = readPylibVersions();

  const prev = readManifest();
  if (
    prev &&
    prev.specVersion === BUNDLE_SPEC_VERSION &&
    prev.sourceSha === sha &&
    shallowEqual(prev.pylibs, pylibs) &&
    existsSync(tarPath)
  ) {
    const pylibSummary = Object.keys(pylibs).length
      ? " + " + Object.entries(pylibs).map(([n, v]) => `${n}@${v}`).join(",")
      : "";
    console.log(
      `[build-mcminimap-bundle] up to date at ${sha.slice(0, 7)}${pylibSummary}, skipping.`,
    );
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const files = collectFiles().sort((a, b) => a.rel.localeCompare(b.rel));
  writeTar(files, tarPath);
  const bytes = statSync(tarPath).size;

  const manifest = {
    specVersion: BUNDLE_SPEC_VERSION,
    sourceSha: sha,
    pylibs,
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    bytes,
    files: files.map((f) => f.rel),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const pylibSummary = Object.keys(pylibs).length
    ? ", pylibs: " + Object.entries(pylibs).map(([n, v]) => `${n}@${v}`).join(",")
    : "";
  console.log(
    `[build-mcminimap-bundle] wrote ${relative(repoRoot, tarPath)} ` +
      `(${files.length} files, ${(bytes / 1024).toFixed(1)} KiB, sha ${sha.slice(0, 7)}${pylibSummary})`,
  );
}

main();
