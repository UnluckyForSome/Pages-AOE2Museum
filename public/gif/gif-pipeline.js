// =============================================================================
// Align decoded RGBA frames, optional NN scale, encode to GIF (gifenc) or APNG.
// =============================================================================

import {
  GIFEncoder,
  quantize,
  applyPalette,
} from "/gif/vendor/gifenc.esm.js";
import { zlibSync } from "/gif/vendor/fflate.browser.js";

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// ---- CRC32 (PNG / APNG chunks) ---------------------------------------------

const CRC_TABLE = (function makeCrcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, off, len) {
  let c = 0xffffffff;
  const end = off + len;
  for (let i = off; i < end; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(typeStr, data) {
  const type = new Uint8Array(4);
  for (let i = 0; i < 4; i++) type[i] = typeStr.charCodeAt(i);
  const n = data.length;
  const out = new Uint8Array(4 + 4 + n + 4);
  const v = new DataView(out.buffer);
  v.setUint32(0, n, false);
  out.set(type, 4);
  out.set(data, 8);
  const c = crc32(out, 4, 4 + n);
  v.setUint32(8 + n, c, false);
  return out;
}

function u32be(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

function u16be(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, false);
  return b;
}

function ihdrData(width, height) {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, width, false);
  v.setUint32(4, height, false);
  d[8] = 8;
  d[9] = 6;
  d[10] = 0;
  d[11] = 0;
  d[12] = 0;
  return d;
}

function fcTLData(seq, width, height, delayMs) {
  const d = new Uint8Array(26);
  const v = new DataView(d.buffer);
  v.setUint32(0, seq, false);
  v.setUint32(4, width, false);
  v.setUint32(8, height, false);
  v.setUint32(12, 0, false);
  v.setUint32(16, 0, false);
  const dn = Math.max(1, Math.round(delayMs));
  v.setUint16(20, dn, false);
  v.setUint16(22, 1000, false);
  d[24] = 0;
  d[25] = 0;
  return d;
}

/** Raw RGBA scanlines: filter 0 + row bytes (color type 6). */
function rgbaToScanlines(rgba, width, height) {
  const row = 1 + width * 4;
  const out = new Uint8Array(row * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    out[o++] = 0;
    const rs = y * width * 4;
    out.set(rgba.subarray(rs, rs + width * 4), o);
    o += width * 4;
  }
  return out;
}

function splitIdat(zlibData, maxPayload) {
  const max = maxPayload || 0x100000;
  if (zlibData.length <= max) return [zlibData];
  const parts = [];
  for (let i = 0; i < zlibData.length; i += max) {
    parts.push(zlibData.subarray(i, Math.min(i + max, zlibData.length)));
  }
  return parts;
}

function mergeUint8Arrays(arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// ---- shared prep -------------------------------------------------------------

function alignFrames(frames) {
  let maxLeft = 0;
  let maxTop = 0;
  let maxRight = 0;
  let maxBottom = 0;
  for (const f of frames) {
    maxLeft = Math.max(maxLeft, f.hotspotX);
    maxTop = Math.max(maxTop, f.hotspotY);
    maxRight = Math.max(maxRight, f.width - f.hotspotX);
    maxBottom = Math.max(maxBottom, f.height - f.hotspotY);
  }
  const cw = Math.max(1, maxLeft + maxRight);
  const ch = Math.max(1, maxTop + maxBottom);
  const out = [];
  for (const fr of frames) {
    const rgba = new Uint8ClampedArray(cw * ch * 4);
    const dx = maxLeft - fr.hotspotX;
    const dy = maxTop - fr.hotspotY;
    for (let y = 0; y < fr.height; y++) {
      const sy = (y * fr.width) * 4;
      const ty = dy + y;
      if (ty < 0 || ty >= ch) continue;
      const dstRow = (ty * cw + dx) * 4;
      rgba.set(fr.rgba.subarray(sy, sy + fr.width * 4), dstRow);
    }
    out.push(rgba);
  }
  return { rgbaFrames: out, width: cw, height: ch };
}

function nnScaleRgba(rgba, w, h, scale) {
  const s = Math.max(1, Math.floor(scale));
  if (s <= 1) return { rgba, width: w, height: h };
  const nw = w * s;
  const nh = h * s;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, (y / s) | 0);
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, (x / s) | 0);
      const si = (sy * w + sx) * 4;
      const di = (y * nw + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { rgba: out, width: nw, height: nh };
}

/** Composite partial alpha onto white (GIF opaque background). */
function flattenOnWhite(rgba, w, h) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = ((rgba[i] * a + 255 * (1 - a)) | 0);
    out[i + 1] = ((rgba[i + 1] * a + 255 * (1 - a)) | 0);
    out[i + 2] = ((rgba[i + 2] * a + 255 * (1 - a)) | 0);
    out[i + 3] = 255;
  }
  return out;
}

function prepareAnimationFrames(frames, sel) {
  if (!frames || frames.length === 0) {
    throw new Error("No frames to encode.");
  }
  const aligned = alignFrames(frames);
  const scale = Number(sel.scale) || 1;
  const scaled = [];
  for (const rgba of aligned.rgbaFrames) {
    const { rgba: r, width: rw, height: rh } = nnScaleRgba(
      rgba,
      aligned.width,
      aligned.height,
      scale,
    );
    scaled.push(r);
  }
  const w = scaled.length ? (aligned.width * Math.max(1, Math.floor(scale))) : aligned.width;
  const h = scaled.length ? (aligned.height * Math.max(1, Math.floor(scale))) : aligned.height;
  return { rgbaFrames: scaled, width: w, height: h };
}

