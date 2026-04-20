// =============================================================================
// SLD (Age of Empires II: DE sprite) decoder.
//
// Ported from examples/SLD Extractor 1.4/sld.js by WAIFor, stripped to the
// decode path only and rewritten as a DOM-free ES module so the same code
// can run in a Web Worker (worker-sld.js) and in Node (scripts/test-sld.mjs).
//
// The public API is a single function:
//
//   renderDirection(bytes, opts, progressCb?)
//     bytes       - Uint8Array containing the raw .sld file
//     opts.directionIndex - which 22.5-degree slice to render (clamped)
//     opts.drawShadow     - draw the shadow layer (else skip)
//     opts.teamRgb        - [r, g, b] tint for the player-color mask
//     progressCb  - optional (done, total) => void, called per decoded frame
//
// Returns:
//   {
//     meta: {
//       version, frameCount, numDirections, framesPerDirection,
//       directionIndex, directionLabel, opacity
//     },
//     frames: [{ width, height, hotspotX, hotspotY, rgba }]
//   }
//
// SLD layers (per frame, order matters because later ones reference earlier):
//   0x01 normal  - 16bpp RGB DXT1-style 4x4 blocks
//   0x02 shadow  - 8bpp alpha DXT5-alpha-style 4x4 blocks
//   0x04 damage  - run-length "unknown" mask that punches alpha holes in
//                  inherited normal layers; only meaningful when the normal
//                  layer set the 0x80 inherit flag
//   0x08 smudge  - unused in this renderer (we don't expose it)
//   0x10 player  - 8bpp grayscale player-colour mask
// =============================================================================

// Alpha we stamp onto pixels that belong to the main RGB layer; any other
// alpha value signals a different layer (shadow/player) in the composite
// buffer and survives later passes.
const NORMAL_COLOR_ALPHA = 224;

// 22.5-degree compass labels, matching the SLD_DIRECTION_OPTIONS list in
// app.js (index 0 = E, walking clockwise through S, W, N and back to E).
const DIRECTION_LABELS_16 = [
  "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW",
  "W", "WNW", "NW", "NNW",
  "N", "NNE", "NE", "ENE",
];

// ---------------------------------------------------------------------------
// Little-endian byte reader. Mirrors the reference ArrayReader but trimmed
// to the surface decode uses.
// ---------------------------------------------------------------------------

class ArrayReader {
  constructor(array) {
    this.array = array;
    this.pointer = 0;
  }
  read(length) {
    const slice = this.array.subarray(this.pointer, this.pointer + length);
    this.pointer += length;
    return slice;
  }
  readText(length) {
    let s = "";
    const end = this.pointer + length;
    for (let i = this.pointer; i < end; i++) s += String.fromCharCode(this.array[i]);
    this.pointer = end;
    return s;
  }
  readUBytes(length) {
    return Array.from(this.read(length));
  }
  readUShorts(length) {
    const out = new Array(length);
    for (let i = 0; i < length; i++) {
      const p = this.pointer + i * 2;
      out[i] = this.array[p] | (this.array[p + 1] << 8);
    }
    this.pointer += length * 2;
    return out;
  }
  readShorts(length) {
    return this.readUShorts(length).map((e) => (e >= 0x8000 ? e - 0x10000 : e));
  }
  readUInts(length) {
    const out = new Array(length);
    for (let i = 0; i < length; i++) {
      const p = this.pointer + i * 4;
      out[i] = (this.array[p]
        | (this.array[p + 1] << 8)
        | (this.array[p + 2] << 16)
        | (this.array[p + 3] << 24)) >>> 0;
    }
    this.pointer += length * 4;
    return out;
  }
  // SLD chunks are a u32 length (includes the 4 length bytes themselves) then
  // bytes padded to the next 4-byte boundary.
  readChunk() {
    const size = this.readUInts(1)[0];
    const payload = (size - 1) >> 2 << 2;
    return this.read(payload);
  }
}

