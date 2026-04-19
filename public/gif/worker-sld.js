// =============================================================================
// SLD module worker. Thin wrapper around sld-decode.js that exists so the
// DXT1/DXT4 decode work happens off the main thread; all pure logic lives in
// the shared decoder module (also consumed by scripts/test-sld.mjs).
// =============================================================================

import { renderDirection } from "/gif/sld-decode.js";

function progress(id, pct, message) {
  self.postMessage({ type: "progress", id, pct, message });
}

function fail(id, error) {
  self.postMessage({ type: "result", id, ok: false, error: String(error) });
}

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.type !== "render") return;

  const { id, sldBytes, directionIndex, drawShadow, teamRgb } = msg;
  try {
    const bytes = new Uint8Array(sldBytes);

    progress(id, 3, "Parsing SLD\u2026");

    let frames, meta;
    try {
      const result = renderDirection(
        bytes,
        { directionIndex, drawShadow, teamRgb },
        function (done, total) {
          const pct = 15 + Math.round((done / total) * 75);
          progress(id, pct, "Decoding frame " + done + "/" + total);
        },
      );
      frames = result.frames;
      meta = result.meta;
    } catch (err) {
      fail(id, (err && err.message) || err);
      return;
    }

    progress(id, 95, "Frames ready.");

    const transfer = frames.map(function (f) { return f.rgba.buffer; });
    self.postMessage(
      { type: "result", id, ok: true, meta, frames },
      transfer,
    );
  } catch (err) {
    fail(id, (err && err.message) || err);
  }
};
