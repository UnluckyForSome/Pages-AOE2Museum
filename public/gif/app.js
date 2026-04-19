// =============================================================================
// /gif/ UI controller.
//
//  * lazy-loads slp_mapping.json, indexes Unit -> Action -> slpId;
//  * wires the dropdowns, direction compass, player color swatches and
//    advanced drawer;
//  * fingerprints settings so the Generate button flips between
//    "Generate GIF" / "Generate again" / "Generated" like /mcminimap/;
//  * streams SLP bytes to /gif/worker-slp.js which returns aligned RGBA
//    frames for the chosen direction+player;
//  * encodes those frames into an animated GIF with gifenc and shows it.
// =============================================================================

import { GIFEncoder, quantize, applyPalette } from "/gif/vendor/gifenc.esm.js";
import { STANDARD_PALETTE } from "/gif/palette.js";

// ---------- constants -------------------------------------------------------

const MAPPING_URL = "/gif/sourcefiles/slp_mapping.json";
const SLP_URL = (id) => "/gif/sourcefiles/slp/" + id + ".slp";
const PLACEHOLDER_URL = "/gif/assets/placeholder.png";

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const PLAYERS = ["1", "2", "3", "4", "5", "6", "7", "8"];

// ---------- DOM -------------------------------------------------------------

const form = document.getElementById("form");
const unitInput = document.getElementById("unit-input");
const unitList = document.getElementById("unit-list");
const actionSelect = document.getElementById("action-select");
const compass = document.querySelector(".compass");
const swatches = document.querySelector(".swatches");
const submitBtn = document.getElementById("submit");
const imgEl = document.getElementById("img");
const captionEl = document.getElementById("preview-caption");
const statusBar = document.getElementById("statusbar");
const statusText = document.getElementById("status");
const progressFill = statusBar.querySelector(".statusbar__fill");
const advancedToggle = document.getElementById("advanced-toggle");
const advancedBody = document.getElementById("advanced-body");
const advancedLabel = advancedToggle.querySelector(".advanced__label");
const tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
const panelSlp = document.getElementById("panel-slp");
const panelSld = document.getElementById("panel-sld");
const delayRange = document.getElementById("delay");
const delayNum = document.getElementById("delay_num");
const scaleRange = document.getElementById("scale");
const scaleNum = document.getElementById("scale_num");
const transparentCb = document.getElementById("transparent");
const outlineCb = document.getElementById("draw_outline");

// ---------- state -----------------------------------------------------------

let mapping = null; // { byUnit: Map<unit, Map<action, slpId>>, units: string[] }
let mappingPromise = null;
const slpCache = new Map(); // slpId -> ArrayBuffer
let worker = null;
let pendingId = 0;
const pending = new Map();

let busy = false;
let lastGifUrl = null;
let lastRenderedFingerprint = null;
let currentFingerprint = "";
let progressHideTimer = 0;

// ---------- status / progress ----------------------------------------------

const STATUS_TONES = ["idle", "loading", "success", "error"];

function setStatusTone(tone) {
  STATUS_TONES.forEach(function (t) {
    statusBar.classList.toggle("statusbar--" + t, t === tone);
  });
}

function setStatus(text, tone) {
  statusText.textContent = text || "";
  setStatusTone(tone || "idle");
}

function setProgress(pct, opts) {
  const options = opts || {};
  if (progressHideTimer) {
    clearTimeout(progressHideTimer);
    progressHideTimer = 0;
  }
  const clamped = Math.max(0, Math.min(100, pct));
  statusBar.style.setProperty("--p", clamped + "%");
  progressFill.style.width = clamped + "%";
  if (clamped >= 100 && options.autoHide !== false) {
    const hold = options.holdMs != null ? options.holdMs : 500;
    progressHideTimer = setTimeout(function () {
      statusBar.style.setProperty("--p", "0%");
      progressFill.style.width = "0%";
    }, hold);
  }
}

// ---------- tabs ------------------------------------------------------------

function selectTab(name) {
  tabs.forEach(function (t) {
    t.setAttribute("aria-selected", t.getAttribute("data-tab") === name ? "true" : "false");
  });
  panelSlp.hidden = name !== "slp";
  panelSld.hidden = name !== "sld";
}

tabs.forEach(function (t) {
  t.addEventListener("click", function () {
    selectTab(t.getAttribute("data-tab"));
  });
});

// ---------- advanced drawer -------------------------------------------------

advancedToggle.addEventListener("click", function () {
  const open = !advancedBody.classList.contains("is-open");
  advancedBody.classList.toggle("is-open", open);
  advancedToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (advancedLabel) advancedLabel.textContent = open ? "Hide advanced" : "Show advanced";
});