// ---------------------------------------------------------------------------
// Colour / math helpers.
// ---------------------------------------------------------------------------

function fromColor16(v) {
  return [
    (v >> 11 & 0x1f) * 255 / 31,
    (v >> 5  & 0x3f) * 255 / 63,
    (v       & 0x1f) * 255 / 31,
  ];
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function mixValue(a, b, t) { return Math.floor(a * (1 - t) + b * t); }
function mixColor(a, b, t) {
  return [mixValue(a[0], b[0], t), mixValue(a[1], b[1], t), mixValue(a[2], b[2], t)];
}

function setPixel(data, offset, color, alpha) {
  if (!color) return;
  offset *= 4;
  data[offset]     = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = alpha;
}

// ---------------------------------------------------------------------------
// Per-layer headers. All layers share the "drawCount"-of-run-length-pairs
// bitmap that tells us which 4x4 tiles are present vs empty.
// ---------------------------------------------------------------------------

function readLayerHeader(reader, hasSize) {
  let coordinates;
  if (hasSize) coordinates = reader.readShorts(4);
  const [flags/*, unk*/] = reader.readUBytes(2);
  const drawCount = reader.readShorts(1)[0];
  const draws = reader.readUBytes(drawCount * 2);
  return { coordinates, flags, draws };
}

// ---------------------------------------------------------------------------
// Normal (RGB) layer - BC1-ish 4x4 blocks of 16bpp colors.
// ---------------------------------------------------------------------------

function createNormalLayer(rawData, frame, previousFrame) {
  const reader = new ArrayReader(rawData);
  const { coordinates, flags, draws } = readLayerHeader(reader, true);
  const { width, height } = frame;

  const data = new Uint8ClampedArray(width * height * 4);
  let previousData = null;
  let inherited = false;
  if ((flags & 0x80) && previousFrame && previousFrame.data.normal) {
    previousData = previousFrame.data.normal.data;
    inherited = true;
  }

  const [x0, y0, x1, y1] = coordinates;
  let drawIndex = 0, drawNumber = draws[0], draw = false;

  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      while (--drawNumber < 0) {
        drawNumber = draws[++drawIndex];
        draw = (drawIndex % 2) === 1;
      }
      if (draw) {
        const [cv0, cv1] = reader.readUShorts(2);
        const c0 = fromColor16(cv0);
        const c1 = fromColor16(cv1);
        const indices = reader.readUInts(1)[0];

        let colors;
        if (cv0 > cv1) {
          colors = [c0, c1, mixColor(c0, c1, 1 / 3), mixColor(c0, c1, 2 / 3)];
        } else {
          // 3-colour + transparent (matching DXT1 1-bit alpha mode)
          colors = [c0, c1, mixColor(c0, c1, 0.5), null];
        }
        for (let m = 0; m < 4; m++) {
          for (let n = 0; n < 4; n++) {
            const i = m * 4 + n;
            const col = colors[(indices >> (i * 2)) & 0x3];
            setPixel(data, (x + n) + (y + m) * width, col, NORMAL_COLOR_ALPHA);
          }
        }
      } else if (previousData) {
        // Copy a 4x4 tile verbatim from the previous frame.
        for (let m = 0; m < 4; m++) {
          let offset = ((x + (y + m) * width) << 2);
          for (let n = 0; n < 16; n++) {
            data[offset] = previousData[offset];
            offset++;
          }
        }
      }
    }
  }

  return { width, height, data, coordinates, inherited };
}

// ---------------------------------------------------------------------------
// Shadow layer - single-channel alpha map, BC4-ish 4x4 blocks.
// ---------------------------------------------------------------------------

