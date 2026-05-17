// rge-campaign.js
//
// Pure-JS port of withmorten/rge_campaign (https://github.com/withmorten/rge_campaign).
// Reads and writes the Genie engine campaign formats:
//
//   .cpn / .cpx        AoE1 to AoC (legacy "1.00")
//   .aoecpn            AoE1: Definitive Edition ("1.10")
//   .aoe2campaign      AoE2: Definitive Edition ("2.00")
//
// The write path mirrors main.c / util.c so output matches rge_campaign.
// The read path also accepts a second on-disk variant seen in some retail /
// HD `.aoe2campaign` files: the two uint16 fields before each UTF-8 blob may
// appear as (len, STRING_ID) instead of (STRING_ID, len).

const VERSION_LEGACY = 0x30302e31; // "1.00" little-endian
const VERSION_DE1    = 0x30312e31; // "1.10"
const VERSION_DE2    = 0x30302e32; // "2.00"
const STRING_ID      = 0x0a60;
const RGE_MAX_CHAR     = 255;
const RGE_DE2_MAX_CHAR = 256;
const DE2_DEPENDENCIES = [2, 3, 4, 5, 6, 7];

export const VERSIONS = {
  LEGACY: VERSION_LEGACY,
  DE1:    VERSION_DE1,
  DE2:    VERSION_DE2,
  STRING_ID,
};

export const FORMATS = {
  LEGACY: "legacy",
  DE1:    "de1",
  DE2:    "de2",
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const utf8Decoder   = new TextDecoder("utf-8", { fatal: false });
const latin1Decoder = new TextDecoder("latin1");
const utf8Encoder   = new TextEncoder();

function decoderFor(format) {
  return format === FORMATS.LEGACY ? latin1Decoder : utf8Decoder;
}

function encodeName(format, str) {
  if (format === FORMATS.LEGACY) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c > 0xff) {
        throw new Error(
          `legacy .cpn/.cpx names must be latin1; got U+${c.toString(16).toUpperCase()} in "${str}"`,
        );
      }
      out[i] = c;
    }
    return out;
  }
  return utf8Encoder.encode(str);
}

function readCStringFixed(view, offset, max, decoder) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, max);
  let end = 0;
  while (end < max && bytes[end] !== 0) end++;
  return decoder.decode(bytes.subarray(0, end));
}

function readBytes(view, offset, length) {
  return new Uint8Array(view.buffer.slice(view.byteOffset + offset, view.byteOffset + offset + length));
}

function basename(path) {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function splitExt(name) {
  const i = name.lastIndexOf(".");
  if (i < 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, i), ext: name.slice(i + 1) };
}

/**
 * Read a DE1/DE2-style length-prefixed UTF-8 string.
 * `rge_campaign` writes (STRING_ID, len); some game builds write (len, STRING_ID).
 * Both orders are accepted.
 */
