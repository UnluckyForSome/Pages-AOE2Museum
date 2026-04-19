#!/usr/bin/env node
// Packs the runtime-needed slice of the AOE2-McMinimap submodule into a single
// tar at public/mcminimap/vendor/aoe2mcminimap.tar, plus a manifest.json
// describing the source SHA and contents.
//
// SHA-gated: if the submodule HEAD matches manifest.sourceSha and the tar
// already exists, we exit early.

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
import { join, relative, resolve, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const submoduleDir = resolve(repoRoot, "mcminimap/vendor/aoe2mcminimap");
const outDir = resolve(repoRoot, "public/mcminimap/vendor");
const tarPath = join(outDir, "aoe2mcminimap.tar");
const manifestPath = join(outDir, "manifest.json");

// Only these top-level entries are shipped to the browser.
const INCLUDE = ["McMinimap.py", "data", "emblems", "legacy"];
// Inside `legacy`, only the mgz_legacy tree is needed at runtime.
const LEGACY_KEEP = new Set(["mgz_legacy"]);

function getSubmoduleSha() {
  return execFileSync("git", ["-C", submoduleDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
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
  for (const top of INCLUDE) {
    const abs = join(submoduleDir, top);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isFile()) {
      files.push({ abs, rel: top });
    } else if (st.isDirectory()) {
      walk(abs, top, files, top === "legacy" ? LEGACY_KEEP : null);
    }
  }
  return files;
}

function walk(dirAbs, dirRel, files, topLevelFilter) {
  for (const name of readdirSync(dirAbs)) {
    if (dirRel === "legacy" && topLevelFilter && !topLevelFilter.has(name)) continue;
    if (name === "__pycache__" || name === ".git") continue;
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
  // USTAR numeric field: length-1 octal digits + trailing NUL.
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

function main() {
  if (!existsSync(join(submoduleDir, "McMinimap.py"))) {
    console.error(
      "[build-mcminimap-bundle] submodule not populated — run `npm run sync:mcminimap` first.",
    );
    process.exit(1);
  }

  const sha = getSubmoduleSha();
  const prev = readManifest();
  if (prev && prev.sourceSha === sha && existsSync(tarPath)) {
    console.log(`[build-mcminimap-bundle] up to date at ${sha.slice(0, 7)}, skipping.`);
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const files = collectFiles().sort((a, b) => a.rel.localeCompare(b.rel));
  writeTar(files, tarPath);
  const bytes = statSync(tarPath).size;

  const manifest = {
    sourceSha: sha,
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    bytes,
    files: files.map((f) => f.rel),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(
    `[build-mcminimap-bundle] wrote ${relative(repoRoot, tarPath)} ` +
      `(${files.length} files, ${(bytes / 1024).toFixed(1)} KiB, sha ${sha.slice(0, 7)})`,
  );
}

main();