function createShadowLayer(rawData, frame, previousFrame) {
  const reader = new ArrayReader(rawData);
  const { coordinates, flags, draws } = readLayerHeader(reader, true);
  const { width, height } = frame;

  const data = new Uint8Array(width * height);
  let previousData = null;
  if ((flags & 0x80) && previousFrame && previousFrame.data.shadow) {
    previousData = previousFrame.data.shadow.data;
  }

  const [x0, y0, x1, y1] = coordinates;
  let drawIndex = 0, drawNumber = draws[0], draw = false;

  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      while (--drawNumber < 0) {
        drawNumber = draws[++drawIndex];
        draw = (drawIndex % 2) === 1;
      }
      if (draw) {
        const [a0, a1] = reader.readUBytes(2);
        const indices = reader.readUBytes(6);

        let colors;
        if (a0 > a1) {
          colors = [a0, a1,
            mixValue(a0, a1, 1 / 7), mixValue(a0, a1, 2 / 7),
            mixValue(a0, a1, 3 / 7), mixValue(a0, a1, 4 / 7),
            mixValue(a0, a1, 5 / 7), mixValue(a0, a1, 6 / 7)];
        } else {
          colors = [a0, a1,
            mixValue(a0, a1, 1 / 5), mixValue(a0, a1, 2 / 5),
            mixValue(a0, a1, 3 / 5), mixValue(a0, a1, 4 / 5),
            0, 255];
        }

        for (let m = 0; m < 4; m++) {
          for (let n = 0; n < 4; n++) {
            const i = m * 4 + n;
            const vi = Math.floor(i * 3 / 8);
            const ri = (i * 3) % 8;
            const col = colors[((indices[vi] | (indices[vi + 1] << 8)) >> ri) & 0x7];
            data[(x + n) + (y + m) * width] = col;
          }
        }
      } else if (previousData) {
        for (let m = 0; m < 4; m++) {
          let off = x + (y + m) * width;
          for (let n = 0; n < 4; n++) { data[off] = previousData[off]; off++; }
        }
      }
    }
  }

  return { width, height, data, coordinates };
}

// ---------------------------------------------------------------------------
// Player (team-colour mask) layer - same BC4-ish encoding as shadow, but the
// "empty" slot stays transparent instead of fully opaque.
// ---------------------------------------------------------------------------

function createPlayerLayer(rawData, frame, previousFrame) {
  const reader = new ArrayReader(rawData);
  const { flags, draws } = readLayerHeader(reader, false);
  // Player mask re-uses the normal layer's bounding rect rather than storing
  // its own - the encoder side guarantees these match.
  const coordinates = frame.data.normal.coordinates;
  const { width, height } = frame;

  const data = new Uint8Array(width * height);
  let previousData = null;
  if ((flags & 0x80) && previousFrame && previousFrame.data.player) {
    previousData = previousFrame.data.player.data;
  }

  const [x0, y0, x1, y1] = coordinates;
  let drawIndex = 0, drawNumber = draws[0], draw = false;

  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      while (--drawNumber < 0) {
        drawNumber = draws[++drawIndex];
        draw = (drawIndex % 2) === 1;
      }
      if (draw) {
        const [a0, a1] = reader.readUBytes(2);
        const indices = reader.readUBytes(6);

        let colors;
        if (a0 > a1) {
          colors = [a0, a1,
            mixValue(a0, a1, 1 / 7), mixValue(a0, a1, 2 / 7),
            mixValue(a0, a1, 3 / 7), mixValue(a0, a1, 4 / 7),
            mixValue(a0, a1, 5 / 7), mixValue(a0, a1, 6 / 7)];
        } else {
          colors = [a0, a1,
            mixValue(a0, a1, 1 / 5), mixValue(a0, a1, 2 / 5),
            mixValue(a0, a1, 3 / 5), mixValue(a0, a1, 4 / 5),
            null, 255];
        }

        for (let m = 0; m < 4; m++) {
          for (let n = 0; n < 4; n++) {
            const i = m * 4 + n;
            const vi = Math.floor(i * 3 / 8);
            const ri = (i * 3) % 8;
            const col = colors[((indices[vi] | (indices[vi + 1] << 8)) >> ri) & 0x7];
            if (col != null) data[(x + n) + (y + m) * width] = col;
          }
        }
      } else if (previousData) {
        for (let m = 0; m < 4; m++) {
          let off = x + (y + m) * width;
          for (let n = 0; n < 4; n++) { data[off] = previousData[off]; off++; }
        }
      }
    }
  }

  return { width, height, data, coordinates };
}

