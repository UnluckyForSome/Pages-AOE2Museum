// =============================================================================
// SLD parser + frame decoder (SLDX v4, AoE2: Definitive Edition).
//
// Pure ES module - no DOM, no worker APIs - so it can be imported from both
// the module worker (worker-sld.js) and the Node smoke test (scripts/test-sld.mjs).
//
// Output frames share the shape returned by worker-slp.js:
//   { rgba: Uint8ClampedArray, width, height, hotspotX, hotspotY }
//
// DXT1 / DXT4 reference:
//   https://github.com/SFTtech/openage/blob/master/doc/media/sld-files.md
// =============================================================================

// Frame-type bit flags (as they appear in the raw byte).
export const LAYER_MAIN    = 0x01;
export const LAYER_SHADOW  = 0x02;
export const LAYER_UNKNOWN = 0x04; // damage/selection tile-mask refinement (skipped)
export const LAYER_SMUDGE  = 0x08; // damage overlay (not rendered)
export const LAYER_PLAYER  = 0x10;

// Counter-clockwise storage order starting at E. Slice index -> bearing.
// This is the order frames are stored in the SLD file itself; the UI option
// values are set so that each picker entry maps directly to its stored slice.
export const DIRECTION_ORDER = [
  "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW",
  "W", "WNW", "NW", "NNW",
  "N", "NNE", "NE", "ENE",
];

// ---------------------------------------------------------------------------
// Cursor: tiny DataView-backed reader (LE throughout).
// ---------------------------------------------------------------------------

export function cursor(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  return {
    get pos() { return p; },
    set pos(v) { p = v; },
    get end() { return bytes.byteLength; },
    u8()   { return bytes[p++]; },
    i8()   { const v = view.getInt8(p); p += 1; return v; },
    u16()  { const v = view.getUint16(p, true); p += 2; return v; },
    i16()  { const v = view.getInt16(p, true);  p += 2; return v; },
    u32()  { const v = view.getUint32(p, true); p += 4; return v; },
    bytes(n) { const s = bytes.subarray(p, p + n); p += n; return s; },
    // Read a layer chunk header (u32 size, inclusive of the 4-byte header
    // itself) and return the remaining bytes padded up to 4-byte alignment.
    chunk() {
      const size = view.getUint32(p, true); p += 4;
      const padded = ((size - 1) >> 2) << 2;
      const data = bytes.subarray(p, p + padded);
      p += padded;
      return data;
    },
  };
}

// ---------------------------------------------------------------------------
// DXT colour helpers
// ---------------------------------------------------------------------------

function rgb565to888(c) {
  return [
    ((c >> 11) & 0x1f) * 255 / 31 | 0,
    ((c >>  5) & 0x3f) * 255 / 63 | 0,
    ( c        & 0x1f) * 255 / 31 | 0,
  ];
}

function mix3(a, b, t) {
  return [
    (a[0] * (1 - t) + b[0] * t) | 0,
    (a[1] * (1 - t) + b[1] * t) | 0,
    (a[2] * (1 - t) + b[2] * t) | 0,
  ];
}

function mixI(a, b, t) { return (a * (1 - t) + b * t) | 0; }

// ---------------------------------------------------------------------------
// Layer header (shared between main/shadow and smudge/player variants).
// ---------------------------------------------------------------------------

function readLayerHeader(c, hasCoords) {
  let coordinates = null;
  if (hasCoords) coordinates = [c.i16(), c.i16(), c.i16(), c.i16()];
  const flags = c.u8();
  c.u8(); // unknown
  const drawCount = c.i16();
  const draws = c.bytes(drawCount * 2);
  return { coordinates, flags, draws };
}

// ---------------------------------------------------------------------------
// DXT1 main-graphics / smudge layer -> RGBA Uint8ClampedArray
// ---------------------------------------------------------------------------

