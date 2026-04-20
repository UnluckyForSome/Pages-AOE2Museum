// =============================================================================
// /gif/ UI controller - handles both the SLP tab (AoK / TC / HD) and the SLD
// tab (Definitive Edition).
//
// Shared pipeline:
//   bytes -> worker (RGBA frames + hotspots) -> canvas normalise -> optional
//   NN upscale -> gifenc quantize + writeFrame -> Blob URL preview.
//
// Each tab owns its own form state, fingerprint/dirty button, worker handle
// and cache, but they share the status bar, the encode stage and the utility
// helpers so adding the SLD mode did not duplicate the critical path.
// =============================================================================

import { GIFEncoder, quantize, applyPalette } from "/gif/vendor/gifenc.esm.js";
import { STANDARD_PALETTE } from "/gif/palette.js";
import { TEAM_COLORS } from "/gif/team-colors.js";
import { buildIndex, listActions, listZooms, resolveKey } from "/gif/sld-index.js";

// ---------- reusable option sets (shared by SLP + SLD) ---------------------

// Player color options use the actual in-game button sprites as both the
// idle and pressed visuals. `icon` drives the <img> src; `iconPressed` is
// swapped in on pointerdown so tapping feels tactile.
const PLAYER_COLOR_OPTIONS = [
  { value: 1, label: "Player 1 (blue)",    icon: "/gif/assets/1.png", iconPressed: "/gif/assets/1pressed.png" },
  { value: 2, label: "Player 2 (red)",     icon: "/gif/assets/2.png", iconPressed: "/gif/assets/2pressed.png" },
  { value: 3, label: "Player 3 (green)",   icon: "/gif/assets/3.png", iconPressed: "/gif/assets/3pressed.png" },
  { value: 4, label: "Player 4 (yellow)",  icon: "/gif/assets/4.png", iconPressed: "/gif/assets/4pressed.png" },
  { value: 5, label: "Player 5 (cyan)",    icon: "/gif/assets/5.png", iconPressed: "/gif/assets/5pressed.png" },
  { value: 6, label: "Player 6 (magenta)", icon: "/gif/assets/6.png", iconPressed: "/gif/assets/6pressed.png" },
  { value: 7, label: "Player 7 (tan)",     icon: "/gif/assets/7.png", iconPressed: "/gif/assets/7pressed.png" },
  { value: 8, label: "Player 8 (orange)",  icon: "/gif/assets/8.png", iconPressed: "/gif/assets/8pressed.png" },
];

// SLP stores 5 of 8 compass directions and mirrors the rest at render time.
// The cycle walks clockwise starting from South. `label` is what prints in
// the tiny rectangle button, so we use the short cardinal form.
const SLP_DIRECTION_OPTIONS = [
  { value: "S",  label: "S"  },
  { value: "SW", label: "SW" },
  { value: "W",  label: "W"  },
  { value: "NW", label: "NW" },
  { value: "N",  label: "N"  },
  { value: "NE", label: "NE" },
  { value: "E",  label: "E"  },
  { value: "SE", label: "SE" },
];

// SLD has 16 directions stored starting with E and proceeding counter-clockwise.
// The `value` is the storage slice index; the cycle order below starts at S
// and walks the full circle clockwise so tapping feels spatial.
const SLD_DIRECTION_OPTIONS = [
  { value: 4,  label: "S"   },
  { value: 3,  label: "SSE" },
  { value: 2,  label: "SE"  },
  { value: 1,  label: "ESE" },
  { value: 0,  label: "E"   },
  { value: 15, label: "ENE" },
  { value: 14, label: "NE"  },
  { value: 13, label: "NNE" },
  { value: 12, label: "N"   },
  { value: 11, label: "NNW" },
  { value: 10, label: "NW"  },
  { value: 9,  label: "WNW" },
  { value: 8,  label: "W"   },
  { value: 7,  label: "WSW" },
  { value: 6,  label: "SW"  },
  { value: 5,  label: "SSW" },
];

const SLD_ZOOM_OPTIONS = [
  { value: "x1", label: "x1" },
  { value: "x2", label: "x2" },
];

// ---------- config ----------------------------------------------------------

// SLP/SLD raw bytes and dropdown manifests are served by the Worker, which
// streams them on demand from the self-hosted Garage S3 buckets. The browser
// never speaks to Garage directly.
const SLP_MANIFEST_URL = "/api/gif/slp/manifest";
const SLP_URL = (id) => "/api/gif/slp/" + id + ".slp";

const SLD_MANIFEST_URL = "/api/gif/sld/manifest";
const SLD_URL = (key) => "/api/gif/sld/" + key + ".sld";

