// End-to-end smoke test: parse SLP -> render one direction -> encode GIF.
//
//   node scripts/test-slp.mjs [path/to/file.slp]

import { readFileSync, writeFileSync } from "fs";
import { STANDARD_PALETTE } from "../public/gif/palette.js";
import {
  GIFEncoder,
  quantize,
  applyPalette,
} from "../public/gif/vendor/gifenc.esm.js";

const SLP_END_OF_ROW = 0x0f;
const SLP_COLOR_LIST = 0x00;
const SLP_COLOR_LIST_EX = 0x02;
const SLP_COLOR_LIST_PLAYER = 0x06;
const SLP_SKIP = 0x01;
const SLP_SKIP_EX = 0x03;
const SLP_FILL = 0x07;
const SLP_FILL_PLAYER = 0x0a;
const SLP_SHADOW = 0x0b;
const SLP_EXTENDED = 0x0e;
const SLP_EX_OUTLINE1 = 0x40;
const SLP_EX_FILL_OUTLINE1 = 0x50;
const SLP_EX_OUTLINE2 = 0x60;
const SLP_EX_FILL_OUTLINE2 = 0x70;
const SLP_LINE_EMPTY = 0x8000;

const RENDER_NEXTLINE = 0x00;
const RENDER_COLOR = 0x01;
const RENDER_SKIP = 0x02;
const RENDER_PLAYER_COLOR = 0x03;
const RENDER_SHADOW = 0x04;
const RENDER_OUTLINE = 0x05;
const RENDER_FILL = 0x06;
const RENDER_PLAYER_FILL = 0x07;

function parseHeader(bytes, view) {
  const td = new TextDecoder("ascii");
  const version = td.decode(bytes.subarray(0, 4));
  const numFrames = view.getInt32(4, true);
  const frames = [];
  let off = 32;
  for (let i = 0; i < numFrames; i++) {
    frames.push({
      cmdTableOffset: view.getUint32(off + 0, true),
      outlineTableOffset: view.getUint32(off + 4, true),
      paletteOffset: view.getUint32(off + 8, true),
      properties: view.getUint32(off + 12, true),
      width: view.getInt32(off + 16, true),
      height: view.getInt32(off + 20, true),
      hotspotX: view.getInt32(off + 24, true),
      hotspotY: view.getInt32(off + 28, true),
    });
    off += 32;
  }
  return { version, numFrames, frames };
}

function parseFrame(bytes, view, frame) {
  const outlines = [];
  let offset = frame.outlineTableOffset;
  for (let i = 0; i < frame.height; i++) {
    outlines.push({
      left: view.getUint16(offset, true),
      right: view.getUint16(offset + 2, true),
    });
    offset += 4;
  }
  offset = frame.cmdTableOffset + frame.height * 4;
  const commands = [];
  let y = 0;
  while (y < frame.height) {
    const cmd = bytes[offset];
    const lowNibble = cmd & 0x0f;
    const highNibble = cmd & 0xf0;
    const lowBits = cmd & 0x03;
    let pxCount;
    if (lowNibble === SLP_END_OF_ROW) {
      commands.push({ command: RENDER_NEXTLINE });
      y++;
    } else if (lowBits === SLP_COLOR_LIST) {
      pxCount = cmd >> 2;
      while (pxCount--) { offset++; commands.push({ command: RENDER_COLOR, arg: bytes[offset] }); }
    } else if (lowBits === SLP_SKIP) {
      pxCount = cmd >> 2 || bytes[++offset];
      commands.push({ command: RENDER_SKIP, arg: pxCount });
    } else if (lowNibble === SLP_COLOR_LIST_EX) {
      offset++;
      pxCount = (highNibble << 4) + bytes[offset];
      while (pxCount--) { offset++; commands.push({ command: RENDER_COLOR, arg: bytes[offset] }); }
    } else if (lowNibble === SLP_SKIP_EX) {
      offset++;
      pxCount = (highNibble << 4) + bytes[offset];
      commands.push({ command: RENDER_SKIP, arg: pxCount });
    } else if (lowNibble === SLP_COLOR_LIST_PLAYER) {
      pxCount = cmd >> 4 || bytes[++offset];
      while (pxCount--) { offset++; commands.push({ command: RENDER_PLAYER_COLOR, arg: bytes[offset] }); }
    } else if (lowNibble === SLP_FILL) {
      pxCount = cmd >> 4 || bytes[++offset];
      offset++;
      commands.push({ command: RENDER_FILL, arg: { pxCount, color: bytes[offset] } });
    } else if (lowNibble === SLP_FILL_PLAYER) {
      pxCount = cmd >> 4 || bytes[++offset];
      offset++;
      commands.push({ command: RENDER_PLAYER_FILL, arg: { pxCount, color: bytes[offset] } });
    } else if (lowNibble === SLP_SHADOW) {
      pxCount = cmd >> 4 || bytes[++offset];
      commands.push({ command: RENDER_SHADOW, arg: pxCount });
    } else if (lowNibble === SLP_EXTENDED) {
      if (highNibble === SLP_EX_OUTLINE1 || highNibble === SLP_EX_OUTLINE2) {
        commands.push({ command: RENDER_OUTLINE, arg: 1 });
      } else if (highNibble === SLP_EX_FILL_OUTLINE1 || highNibble === SLP_EX_FILL_OUTLINE2) {
        offset++;
        pxCount = bytes[offset];
        while (pxCount--) commands.push({ command: RENDER_OUTLINE, arg: 1 });
      }
    } else {
      throw new Error("Unknown opcode 0x" + cmd.toString(16));
    }
    offset++;
  }
  return { outlines, commands };
}

