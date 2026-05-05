// =============================================================================
// SLP parser + renderer (v2.0N, AoE2 / AoK / SWGB / HD).
//
// Ported from oldexamples/.../ChineseWorkingSLPConvert/SLP.js (pure JS, no
// deps) with the Node-specific bits removed:
//   - awestruct -> DataView
//   - Buffer.readUInt16LE -> DataView.getUint16(off, true)
//
// Outputs RGBA Uint8ClampedArray frames sliced to a single direction with
// optional horizontal mirroring (for the 3 non-stored compass directions).
// =============================================================================

// SLP opcodes
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

// Internal render ops (match SLP.js)
const RENDER_NEXTLINE = 0x00;
const RENDER_COLOR = 0x01;
const RENDER_SKIP = 0x02;
const RENDER_PLAYER_COLOR = 0x03;
const RENDER_SHADOW = 0x04;
const RENDER_OUTLINE = 0x05;
const RENDER_FILL = 0x06;
const RENDER_PLAYER_FILL = 0x07;

// Direction mapping: UI compass -> {sliceIndex, flipX}
// Stored slices (community convention for 5-direction AoE2 SLPs):
//   0=S, 1=SW, 2=W, 3=NW, 4=N. Missing dirs mirror their counterparts.
const DIRECTION_MAP = {
  S:  { slice: 0, flipX: false },
  SW: { slice: 1, flipX: false },
  W:  { slice: 2, flipX: false },
  NW: { slice: 3, flipX: false },
  N:  { slice: 4, flipX: false },
  SE: { slice: 1, flipX: true },
  E:  { slice: 2, flipX: true },
  NE: { slice: 3, flipX: true },
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const td = new TextDecoder("ascii");

  const version = td.decode(bytes.subarray(0, 4));
  const numFrames = view.getInt32(4, true);
  const comment = td.decode(bytes.subarray(8, 32)).replace(/\0+$/, "");

  const frames = new Array(numFrames);
  let off = 32;
  for (let i = 0; i < numFrames; i++) {
    frames[i] = {
      cmdTableOffset:     view.getUint32(off + 0,  true),
      outlineTableOffset: view.getUint32(off + 4,  true),
      paletteOffset:      view.getUint32(off + 8,  true),
      properties:         view.getUint32(off + 12, true),
      width:              view.getInt32(off + 16, true),
      height:             view.getInt32(off + 20, true),
      hotspotX:           view.getInt32(off + 24, true),
      hotspotY:           view.getInt32(off + 28, true),
    };
    off += 32;
  }
  return { version, numFrames, comment, frames };
}

function parseFrame(bytes, view, frame) {
  const outlines = new Array(frame.height);
  let offset = frame.outlineTableOffset;
  for (let i = 0; i < frame.height; i++) {
    outlines[i] = {
      left:  view.getUint16(offset, true),
      right: view.getUint16(offset + 2, true),
    };
    offset += 4;
  }

  // skip past the command offset table (not strictly needed, commands are
  // also sequential from the first row)
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
      while (pxCount--) {
        offset++;
        commands.push({ command: RENDER_COLOR, arg: bytes[offset] });
      }
    } else if (lowBits === SLP_SKIP) {
      pxCount = (cmd >> 2) || bytes[++offset];
      commands.push({ command: RENDER_SKIP, arg: pxCount });
    } else if (lowNibble === SLP_COLOR_LIST_EX) {
      offset++;
      pxCount = (highNibble << 4) + bytes[offset];
      while (pxCount--) {
        offset++;
        commands.push({ command: RENDER_COLOR, arg: bytes[offset] });
      }
    } else if (lowNibble === SLP_SKIP_EX) {
      offset++;
      pxCount = (highNibble << 4) + bytes[offset];
      commands.push({ command: RENDER_SKIP, arg: pxCount });
    } else if (lowNibble === SLP_COLOR_LIST_PLAYER) {
      pxCount = (cmd >> 4) || bytes[++offset];
      while (pxCount--) {
        offset++;
        commands.push({ command: RENDER_PLAYER_COLOR, arg: bytes[offset] });
      }
    } else if (lowNibble === SLP_FILL) {
      pxCount = (cmd >> 4) || bytes[++offset];
      offset++;
      commands.push({ command: RENDER_FILL, arg: { pxCount, color: bytes[offset] } });
    } else if (lowNibble === SLP_FILL_PLAYER) {
      pxCount = (cmd >> 4) || bytes[++offset];
      offset++;
      commands.push({ command: RENDER_PLAYER_FILL, arg: { pxCount, color: bytes[offset] } });
    } else if (lowNibble === SLP_SHADOW) {
      pxCount = (cmd >> 4) || bytes[++offset];
      commands.push({ command: RENDER_SHADOW, arg: pxCount });
    } else if (lowNibble === SLP_EXTENDED) {
      if (highNibble === SLP_EX_OUTLINE1) {
        commands.push({ command: RENDER_OUTLINE, arg: 1 });
      } else if (highNibble === SLP_EX_OUTLINE2) {
        commands.push({ command: RENDER_OUTLINE, arg: 2 });
      } else if (highNibble === SLP_EX_FILL_OUTLINE1) {
        offset++;
        pxCount = bytes[offset];
        while (pxCount--) commands.push({ command: RENDER_OUTLINE, arg: 1 });
      } else if (highNibble === SLP_EX_FILL_OUTLINE2) {
        offset++;
        pxCount = bytes[offset];
        while (pxCount--) commands.push({ command: RENDER_OUTLINE, arg: 2 });
      }
      // other 0x0E opcodes (forward/reverse/normal/alt transform, dither)
      // are no-ops we silently skip past.
    } else {
      throw new Error("Unrecognised SLP opcode 0x" + cmd.toString(16));
    }
    offset++;
  }

  return { outlines, commands };
}