const PLACEHOLDER_URL = "/gif/assets/placeholder.png";

// ---------- shared DOM ------------------------------------------------------

const tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
const panelSlp = document.getElementById("panel-slp");
const panelSld = document.getElementById("panel-sld");
const statusBar = document.getElementById("statusbar");
const statusText = document.getElementById("status");
const progressFill = statusBar.querySelector(".statusbar__fill");

// ---------- shared status / progress ---------------------------------------

let progressHideTimer = 0;
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

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

// ---------- shared encode pipeline -----------------------------------------

function computeCanvas(frames) {
  let maxLeft = 0, maxRight = 0, maxTop = 0, maxBottom = 0;
  for (const f of frames) {
    maxLeft = Math.max(maxLeft, f.hotspotX);
    maxTop = Math.max(maxTop, f.hotspotY);
    maxRight = Math.max(maxRight, f.width - f.hotspotX);
    maxBottom = Math.max(maxBottom, f.height - f.hotspotY);
  }
  const width = Math.max(1, maxLeft + maxRight);
  const height = Math.max(1, maxTop + maxBottom);
  return { width, height, pivotX: maxLeft, pivotY: maxTop };
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

function encodeGif(framesOnCanvas, width, height, opts) {
  const transparent = !!opts.transparent;
  const format = transparent ? "rgba4444" : "rgb565";
  const palette = quantize(framesOnCanvas[0], 256, {
    format,
    oneBitAlpha: transparent,
    clearAlpha: true,
    clearAlphaThreshold: 0,
    clearAlphaColor: 0x00,
  });

  let transparentIndex = 0;
  if (transparent) {
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
      transparent,
      transparentIndex,
      delay: opts.delay,
      repeat: 0,
    });
    const pct = 95 + Math.round((i + 1) / total * 4);
    setProgress(pct, { autoHide: false });
  }
  gif.finish();
  return gif.bytes();
}

function framesToBlob(frames, opts) {
  const canvas = computeCanvas(frames);
  const blitted = frames.map(function (f) { return blitFrame(f, canvas); });
  let outW = canvas.width, outH = canvas.height;
  let blittedScaled = blitted;
  if (opts.scale > 1) {
    blittedScaled = blitted.map(function (rgba) {
      const r = scaleNN(rgba, canvas.width, canvas.height, opts.scale);
      outW = r.width; outH = r.height;
      return r.rgba;
    });
  }
  const bytes = encodeGif(blittedScaled, outW, outH, opts);
  return {
    blob: new Blob([bytes], { type: "image/gif" }),
    width: outW, height: outH,
  };
}

// ---------- worker wiring (shared pattern) ---------------------------------

function makeWorkerHandle(url, onProgress, workerOpts) {
  const state = {
    worker: null,
    pendingId: 0,
    pending: new Map(),
  };

  function ensure() {
    if (state.worker) return state.worker;
    state.worker = workerOpts ? new Worker(url, workerOpts) : new Worker(url);
    state.worker.onmessage = function (ev) {
      const msg = ev.data || {};
      if (msg.type === "progress") {
        if (onProgress) onProgress(msg);
        return;
      }
      if (msg.type === "result") {
        const entry = state.pending.get(msg.id);
        if (!entry) return;
        state.pending.delete(msg.id);
        if (msg.ok) entry.resolve(msg);
        else entry.reject(new Error(msg.error || "Worker failed"));
      }
    };
    state.worker.onerror = function (e) {
      state.pending.forEach(function (entry) {
        entry.reject(new Error(e.message || "Worker error"));
      });
      state.pending.clear();
    };
    return state.worker;
  }

  function request(payload, transfer) {
    ensure();
    const id = ++state.pendingId;
    return new Promise(function (resolve, reject) {
      state.pending.set(id, { resolve, reject });
      state.worker.postMessage(Object.assign({ id }, payload), transfer || []);
    });
  }

  return { request };
}

function workerProgressHandler(msg) {
  if (typeof msg.pct === "number") setProgress(msg.pct, { autoHide: false });
  if (msg.message) setStatus(msg.message, "loading");
}

const slpWorker = makeWorkerHandle("/gif/worker-slp.js", workerProgressHandler);
const sldWorker = makeWorkerHandle("/gif/worker-sld.js", workerProgressHandler, { type: "module" });

// ---------- combo (live-filter dropdown) ------------------------------------

// A light-weight combobox: the `<input>` stays a regular text input so the
// browser keeps its native IME / mobile keyboard, but typing filters a
// scrollable `<ul role="listbox">` rendered below. Mouse/keyboard both drive
// the same "active option" state.
const COMBO_MAX_ROWS = 200;

