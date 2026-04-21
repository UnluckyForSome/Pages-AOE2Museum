// Decode one SLD frame with public/gif/sld-decode.js and write a PNG for visual debugging.
//
//   node scripts/debug-sld-frame-png.mjs [path/to/file.sld] [frame1Based] [player1to8]
//
// Defaults target the warwagon death sample and the 35th on-disk frame (1-based).
// Output: public/gif/testgraphics/outputpng/<basename>-frame<idx>.png

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "node:zlib";

import { decodeFrameAtIndex } from "../public/gif/sld-decode.js";
import { TEAM_COLORS } from "../public/gif/team-colors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const defaultSld = join(
  repoRoot,
  "public/gif/testgraphics/sld/u_cav_warwagon_deathA_x2.sld",
);
const defaultOutDir = join(repoRoot, "public/gif/testgraphics/outputpng");

const sldPath = process.argv[2] || defaultSld;
const frameOneBased = Math.max(1, Number(process.argv[3] || "35") | 0);
const player = Math.max(1, Math.min(8, Number(process.argv[4] || "1") | 0));
const frameIndex = frameOneBased - 1;

// Solid backdrop so transparent pixels are obvious when inspecting halos / edges.
const DEBUG_BG = { r: 140, g: 60, b: 200 };

function compositeOverSolidBg(rgba, width, height, bg) {
  const { r: br, g: bgG, b: bb } = bg;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    const ia = 1 - a;
    out[i] = (rgba[i] * a + br * ia) | 0;
    out[i + 1] = (rgba[i + 1] * a + bgG * ia) | 0;
    out[i + 2] = (rgba[i + 2] * a + bb * ia) | 0;
    out[i + 3] = 255;
  }
  return out;
}

// --- minimal RGBA8 PNG (zlib IDAT, no extra deps) -------------------------

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "binary");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function encodePngRgba8(width, height, rgba) {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`PNG: expected ${expected} rgba bytes, got ${rgba.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBpr = width * 4;
  const raw = Buffer.alloc((1 + rowBpr) * height);
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y++) {
    const o = y * (1 + rowBpr);
    raw[o] = 0;
    src.copy(raw, o + 1, y * rowBpr, (y + 1) * rowBpr);
  }

  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- run ------------------------------------------------------------------

mkdirSync(defaultOutDir, { recursive: true });

const buf = readFileSync(sldPath);
const bytes = new Uint8Array(buf);

const { frame, meta } = decodeFrameAtIndex(bytes, frameIndex, {
  drawShadow: true,
  teamRgb: TEAM_COLORS[player - 1],
});

const outName = `${basename(sldPath, ".sld")}-frame${frameOneBased}.png`;
const outPath = join(defaultOutDir, outName);

const flattened = compositeOverSolidBg(
  frame.rgba,
  frame.width,
  frame.height,
  DEBUG_BG,
);
writeFileSync(outPath, encodePngRgba8(frame.width, frame.height, flattened));

console.log("SLD:", sldPath);
console.log("meta:", meta);
console.log("frame:", frame.width, "x", frame.height, "hotspot", frame.hotspotX, frame.hotspotY);
console.log("wrote:", outPath);