function bindRangePair(range, num) {
  range.addEventListener("input", function () { num.value = range.value; refreshFingerprint(); });
  num.addEventListener("input", function () { range.value = num.value; refreshFingerprint(); });
}
bindRangePair(delayRange, delayNum);
bindRangePair(scaleRange, scaleNum);

form.addEventListener("input", refreshFingerprint);
form.addEventListener("change", refreshFingerprint);

// ---------- mapping ---------------------------------------------------------

function loadMapping() {
  if (mappingPromise) return mappingPromise;
  mappingPromise = fetch(MAPPING_URL, { cache: "force-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("Failed to fetch mapping: HTTP " + res.status);
      return res.json();
    })
    .then(function (rows) {
      const byUnit = new Map();
      for (const row of rows) {
        if (!row || typeof row.SLP !== "number") continue;
        const unit = String(row.Unit || "").trim();
        const action = String(row.Action || "").trim();
        if (!unit || !action) continue;
        if (!byUnit.has(unit)) byUnit.set(unit, new Map());
        const actions = byUnit.get(unit);
        if (!actions.has(action)) actions.set(action, row.SLP);
      }
      const units = Array.from(byUnit.keys()).sort(function (a, b) {
        return a.localeCompare(b);
      });
      mapping = { byUnit, units };
      return mapping;
    });
  return mappingPromise;
}

function populateUnits() {
  const frag = document.createDocumentFragment();
  mapping.units.forEach(function (u) {
    const opt = document.createElement("option");
    opt.value = u;
    frag.appendChild(opt);
  });
  unitList.textContent = "";
  unitList.appendChild(frag);
}

function populateActions(unit) {
  actionSelect.textContent = "";
  const actions = mapping.byUnit.get(unit);
  if (!actions || actions.size === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No actions";
    actionSelect.appendChild(opt);
    actionSelect.disabled = true;
    return;
  }
  actionSelect.disabled = false;
  const keys = Array.from(actions.keys()).sort(function (a, b) { return a.localeCompare(b); });
  keys.forEach(function (a) {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = a;
    actionSelect.appendChild(opt);
  });
}

// ---------- compass + swatches ----------------------------------------------

function wireRadioGroup(container, attr) {
  container.addEventListener("click", function (ev) {
    const btn = ev.target.closest("[" + attr + "]");
    if (!btn || !container.contains(btn)) return;
    const buttons = container.querySelectorAll("[" + attr + "]");
    buttons.forEach(function (b) {
      b.setAttribute("aria-checked", b === btn ? "true" : "false");
    });
    refreshFingerprint();
  });
}
wireRadioGroup(compass, "data-dir");
wireRadioGroup(swatches, "data-player");

function selectedFromGroup(container, attr) {
  const el = container.querySelector("[" + attr + "][aria-checked='true']");
  return el ? el.getAttribute(attr) : null;
}

// ---------- fingerprint / button state -------------------------------------

function currentSelection() {
  return {
    unit: unitInput.value.trim(),
    action: actionSelect.value,
    direction: selectedFromGroup(compass, "data-dir") || "S",
    player: Number(selectedFromGroup(swatches, "data-player") || "1"),
    delay: Number(delayRange.value),
    scale: Number(scaleRange.value),
    transparent: !!transparentCb.checked,
    drawOutline: !!outlineCb.checked,
  };
}

function resolveSlpId(sel) {
  if (!mapping || !sel.unit || !sel.action) return null;
  const actions = mapping.byUnit.get(sel.unit);
  if (!actions) return null;
  return actions.has(sel.action) ? actions.get(sel.action) : null;
}

function computeFingerprint() {
  return JSON.stringify(currentSelection());
}

function refreshFingerprint() {
  currentFingerprint = computeFingerprint();
  applyButtonState();
}

function buttonState() {
  const sel = currentSelection();
  const slpId = resolveSlpId(sel);
  if (!slpId) return "no-selection";
  if (lastRenderedFingerprint && lastRenderedFingerprint === currentFingerprint) return "rendered";
  return lastRenderedFingerprint ? "dirty" : "ready";
}

function applyButtonState() {
  if (busy) return;
  switch (buttonState()) {
    case "no-selection":
      submitBtn.disabled = true;
      submitBtn.textContent = "Generate GIF";
      break;
    case "ready":
      submitBtn.disabled = false;
      submitBtn.textContent = "Generate GIF";
      break;
    case "rendered":
      submitBtn.disabled = true;
      submitBtn.textContent = "Generated";
      break;
    case "dirty":
      submitBtn.disabled = false;
      submitBtn.textContent = "Generate again";
      break;
  }
}