function createCombo(opts) {
  const input = opts.input;
  const list = opts.list;
  const getOptions = opts.getOptions;
  const onSelect = opts.onSelect;

  let current = [];
  let activeIdx = -1;

  function render() {
    const q = input.value.trim().toLowerCase();
    const pool = getOptions() || [];
    const matches = q
      ? pool.filter(function (u) { return u.toLowerCase().includes(q); })
      : pool.slice();
    current = matches.slice(0, COMBO_MAX_ROWS);
    list.textContent = "";
    if (current.length === 0) {
      const li = document.createElement("li");
      li.className = "combo__option combo__option--empty";
      li.textContent = "Nothing matches";
      li.setAttribute("role", "presentation");
      list.appendChild(li);
    } else {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < current.length; i++) {
        const li = document.createElement("li");
        li.className = "combo__option";
        li.setAttribute("role", "option");
        li.setAttribute("data-idx", String(i));
        li.textContent = current[i];
        frag.appendChild(li);
      }
      list.appendChild(frag);
    }
    activeIdx = current.length > 0 ? 0 : -1;
    paintActive();
  }

  function paintActive() {
    const nodes = list.querySelectorAll(".combo__option[role='option']");
    nodes.forEach(function (n, i) {
      n.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
    });
    if (activeIdx >= 0 && nodes[activeIdx]) {
      const el = nodes[activeIdx];
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function open() {
    if (!list.hidden) return;
    render();
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    if (list.hidden) return;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function commit(value) {
    input.value = value;
    close();
    if (onSelect) onSelect(value);
  }

  input.addEventListener("focus", open);
  input.addEventListener("input", function () {
    open();
    render();
  });
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (list.hidden) { open(); return; }
      if (current.length === 0) return;
      activeIdx = (activeIdx + 1) % current.length;
      paintActive();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (list.hidden) { open(); return; }
      if (current.length === 0) return;
      activeIdx = (activeIdx - 1 + current.length) % current.length;
      paintActive();
    } else if (ev.key === "Enter") {
      if (!list.hidden && activeIdx >= 0 && current[activeIdx]) {
        ev.preventDefault();
        commit(current[activeIdx]);
      }
    } else if (ev.key === "Escape") {
      if (!list.hidden) { ev.preventDefault(); close(); }
    }
  });

  // Use pointerdown so selection wins the race against the input's blur.
  list.addEventListener("pointerdown", function (ev) {
    const li = ev.target.closest(".combo__option[role='option']");
    if (!li || !list.contains(li)) return;
    ev.preventDefault();
    const idx = Number(li.getAttribute("data-idx"));
    if (!Number.isFinite(idx) || !current[idx]) return;
    commit(current[idx]);
  });

  document.addEventListener("pointerdown", function (ev) {
    if (list.hidden) return;
    const root = input.closest("[data-combo]");
    if (root && root.contains(ev.target)) return;
    close();
  });

  input.addEventListener("blur", function () {
    // Give pointerdown-on-option a chance to fire first.
    setTimeout(close, 120);
  });

  return {
    refresh: function () { if (!list.hidden) render(); },
    close: close,
  };
}

// ---------- cycle button (tap-to-advance: zoom / direction / player) --------

