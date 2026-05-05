// =============================================================================
// SLP worker. Thin wrapper around `slp-decode.js` so parsing + render happens
// off the main thread.
// =============================================================================

import { renderDirection } from "/gif/slp-decode.js";

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

    progress(id, 5, "Parsing SLP\u2026");
    const result = renderDirection(
      bytes,
      { direction, player, drawOutline, palette },
      function (done, total) {
        progress(
          id,
          15 + Math.round((done / total) * 70),
          "Decoding frame " + done + "/" + total,
        );
      },
    );

    progress(id, 95, "Frames ready.");

    // Transfer the RGBA buffers back to the main thread (zero-copy).
    const frames = result.frames;
    const meta = result.meta;
    const transfer = frames.map(function (f) { return f.rgba.buffer; });
    self.postMessage(
      {
        type: "result",
        id,
        ok: true,
        meta,
        frames,
      },
      transfer,
    );
  } catch (err) {
    fail(id, (err && err.message) || err);
  }
};