function setBusy(on) {
  busy = on;
  if (on) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Generating\u2026";
  } else {
    applyButtonState();
  }
}

// ---------- unit + action wiring -------------------------------------------

function onUnitChanged() {
  const unit = unitInput.value.trim();
  if (mapping && mapping.byUnit.has(unit)) {
    populateActions(unit);
  } else {
    actionSelect.innerHTML = "<option value=\"\">Pick a unit first</option>";
    actionSelect.disabled = true;
  }
  refreshFingerprint();
}
unitInput.addEventListener("input", onUnitChanged);
unitInput.addEventListener("change", onUnitChanged);

// ---------- SLP fetch + cache ----------------------------------------------

async function fetchSlp(id) {
  if (slpCache.has(id)) return slpCache.get(id);
  const res = await fetch(SLP_URL(id), { cache: "force-cache" });
  if (!res.ok) {
    throw new Error(
      "SLP " + id + " not available (HTTP " + res.status + "). Most SLPs are not" +
      " included in this deploy yet; only a few test files are shipped.",
    );
  }
  const buf = await res.arrayBuffer();
  slpCache.set(id, buf);
  return buf;
}

// ---------- worker RPC ------------------------------------------------------

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker("/gif/worker-slp.js");
  worker.onmessage = function (ev) {
    const msg = ev.data || {};
    if (msg.type === "progress") {
      if (typeof msg.pct === "number") setProgress(msg.pct, { autoHide: false });
      if (msg.message) setStatus(msg.message, "loading");
      return;
    }
    if (msg.type === "result") {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg);
      else entry.reject(new Error(msg.error || "Worker failed"));
    }
  };
  worker.onerror = function (e) {
    pending.forEach(function (entry) { entry.reject(new Error(e.message || "Worker error")); });
    pending.clear();
    setProgress(100, { holdMs: 1200 });
    setStatus(e.message || "Worker error", "error");
    setBusy(false);
  };
  return worker;
}

function renderFramesViaWorker(slpBytes, sel) {
  ensureWorker();
  const id = ++pendingId;
  // clone the SLP bytes so the cached copy isn't detached by transfer
  const copy = slpBytes.slice(0);
  return new Promise(function (resolve, reject) {
    pending.set(id, { resolve, reject });
    worker.postMessage(
      {
        type: "render",
        id,
        slpBytes: copy,
        direction: sel.direction,
        player: sel.player,
        drawOutline: sel.drawOutline,
        palette: STANDARD_PALETTE,
      },
      [copy],
    );
  });
}

// ---------- canvas normalisation (hotspot-aligned) -------------------------

function computeCanvas(frames) {
  // Normalise all frames to a common canvas using the hotspot as the pivot
  // so the sprite doesn't jitter between frames.
  let maxLeft = 0, maxRight = 0, maxTop = 0, maxBottom = 0;
  for (const f of frames) {
    maxLeft = Math.max(maxLeft, f.hotspotX);
    maxTop = Math.max(maxTop, f.hotspotY);
    maxRight = Math.max(maxRight, f.width - f.hotspotX);
    maxBottom = Math.max(maxBottom, f.height - f.hotspotY);
  }
  const width = Math.max(1, maxLeft + maxRight);
  const height = Math.max(1, maxTop + maxBottom);
  const pivotX = maxLeft;
  const pivotY = maxTop;
  return { width, height, pivotX, pivotY };
}

function blitFrame(frame, canvas) {
  const out = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  const dx = canvas.pivotX - frame.hotspotX;
  const dy = canvas.pivotY - frame.hotspotY;
  const src = frame.rgba;
  for (let y = 0; y < frame.height; y++) {
    const sy = (y * frame.width) * 4;
    const dyRow = ((dy + y) * canvas.width + dx) * 4;
    if (dy + y < 0 || dy + y >= canvas.height) continue;
    out.set(src.subarray(sy, sy + frame.width * 4), dyRow);
  }
  return out;
}

function scaleNN(rgba, width, height, factor) {
  if (factor <= 1) return { rgba, width, height };
  const w2 = width * factor;
  const h2 = height * factor;
  const out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < w2; x++) {
      const sx = Math.floor(x / factor);
      const srcOff = (sy * width + sx) * 4;
      const dstOff = (y * w2 + x) * 4;
      out[dstOff + 0] = rgba[srcOff + 0];
      out[dstOff + 1] = rgba[srcOff + 1];
      out[dstOff + 2] = rgba[srcOff + 2];
      out[dstOff + 3] = rgba[srcOff + 3];
    }
  }
  return { rgba: out, width: w2, height: h2 };
}