// Each cycle button owns an ordered list of options and advances to the next
// enabled option on click / Enter / Space. Options with `.icon` render as an
// <img> (player color button); options with just `.label` render as text
// (direction, zoom). Pointerdown/up swaps the image between `icon` and
// `iconPressed` for tactile feedback; text buttons rely on CSS `:active`.
function createCycleButton(el, options, init) {
  const settings = init || {};
  const state = {
    options: options.slice(),
    index: 0,
    disabled: new Set(),
  };
  const isImage = state.options.some(function (o) { return !!o.icon; });
  let imgNode = null;
  if (isImage) {
    imgNode = document.createElement("img");
    imgNode.alt = "";
    imgNode.draggable = false;
    el.textContent = "";
    el.appendChild(imgNode);
  }

  function currentOption() { return state.options[state.index] || null; }

  function paint() {
    const opt = currentOption();
    const allDisabled = state.options.every(function (o) { return state.disabled.has(o.value); });
    el.disabled = allDisabled;
    if (!opt) return;
    if (settings.tag) {
      el.setAttribute("aria-label", settings.tag + ": " + opt.label);
    } else {
      el.setAttribute("aria-label", opt.label);
    }
    if (isImage && imgNode) {
      imgNode.src = opt.icon || "";
    } else {
      el.textContent = opt.label;
    }
  }

  function isEnabled(i) {
    const o = state.options[i];
    return !!o && !state.disabled.has(o.value);
  }

  function findNextEnabled(fromIdx) {
    const n = state.options.length;
    if (n === 0) return -1;
    for (let step = 1; step <= n; step++) {
      const i = (fromIdx + step) % n;
      if (isEnabled(i)) return i;
    }
    return -1;
  }

  function advance(notify) {
    const next = findNextEnabled(state.index);
    if (next < 0 || next === state.index) return;
    state.index = next;
    paint();
    if (notify !== false && settings.onChange) {
      settings.onChange(currentOption().value);
    }
  }

  el.addEventListener("click", function () { advance(true); });
  el.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      advance(true);
    }
  });

  // Image buttons get an explicit pressed-sprite swap; :active is unreliable
  // on mobile touch events. Text buttons use CSS :active instead.
  if (isImage && imgNode) {
    const pressDown = function () {
      const opt = currentOption();
      if (opt && opt.iconPressed) imgNode.src = opt.iconPressed;
    };
    const pressUp = function () {
      const opt = currentOption();
      if (opt && opt.icon) imgNode.src = opt.icon;
    };
    el.addEventListener("pointerdown", pressDown);
    el.addEventListener("pointerup", pressUp);
    el.addEventListener("pointerleave", pressUp);
    el.addEventListener("pointercancel", pressUp);
    el.addEventListener("blur", pressUp);
  }

  function setValue(val, notify) {
    for (let i = 0; i < state.options.length; i++) {
      if (state.options[i].value === val) {
        state.index = i;
        paint();
        if (notify && settings.onChange) settings.onChange(val);
        return true;
      }
    }
    return false;
  }

  function setEnabled(predicate) {
    state.disabled.clear();
    for (const opt of state.options) {
      if (!predicate(opt.value)) state.disabled.add(opt.value);
    }
    if (!isEnabled(state.index)) {
      const next = findNextEnabled(state.index);
      if (next >= 0) state.index = next;
    }
    paint();
  }

  if (settings.initial !== undefined) {
    setValue(settings.initial, false);
  } else {
    paint();
  }

  return {
    get value() { const o = currentOption(); return o ? o.value : null; },
    setValue: setValue,
    setEnabled: setEnabled,
    advance: advance,
  };
}

// =============================================================================
// Tab switching (hash-synced)
// =============================================================================

function currentTab() {
  const active = document.querySelector(".tab[aria-selected='true']");
  return active ? active.getAttribute("data-tab") : "slp";
}

