#!/usr/bin/env node
// Build the genie-scx WASM parser (wasm-bindgen, no-modules target) and place
// artifacts under public/modules/geniescx/ for the browser.
//
// Requirements (when building):
// - Rust toolchain with wasm32-unknown-unknown target installed
// - wasm-bindgen-cli on PATH
//
// CI / Cloudflare Pages: `cargo` is usually absent. Set SKIP_GENIE_SCX_WASM=1 or rely on
// auto-skip when cargo is missing — committed outputs under public/modules/geniescx/ must exist.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const genieRoot = resolve(repoRoot, "sourcemodules/genie-rs");
const crateName = "genie-scx-wasm";
const outDir = resolve(repoRoot, "public/modules/geniescx");

const REQUIRED_ARTIFACTS = ["genie_scx_wasm.js", "genie_scx_wasm_bg.wasm"];

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: opts.cwd || repoRoot,
    stdio: "inherit",
    encoding: "utf8",
  });
}

function hasCargo() {
  const r = spawnSync("cargo", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0;
}

function artifactsOk() {
  return REQUIRED_ARTIFACTS.every((name) => existsSync(join(outDir, name)));
}

function maybeSkipForCi() {
  const forceSkip = process.env.SKIP_GENIE_SCX_WASM === "1";
  const noCargo = !hasCargo();
  if (!forceSkip && !noCargo) return false;

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  if (!artifactsOk()) {
    console.error(
      "[build-genie-scx-wasm] skipping compile (" +
        (forceSkip ? "SKIP_GENIE_SCX_WASM=1" : "cargo not on PATH") +
        ") but pre-built artifacts are missing:",
    );
    for (const name of REQUIRED_ARTIFACTS) {
      const p = join(outDir, name);
      console.error("  - " + p + (existsSync(p) ? " OK" : " MISSING"));
    }
    console.error(
      "Run `npm run build:genie-scx-wasm` locally (Rust + wasm-bindgen), commit public/modules/geniescx/*",
    );
    process.exit(1);
  }

  console.log(
    "[build-genie-scx-wasm] skip compile (" +
      (forceSkip ? "SKIP_GENIE_SCX_WASM=1" : "no cargo") +
      "); using committed artifacts in public/modules/geniescx/",
  );
  return true;
}

function main() {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  if (maybeSkipForCi()) return;

  console.log("[build-genie-scx-wasm] cargo build (wasm32-unknown-unknown) …");
  sh("cargo", ["build", "-p", crateName, "--release", "--target", "wasm32-unknown-unknown"], {
    cwd: genieRoot,
  });

  const wasmIn = join(
    genieRoot,
    "target/wasm32-unknown-unknown/release",
    crateName.replaceAll("-", "_") + ".wasm",
  );

  console.log("[build-genie-scx-wasm] wasm-bindgen …");
  sh("wasm-bindgen", [
    wasmIn,
    "--target",
    "no-modules",
    "--out-dir",
    outDir,
    "--out-name",
    "genie_scx_wasm",
  ]);

  // wasm-bindgen writes:
  // - genie_scx_wasm.js
  // - genie_scx_wasm_bg.wasm
  console.log("[build-genie-scx-wasm] done.");
}

main();