// ---------------------------------------------------------------------------
// Renderer -> RGBA
// ---------------------------------------------------------------------------

function playerColor(palette, paletteIdx, player) {
  // AoK/SWGB: indices 16..143 contain 8 bands of 16 player colors each;
  // band N starts at 16*N. Clamp to keep out-of-range indices sane.
  const resolved = paletteIdx + 16 * player;
  return palette[resolved] || palette[paletteIdx] || [0, 0, 0];
}

function renderFrameRGBA(bytes, view, frame, parsed, palette, opts) {
  const { player, drawOutline } = opts;
  const { outlines, commands } = parsed;
  const { width, height } = frame;
  const pixels = new Uint8ClampedArray(width * height * 4);

  let idx = 0;
  let y = 0;

  function pushColor(rgb, alpha) {
    pixels[idx++] = rgb[0];
    pixels[idx++] = rgb[1];
    pixels[idx++] = rgb[2];
    pixels[idx++] = alpha;
  }

  // Initial row's left spacing
  let skip = outlines[0].left;
  if (skip === SLP_LINE_EMPTY) skip = width;
  idx = skip * 4; // leave (0,0,0,0) as-is

  for (let c = 0; c < commands.length; c++) {
    const { command, arg } = commands[c];
    switch (command) {
      case RENDER_SKIP: {
        idx += arg * 4; // already zeroed
        break;
      }
      case RENDER_NEXTLINE: {
        // fill the right edge of this row
        idx += outlines[y].right * 4;
        y++;
        if (y < height) {
          let s = outlines[y].left;
          if (s === SLP_LINE_EMPTY) s = width;
          idx += s * 4;
        }
        break;
      }
      case RENDER_COLOR: {
        pushColor(palette[arg], 255);
        break;
      }
      case RENDER_FILL: {
        let n = arg.pxCount;
        const col = palette[arg.color];
        while (n--) pushColor(col, 255);
        break;
      }
      case RENDER_OUTLINE: {
        pushColor([0, 0, 0], drawOutline ? 255 : 0);
        break;
      }
      case RENDER_PLAYER_COLOR: {
        pushColor(playerColor(palette, arg, player), 255);
        break;
      }
      case RENDER_PLAYER_FILL: {
        let n = arg.pxCount;
        const col = playerColor(palette, arg.color, player);
        while (n--) pushColor(col, 255);
        break;
      }
      case RENDER_SHADOW: {
        // Flat semi-transparent black stand-in; full shadow support is future
        // work. Leaves the pixels transparent-ish so the GIF isn't cluttered.
        let n = arg;
        while (n--) pushColor([0, 0, 0], 64);
        break;
      }
    }
  }

  return pixels;
}

function mirrorX(pixels, width, height) {
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = (y * width + (width - 1 - x)) * 4;
      out[dst + 0] = pixels[src + 0];
      out[dst + 1] = pixels[src + 1];
      out[dst + 2] = pixels[src + 2];
      out[dst + 3] = pixels[src + 3];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function progress(id, pct, message) {
  self.postMessage({ type: "progress", id, pct, message });
}

function fail(id, error) {
  self.postMessage({ type: "result", id, ok: false, error: String(error) });
}

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.type !== "render") return;

  const { id, slpBytes, direction, player, drawOutline, palette } = msg;
  try {
    const bytes = new Uint8Array(slpBytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    progress(id, 5, "Parsing SLP\u2026");
    const header = parseHeader(bytes);

    if (!header.version.startsWith("2.") && !header.version.startsWith("3.")) {
      throw new Error(
        "Unsupported SLP version '" + header.version.trim() +
        "'. Only AoE2 / AoK / SWGB / HD (2.0N, 3.0) files work in the SLP tab.",
      );
    }
    if (header.numFrames === 0) throw new Error("SLP has no frames.");
    if (header.numFrames % 5 !== 0) {
      // Not a military 5-direction SLP; still render the first N frames as a
      // single "direction" so users at least see something.
      progress(id, 15, "Note: frames not divisible by 5, showing all frames.");
    }

    const dir = DIRECTION_MAP[direction] || DIRECTION_MAP.S;
    const fpd = header.numFrames % 5 === 0 ? header.numFrames / 5 : header.numFrames;
    const slice = header.numFrames % 5 === 0 ? dir.slice : 0;
    const flipX = dir.flipX;

    const start = slice * fpd;
    const endExclusive = start + fpd;

    const frames = [];
    for (let i = start; i < endExclusive; i++) {
      const frame = header.frames[i];
      progress(id, 15 + Math.round(((i - start + 1) / fpd) * 70),
        "Decoding frame " + (i - start + 1) + "/" + fpd);

      const parsed = parseFrame(bytes, view, frame);
      let rgba = renderFrameRGBA(bytes, view, frame, parsed, palette, { player, drawOutline });
      let hotspotX = frame.hotspotX;

      if (flipX) {
        rgba = mirrorX(rgba, frame.width, frame.height);
        hotspotX = frame.width - 1 - frame.hotspotX;
      }

      frames.push({
        width: frame.width,
        height: frame.height,
        hotspotX,
        hotspotY: frame.hotspotY,
        rgba,
      });
    }

    progress(id, 95, "Frames ready.");

    // Transfer the RGBA buffers back to the main thread (zero-copy).
    const transfer = frames.map(function (f) { return f.rgba.buffer; });
    self.postMessage(
      {
        type: "result",
        id,
        ok: true,
        meta: {
          version: header.version,
          numFrames: header.numFrames,
          framesPerDirection: fpd,
          slice,
          flipX,
        },
        frames,
      },
      transfer,
    );
  } catch (err) {
    fail(id, (err && err.message) || err);
  }
};
