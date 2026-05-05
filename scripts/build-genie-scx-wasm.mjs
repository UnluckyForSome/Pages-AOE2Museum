#!/usr/bin/env node
// Build the genie-scx WASM parser (wasm-bindgen, no-modules target) and place
// artifacts under public/modules/geniescx/ for the browser.
//
// Requirements:
// - Rust toolchain with wasm32-unknown-unknown target installed
// - wasm-bindgen-cli on PATH

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const genieRoot = resolve(repoRoot, "sourcemodules/genie-rs");
const crateName = "genie-scx-wasm";
const outDir = resolve(repoRoot, "public/modules/geniescx");

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: opts.cwd || repoRoot,
    stdio: "inherit",
    encoding: "utf8",
  });
}

function main() {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

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