// ---- GIF: DE-style shadows (black RGB + partial A) -----------------------------
//
// gifenc’s `oneBitAlpha: true` uses threshold 127: alpha ≤127 → treated as
// transparent in the palette. DXT4 shadows are black (0,0,0) with alpha
// often below that, so they disappear. We (1) nudge alpha up on near-black
// pixels only (matches SLD composeFrameRGBA shadow output) and (2) pass a
// lower numeric threshold so more semi-transparent pixels snap to “opaque”
// in the 256-colour GIF.

const GIF_SHADOW_RGB_CAP = 12;
const GIF_SHADOW_ALPHA_BOOST = 72;
/** Alpha ≤ this (after boost) tends toward transparent in quantize; lower = stronger shadow. Default true → 127. */
const GIF_ONE_BIT_ALPHA_THRESHOLD = 38;

function boostNearBlackShadowForGif(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0 || a === 255) continue;
    if (rgba[i] <= GIF_SHADOW_RGB_CAP
      && rgba[i + 1] <= GIF_SHADOW_RGB_CAP
      && rgba[i + 2] <= GIF_SHADOW_RGB_CAP) {
      rgba[i + 3] = Math.min(255, a + GIF_SHADOW_ALPHA_BOOST);
    }
  }
}

// ---- GIF --------------------------------------------------------------------

export function framesToGifBytes(frames, sel, onProgress) {
  const delay = Math.max(20, Number(sel.delay) || 100);
  const transparent = sel.transparent !== false;

  const { rgbaFrames, width: cw, height: ch } = prepareAnimationFrames(frames, sel);

  let working = rgbaFrames;
  if (!transparent) {
    working = working.map(function (rgba) {
      return flattenOnWhite(rgba, cw, ch);
    });
  } else {
    for (let j = 0; j < working.length; j++) {
      boostNearBlackShadowForGif(working[j]);
    }
  }

  const n = working.length;
  if (onProgress) onProgress(0, n);

  const palette = quantize(working[0], 256, {
    format: "rgba4444",
    oneBitAlpha: transparent ? GIF_ONE_BIT_ALPHA_THRESHOLD : false,
  });
  let transparentIndex = 0;
  if (transparent) {
    for (let i = 0; i < palette.length; i++) {
      if (palette[i].length >= 4 && palette[i][3] === 0) {
        transparentIndex = i;
        break;
      }
    }
  }

  const gif = GIFEncoder();
  for (let i = 0; i < n; i++) {
    if (onProgress) onProgress(i + 1, n);
    const idx = applyPalette(working[i], palette, "rgba4444");
    gif.writeFrame(idx, cw, ch, {
      palette: i === 0 ? palette : undefined,
      first: i === 0,
      transparent: !!transparent,
      transparentIndex,
      delay,
      repeat: 0,
    });
  }
  gif.finish();
  const bytes = gif.bytes();
  return { bytes, width: cw, height: ch };
}

// ---- APNG -------------------------------------------------------------------

export function framesToApngBytes(frames, sel, onProgress) {
  const delay = Math.max(20, Number(sel.delay) || 100);
  let { rgbaFrames, width: cw, height: ch } = prepareAnimationFrames(frames, sel);
  if (sel.transparent === false) {
    rgbaFrames = rgbaFrames.map(function (rgba) {
      return flattenOnWhite(rgba, cw, ch);
    });
  }
  const n = rgbaFrames.length;

  const parts = [];
  parts.push(PNG_SIG);
  parts.push(chunk("IHDR", ihdrData(cw, ch)));

  const ac = new Uint8Array(8);
  const acv = new DataView(ac.buffer);
  acv.setUint32(0, n, false);
  acv.setUint32(4, 0, false);
  parts.push(chunk("acTL", ac));

  // Shared fcTL/fdAT sequence numbers (Mozilla APNG spec): acTL has none; first
  // fcTL is 0; IDAT has none; second fcTL is 1; first fdAT is 2; then strictly
  // increasing with no gaps or duplicates.
  for (let i = 0; i < n; i++) {
    if (onProgress) onProgress(i + 1, n);
    const fcSeq = i === 0 ? 0 : (i * 2 - 1);
    parts.push(chunk("fcTL", fcTLData(fcSeq, cw, ch, delay)));
    const scan = rgbaToScanlines(rgbaFrames[i], cw, ch);
    const zlibbed = zlibSync(scan, { level: 6 });
    if (i === 0) {
      for (const piece of splitIdat(zlibbed)) {
        parts.push(chunk("IDAT", piece));
      }
    } else {
      const fdSeq = i * 2;
      const payload = new Uint8Array(4 + zlibbed.length);
      new DataView(payload.buffer).setUint32(0, fdSeq, false);
      payload.set(zlibbed, 4);
      parts.push(chunk("fdAT", payload));
    }
  }

  parts.push(chunk("IEND", new Uint8Array(0)));
  const bytes = mergeUint8Arrays(parts);
  return { bytes, width: cw, height: ch };
}