function selectTab(name) {
  const valid = name === "slp" || name === "sld";
  const n = valid ? name : "slp";
  tabs.forEach(function (t) {
    t.setAttribute("aria-selected", t.getAttribute("data-tab") === n ? "true" : "false");
  });
  panelSlp.hidden = n !== "slp";
  panelSld.hidden = n !== "sld";
  if (n === "sld") slpEnsureIdle(); else sldEnsureIdle();
  if (n === "sld") sld.onActivate();
  const hash = "#" + n;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

tabs.forEach(function (t) {
  t.addEventListener("click", function () {
    selectTab(t.getAttribute("data-tab"));
  });
});

window.addEventListener("hashchange", function () {
  const target = (location.hash || "#slp").slice(1);
  selectTab(target);
});

function slpEnsureIdle() { if (slp.busy) return; slp.applyButtonState(); }
function sldEnsureIdle() { if (sld.busy) return; sld.applyButtonState(); }

// =============================================================================
// SLP mode
// =============================================================================

const slp = (function () {
  const form = document.getElementById("form");
  const unitInput = document.getElementById("unit-input");
  const unitList = document.getElementById("unit-list");
  const actionSelect = document.getElementById("action-select");
  const directionBtn = document.getElementById("slp-direction");
  const playerBtn = document.getElementById("slp-player");
  const submitBtn = document.getElementById("submit");
  const imgEl = document.getElementById("img");
  const captionEl = document.getElementById("preview-caption");
  const advancedToggle = document.getElementById("advanced-toggle");
  const advancedBody = document.getElementById("advanced-body");
  const advancedLabel = advancedToggle.querySelector(".advanced__label");
  const delayRange = document.getElementById("delay");
  const delayNum = document.getElementById("delay_num");
  const scaleRange = document.getElementById("scale");
  const scaleNum = document.getElementById("scale_num");
  const transparentCb = document.getElementById("transparent");
  const outlineCb = document.getElementById("draw_outline");

  let mapping = null;
  let mappingPromise = null;
  const slpCache = new Map();

  const m = {
    busy: false,
    lastGifUrl: null,
    lastRenderedFingerprint: null,
    currentFingerprint: "",
    applyButtonState: applyButtonState,
    onActivate: function () {}, // no lazy init; mapping is fetched at boot
  };

  function loadMapping() {
    if (mappingPromise) return mappingPromise;
    // Worker returns { units: { [unit]: { [action]: slpId } }, total }, already
    // intersected with what Garage actually has. Normalise to the Map shape
    // the rest of this module expects.
    mappingPromise = fetch(SLP_MANIFEST_URL, { cache: "default" })
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to fetch SLP manifest: HTTP " + res.status);
        return res.json();
      })
      .then(function (manifest) {
        const units = (manifest && manifest.units) || {};
        const byUnit = new Map();
        Object.keys(units).forEach(function (unit) {
          const actions = units[unit] || {};
          const actionMap = new Map();
          Object.keys(actions).forEach(function (action) {
            const id = actions[action];
            if (typeof id === "number") actionMap.set(action, id);
          });
          if (actionMap.size > 0) byUnit.set(unit, actionMap);
        });
        const unitList = Array.from(byUnit.keys()).sort(function (a, b) {
          return a.localeCompare(b);
        });
        mapping = { byUnit, units: unitList };
        return mapping;
      });
    return mappingPromise;
  }

  function populateUnits() {
    combo.refresh();
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
      opt.value = a; opt.textContent = a;
      actionSelect.appendChild(opt);
    });
  }

  const directionCycle = createCycleButton(directionBtn, SLP_DIRECTION_OPTIONS, {
    tag: "Direction",
    initial: "S",
    onChange: function () { refresh(); },
  });
  const playerCycle = createCycleButton(playerBtn, PLAYER_COLOR_OPTIONS, {
    tag: "Player",
    initial: 1,
    onChange: function () { refresh(); },
  });

  const combo = createCombo({
    input: unitInput,
    list: unitList,
    getOptions: function () { return mapping ? mapping.units : []; },
    onSelect: function () { onUnitChanged(); },
  });

  advancedToggle.addEventListener("click", function () {
    const open = !advancedBody.classList.contains("is-open");
    advancedBody.classList.toggle("is-open", open);
    advancedToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (advancedLabel) advancedLabel.textContent = open ? "Hide advanced" : "Show advanced";
  });

  function bindRangePair(range, num) {
    range.addEventListener("input", function () { num.value = range.value; refresh(); });
    num.addEventListener("input", function () { range.value = num.value; refresh(); });
  }
  bindRangePair(delayRange, delayNum);
  bindRangePair(scaleRange, scaleNum);

  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);

  function selection() {
    return {
      unit: unitInput.value.trim(),
      action: actionSelect.value,
      direction: directionCycle.value || "S",
      player: Number(playerCycle.value || 1),
      delay: Number(delayRange.value),
      scale: Number(scaleRange.value),
      transparent: !!transparentCb.checked,
      drawOutline: !!outlineCb.checked,
    };
  }

  function resolveId(sel) {
    if (!mapping || !sel.unit || !sel.action) return null;
    const actions = mapping.byUnit.get(sel.unit);
    if (!actions) return null;
    return actions.has(sel.action) ? actions.get(sel.action) : null;
  }

  function fingerprint() { return JSON.stringify(selection()); }

  function refresh() {
    m.currentFingerprint = fingerprint();
    applyButtonState();
  }

  function buttonState() {
    const sel = selection();
    if (!resolveId(sel)) return "no-selection";
    if (m.lastRenderedFingerprint && m.lastRenderedFingerprint === m.currentFingerprint) return "rendered";
    return m.lastRenderedFingerprint ? "dirty" : "ready";
  }

  function applyButtonState() {
    if (m.busy) return;
    switch (buttonState()) {
      case "no-selection": submitBtn.disabled = true;  submitBtn.textContent = "Generate GIF"; break;
      case "ready":        submitBtn.disabled = false; submitBtn.textContent = "Generate GIF"; break;
      case "rendered":     submitBtn.disabled = true;  submitBtn.textContent = "Generated";    break;
      case "dirty":        submitBtn.disabled = false; submitBtn.textContent = "Generate again"; break;
    }
  }

  function setBusy(on) {
    m.busy = on;
    if (on) { submitBtn.disabled = true; submitBtn.textContent = "Generating\u2026"; }
    else applyButtonState();
  }

  function onUnitChanged() {
    const unit = unitInput.value.trim();
    if (mapping && mapping.byUnit.has(unit)) populateActions(unit);
    else {
      actionSelect.innerHTML = "<option value=\"\">Pick a unit first</option>";
      actionSelect.disabled = true;
    }
    refresh();
  }
  unitInput.addEventListener("input", onUnitChanged);
  unitInput.addEventListener("change", onUnitChanged);

  async function fetchSlp(id) {
    if (slpCache.has(id)) return slpCache.get(id);
    const res = await fetch(SLP_URL(id), { cache: "force-cache" });
    if (!res.ok) {
      throw new Error(
        "SLP " + id + " not available (HTTP " + res.status + "). The file is not" +
        " present in the Garage bucket.",
      );
    }
    const buf = await res.arrayBuffer();
    slpCache.set(id, buf);
    return buf;
  }

  function renderFrames(slpBytes, sel) {
    const copy = slpBytes.slice(0);
    return slpWorker.request(
      {
        type: "render",
        slpBytes: copy,
        direction: sel.direction,
        player: sel.player,
        drawOutline: sel.drawOutline,
        palette: STANDARD_PALETTE,
      },
      [copy],
    );
  }

  function setImageFromBlob(blob) {
    if (m.lastGifUrl) URL.revokeObjectURL(m.lastGifUrl);
    m.lastGifUrl = URL.createObjectURL(blob);
    imgEl.src = m.lastGifUrl;
  }

  function setCaption(sel, meta) {
    if (!sel || !meta) { captionEl.textContent = ""; return; }
    captionEl.textContent =
      sel.unit + " \u00b7 " + sel.action + " \u00b7 " + sel.direction +
      " \u00b7 player " + sel.player +
      " \u00b7 " + meta.framesPerDirection + "f";
  }

  async function generate() {
    if (m.busy) return;
    const sel = selection();
    const slpId = resolveId(sel);
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
      const { frames, meta } = await renderFrames(slpBytes, sel);

      setStatus("Aligning frames\u2026", "loading");
      const out = framesToBlob(frames, sel);

      setImageFromBlob(out.blob);
      setCaption(sel, meta);

      m.lastRenderedFingerprint = m.currentFingerprint;
      setProgress(100, { holdMs: 600 });
      setStatus("Done \u00b7 " + formatBytes(out.blob.size) + " \u00b7 " +
        out.width + "\u00d7" + out.height + "px", "success");
    } catch (err) {
      setProgress(100, { holdMs: 1500 });
      setStatus((err && err.message) || String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", function (ev) { ev.preventDefault(); generate(); });

  async function boot() {
    setStatus("Loading SLP catalogue\u2026", "loading");
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
    refresh();
  }

  imgEl.src = PLACEHOLDER_URL;

  return Object.assign(m, { boot: boot });
})();

