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
export const LAYER_UNKNOWN = 0x04; // tile-mask refinement for inherited frames
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

  return { rgba: out, coordinates: coords, flags, inherited: !!(flags & 0x80) };
}

// ---------------------------------------------------------------------------
// Tile-mask refinement for inherited frames (layer 0x04).
//
// When flag 0x80 of the main layer says "reuse last frame's pixels in any
// block that isn't re-drawn this frame", a separate RLE-encoded tile-mask
// stream tells us which of those inherited pixels are actually still part
// of the silhouette. Any pixel whose bit in the mask is zero must have its
// alpha cleared, otherwise we leak stale pixels from the previous frame
// (the "uncleared tiles of inherited frames" bug in the 1.3 extractor).
//
// Stream layout, per row of 4x4 tiles:
//   u8[2]       - header (version=5, 0)
//   u16[rows]   - per-row byte offset into the payload
//   payload:    - interleaved (skip-count / draw-header / tile-mask[]) runs
//     skip bytes  (c < 128)  advance the tile cursor by c tiles
//     draw header (c >= 128) starts a run of (c - 128) u16 tile masks
//       per tile: if mask == 0   -> clear alpha of all 16 pixels
//                 if mask != 0   -> clear alpha of pixels where bit j is 0
//
// Ported from `adjustByUnknownLayer()` in `SLD Extractor 1.4/sld.js`, with
// one deliberate correction: the upstream writes `tile & (1 << j) == 0`,
// which due to JS precedence evaluates as `tile & ((1 << j) == 0)` -> 0,
// making the per-pixel clear a no-op. We parenthesise it so partial-tile
// leftovers are cleared too.
// ---------------------------------------------------------------------------

function adjustByUnknownLayer(rawData, frame, normalResult) {
  if (!normalResult || !normalResult.inherited) return;
  const coord = normalResult.coordinates;
  if (!coord) return;

  const [x0, y0, x1, y1] = coord;
  const stride = frame.width;
  const rightLimit = x1;
  const data = normalResult.rgba;

  const rows = (y1 - y0) >> 2;
  if (rows <= 0) return;
  const startOffset = 2 + rows * 2;

  const offsets = new Array(rows + 1);
  for (let p = 0; p < rows; p++) {
    const ptr = p * 2 + 2;
    offsets[p] = (rawData[ptr] | (rawData[ptr + 1] << 8)) + startOffset;
  }
  offsets[rows] = rawData.length;

  let tile = 0;
  for (let p = 0; p < rows; p++) {
    let off0 = offsets[p];
    const off1 = offsets[p + 1];
    let xOff = x0;
    let yOff = p * 4 + y0;

    // Consume leading skip bytes to align the cursor to the first drawn tile.
    let c = rawData[off0];
    if (c < 128) {
      xOff += c * 4;
      c = rawData[++off0];
    }
    while (c !== undefined && c < 128) {
      if (c > 1) xOff += c * 4;
      c = rawData[++off0];
    }
    if (c === undefined) continue;
    let slen = c - 128;
    off0++;

    for (; off0 < off1; off0 += 2, slen -= 1) {
      if (slen <= 0) {
        // Next skip-count / draw-header pair.
        let rep = rawData[off0];
        let c1 = rawData[++off0];
        while (c1 !== undefined && c1 < 128) {
          if (c1 > 1) rep += c1;
          c1 = rawData[++off0];
        }
        if (c1 === undefined) break;
        slen = c1 - 128;

        // Apply the last-seen tile mask to each skipped tile.
        if (tile) {
          for (let k = 0; k < rep; k++) {
            for (let j = 0; j < 16; j++) {
              const xx = xOff + (j % 4);
              if (xx < stride) {
                const yy = yOff + ((j / 4) | 0);
                const o = 4 * (xx + yy * stride);
                if ((tile & (1 << j)) === 0) data[o + 3] = 0;
              }
            }
            xOff += 4;
            if (xOff >= rightLimit) { xOff = x0; yOff += 4; }
          }
        } else {
          for (let k = 0; k < rep; k++) {
            for (let j = 0; j < 16; j++) {
              const xx = xOff + (j % 4);
              const yy = yOff + ((j / 4) | 0);
              const o = 4 * (xx + yy * stride);
              data[o + 3] = 0;
            }
            xOff += 4;
            if (xOff >= rightLimit) { xOff = x0; yOff += 4; }
          }
        }

        if (++off0 >= off1) break;
      }

      // Read the next 16-bit tile mask and apply it to the current tile.
      const xT = xOff;
      const yT = yOff;
      tile = rawData[off0] | (rawData[off0 + 1] << 8);
      if (tile) {
        for (let j = 0; j < 16; j++) {
          const xx = xT + (j % 4);
          if (xx < stride) {
            const yy = yT + ((j / 4) | 0);
            const o = 4 * (xx + yy * stride);
            if ((tile & (1 << j)) === 0) data[o + 3] = 0;
          }
        }
      } else {
        for (let j = 0; j < 16; j++) {
          const xx = xT + (j % 4);
          const yy = yT + ((j / 4) | 0);
          const o = 4 * (xx + yy * stride);
          data[o + 3] = 0;
        }
      }
      xOff += 4;
      if (xOff >= rightLimit) { xOff = x0; yOff += 4; }
    }
  }
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
    // Tile-mask refinement: clears stale pixels in inherited frames so
    // leftovers from the previous frame don't leak through blocks the
    // current frame didn't redraw.
    const unknownChunk = c.chunk();
    adjustByUnknownLayer(unknownChunk, frame, normalResult);
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