function decodeDxt1Layer(chunkBytes, frame, previousRgba, hasCoords) {
  const c = cursor(chunkBytes);
  const { coordinates, flags, draws } = readLayerHeader(c, hasCoords);
  const coords = coordinates || frame.normalCoords;
  const { width, height } = frame;
  const out = new Uint8ClampedArray(width * height * 4);
  const inheritPrev = (flags & 0x80) && previousRgba;

  const [x0, y0, x1, y1] = coords;
  let drawIdx = 0;
  let drawNumber = draws.length > 0 ? draws[0] : 0;
  let draw = false;

  const view = new DataView(chunkBytes.buffer, chunkBytes.byteOffset, chunkBytes.byteLength);

  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      while (--drawNumber < 0) {
        drawNumber = draws[++drawIdx];
        draw = (drawIdx % 2) === 1;
      }

      if (draw) {
        const p = c.pos;
        const c0v = view.getUint16(p, true);
        const c1v = view.getUint16(p + 2, true);
        const indices = view.getUint32(p + 4, true);
        c.pos = p + 8;

        const color0 = rgb565to888(c0v);
        const color1 = rgb565to888(c1v);
        let lut2, lut3, alpha3;
        if (c0v > c1v) {
          lut2 = mix3(color0, color1, 1 / 3);
          lut3 = mix3(color0, color1, 2 / 3);
          alpha3 = 255;
        } else {
          lut2 = mix3(color0, color1, 0.5);
          lut3 = null;
          alpha3 = 0;
        }

        for (let m = 0; m < 4; m++) {
          const yy = y + m;
          if (yy >= height) continue;
          for (let n = 0; n < 4; n++) {
            const xx = x + n;
            if (xx >= width) continue;
            const i = m * 4 + n;
            const ci = (indices >>> (i * 2)) & 0x3;
            const off = (xx + yy * width) * 4;
            if (ci === 3) {
              if (lut3) {
                out[off]     = lut3[0];
                out[off + 1] = lut3[1];
                out[off + 2] = lut3[2];
                out[off + 3] = alpha3;
              }
              // else leave pre-zeroed (transparent)
            } else {
              const col = ci === 0 ? color0 : ci === 1 ? color1 : lut2;
              out[off]     = col[0];
              out[off + 1] = col[1];
              out[off + 2] = col[2];
              out[off + 3] = 255;
            }
          }
        }
      } else if (inheritPrev) {
        for (let m = 0; m < 4; m++) {
          const yy = y + m;
          if (yy >= height) continue;
          const rowStart = (x + yy * width) * 4;
          for (let n = 0; n < 4; n++) {
            const xx = x + n;
            if (xx >= width) break;
            const off = rowStart + n * 4;
            out[off]     = previousRgba[off];
            out[off + 1] = previousRgba[off + 1];
            out[off + 2] = previousRgba[off + 2];
            out[off + 3] = previousRgba[off + 3];
          }
        }
      }
    }
  }

  return { rgba: out, coordinates: coords, flags };
}

// ---------------------------------------------------------------------------
// DXT4 shadow / player-mask layer -> grayscale Uint8Array
// ---------------------------------------------------------------------------

function decodeDxt4Layer(chunkBytes, frame, previousGray, hasCoords) {
  const c = cursor(chunkBytes);
  const { coordinates, flags, draws } = readLayerHeader(c, hasCoords);
  const coords = coordinates || frame.normalCoords;
  const { width, height } = frame;
  const out = new Uint8Array(width * height);
  const inheritPrev = (flags & 0x80) && previousGray;

  const [x0, y0, x1, y1] = coords;
  let drawIdx = 0;
  let drawNumber = draws.length > 0 ? draws[0] : 0;
  let draw = false;

  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      while (--drawNumber < 0) {
        drawNumber = draws[++drawIdx];
        draw = (drawIdx % 2) === 1;
      }

      if (draw) {
        const color0 = c.u8();
        const color1 = c.u8();
        const idx0 = c.u8(), idx1 = c.u8(), idx2 = c.u8();
        const idx3 = c.u8(), idx4 = c.u8(), idx5 = c.u8();
        const indices = [idx0, idx1, idx2, idx3, idx4, idx5];

        let lut;
        if (color0 > color1) {
          lut = [
            color0, color1,
            mixI(color0, color1, 1 / 7),
            mixI(color0, color1, 2 / 7),
            mixI(color0, color1, 3 / 7),
            mixI(color0, color1, 4 / 7),
            mixI(color0, color1, 5 / 7),
            mixI(color0, color1, 6 / 7),
          ];
        } else {
          lut = [
            color0, color1,
            mixI(color0, color1, 1 / 5),
            mixI(color0, color1, 2 / 5),
            mixI(color0, color1, 3 / 5),
            mixI(color0, color1, 4 / 5),
            -1, // fully empty
            255,
          ];
        }

        for (let m = 0; m < 4; m++) {
          const yy = y + m;
          if (yy >= height) continue;
          for (let n = 0; n < 4; n++) {
            const xx = x + n;
            if (xx >= width) continue;
            const i = m * 4 + n;
            const vi = (i * 3) >> 3;
            const ri = (i * 3) & 0x7;
            const low = indices[vi] | 0;
            const high = vi + 1 < 6 ? (indices[vi + 1] | 0) : 0;
            const ci = ((low | (high << 8)) >> ri) & 0x7;
            const v = lut[ci];
            if (v >= 0) out[xx + yy * width] = v;
          }
        }
      } else if (inheritPrev) {
        for (let m = 0; m < 4; m++) {
          const yy = y + m;
          if (yy >= height) continue;
          const rowStart = x + yy * width;
          for (let n = 0; n < 4; n++) {
            const xx = x + n;
            if (xx >= width) break;
            out[rowStart + n] = previousGray[rowStart + n];
          }
        }
      }
    }
  }

  return { gray: out, coordinates: coords, flags };
}