// =============================================================================
// SLD mode
// =============================================================================

const sld = (function () {
  const form = document.getElementById("form-sld");
  const unitInput = document.getElementById("sld-unit");
  const unitList = document.getElementById("sld-unit-list");
  const actionSelect = document.getElementById("sld-action");
  const zoomBtn = document.getElementById("sld-zoom");
  const directionBtn = document.getElementById("sld-direction");
  const playerBtn = document.getElementById("sld-player");
  const submitBtn = document.getElementById("sld-submit");
  const imgEl = document.getElementById("sld-img");
  const captionEl = document.getElementById("sld-preview-caption");
  const advancedToggle = document.getElementById("sld-advanced-toggle");
  const advancedBody = document.getElementById("sld-advanced-body");
  const advancedLabel = advancedToggle.querySelector(".advanced__label");
  const delayRange = document.getElementById("sld-delay");
  const delayNum = document.getElementById("sld-delay_num");
  const scaleRange = document.getElementById("sld-scale");
  const scaleNum = document.getElementById("sld-scale_num");
  const transparentCb = document.getElementById("sld-transparent");
  const drawShadowCb = document.getElementById("sld-draw_shadow");

  let index = null;
  let indexPromise = null;
  const sldCache = new Map();

  const m = {
    busy: false,
    lastGifUrl: null,
    lastRenderedFingerprint: null,
    currentFingerprint: "",
    applyButtonState: applyButtonState,
    onActivate: onActivate,
  };

  // ----- lazy mapping load -------------------------------------------------

  function ensureIndex() {
    if (indexPromise) return indexPromise;
    setStatus("Loading SLD catalogue\u2026", "loading");
    setProgress(10, { autoHide: false });
    // Worker returns a pre-filtered manifest keyed by unit -> action -> zoom
    // -> key. Flatten it back into the { key: {unit, action, zoom} } shape
    // that buildIndex already understands so no other SLD-path code moves.
    indexPromise = fetch(SLD_MANIFEST_URL, { cache: "default" })
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to fetch SLD manifest: HTTP " + res.status);
        return res.json();
      })
      .then(function (manifest) {
        const flat = {};
        const units = (manifest && manifest.units) || {};
        Object.keys(units).forEach(function (unit) {
          const actions = units[unit] || {};
          Object.keys(actions).forEach(function (action) {
            const zooms = actions[action] || {};
            Object.keys(zooms).forEach(function (zoom) {
              const key = zooms[zoom];
              if (typeof key === "string" && key) {
                flat[key] = { unit: unit, action: action, zoom: zoom };
              }
            });
          });
        });
        index = buildIndex(flat);
        populateUnits();
        setProgress(100, { holdMs: 400 });
        setStatus("Ready \u00b7 " + index.units.length + " DE units", "success");
        refresh();
        return index;
      })
      .catch(function (err) {
        setProgress(100, { holdMs: 1500 });
        setStatus((err && err.message) || "Failed to load SLD catalogue", "error");
        indexPromise = null; // allow retry
        throw err;
      });
    return indexPromise;
  }

  function onActivate() {
    if (!index && !indexPromise) ensureIndex().catch(function () {});
  }

  // ----- populate helpers --------------------------------------------------

  function populateUnits() {
    combo.refresh();
  }

  function populateActions(unit) {
    actionSelect.textContent = "";
    const actions = listActions(index, unit);
    if (actions.length === 0) {
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "No actions";
      actionSelect.appendChild(opt);
      actionSelect.disabled = true;
      return;
    }
    actionSelect.disabled = false;
    actions.forEach(function (a) {
      const opt = document.createElement("option");
      opt.value = a; opt.textContent = a;
      actionSelect.appendChild(opt);
    });
  }

  function refreshZooms() {
    const unit = unitInput.value.trim();
    const action = actionSelect.value;
    const available = (index && unit && action)
      ? new Set(listZooms(index, unit, action))
      : null;
    // When no (unit, action) is selected yet, leave zoom fully enabled so the
    // user can still cycle it for preview purposes.
    zoomCycle.setEnabled(function (v) {
      return available ? available.has(v) : true;
    });
  }

  // ----- cycle buttons -----------------------------------------------------

  const zoomCycle = createCycleButton(zoomBtn, SLD_ZOOM_OPTIONS, {
    tag: "Zoom",
    initial: "x2",
    onChange: function () { refresh(); },
  });
  const directionCycle = createCycleButton(directionBtn, SLD_DIRECTION_OPTIONS, {
    tag: "Direction",
    initial: 4,
    onChange: function () { refresh(); },
  });
  const playerCycle = createCycleButton(playerBtn, PLAYER_COLOR_OPTIONS, {
    tag: "Player",
    initial: 1,
    onChange: function () { refresh(); },
  });

  const combo = createCombo({
    input: unitInput,
    list: unitList,
    getOptions: function () { return index ? index.units : []; },
    onSelect: function () { onUnitChanged(); },
  });

  // ----- advanced drawer ---------------------------------------------------

  advancedToggle.addEventListener("click", function () {
    const open = !advancedBody.classList.contains("is-open");
    advancedBody.classList.toggle("is-open", open);
    advancedToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (advancedLabel) advancedLabel.textContent = open ? "Hide advanced" : "Show advanced";
  });

  function bindRangePair(range, num) {
    range.addEventListener("input", function () { num.value = range.value; refresh(); });
    num.addEventListener("input", function () { range.value = num.value; refresh(); });
  }
  bindRangePair(delayRange, delayNum);
  bindRangePair(scaleRange, scaleNum);

  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);

  // ----- selection + fingerprint ------------------------------------------

  function selection() {
    return {
      unit: unitInput.value.trim(),
      action: actionSelect.value,
      zoom: zoomCycle.value || "",
      directionIndex: Number(directionCycle.value != null ? directionCycle.value : 0),
      player: Number(playerCycle.value || 1),
      delay: Number(delayRange.value),
      scale: Number(scaleRange.value),
      transparent: !!transparentCb.checked,
      drawShadow: !!drawShadowCb.checked,
    };
  }

  function resolveCurrentKey(sel) {
    if (!index) return null;
    return resolveKey(index, sel.unit, sel.action, sel.zoom);
  }

  function fingerprint() { return JSON.stringify(selection()); }

  function refresh() {
    m.currentFingerprint = fingerprint();
    applyButtonState();
  }

  function buttonState() {
    const sel = selection();
    if (!resolveCurrentKey(sel)) return "no-selection";
    if (m.lastRenderedFingerprint && m.lastRenderedFingerprint === m.currentFingerprint) return "rendered";
    return m.lastRenderedFingerprint ? "dirty" : "ready";
  }

  function applyButtonState() {
    if (m.busy) return;
    switch (buttonState()) {
      case "no-selection": submitBtn.disabled = true;  submitBtn.textContent = "Generate GIF"; break;
      case "ready":        submitBtn.disabled = false; submitBtn.textContent = "Generate GIF"; break;
      case "rendered":     submitBtn.disabled = true;  submitBtn.textContent = "Generated";    break;
      case "dirty":        submitBtn.disabled = false; submitBtn.textContent = "Generate again"; break;
    }
  }

  function setBusy(on) {
    m.busy = on;
    if (on) { submitBtn.disabled = true; submitBtn.textContent = "Generating\u2026"; }
    else applyButtonState();
  }

  // ----- unit / action cascade --------------------------------------------

  function onUnitChanged() {
    if (!index) { refresh(); return; }
    const unit = unitInput.value.trim();
    if (index.byUnit.has(unit)) populateActions(unit);
    else {
      actionSelect.innerHTML = "<option value=\"\">Pick a unit first</option>";
      actionSelect.disabled = true;
    }
    refreshZooms();
    refresh();
  }
  unitInput.addEventListener("input", onUnitChanged);
  unitInput.addEventListener("change", onUnitChanged);
  actionSelect.addEventListener("change", function () { refreshZooms(); refresh(); });

  // ----- SLD fetch + cache + render ---------------------------------------

  async function fetchSld(key) {
    if (sldCache.has(key)) return sldCache.get(key);
    const res = await fetch(SLD_URL(key), { cache: "force-cache" });
    if (!res.ok) {
      throw new Error(
        key + ".sld not available (HTTP " + res.status + "). The file is not" +
        " present in the Garage bucket.",
      );
    }
    const buf = await res.arrayBuffer();
    sldCache.set(key, buf);
    return buf;
  }

  function renderFrames(sldBytes, sel) {
    const copy = sldBytes.slice(0);
    const team = TEAM_COLORS[Math.max(1, Math.min(8, sel.player)) - 1];
    return sldWorker.request(
      {
        type: "render",
        sldBytes: copy,
        directionIndex: sel.directionIndex,
        player: sel.player,
        drawShadow: sel.drawShadow,
        teamRgb: team,
      },
      [copy],
    );
  }

  function setImageFromBlob(blob) {
    if (m.lastGifUrl) URL.revokeObjectURL(m.lastGifUrl);
    m.lastGifUrl = URL.createObjectURL(blob);
    imgEl.src = m.lastGifUrl;
  }

  function setCaption(sel, meta, key) {
    if (!sel || !meta) { captionEl.textContent = ""; return; }
    captionEl.textContent =
      key + " \u00b7 " + meta.directionLabel +
      " \u00b7 player " + sel.player +
      " \u00b7 " + meta.framesPerDirection + "f";
  }

  async function generate() {
    if (m.busy) return;
    let idx;
    try { idx = await ensureIndex(); } catch (_) { return; }
    void idx;

    const sel = selection();
    const key = resolveCurrentKey(sel);
    if (!key) {
      setStatus("Pick a unit, action and zoom first.", "error");
      return;
    }

    setBusy(true);
    try {
      setStatus("Loading " + key + ".sld\u2026", "loading");
      setProgress(2, { autoHide: false });
      const sldBytes = await fetchSld(key);

      setProgress(5, { autoHide: false });
      const { frames, meta } = await renderFrames(sldBytes, sel);

      setStatus("Aligning frames\u2026", "loading");
      const out = framesToBlob(frames, sel);

      setImageFromBlob(out.blob);
      setCaption(sel, meta, key);

      m.lastRenderedFingerprint = m.currentFingerprint;
      setProgress(100, { holdMs: 600 });
      setStatus("Done \u00b7 " + formatBytes(out.blob.size) + " \u00b7 " +
        out.width + "\u00d7" + out.height + "px", "success");
    } catch (err) {
      setProgress(100, { holdMs: 1500 });
      setStatus((err && err.message) || String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener("submit", function (ev) { ev.preventDefault(); generate(); });

  imgEl.src = PLACEHOLDER_URL;

  return m;
})();

// =============================================================================
// Boot
// =============================================================================

// Honour initial hash (#slp / #sld) before anything else.
const initialTab = (location.hash || "").replace(/^#/, "");
if (initialTab === "sld") selectTab("sld");

slp.boot();

// If the user landed directly on #sld, kick off the mapping load immediately.
if (initialTab === "sld") sld.onActivate();