// ---------------------------------------------------------------------------
// "Unknown" layer (a.k.a. damage/inherit-fix mask).
//
// For frames that inherit their normal layer (flag 0x80), the encoder stores
// a compressed RLE of 16-bit tile bitmasks describing which pixels of the
// inherited tile are actually transparent in this frame. We walk it and punch
// alpha=0 into those pixels.
// ---------------------------------------------------------------------------

function adjustByUnknownLayer(rawData, frame) {
  const normal = frame.data.normal;
  if (!normal || !normal.inherited) return;

  const coord = normal.coordinates;
  const width = coord[2] - coord[0];
  const height = coord[3] - coord[1];
  const stride = normal.width;
  const rightLimit = coord[2];
  const data = normal.data;

  const rows = height / 4;
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

    let xOff = coord[0];
    let yOff = p * 4 + coord[1];
    let c = rawData[off0];
    if (c < 128) { xOff += c * 4; c = rawData[++off0]; }
    while (c < 128) {
      if (c > 1) xOff += c * 4;
      c = rawData[++off0];
    }
    let slen = c - 128;
    off0++;

    for (; off0 < off1; off0 += 2, slen -= 1) {
      if (slen <= 0) {
        let rep = rawData[off0];
        let c1 = rawData[++off0];
        while (c1 < 128) {
          if (c1 > 1) rep += c1;
          c1 = rawData[++off0];
        }
        slen = c1 - 128;

        if (tile) {
          for (let k = 0; k < rep; k++) {
            for (let j = 0; j < 16; j++) {
              const x = xOff + (j % 4);
              if (x < stride) {
                const y = yOff + Math.floor(j / 4);
                const o = 4 * (x + y * stride);
                // Note: this mirrors the reference's (likely buggy) test -
                // `tile & (1 << j) == 0` parses as `tile & ((1<<j) == 0)`,
                // i.e. `tile & 0`, i.e. always zero. We preserve the
                // behaviour so outputs match the extractor bit-for-bit.
                if (tile & (1 << j) == 0) data[o + 3] = 0;
              }
            }
            xOff += 4;
            if (xOff >= rightLimit) { xOff = coord[0]; yOff += 4; }
          }
        } else {
          for (let k = 0; k < rep; k++) {
            for (let j = 0; j < 16; j++) {
              const x = xOff + (j % 4);
              const y = yOff + Math.floor(j / 4);
              const o = 4 * (x + y * stride);
              data[o + 3] = 0;
            }
            xOff += 4;
            if (xOff >= rightLimit) { xOff = coord[0]; yOff += 4; }
          }
        }

        if (++off0 >= off1) break;
      }

      const x0 = xOff, y0 = yOff;
      tile = rawData[off0] | (rawData[off0 + 1] << 8);
      if (tile) {
        for (let j = 0; j < 16; j++) {
          const x = x0 + (j % 4);
          if (x < stride) {
            const y = y0 + Math.floor(j / 4);
            const o = 4 * (x + y * stride);
            if (tile & (1 << j) == 0) data[o + 3] = 0;
          }
        }
      } else {
        for (let j = 0; j < 16; j++) {
          const x = xOff + (j % 4);
          const y = yOff + Math.floor(j / 4);
          const o = 4 * (x + y * stride);
          data[o + 3] = 0;
        }
      }
      xOff += 4;
      if (xOff >= rightLimit) { xOff = coord[0]; yOff += 4; }
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing pass - walks all frames linearly. We must process every frame up
// through the end of the selected direction because inheritance chains can
// cross frame boundaries; we release each frame's layer buffers as soon as
// the *next* frame stops referencing them.
// ---------------------------------------------------------------------------

function parseHeader(reader) {
  const format = reader.readText(4);
  if (format !== "SLDX") {
    throw new Error("Not a valid SLD file (expected 'SLDX' magic, got '" + format + "')");
  }
  const [version, frameCount] = reader.readUShorts(2);
  const [unknown1, opacity] = reader.readUInts(2);
  if (frameCount >= 4096) throw new Error("SLD frame count overflow: " + frameCount);
  return { format, version, frameCount, unknown1, opacity };
}

function parseFrame(reader, previousFrame) {
  const [width, height, anchorX, anchorY] = reader.readShorts(4);
  const [frameType, unknown] = reader.readUBytes(2);
  const index = reader.readShorts(1)[0];

  const frame = { width, height, anchorX, anchorY, frameType, unknown, index, data: {} };

  if (frameType & 0x1) {
    frame.data.normal = createNormalLayer(reader.readChunk(), frame, previousFrame);
  }
  if (frameType & 0x2) {
    frame.data.shadow = createShadowLayer(reader.readChunk(), frame, previousFrame);
  }
  if (frameType & 0x4) {
    adjustByUnknownLayer(reader.readChunk(), frame);
  }
  if (frameType & 0x8) {
    // Smudge layer - same DXT1-style encoding as normal but we don't render
    // it. Read past the bytes so the reader stays aligned.
    reader.readChunk();
  }
  if (frameType & 0x10) {
    frame.data.player = createPlayerLayer(reader.readChunk(), frame, previousFrame);
  }
  return frame;
}

// ---------------------------------------------------------------------------
// Composite pass - flattens a frame's normal + shadow + player-mask layers
// into a single width*height RGBA buffer sized to the frame's bounding box.
// ---------------------------------------------------------------------------

function composeRGBA(frame, { drawShadow, teamRgb }) {
  const { width, height } = frame;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const size = width * height;

  // 1. Blit the normal layer, promoting its "carry this alpha" marker to
  //    either fully opaque or fully transparent depending on whether a tint
  //    is about to overwrite it.
  const normal = frame.data.normal;
  if (normal) rgba.set(normal.data);

  // 2. Shadow fills any pixels the normal layer left transparent-ish.
  const shadow = frame.data.shadow;
  if (drawShadow && shadow) {
    const sdata = shadow.data;
    for (let i = 0; i < size; i++) {
      const a = sdata[i];
      if (!a) continue;
      const off = i << 2;
      if (rgba[off + 3] < 128) {
        rgba[off]     = 0;
        rgba[off + 1] = 0;
        rgba[off + 2] = 0;
        rgba[off + 3] = a;
      }
    }
  }

  // 3. Player mask tints any normal-layer pixel where the mask is > 0. We
  //    scale the team colour by the original pixel's luminance so bright
  //    fabric looks like bright team colour and dark looks dark.
  const player = frame.data.player;
  if (player && teamRgb) {
    const pdata = player.data;
    const [tr, tg, tb] = teamRgb;
    for (let i = 0; i < size; i++) {
      const off = i << 2;
      if (rgba[off + 3] !== NORMAL_COLOR_ALPHA) continue;
      const maskA = pdata[i];
      if (!maskA) continue;
      const k = maskA / 255;
      const r = rgba[off], g = rgba[off + 1], b = rgba[off + 2];
      // luminance in 0..255; scale=1 at luminance=128
      const scale = (0.299 * r + 0.587 * g + 0.114 * b) / 128;
      const trT = clamp(tr * scale, 0, 255);
      const tgT = clamp(tg * scale, 0, 255);
      const tbT = clamp(tb * scale, 0, 255);
      rgba[off]     = mixValue(r, trT, k);
      rgba[off + 1] = mixValue(g, tgT, k);
      rgba[off + 2] = mixValue(b, tbT, k);
      rgba[off + 3] = 255;
    }
  }

  // 4. Normalise alpha: the NORMAL_COLOR_ALPHA marker that survived step 3
  //    (pixels with no tint) should be fully opaque in the output.
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === NORMAL_COLOR_ALPHA) rgba[i] = 255;
  }

  return rgba;
}

