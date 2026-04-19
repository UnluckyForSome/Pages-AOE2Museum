// End-to-end smoke test: parse SLD -> render one direction -> encode GIF.
//
//   node scripts/test-sld.mjs [path/to/file.sld] [directionIndex] [player]
//
// Exercises the same decode module the browser worker uses.

import { readFileSync, writeFileSync } from "fs";
import { performance } from "perf_hooks";
import { renderDirection } from "../public/gif/sld-decode.js";
import { TEAM_COLORS } from "../public/gif/team-colors.js";
import {
  GIFEncoder,
  quantize,
  applyPalette,
} from "../public/gif/vendor/gifenc.esm.js";

const sldPath = process.argv[2] || "public/gif/sourcefiles/sld/u_cav_warwagon_elite_walkA_x2.sld";
const directionIndex = Number(process.argv[3] || "0");
const player = Number(process.argv[4] || "1");

const buf = readFileSync(sldPath);
const bytes = new Uint8Array(buf);

const t0 = performance.now();
const { frames, meta } = renderDirection(
  bytes,
  {
    directionIndex,
    drawShadow: true,
    teamRgb: TEAM_COLORS[Math.max(1, Math.min(8, player)) - 1],
  },
  null,
);
const tDecode = performance.now();

console.log("Header:", meta);
console.log("Decoded", frames.length, "frames in", (tDecode - t0).toFixed(1), "ms");

// ---- assertions ----------------------------------------------------------

let nonTransparent = 0;
let tintedPixels = 0;
for (const f of frames) {
  for (let i = 3; i < f.rgba.length; i += 4) {
    if (f.rgba[i] > 0) nonTransparent++;
  }
}

// Ensure at least a few pixels survived the pipeline.
if (nonTransparent === 0) {
  console.error("FAIL: no non-transparent pixels decoded");
  process.exit(1);
}
console.log("non-transparent pixels:", nonTransparent);

// Tint sanity: compare player-1 (blue) vs player-2 (red) max blue/red for
// pixels that differ between the two renders.
const { frames: framesP2 } = renderDirection(bytes, {
  directionIndex,
  drawShadow: true,
  teamRgb: TEAM_COLORS[1], // red
}, null);

let diffP1Blue = 0, diffP2Red = 0;
const ref = frames[0].rgba;
const alt = framesP2[0].rgba;
for (let i = 0; i < ref.length; i += 4) {
  if (ref[i] !== alt[i] || ref[i + 1] !== alt[i + 1] || ref[i + 2] !== alt[i + 2]) {
    tintedPixels++;
    if (ref[i + 2] > alt[i + 2]) diffP1Blue++;
    if (alt[i] > ref[i]) diffP2Red++;
  }
}
console.log("pixels differing between P1 and P2 renders:", tintedPixels,
  " (P1 bluer:", diffP1Blue, "P2 redder:", diffP2Red, ")");
if (tintedPixels === 0) {
  console.warn("WARN: no pixels differ between P1 and P2 - player-mask tint may not be applied.");
}

// ---- align + encode ------------------------------------------------------

let maxLeft = 0, maxTop = 0, maxRight = 0, maxBottom = 0;
for (const f of frames) {
  maxLeft = Math.max(maxLeft, f.hotspotX);
  maxTop = Math.max(maxTop, f.hotspotY);
  maxRight = Math.max(maxRight, f.width - f.hotspotX);
  maxBottom = Math.max(maxBottom, f.height - f.hotspotY);
}
const cw = Math.max(1, maxLeft + maxRight);
const ch = Math.max(1, maxTop + maxBottom);
console.log("canvas:", cw, "x", ch);

const blitted = frames.map((fr) => {
  const out = new Uint8ClampedArray(cw * ch * 4);
  const dx = maxLeft - fr.hotspotX;
  const dy = maxTop - fr.hotspotY;
  for (let y = 0; y < fr.height; y++) {
    const sy = (y * fr.width) * 4;
    const ty = dy + y;
    if (ty < 0 || ty >= ch) continue;
    const dstRow = (ty * cw + dx) * 4;
    out.set(fr.rgba.subarray(sy, sy + fr.width * 4), dstRow);
  }
  return out;
});

// Cap the GIF to 8 frames so this smoke test stays small + fast.
const gifFrames = blitted.slice(0, Math.min(8, blitted.length));

const palette = quantize(gifFrames[0], 256, { format: "rgba4444", oneBitAlpha: true });
let transparentIndex = 0;
for (let i = 0; i < palette.length; i++) {
  if (palette[i].length >= 4 && palette[i][3] === 0) { transparentIndex = i; break; }
}

const gif = GIFEncoder();
for (let i = 0; i < gifFrames.length; i++) {
  const idx = applyPalette(gifFrames[i], palette, "rgba4444");
  gif.writeFrame(idx, cw, ch, {
    palette: i === 0 ? palette : undefined,
    first: i === 0,
    transparent: true,
    transparentIndex,
    delay: 100,
    repeat: 0,
  });
}
gif.finish();
const outBytes = gif.bytes();
const tEncode = performance.now();

writeFileSync("scripts/test-sld.gif", Buffer.from(outBytes));
console.log(
  "wrote scripts/test-sld.gif  bytes=" + outBytes.length +
  "  frames=" + gifFrames.length +
  "  decode+encode=" + (tEncode - t0).toFixed(1) + "ms",
);