// ---------------------------------------------------------------------------
// Damage-mask / "LAYER_UNKNOWN" refinement (chunk 0x04).
//
// For frames whose main layer inherits pixels from the previous frame
// (main-layer flag 0x80), this chunk carries a compressed per-pixel bitmask
// that specifies which inherited pixels must be cleared to transparent. SLD
// Extractor 1.3 discarded it entirely, which leaves ghost trails on attack /
// death / turn animations. This port is derived from SLD Extractor 1.4's
// adjustByUnknownLayer(), with the upstream operator-precedence bug fixed so
// partial tiles actually get cleared per-pixel (upstream wrote
// `tile & (1 << j) == 0`, which JS parses as `tile & ((1<<j)==0)` -> always
// 0, reducing the function to "clear whole 4x4 tiles where tile === 0").
//
// Layout (reverse-engineered from 1.4's compileUnknown writer):
//   [2 bytes magic, ignored]
//   [rows * 2 bytes of u16 LE: per-row byte offset into segment blob]
//   [segment blob]
//
// Each row's segment is a run-length encoded stream of:
//   - leading skip bytes (value < 128) advancing xOff by N * 4
//   - a length byte (value >= 128) marking the count (value - 128) of 16-bit
//     tile bitmasks that follow
//   - each tile bitmask: bit j set means "keep inherited pixel j", bit j
//     clear means "zero the alpha"; a fully-zero tile clears the whole block
//   - repeat blocks (when the length counter runs out) that re-emit the
//     previous tile pattern N times before the next length byte
// ---------------------------------------------------------------------------