function playerColor(palette, idx, player) {
  const resolved = idx + 16 * player;
  return palette[resolved] || palette[idx] || [0, 0, 0];
}

function renderRGBA(frame, parsed, palette, player, drawOutline) {
  const { outlines, commands } = parsed;
  const { width, height } = frame;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let idx = 0;
  let y = 0;
  let skip = outlines[0].left;
  if (skip === SLP_LINE_EMPTY) skip = width;
  idx = skip * 4;

  function push(rgb, a) {
    pixels[idx++] = rgb[0]; pixels[idx++] = rgb[1]; pixels[idx++] = rgb[2]; pixels[idx++] = a;
  }

  for (const { command, arg } of commands) {
    switch (command) {
      case RENDER_SKIP: idx += arg * 4; break;
      case RENDER_NEXTLINE: {
        idx += outlines[y].right * 4;
        y++;
        if (y < height) {
          let s = outlines[y].left;
          if (s === SLP_LINE_EMPTY) s = width;
          idx += s * 4;
        }
        break;
      }
      case RENDER_COLOR: push(palette[arg], 255); break;
      case RENDER_FILL: {
        let n = arg.pxCount; const c = palette[arg.color];
        while (n--) push(c, 255); break;
      }
      case RENDER_OUTLINE: push([0, 0, 0], drawOutline ? 255 : 0); break;
      case RENDER_PLAYER_COLOR: push(playerColor(palette, arg, player), 255); break;
      case RENDER_PLAYER_FILL: {
        let n = arg.pxCount; const c = playerColor(palette, arg.color, player);
        while (n--) push(c, 255); break;
      }
      case RENDER_SHADOW: { let n = arg; while (n--) push([0, 0, 0], 64); break; }
    }
  }
  return pixels;
}

// ---- run ----------------------------------------------------------------

const slpPath = process.argv[2] || "public/gif/testgraphics/slp/5207.slp";
const buf = readFileSync(slpPath);
const bytes = new Uint8Array(buf);
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const t0 = performance.now();
const header = parseHeader(bytes, view);
console.log("Header:", { version: header.version, numFrames: header.numFrames });

const fpd = header.numFrames / 5;
const sliceIdx = 0; // S
const start = sliceIdx * fpd;
const rendered = [];
let maxLeft = 0, maxTop = 0, maxRight = 0, maxBottom = 0;
for (let i = start; i < start + fpd; i++) {
  const f = header.frames[i];
  const parsed = parseFrame(bytes, view, f);
  const rgba = renderRGBA(f, parsed, STANDARD_PALETTE, 1, false);
  rendered.push({ w: f.width, h: f.height, hx: f.hotspotX, hy: f.hotspotY, rgba });
  maxLeft = Math.max(maxLeft, f.hotspotX);
  maxTop = Math.max(maxTop, f.hotspotY);
  maxRight = Math.max(maxRight, f.width - f.hotspotX);
  maxBottom = Math.max(maxBottom, f.height - f.hotspotY);
}
const cw = maxLeft + maxRight;
const ch = maxTop + maxBottom;
console.log("canvas:", cw, "x", ch);

const blitted = rendered.map((fr) => {
  const out = new Uint8ClampedArray(cw * ch * 4);
  const dx = maxLeft - fr.hx;
  const dy = maxTop - fr.hy;
  for (let y = 0; y < fr.h; y++) {
    const srcRow = (y * fr.w) * 4;
    const dstRow = ((dy + y) * cw + dx) * 4;
    out.set(fr.rgba.subarray(srcRow, srcRow + fr.w * 4), dstRow);
  }
  return out;
});

const palette = quantize(blitted[0], 256, { format: "rgba4444", oneBitAlpha: true });
let transparentIndex = 0;
for (let i = 0; i < palette.length; i++) {
  if (palette[i].length >= 4 && palette[i][3] === 0) { transparentIndex = i; break; }
}

const gif = GIFEncoder();
for (let i = 0; i < blitted.length; i++) {
  const idx = applyPalette(blitted[i], palette, "rgba4444");
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
const t1 = performance.now();

writeFileSync("scripts/test-slp.gif", Buffer.from(outBytes));
console.log("wrote scripts/test-slp.gif  bytes=" + outBytes.length + "  in " + (t1 - t0).toFixed(1) + "ms");