function readDePrefixedString(view, u8, cursor, ctx) {
  if (cursor + 4 > u8.byteLength) {
    throw new Error(`${ctx}: truncated string prefix`);
  }
  const a = view.getUint16(cursor, true);
  const b = view.getUint16(cursor + 2, true);
  cursor += 4;
  let len;
  if (a === STRING_ID) {
    len = b;
  } else if (b === STRING_ID) {
    len = a;
  } else {
    const hex = [...u8.subarray(cursor - 4, cursor)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join(" ");
    throw new Error(
      `${ctx}: expected string id 0x${STRING_ID.toString(16)} in prefix (got 0x${a.toString(16)}, 0x${b.toString(16)}; bytes ${hex})`,
    );
  }
  if (len < 0 || len > 16 * 1024 * 1024) {
    throw new Error(`${ctx}: implausible string length ${len}`);
  }
  if (cursor + len > u8.byteLength) {
    throw new Error(`${ctx}: string length ${len} exceeds file`);
  }
  const value = utf8Decoder.decode(u8.subarray(cursor, cursor + len));
  return { value, cursor: cursor + len };
}

// --------------------------------------------------------------------------
// Format / extension routing
// --------------------------------------------------------------------------

export function extensionToFormat(ext) {
  const e = String(ext || "").toLowerCase().replace(/^\./, "");
  if (e === "cpn" || e === "cpx") return FORMATS.LEGACY;
  if (e === "aoecpn")             return FORMATS.DE1;
  if (e === "aoe2campaign")       return FORMATS.DE2;
  return null;
}

export function formatToExtension(format) {
  if (format === FORMATS.LEGACY) return "cpn";
  if (format === FORMATS.DE1)    return "aoecpn";
  if (format === FORMATS.DE2)    return "aoe2campaign";
  return null;
}

export function detectFormat(bytes) {
  if (!bytes || bytes.byteLength < 4) return null;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const v = view.getUint32(0, true);
  if (v === VERSION_LEGACY) return FORMATS.LEGACY;
  if (v === VERSION_DE1)    return FORMATS.DE1;
  if (v === VERSION_DE2)    return FORMATS.DE2;
  return null;
}

function allowsScenarioExt(format, ext) {
  const e = ext.toLowerCase();
  if (e === "scn" || e === "scx") return true;
  if (e === "aoescn")       return format === FORMATS.DE1 || format === FORMATS.DE2;
  if (e === "aoe2scenario") return format === FORMATS.DE2;
  return false;
}

// --------------------------------------------------------------------------
// Read
// --------------------------------------------------------------------------

/**
 * Parse a campaign file.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{ extract?: boolean }} [opts] - extract=false returns metadata only.
 * @returns {{
 *   format: "legacy"|"de1"|"de2",
 *   version: number,
 *   versionString: string,
 *   name: string,
 *   scenarios: Array<{
 *     index: number,
 *     name: string,
 *     fileName: string,
 *     size: number,
 *     offset: number,
 *     bytes?: Uint8Array,
 *   }>,
 * }}
 */
export function readCampaign(bytes, opts = {}) {
  const extract = opts.extract !== false;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  const version = view.getUint32(0, true);
  const format = detectFormat(u8);
  if (!format) {
    throw new Error("not an RGE_Campaign file (unrecognised version header)");
  }

  let cursor = 4;
  let name;
  let scenarioNum;

  if (format === FORMATS.LEGACY) {
    name = readCStringFixed(view, cursor, RGE_MAX_CHAR, decoderFor(format));
    cursor += RGE_MAX_CHAR;
    cursor += 1; // padding byte
    scenarioNum = view.getInt32(cursor, true); cursor += 4;
  } else if (format === FORMATS.DE1) {
    scenarioNum = view.getInt32(cursor, true); cursor += 4;
    const hdr = readDePrefixedString(view, u8, cursor, "DE1 campaign name");
    name = hdr.value;
    cursor = hdr.cursor;
  } else {
    // DE2
    const depNum = view.getInt32(cursor, true); cursor += 4;
    cursor += depNum * 4; // dependencies (read+discard, like the C tool)
    name = readCStringFixed(view, cursor, RGE_DE2_MAX_CHAR, decoderFor(format));
    cursor += RGE_DE2_MAX_CHAR;
    scenarioNum = view.getInt32(cursor, true); cursor += 4;
  }

  if (!Number.isFinite(scenarioNum) || scenarioNum < 0 || scenarioNum > 1024) {
    throw new Error(`implausible scenario count: ${scenarioNum}`);
  }

  const scenarios = [];
  for (let i = 0; i < scenarioNum; i++) {
    let size, offset, scenName, fileName;
    const decoder = decoderFor(format);

    if (format === FORMATS.LEGACY) {
      size   = view.getInt32(cursor, true); cursor += 4;
      offset = view.getInt32(cursor, true); cursor += 4;
      scenName = readCStringFixed(view, cursor, RGE_MAX_CHAR, decoder);
      cursor += RGE_MAX_CHAR;
      fileName = readCStringFixed(view, cursor, RGE_MAX_CHAR, decoder);
      cursor += RGE_MAX_CHAR;
      cursor += 2; // 2 padding bytes
    } else if (format === FORMATS.DE1) {
      // 64-bit size + offset
      const sizeLo = view.getUint32(cursor, true);
      const sizeHi = view.getUint32(cursor + 4, true);
      cursor += 8;
      const offLo = view.getUint32(cursor, true);
      const offHi = view.getUint32(cursor + 4, true);
      cursor += 8;
      if (sizeHi !== 0 || offHi !== 0) {
        throw new Error("DE1 scenarios over 4 GB are not supported");
      }
      size = sizeLo;
      offset = offLo;

      let sn = readDePrefixedString(view, u8, cursor, `DE1 scenario #${i + 1} name`);
      scenName = sn.value;
      cursor = sn.cursor;

      let sf = readDePrefixedString(view, u8, cursor, `DE1 scenario #${i + 1} file_name`);
      fileName = sf.value;
      cursor = sf.cursor;
    } else {
      // DE2
      size   = view.getInt32(cursor, true); cursor += 4;
      offset = view.getInt32(cursor, true); cursor += 4;

      let sn = readDePrefixedString(view, u8, cursor, `DE2 scenario #${i + 1} name`);
      scenName = sn.value;
      cursor = sn.cursor;

      let sf = readDePrefixedString(view, u8, cursor, `DE2 scenario #${i + 1} file_name`);
      fileName = sf.value;
      cursor = sf.cursor;
    }

    const entry = {
      index: i,
      name: scenName,
      fileName,
      size,
      offset,
    };

    if (extract) {
      if (offset < 0 || offset + size > u8.byteLength) {
        throw new Error(`scenario "${fileName}" payload range out of bounds`);
      }
      entry.bytes = u8.slice(offset, offset + size);
    }

    scenarios.push(entry);
  }

  return {
    format,
    version,
    versionString: versionString(version),
    name,
    scenarios,
  };
}

function versionString(v) {
  return String.fromCharCode(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

// --------------------------------------------------------------------------
// Write
// --------------------------------------------------------------------------

/**
 * Build a campaign file.
 *
 * @param {{
 *   ext?: string,           // ".cpn" / ".cpx" / ".aoecpn" / ".aoe2campaign" (alt: format)
 *   format?: "legacy"|"de1"|"de2",
 *   name: string,           // internal campaign name
 *   scenarios: Array<{ fileName: string, bytes: Uint8Array }>,
 * }} input
 * @returns {Uint8Array}
 */
export function writeCampaign(input) {
  const format = input.format
    || extensionToFormat(input.ext)
    || FORMATS.LEGACY;

  if (!input.scenarios || input.scenarios.length === 0) {
    throw new Error("at least one scenario is required");
  }

  // Validate / size-check the campaign name.
  const campaignName = String(input.name ?? "");
  if (format === FORMATS.LEGACY && campaignName.length > RGE_MAX_CHAR - 1) {
    throw new Error(`campaign name too long for .cpn/.cpx (max ${RGE_MAX_CHAR - 1} chars)`);
  }
  if (format === FORMATS.DE2 && campaignName.length > RGE_DE2_MAX_CHAR - 1) {
    throw new Error(`campaign name too long for .aoe2campaign (max ${RGE_DE2_MAX_CHAR - 1} chars)`);
  }

  // Per-scenario metadata.
  const scenarios = input.scenarios.map((s, i) => {
    if (!s || !(s.bytes instanceof Uint8Array)) {
      throw new Error(`scenario #${i + 1}: missing bytes`);
    }
    const file = basename(String(s.fileName || ""));
    const { stem, ext } = splitExt(file);
    if (!ext) {
      throw new Error(`scenario "${file}": missing extension (.scn/.scx/.aoescn/.aoe2scenario)`);
    }
    if (!allowsScenarioExt(format, ext)) {
      throw new Error(
        `scenario "${file}": .${ext} not allowed in ${format} campaigns`,
      );
    }
    if (format === FORMATS.LEGACY && (file.length > RGE_MAX_CHAR - 1 || stem.length > RGE_MAX_CHAR - 1)) {
      throw new Error(`scenario "${file}": name too long for .cpn/.cpx`);
    }

    // Match the C tool exactly:
    //   - DE2 stores the full filename for both `name` and `file_name`.
    //   - Other formats store stem (no extension) for `name`,
    //     and the full filename for `file_name`.
    const innerName = format === FORMATS.DE2 ? file : stem;
    const innerFileName = file;
    const nameBytes = encodeName(format, innerName);
    const fileNameBytes = encodeName(format, innerFileName);

    return {
      file,
      ext,
      stem,
      bytes: s.bytes,
      size: s.bytes.byteLength,
      nameBytes,
      fileNameBytes,
    };
  });

  // Compute the offset of the first scenario payload (= total header size).
  // This mirrors the offset arithmetic in RGE_Campaign_write().
  let firstOffset;
  if (format === FORMATS.LEGACY) {
    firstOffset = 4 + RGE_MAX_CHAR + 1 + 4
      + scenarios.length * (4 + 4 + RGE_MAX_CHAR + RGE_MAX_CHAR + 1 + 1);
  } else if (format === FORMATS.DE1) {
    const campaignNameBytes = encodeName(format, campaignName);
    firstOffset = 4 /*version*/ + 4 /*scenario_num*/ + 2 /*string_id*/ + 2 /*name_len*/ + campaignNameBytes.length;
    for (const s of scenarios) {
      firstOffset += 8 /*size*/ + 8 /*offset*/
        + 2 + 2 + s.nameBytes.length
        + 2 + 2 + s.fileNameBytes.length;
    }
  } else {
    firstOffset = 4 /*version*/ + 4 /*dep_num*/ + DE2_DEPENDENCIES.length * 4
      + RGE_DE2_MAX_CHAR + 4 /*scenario_num*/;
    for (const s of scenarios) {
      firstOffset += 4 + 4 /*size+offset*/
        + 2 + 2 + s.nameBytes.length
        + 2 + 2 + s.fileNameBytes.length;
    }
  }

  // Assign offsets sequentially.
  let payloadCursor = firstOffset;
  const total = scenarios.reduce((acc, s) => {
    s.offset = payloadCursor;
    payloadCursor += s.size;
    return acc + s.size;
  }, 0);

  const out = new Uint8Array(firstOffset + total);
  const view = new DataView(out.buffer);
  let p = 0;

  // ----- Header -----
  view.setUint32(p, format === FORMATS.LEGACY ? VERSION_LEGACY
    : format === FORMATS.DE1 ? VERSION_DE1
    : VERSION_DE2, true);
  p += 4;

  if (format === FORMATS.LEGACY) {
    const nameBuf = encodeName(format, campaignName);
    out.set(nameBuf.subarray(0, Math.min(nameBuf.length, RGE_MAX_CHAR)), p);
    p += RGE_MAX_CHAR;
    p += 1; // pad byte (already zero)
    view.setInt32(p, scenarios.length, true); p += 4;
  } else if (format === FORMATS.DE1) {
    view.setInt32(p, scenarios.length, true); p += 4;
    view.setUint16(p, STRING_ID, true); p += 2;
    const nameBuf = encodeName(format, campaignName);
    view.setUint16(p, nameBuf.length, true); p += 2;
    out.set(nameBuf, p); p += nameBuf.length;
  } else {
    view.setInt32(p, DE2_DEPENDENCIES.length, true); p += 4;
    for (const d of DE2_DEPENDENCIES) {
      view.setInt32(p, d, true); p += 4;
    }
    const nameBuf = encodeName(format, campaignName);
    out.set(nameBuf.subarray(0, Math.min(nameBuf.length, RGE_DE2_MAX_CHAR)), p);
    p += RGE_DE2_MAX_CHAR;
    view.setInt32(p, scenarios.length, true); p += 4;
  }

  // ----- Scenario index -----
  for (const s of scenarios) {
    if (format === FORMATS.LEGACY) {
      view.setInt32(p, s.size,   true); p += 4;
      view.setInt32(p, s.offset, true); p += 4;
      out.set(s.nameBytes.subarray(0, Math.min(s.nameBytes.length, RGE_MAX_CHAR)), p);
      p += RGE_MAX_CHAR;
      out.set(s.fileNameBytes.subarray(0, Math.min(s.fileNameBytes.length, RGE_MAX_CHAR)), p);
      p += RGE_MAX_CHAR;
      p += 2; // 2 pad bytes
    } else if (format === FORMATS.DE1) {
      // i64 size + offset (we never produce values >= 2^32)
      view.setUint32(p, s.size,   true); view.setUint32(p + 4, 0, true); p += 8;
      view.setUint32(p, s.offset, true); view.setUint32(p + 4, 0, true); p += 8;
      view.setUint16(p, STRING_ID, true); p += 2;
      view.setUint16(p, s.nameBytes.length, true); p += 2;
      out.set(s.nameBytes, p); p += s.nameBytes.length;
      view.setUint16(p, STRING_ID, true); p += 2;
      view.setUint16(p, s.fileNameBytes.length, true); p += 2;
      out.set(s.fileNameBytes, p); p += s.fileNameBytes.length;
    } else {
      view.setInt32(p, s.size,   true); p += 4;
      view.setInt32(p, s.offset, true); p += 4;
      view.setUint16(p, STRING_ID, true); p += 2;
      view.setUint16(p, s.nameBytes.length, true); p += 2;
      out.set(s.nameBytes, p); p += s.nameBytes.length;
      view.setUint16(p, STRING_ID, true); p += 2;
      view.setUint16(p, s.fileNameBytes.length, true); p += 2;
      out.set(s.fileNameBytes, p); p += s.fileNameBytes.length;
    }
  }

  if (p !== firstOffset) {
    throw new Error(`internal: header size mismatch (${p} != ${firstOffset})`);
  }

  // ----- Payloads -----
  for (const s of scenarios) {
    out.set(s.bytes, s.offset);
  }

  return out;
}

// --------------------------------------------------------------------------
// Convenience
// --------------------------------------------------------------------------

/** Like readCampaign(bytes, { extract: false }) but slightly clearer at call sites. */
export function listCampaign(bytes) {
  return readCampaign(bytes, { extract: false });
}