// ---------- encode ---------------------------------------------------------

function encodeGif(framesOnCanvas, width, height, sel) {
  // Quantize once using frame 0 to produce a shared global palette. Using the
  // rgba4444 format with oneBitAlpha gives us a clean transparent slot when
  // the 'Transparent background' toggle is on.
  const format = sel.transparent ? "rgba4444" : "rgb565";
  const palette = quantize(framesOnCanvas[0], 256, {
    format,
    oneBitAlpha: sel.transparent ? true : false,
    clearAlpha: true,
    clearAlphaThreshold: 0,
    clearAlphaColor: 0x00,
  });

  let transparentIndex = 0;
  if (sel.transparent) {
    for (let i = 0; i < palette.length; i++) {
      if (palette[i].length >= 4 && palette[i][3] === 0) { transparentIndex = i; break; }
    }
  }

  const gif = GIFEncoder();
  const total = framesOnCanvas.length;
  for (let i = 0; i < total; i++) {
    const idx = applyPalette(framesOnCanvas[i], palette, format);
    gif.writeFrame(idx, width, height, {
      palette: i === 0 ? palette : undefined,
      first: i === 0,
      transparent: sel.transparent,
      transparentIndex,
      delay: sel.delay,
      repeat: 0,
    });
    const pct = 95 + Math.round((i + 1) / total * 4);
    setProgress(pct, { autoHide: false });
  }
  gif.finish();
  return gif.bytes();
}

// ---------- main generate flow ---------------------------------------------

function setImageFromBlob(blob) {
  if (lastGifUrl) URL.revokeObjectURL(lastGifUrl);
  lastGifUrl = URL.createObjectURL(blob);
  imgEl.src = lastGifUrl;
}

function setCaption(sel, meta) {
  if (!sel || !meta) { captionEl.textContent = ""; return; }
  captionEl.textContent =
    sel.unit + " \u00b7 " + sel.action + " \u00b7 " + sel.direction +
    " \u00b7 player " + sel.player +
    " \u00b7 " + meta.framesPerDirection + "f";
}

async function generate() {
  if (busy) return;
  const sel = currentSelection();
  const slpId = resolveSlpId(sel);
  if (!slpId) {
    setStatus("Pick a unit and an action first.", "error");
    return;
  }

  setBusy(true);
  try {
    setStatus("Loading SLP " + slpId + "\u2026", "loading");
    setProgress(2, { autoHide: false });
    const slpBytes = await fetchSlp(slpId);

    setProgress(5, { autoHide: false });
    const { frames, meta } = await renderFramesViaWorker(slpBytes, sel);

    setStatus("Aligning frames\u2026", "loading");
    const canvas = computeCanvas(frames);
    const blitted = frames.map(function (f) { return blitFrame(f, canvas); });

    // Optional nearest-neighbour upscale so the sprite isn't tiny.
    let outW = canvas.width, outH = canvas.height;
    let blittedScaled = blitted;
    if (sel.scale > 1) {
      blittedScaled = blitted.map(function (rgba) {
        const r = scaleNN(rgba, canvas.width, canvas.height, sel.scale);
        outW = r.width; outH = r.height;
        return r.rgba;
      });
    }

    setStatus("Encoding GIF\u2026", "loading");
    const bytes = encodeGif(blittedScaled, outW, outH, sel);
    const blob = new Blob([bytes], { type: "image/gif" });

    setImageFromBlob(blob);
    setCaption(sel, meta);

    lastRenderedFingerprint = currentFingerprint;
    setProgress(100, { holdMs: 600 });
    setStatus("Done \u00b7 " + formatBytes(blob.size) + " \u00b7 " +
      outW + "\u00d7" + outH + "px", "success");
  } catch (err) {
    setProgress(100, { holdMs: 1500 });
    setStatus((err && err.message) || String(err), "error");
  } finally {
    setBusy(false);
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

form.addEventListener("submit", function (ev) {
  ev.preventDefault();
  generate();
});

// ---------- boot ------------------------------------------------------------

async function boot() {
  setStatus("Loading unit index\u2026", "loading");
  setProgress(10, { autoHide: false });
  try {
    await loadMapping();
    populateUnits();
    setProgress(100, { holdMs: 400 });
    setStatus("Ready \u00b7 " + mapping.units.length + " units", "success");
  } catch (err) {
    setProgress(100, { holdMs: 1500 });
    setStatus((err && err.message) || "Failed to load unit index", "error");
  }
  refreshFingerprint();
}

imgEl.src = PLACEHOLDER_URL;
boot();
