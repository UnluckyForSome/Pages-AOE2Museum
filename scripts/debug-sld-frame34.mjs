/**
 * Export one decoded frame as PNG for comparison: sld-decode.js vs SLD Extractor 1.4.
 *
 *   node scripts/debug-sld-frame34.mjs [path/to/file.sld] [globalFrameIndex] [directionIndex]
 *
 * Default: Trash/SLD Extractor 1.4/u_cav_warwagon_deathA_x2.sld, frame 34, EAST (0).
 * Writes to public/gif/debug/
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { zlibSync } from "fflate";
import vm from "node:vm";

import {
  parseSld,
  cursor,
  decodeFrameWithLayers,
  composeFrameRGBA,
} from "../public/gif/sld-decode.js";
import { TEAM_COLORS } from "../public/gif/team-colors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");

const defaultSld = join(
  repoRoot,
  "Trash",
  "SLD Extractor 1.4",
  "u_cav_warwagon_deathA_x2.sld",
);

const sldPath = process.argv[2] || defaultSld;
const globalFrameIndex = Number(process.argv[3] ?? "34");
const directionIndex = Number(process.argv[4] ?? "0");

const outDir = join(__dirname, "..", "public", "gif", "debug");
mkdirSync(outDir, { recursive: true });
const baseName = sldPath.replace(/\\/g, "/").split("/").pop().replace(/\.sld$/i, "");

// --- PNG (RGBA) -----------------------------------------------------------------

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(typeStr, data) {
  const te = new TextEncoder();
  const type = te.encode(typeStr);
  const len = data.length;
  const crcInput = new Uint8Array(4 + len);
  crcInput.set(type, 0);
  crcInput.set(data, 4);
  const crc = crc32(crcInput);
  const out = new Uint8Array(4 + 4 + len + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len, false);
  out.set(type, 4);
  out.set(data, 8);
  dv.setUint32(8 + len, crc, false);
  return out;
}

function encodePngRgba(rgba, width, height) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width, false);
  dv.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = zlibSync(raw, { level: 6 });

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// --- Reference: SLD Extractor 1.4 (vm) ------------------------------------------

function loadExtractor14() {
  const sldJs = join(repoRoot, "Trash", "SLD Extractor 1.4", "sld.js");
  const code =
    readFileSync(sldJs, "utf8") + "\nthis.__ArrayReader = ArrayReader;\n";
  const ctx = vm.createContext({
    console,
    Uint8Array,
    Uint8ClampedArray,
    ArrayBuffer,
    DataView,
    ImageData: class ImageData {
      constructor(w, h) {
        this.width = w;
        this.height = h;
        this.data = new Uint8ClampedArray(w * h * 4);
      }
    },
    alert: () => {},
    MESSAGES: [""],
    Math,
    NORMAL_COLOR_ALPHA: 224,
    currentSprite: null,
  });
  vm.runInContext(code, ctx);
  return ctx;
}

// --- Decode ours: sequential frames up to globalFrameIndex ----------------------

function decodeOurs(bytes, targetGlobalIndex, composeOpts) {
  const parsed = parseSld(bytes);
  const c = parsed.cursor;
  const previousLayers = { normal: null, shadow: null, player: null };
  let last = null;
  for (let i = 0; i <= targetGlobalIndex; i++) {
    const keep = i === targetGlobalIndex;
    last = decodeFrameWithLayers(c, keep, previousLayers, composeOpts);
  }
  if (!last) throw new Error("decodeFrameWithLayers returned nothing for target frame");
  return last;
}

function diffRgba(a, b, w, h) {
  let diff = 0;
  let max = 0;
  const stride = w * h * 4;
  for (let i = 0; i < stride; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d) {
      diff++;
      if (d > max) max = d;
    }
  }
  return { diffBytes: diff, maxDelta: max, totalBytes: stride };
}

function diffRgbWhereAlpha(a, b, w, h) {
  let diff = 0;
  let max = 0;
  for (let p = 0; p < w * h; p++) {
    const j = p * 4;
    const aa = a[j + 3];
    const ba = b[j + 3];
    if (aa === 0 && ba === 0) continue;
    for (let k = 0; k < 3; k++) {
      const d = Math.abs(a[j + k] - b[j + k]);
      if (d) {
        diff++;
        if (d > max) max = d;
      }
    }
  }
  return { diffRgbSamples: diff, maxDelta: max };
}

/** Reference alpha 0 but ours still visible — typical inherited “ghost” if mask failed. */
function ghostMetrics(refA, oursA, w, h) {
  let refClearOursOpaque = 0;
  let refOpaqueOursClear = 0;
  for (let p = 0; p < w * h; p++) {
    const j = p * 4 + 3;
    const r = refA[j];
    const o = oursA[j];
    if (r === 0 && o > 0) refClearOursOpaque++;
    if (r > 0 && o === 0) refOpaqueOursClear++;
  }
  return { refClearOursOpaque, refOpaqueOursClear };
}

