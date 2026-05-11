#!/usr/bin/env node
// Packs McMinimap sources from sourcemodules/aoe2mcminimap (populated by
// fetch-pylibs.mjs from PyPI/TestPyPI), plus fetched aoe2_geniescx,
// aoe2_mccampaign, AOE2-McMGZ (`mgz` import namespace), and its
// transitive deps (`construct`, `aocref`) into
// public/modules/aoe2mcminimap/aoe2mcminimap.tar + manifest.json.
//
// Cache-gated: pylib versions + AOE2-McMinimap version must match manifest.json.

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
const mcminimapSrcDir = resolve(repoRoot, "sourcemodules/aoe2mcminimap");
const aoe2GenieScxPkgDir = resolve(repoRoot, "sourcemodules/aoe2_geniescx");
const aoe2McCampaignPkgDir = resolve(repoRoot, "sourcemodules/aoe2_mccampaign");
const mgzPkgDir = resolve(repoRoot, "sourcemodules/mgz");
const constructDir = resolve(repoRoot, "sourcemodules/construct");
const aocrefDir = resolve(repoRoot, "sourcemodules/aocref");
const outDir = resolve(repoRoot, "public/modules/aoe2mcminimap");
const tarPath = join(outDir, "aoe2mcminimap.tar");
const manifestPath = join(outDir, "manifest.json");

const BUNDLE_SPEC_VERSION = 14;

const MCMINIMAP_TOP = ["McMinimap.py", "aoe2_mcminimap"];

const SKIP_DIRS = new Set(["__pycache__", ".git", "examples", "tests"]);

function readPylibVersions() {
  const roots = [
    { name: "construct", dir: constructDir },
    { name: "aocref", dir: aocrefDir },
    { name: "aoe2_geniescx", dir: aoe2GenieScxPkgDir },
    { name: "aoe2_mccampaign", dir: aoe2McCampaignPkgDir },
    { name: "aoe2_mcmgz", dir: mgzPkgDir },
    { name: "aoe2_mcminimap", dir: mcminimapSrcDir },
  ];
  const out = {};
  for (const { name, dir } of roots) {
    const marker = join(dir, ".version");
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

  if (!existsSync(join(aoe2GenieScxPkgDir, "__init__.py"))) {
    console.error(
      "[build-mcminimap-bundle] aoe2_geniescx missing — run `npm run fetch:pylibs` first.",
    );
    process.exit(1);
  }
  if (!existsSync(join(aoe2McCampaignPkgDir, "__init__.py"))) {
    console.error(
      "[build-mcminimap-bundle] aoe2_mccampaign missing — run `npm run fetch:pylibs` first.",
    );
    process.exit(1);
  }
  if (!existsSync(join(mgzPkgDir, "__init__.py"))) {
    console.error(
      "[build-mcminimap-bundle] mgz (from AOE2-McMGZ) missing — run `npm run fetch:pylibs` first.",
    );
    process.exit(1);
  }

  for (const top of MCMINIMAP_TOP) {
    const abs = join(mcminimapSrcDir, top);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isFile()) {
      files.push({ abs, rel: top });
    } else if (st.isDirectory()) {
      walk(abs, top, files, null);
    }
  }

  const pyPack = [
    { abs: aoe2GenieScxPkgDir, rel: "pylibs/aoe2_geniescx" },
    { abs: aoe2McCampaignPkgDir, rel: "pylibs/aoe2_mccampaign" },
    { abs: mgzPkgDir, rel: "pylibs/mgz" },
    { abs: constructDir, rel: "pylibs/construct" },
    { abs: aocrefDir, rel: "pylibs/aocref" },
  ];
  for (const { abs, rel } of pyPack) {
    if (!existsSync(abs)) continue;
    if (!statSync(abs).isDirectory()) continue;
    walk(abs, rel, files, null);
  }

  return files;
}

function walk(dirAbs, dirRel, files, topLevelFilter) {
  for (const name of readdirSync(dirAbs)) {
    if (dirRel === "aoe2_mcminimap" && name === "legacy") continue;
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

function shallowEqual(a, b) {
  const ak = Object.keys(a || {});
  const bk = Object.keys(b || {});
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

function main() {
  if (!existsSync(join(mcminimapSrcDir, "aoe2_mcminimap", "__init__.py"))) {
    console.error(
      "[build-mcminimap-bundle] sourcemodules/aoe2mcminimap (aoe2_mcminimap package) missing — run `npm run fetch:pylibs` first.",
    );
    process.exit(1);
  }

  const pylibs = readPylibVersions();

  const prev = readManifest();
  if (
    prev &&
    prev.specVersion === BUNDLE_SPEC_VERSION &&
    shallowEqual(prev.pylibs, pylibs) &&
    existsSync(tarPath)
  ) {
    const mm = pylibs.aoe2_mcminimap ? ` mcminimap@${pylibs.aoe2_mcminimap}` : "";
    const pylibSummary = Object.keys(pylibs).length
      ? " +" + Object.entries(pylibs).map(([n, v]) => ` ${n}@${v}`).join("")
      : "";
    console.log(`[build-mcminimap-bundle] up to date (${mm || pylibSummary}), skipping.`);
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const files = collectFiles().sort((a, b) => a.rel.localeCompare(b.rel));
  writeTar(files, tarPath);
  const bytes = statSync(tarPath).size;

  const manifest = {
    specVersion: BUNDLE_SPEC_VERSION,
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
      `(${files.length} files, ${(bytes / 1024).toFixed(1)} KiB${pylibSummary})`,
  );
}

main();