// ---------------------------------------------------------------------------
// Direction slicing.
//
// SLD files don't explicitly record how many directions are baked in; the
// convention is that `frameCount` is divisible by the direction count and
// the frames are laid out direction-major. We prefer the larger divisor
// since AoE2:DE unit sprites almost always use 16 directions.
//
// Many DE sprites store (16n + 1) frames (e.g. 481): the final frame is a
// stray duplicate / padding and must be ignored for direction layout. We
// treat the logical frame count as `rawCount - 1` in that case only.
// ---------------------------------------------------------------------------

function logicalFrameCount(rawCount) {
  if (rawCount > 1 && rawCount % 16 === 1) {
    return { count: rawCount - 1, discardedTrailingFrame: true };
  }
  return { count: rawCount, discardedTrailingFrame: false };
}

function inferNumDirections(frameCount) {
  if (frameCount >= 16 && frameCount % 16 === 0) return 16;
  if (frameCount >= 8  && frameCount % 8  === 0) return 8;
  if (frameCount >= 5  && frameCount % 5  === 0) return 5;
  return 1;
}

function labelForDirection(numDirections, dirIndex) {
  if (numDirections === 16) return DIRECTION_LABELS_16[dirIndex] || ("dir " + dirIndex);
  if (numDirections === 1) return "still";
  return "dir " + dirIndex + "/" + numDirections;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export function renderDirection(bytes, opts, progressCb) {
  const { directionIndex = 0, drawShadow = true, teamRgb = null } = opts || {};
  const reader = new ArrayReader(bytes);
  const header = parseHeader(reader);

  const { count: logicalCount, discardedTrailingFrame } = logicalFrameCount(header.frameCount);
  const numDirections = inferNumDirections(logicalCount);
  const framesPerDirection = logicalCount / numDirections;
  const dir = clamp(directionIndex | 0, 0, numDirections - 1);
  const start = dir * framesPerDirection;
  const endExclusive = start + framesPerDirection;

  const outFrames = new Array(framesPerDirection);

  // We only need a sliding window of two frames' layer buffers (the one
  // currently being decoded and its immediate predecessor). Holding
  // everything would blow up memory for big sprites.
  let previousFrame = null;
  for (let i = 0; i < endExclusive; i++) {
    const frame = parseFrame(reader, previousFrame);

    if (i >= start) {
      const rgba = composeRGBA(frame, { drawShadow, teamRgb });
      outFrames[i - start] = {
        width: frame.width,
        height: frame.height,
        hotspotX: frame.anchorX,
        hotspotY: frame.anchorY,
        rgba,
      };
      if (progressCb) progressCb(i - start + 1, framesPerDirection);
    }

    if (previousFrame) {
      // Release layer pixel buffers we'll never reference again. Keep the
      // frame object itself lightweight enough that parseFrame's inheritance
      // lookup `previousFrame.data.normal` keeps working for *this* frame.
      previousFrame.data = null;
    }
    previousFrame = frame;
  }

  // If the file had (16n+1) frames, the last raw frame is skipped for layout
  // but still sits on disk after the last *logical* frame. Only when we
  // decoded through that last logical frame (e.g. direction 15) do we need
  // to read past it so the stream is fully consumed for this slice.
  if (discardedTrailingFrame && endExclusive === logicalCount) {
    parseFrame(reader, previousFrame);
  }

  return {
    meta: {
      version: header.version,
      frameCount: logicalCount,
      rawFrameCount: header.frameCount,
      discardedTrailingFrame,
      numDirections,
      framesPerDirection,
      directionIndex: dir,
      directionLabel: labelForDirection(numDirections, dir),
      opacity: header.opacity,
    },
    frames: outFrames,
  };
}