function makeGhostOverlay(refA, oursA, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const j = p * 4;
    const r = refA[j + 3];
    const o = oursA[j + 3];
    if (r === 0 && o > 0) {
      out[j] = 255;
      out[j + 1] = 0;
      out[j + 2] = 0;
      out[j + 3] = 255;
    }
  }
  return out;
}

// --- main -----------------------------------------------------------------------

const bytes = new Uint8Array(readFileSync(sldPath));
const composeOpts = {
  teamRgb: TEAM_COLORS[0],
  drawShadow: true,
};

console.log("SLD:", sldPath);
console.log("Global frame index:", globalFrameIndex, " directionIndex:", directionIndex, "(E=0)");

const ours = decodeOurs(bytes, globalFrameIndex, composeOpts);
const { frame, normalResult, shadowResult, playerResult, composed } = ours;
const composedRgba = composed.rgba;

const normalRgba = normalResult
  ? new Uint8ClampedArray(normalResult.rgba)
  : new Uint8ClampedArray(frame.width * frame.height * 4);

const vmx = loadExtractor14();
const r = new vmx.__ArrayReader(bytes);
vmx.readSpriteFile(r);
const refFrames = vmx.currentSprite.frames;
if (globalFrameIndex >= refFrames.length) {
  throw new Error(`Frame ${globalFrameIndex} out of range (${refFrames.length})`);
}
const refFrame = refFrames[globalFrameIndex];
if (!refFrame.data.normal) {
  throw new Error("Reference frame has no normal layer");
}
const refNormal = new Uint8ClampedArray(refFrame.data.normal.data);

const refComposed = composeFrameRGBA(
  {
    width: refFrame.width,
    height: refFrame.height,
    hotspotX: refFrame.anchorX,
    hotspotY: refFrame.anchorY,
  },
  refFrame.data.normal
    ? { rgba: new Uint8ClampedArray(refFrame.data.normal.data) }
    : null,
  refFrame.data.shadow
    ? { gray: refFrame.data.shadow.data }
    : null,
  refFrame.data.player
    ? { gray: refFrame.data.player.data }
    : null,
  composeOpts,
);

const refComposedRgba = refComposed.rgba;

const tag = `${baseName}-EAST-frame${globalFrameIndex}`;

writeFileSync(
  join(outDir, `${tag}-ours-normal.png`),
  encodePngRgba(normalRgba, frame.width, frame.height),
);
writeFileSync(
  join(outDir, `${tag}-ref14-normal.png`),
  encodePngRgba(refNormal, refFrame.width, refFrame.height),
);
writeFileSync(
  join(outDir, `${tag}-ours-composed.png`),
  encodePngRgba(composedRgba, frame.width, frame.height),
);
writeFileSync(
  join(outDir, `${tag}-ref14-composed.png`),
  encodePngRgba(refComposedRgba, refFrame.width, refFrame.height),
);
writeFileSync(
  join(outDir, `${tag}-ghost-ref0-ours255.png`),
  encodePngRgba(
    makeGhostOverlay(refNormal, normalRgba, frame.width, frame.height),
    frame.width,
    frame.height,
  ),
);

const dNorm = diffRgba(normalRgba, refNormal, frame.width, frame.height);
const dRgb = diffRgbWhereAlpha(normalRgba, refNormal, frame.width, frame.height);
const ghosts = ghostMetrics(refNormal, normalRgba, frame.width, frame.height);
const dComp = diffRgba(composedRgba, refComposedRgba, frame.width, frame.height);

console.log("\nNormal layer (post unknown-layer adjust):");
console.log("  Per-byte differences:", dNorm.diffBytes, "/", dNorm.totalBytes, " maxDelta:", dNorm.maxDelta);
console.log("  RGB diff (where either alpha>0):", dRgb);
console.log("  Ghost test (ref alpha==0, ours>0):", ghosts.refClearOursOpaque, " (should be 0 if clears match 1.4)");
console.log("  Inverse (ref alpha>0, ours==0):", ghosts.refOpaqueOursClear);

console.log("\nComposed (shadow + playercolor, same composeFrameRGBA + TEAM_COLORS[0]):");
console.log("  Per-byte differences:", dComp.diffBytes, "/", dComp.totalBytes, " maxDelta:", dComp.maxDelta);

console.log("\nWrote PNGs to:", outDir);
console.log("  ", `${tag}-ours-normal.png`, `${tag}-ref14-normal.png`);
console.log("  ", `${tag}-ours-composed.png`, `${tag}-ref14-composed.png`);
console.log("  ", `${tag}-ghost-ref0-ours255.png`, "(red = ref transparent, ours still opaque)");