function adjustNormalByTileMask(chunkBytes, normalRgba, coordinates, frameWidth, frameHeight) {
  if (!chunkBytes || !normalRgba || !coordinates) return;
  const [x0, y0, x1, y1] = coordinates;
  const layerW = x1 - x0;
  const layerH = y1 - y0;
  if (layerW <= 0 || layerH <= 0) return;

  const rows = layerH >>> 2;
  if (rows === 0) return;

  const headerLen = 2 + rows * 2;
  if (chunkBytes.length < headerLen) return;

  const offsets = new Array(rows + 1);
  for (let p = 0; p < rows; p++) {
    const ptr = 2 + p * 2;
    offsets[p] = (chunkBytes[ptr] | (chunkBytes[ptr + 1] << 8)) + headerLen;
  }
  offsets[rows] = chunkBytes.length;

  const stride = frameWidth;
  const rightLimit = x1;

  // Pixel-clear helpers. Both guard x/y against the frame bounds so a
  // corrupted mask cannot write outside the RGBA buffer.
  const clearMasked = (xOff, yOff, tile) => {
    for (let j = 0; j < 16; j++) {
      const x = xOff + (j & 3);
      if (x < 0 || x >= stride || x >= rightLimit) continue;
      const y = yOff + (j >> 2);
      if (y < 0 || y >= frameHeight) continue;
      if ((tile & (1 << j)) === 0) {
        normalRgba[((x + y * stride) << 2) + 3] = 0;
      }
    }
  };
  const clearAll = (xOff, yOff) => {
    for (let j = 0; j < 16; j++) {
      const x = xOff + (j & 3);
      if (x < 0 || x >= stride) continue;
      const y = yOff + (j >> 2);
      if (y < 0 || y >= frameHeight) continue;
      normalRgba[((x + y * stride) << 2) + 3] = 0;
    }
  };

  let tile = 0;
  for (let p = 0; p < rows; p++) {
    let off0 = offsets[p];
    const off1 = Math.min(offsets[p + 1], chunkBytes.length);
    if (off0 >= off1) continue;

    let xOff = x0;
    let yOff = p * 4 + y0;

    // Leading skips: walk past bytes < 128, advancing xOff by N * 4. The
    // first byte skips unconditionally; subsequent bytes only advance when
    // value > 1 (matching the 1.4 encoder's per-row header semantics).
    let c = chunkBytes[off0];
    if (c < 128) {
      xOff += c * 4;
      off0++;
      while (off0 < off1) {
        c = chunkBytes[off0];
        if (c >= 128) break;
        if (c > 1) xOff += c * 4;
        off0++;
      }
      if (off0 >= off1) continue;
    }
    let slen = c - 128;
    off0++;

    while (off0 < off1) {
      if (slen <= 0) {
        // Repeat block: `rep` copies of the previous tile pattern, followed
        // by another length byte (>= 128) that begins the next tile run.
        if (off0 >= off1) break;
        let rep = chunkBytes[off0++];
        let foundNext = false;
        while (off0 < off1) {
          const c1 = chunkBytes[off0++];
          if (c1 >= 128) {
            slen = c1 - 128;
            foundNext = true;
            break;
          }
          if (c1 > 1) rep += c1;
        }

        if (tile) {
          for (let k = 0; k < rep; k++) {
            clearMasked(xOff, yOff, tile);
            xOff += 4;
            if (xOff >= rightLimit) { xOff = x0; yOff += 4; }
          }
        } else {
          for (let k = 0; k < rep; k++) {
            clearAll(xOff, yOff);
            xOff += 4;
            if (xOff >= rightLimit) { xOff = x0; yOff += 4; }
          }
        }

        if (!foundNext) break;
        if (off0 >= off1) break;
      }

      if (off0 + 1 >= off1) break;
      const tileX = xOff, tileY = yOff;
      tile = chunkBytes[off0] | (chunkBytes[off0 + 1] << 8);
      off0 += 2;
      slen -= 1;

      if (tile) {
        clearMasked(tileX, tileY, tile);
      } else {
        clearAll(tileX, tileY);
      }
      xOff += 4;
      if (xOff >= rightLimit) { xOff = x0; yOff += 4; }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-frame decode + composition
// ---------------------------------------------------------------------------

function composeFrameRGBA(frame, normal, shadow, player, opts) {
  const { width, height } = frame;
  const out = normal
    ? new Uint8ClampedArray(normal.rgba)
    : new Uint8ClampedArray(width * height * 4);

  const teamRgb = opts.teamRgb || [0, 0, 0];
  const drawShadow = opts.drawShadow !== false;

  if (shadow && drawShadow) {
    const g = shadow.gray;
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      const a = g[i];
      if (a && out[j + 3] < 128) {
        out[j]     = 0;
        out[j + 1] = 0;
        out[j + 2] = 0;
        out[j + 3] = a;
      }
    }
  }

  if (player) {
    const m = player.gray;
    const tr = teamRgb[0], tg = teamRgb[1], tb = teamRgb[2];
    for (let i = 0, j = 0; i < m.length; i++, j += 4) {
      const alpha = m[i];
      if (!alpha) continue;
      const r = out[j], g = out[j + 1], b = out[j + 2];
      const lum = out[j + 3] ? (0.299 * r + 0.587 * g + 0.114 * b) : 160;
      const lk = lum / 255;
      const targetR = (tr * lk) | 0;
      const targetG = (tg * lk) | 0;
      const targetB = (tb * lk) | 0;
      const k = alpha / 255;
      out[j]     = (r * (1 - k) + targetR * k) | 0;
      out[j + 1] = (g * (1 - k) + targetG * k) | 0;
      out[j + 2] = (b * (1 - k) + targetB * k) | 0;
      out[j + 3] = 255;
    }
  }

  return {
    rgba: out,
    width, height,
    hotspotX: frame.hotspotX,
    hotspotY: frame.hotspotY,
  };
}

export function decodeFrame(c, keep, previousLayers, opts) {
  const width = c.u16();
  const height = c.u16();
  const hotspotX = c.i16();
  const hotspotY = c.i16();
  const frameType = c.u8();
  c.u8(); // unknown
  c.u16(); // frame index

  const frame = { width, height, hotspotX, hotspotY, normalCoords: null };

  let normalResult = null;
  let shadowResult = null;
  let playerResult = null;

  if (frameType & LAYER_MAIN) {
    normalResult = decodeDxt1Layer(c.chunk(), frame, previousLayers.normal, true);
    frame.normalCoords = normalResult.coordinates;
  }
  if (frameType & LAYER_SHADOW) {
    shadowResult = decodeDxt4Layer(c.chunk(), frame, previousLayers.shadow, true);
  }
  if (frameType & LAYER_UNKNOWN) {
    // Per-pixel alpha refinement for inherited main layers. Non-inherited
    // frames carry the chunk too (we still need to consume it for cursor
    // alignment), but the mask only has visible effect when the normal
    // layer copied pixels from the previous frame via flag 0x80.
    const maskBytes = c.chunk();
    if (normalResult && (normalResult.flags & 0x80)) {
      adjustNormalByTileMask(
        maskBytes,
        normalResult.rgba,
        normalResult.coordinates,
        width,
        height,
      );
    }
  }
  if (frameType & LAYER_SMUDGE) {
    c.chunk();
  }
  if (frameType & LAYER_PLAYER) {
    playerResult = decodeDxt4Layer(c.chunk(), frame, previousLayers.player, false);
  }

  previousLayers.normal = normalResult ? normalResult.rgba : previousLayers.normal;
  previousLayers.shadow = shadowResult ? shadowResult.gray : previousLayers.shadow;
  previousLayers.player = playerResult ? playerResult.gray : previousLayers.player;

  if (!keep) return null;
  return composeFrameRGBA(frame, normalResult, shadowResult, playerResult, opts);
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

export function parseSld(bytes) {
  const c = cursor(bytes);
  const td = new TextDecoder("ascii");

  const sig = td.decode(c.bytes(4));
  if (sig !== "SLDX") throw new Error("Not an SLDX file (got '" + sig + "')");

  const version = c.u16();
  const numFrames = c.u16();
  c.u16(); // unknown1
  c.u16(); // unknown2 (always 0x0010)
  c.u32(); // unknown3 (always 0xFF000000)

  if (numFrames === 0) throw new Error("SLD has no frames.");
  if (numFrames > 4096) throw new Error("SLD has too many frames (" + numFrames + ")");

  return { bytes, cursor: c, version, numFrames };
}

// ---------------------------------------------------------------------------
// High-level entry: "render one direction's worth of frames".
// ---------------------------------------------------------------------------

export function renderDirection(bytes, opts, onProgress) {
  const parsed = parseSld(bytes);
  const numDirs = 16;

  // Accepted directional-frame layouts:
  //   1. N % 16 == 0      -> N/16 frames per direction.
  //   2. N % 16 == 1      -> trailing "reference"/idle frame that every AoE2
  //                           DE military sprite carries. Ignore the last
  //                           frame and treat the remaining (N-1) as 16
  //                           directions of (N-1)/16 frames each.
  // Anything else falls back to "one reel, all frames" (statics, decorations).
  let usableFrames = parsed.numFrames;
  if (usableFrames % numDirs === 1) usableFrames -= 1;

  let fpd = Math.floor(usableFrames / numDirs);
  let startIdx, endIdx;
  if (fpd > 0 && usableFrames % numDirs === 0) {
    const dir = Math.max(0, Math.min(numDirs - 1, (opts.directionIndex | 0)));
    startIdx = dir * fpd;
    endIdx = startIdx + fpd;
  } else {
    fpd = parsed.numFrames;
    startIdx = 0;
    endIdx = parsed.numFrames;
  }

  const previousLayers = { normal: null, shadow: null, player: null };
  const composeOpts = {
    teamRgb: opts.teamRgb || [80, 110, 210],
    drawShadow: !!opts.drawShadow,
  };

  const frames = [];
  const c = parsed.cursor;
  for (let i = 0; i < parsed.numFrames; i++) {
    const keep = i >= startIdx && i < endIdx;
    const f = decodeFrame(c, keep, previousLayers, composeOpts);
    if (f) {
      frames.push(f);
      if (onProgress) {
        const total = endIdx - startIdx;
        onProgress(frames.length, total);
      }
    }
    if (i + 1 >= endIdx) break;
  }

  if (frames.length === 0) throw new Error("No frames decoded in the selected direction.");

  return {
    frames,
    meta: {
      version: parsed.version,
      numFrames: parsed.numFrames,
      framesPerDirection: fpd,
      directionIndex: opts.directionIndex | 0,
      directionLabel: DIRECTION_ORDER[opts.directionIndex | 0] || "?",
    },
  };
}
