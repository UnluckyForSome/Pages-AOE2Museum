(function () {
  "use strict";

  const SUPPORTED_EXTENSIONS = [
    ".aoe2scenario",
    ".aoe2record",
    ".mgz",
    ".mgx",
    ".mgl",
    ".scx",
    ".scn",
  ];

  const BOOL_NAMES = [
    "draw_cliffs",
    "draw_walls",
    "smooth_walls",
    "draw_players",
    "draw_gaia",
    "draw_food",
    "draw_gold",
    "draw_stone",
    "draw_relics",
    "resize_output",
  ];

  const NUM_SYNC = [
    ["angle", "angle_num"],
    ["multiplier_integer", "multiplier_integer_num"],
    ["orthographic_ratio", "orthographic_ratio_num"],
    ["border_spacing", "border_spacing_num"],
    ["cliff_size", "cliff_size_num"],
    ["player_wall_size", "player_wall_size_num"],
    ["food_size", "food_size_num"],
    ["gold_size", "gold_size_num"],
    ["stone_size", "stone_size_num"],
    ["relic_size", "relic_size_num"],
    ["player_object_size", "player_object_size_num"],
    ["town_center_size", "town_center_size_num"],
    ["civ_emblem_halo", "civ_emblem_halo_num"],
  ];

  const INT_BOUNDS = {
    angle: [0, 360],
    multiplier_integer: [1, 10],
    orthographic_ratio: [1, 10],
    border_spacing: [0, 64],
    cliff_size: [0, 32],
    player_wall_size: [0, 32],
    relic_size: [0, 64],
    stone_size: [0, 64],
    gold_size: [0, 64],
    food_size: [0, 64],
    player_object_size: [0, 64],
    town_center_size: [0, 64],
    civ_emblem_halo: [0, 512],
    final_width: [64, 8192],
    final_height: [64, 8192],
  };

  const RAINBOW_URL = "/mcminimap/assets/rainbow.png";

  // ---------- DOM references ----------------------------------------------

  const form = document.getElementById("form");
  const fileInput = document.getElementById("file");
  const dropzone = document.getElementById("dropzone");
  const browseBtn = document.getElementById("browse-btn");
  const fileMeta = document.getElementById("file-meta");
  const statusBar = document.getElementById("statusbar");
  const statusText = document.getElementById("status");
  const progressFill = statusBar.querySelector(".statusbar__fill");
  const imgEl = document.getElementById("img");
  const submitBtn = document.getElementById("submit");
  const advancedToggle = document.getElementById("advanced-toggle");
  const advancedBody = document.getElementById("advanced-body");
  const advancedLabel = advancedToggle.querySelector(".advanced__label");
  const presetButtons = Array.prototype.slice.call(document.querySelectorAll(".preset-btn"));
  const tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  const panelGenerate = document.getElementById("panel-generate");
  const panelGallery = document.getElementById("panel-gallery");
  const galleryGrid = document.getElementById("gallery-grid");
  const galleryRefresh = document.getElementById("gallery-refresh");

  // ---------- state -------------------------------------------------------

  let lastObjectUrl = null;
  let busy = false;
  let worker = null;
  let pendingId = 0;
  const pending = new Map();
  let lastRenderedFingerprint = null;
  let currentFingerprint = "";
  let galleryLoaded = false;
  let progressHideTimer = 0;
  let bootDone = false;

  // ---------- utility -----------------------------------------------------

  function formatBytes(n) {
    if (!Number.isFinite(n) || n < 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function fileExtension(name) {
    if (!name) return "";
    const idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(idx).toLowerCase() : "";
  }

  function isSupported(file) {
    return SUPPORTED_EXTENSIONS.indexOf(fileExtension(file.name)) !== -1;
  }

  // ---------- status + progress ------------------------------------------

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

  // ---------- render-button state ----------------------------------------

  function buttonState() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return "no-file";
    if (!isSupported(file)) return "unsupported";
    if (
      lastRenderedFingerprint &&
      lastRenderedFingerprint === currentFingerprint
    ) {
      return "rendered";
    }
    return lastRenderedFingerprint ? "dirty" : "ready";
  }

  function applyButtonState() {
    if (busy) return;
    const state = buttonState();
    switch (state) {
      case "no-file":
      case "unsupported":
        submitBtn.disabled = true;
        submitBtn.textContent = "Render minimap";
        break;
      case "ready":
        submitBtn.disabled = false;
        submitBtn.textContent = "Render minimap";
        break;
      case "rendered":
        submitBtn.disabled = true;
        submitBtn.textContent = "Rendered";
        break;
      case "dirty":
        submitBtn.disabled = false;
        submitBtn.textContent = "Render again";
        break;
    }
  }

  function setBusy(on) {
    busy = on;
    if (on) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Rendering\u2026";
    } else {
      applyButtonState();
    }
    dropzone.classList.toggle("is-disabled", on);
    dropzone.tabIndex = on ? -1 : 0;
    browseBtn.disabled = on;
  }

  // ---------- file / dropzone --------------------------------------------

  function setImageFromBlob(blob) {
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(blob);
    imgEl.src = lastObjectUrl;
  }

  function resetImage() {
    if (lastObjectUrl) {
      URL.revokeObjectURL(lastObjectUrl);
      lastObjectUrl = null;
    }
    imgEl.src = RAINBOW_URL;
  }

  function updateFileMeta() {
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      fileMeta.textContent = "No file selected";
      fileMeta.classList.remove("is-set");
    } else {
      fileMeta.textContent = f.name + " \u00b7 " + formatBytes(f.size);
      fileMeta.classList.add("is-set");
    }
    // A new (different) file invalidates any prior render.
    lastRenderedFingerprint = null;
    refreshFingerprint();
  }

  function assignFile(file) {
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    updateFileMeta();
  }

  function openFilePicker() {
    fileInput.click();
  }

  // ---------- presets ----------------------------------------------------

  function setRangePair(rangeId, numId, value) {
    const r = document.getElementById(rangeId);
    const n = document.getElementById(numId);
    r.value = String(value);
    n.value = String(value);
  }

  function setSelect(id, value) {
    document.getElementById(id).value = value;
  }

  function setCheckbox(name, checked) {
    const el = form.querySelector('[name="' + name + '"]');
    if (el) el.checked = checked;
  }

  function applyBaseline() {
    setSelect("object_mode", "square");
    setSelect("town_center", "pixel");
    setRangePair("angle", "angle_num", 45);
    setRangePair("multiplier_integer", "multiplier_integer_num", 9);
    setRangePair("orthographic_ratio", "orthographic_ratio_num", 2);
    setRangePair("border_spacing", "border_spacing_num", 4);
    BOOL_NAMES.forEach(function (name) {
      setCheckbox(name, name !== "resize_output");
    });
    setRangePair("cliff_size", "cliff_size_num", 1);
    setRangePair("player_wall_size", "player_wall_size_num", 1);
    setRangePair("food_size", "food_size_num", 4);
    setRangePair("gold_size", "gold_size_num", 4);
    setRangePair("stone_size", "stone_size_num", 4);
    setRangePair("relic_size", "relic_size_num", 4);
    setRangePair("player_object_size", "player_object_size_num", 4);
    setRangePair("town_center_size", "town_center_size_num", 4);
    setRangePair("civ_emblem_halo", "civ_emblem_halo_num", 40);
  }

  function applyPreset(preset) {
    applyBaseline();
    if (preset === "tactical") {
      setRangePair("orthographic_ratio", "orthographic_ratio_num", 1);
    } else if (preset === "square") {
      setRangePair("angle", "angle_num", 0);
      setRangePair("orthographic_ratio", "orthographic_ratio_num", 1);
    }
    presetButtons.forEach(function (btn) {
      const id = btn.getAttribute("data-preset");
      btn.setAttribute("aria-checked", id === preset ? "true" : "false");
    });
    refreshFingerprint();
  }

  // ---------- form -> settings -------------------------------------------

  function clampInt(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.trunc(n)));
  }

  function readBool(name, def) {
    const el = form.querySelector('[name="' + name + '"]');
    if (!el) return def;
    return !!el.checked;
  }

  function readInt(name) {
    const bounds = INT_BOUNDS[name];
    const el = document.getElementById(name);
    const raw = el ? el.value : undefined;
    return clampInt(raw, bounds[0], bounds[1]);
  }

  function readEnum(id, allowed, def) {
    const el = document.getElementById(id);
    const v = el ? el.value : def;
    return allowed.indexOf(v) >= 0 ? v : def;
  }

  function buildSettings() {
    const resize = readBool("resize_output", false);
    const settings = {
      object_mode: readEnum("object_mode", ["square", "rotated"], "square"),
      town_center: readEnum("town_center", ["none", "pixel", "emblem"], "pixel"),
      angle: readInt("angle"),
      multiplier_integer: readInt("multiplier_integer"),
      orthographic_ratio: readInt("orthographic_ratio"),
      border_spacing: readInt("border_spacing"),
      draw_cliffs: readBool("draw_cliffs", true),
      draw_walls: readBool("draw_walls", true),
      smooth_walls: readBool("smooth_walls", true),
      draw_players: readBool("draw_players", true),
      draw_gaia: readBool("draw_gaia", true),
      draw_food: readBool("draw_food", true),
      draw_gold: readBool("draw_gold", true),
      draw_stone: readBool("draw_stone", true),
      draw_relics: readBool("draw_relics", true),
      cliff_size: readInt("cliff_size"),
      player_wall_size: readInt("player_wall_size"),
      relic_size: readInt("relic_size"),
      stone_size: readInt("stone_size"),
      gold_size: readInt("gold_size"),
      food_size: readInt("food_size"),
      player_object_size: readInt("player_object_size"),
      town_center_size: readInt("town_center_size"),
      civ_emblem_halo: readInt("civ_emblem_halo"),
    };
    if (resize) {
      settings.final_size = [readInt("final_width"), readInt("final_height")];
    }
    return settings;
  }

  function computeFingerprint() {
    const file = fileInput.files && fileInput.files[0];
    const fileKey = file
      ? { name: file.name, size: file.size, lastModified: file.lastModified }
      : null;
    return JSON.stringify({ file: fileKey, settings: buildSettings() });
  }

  function refreshFingerprint() {
    currentFingerprint = computeFingerprint();
    applyButtonState();
  }

  // ---------- bindings ---------------------------------------------------

  function bindRange(rangeId, numberId) {
    const r = document.getElementById(rangeId);
    const n = document.getElementById(numberId);
    r.addEventListener("input", function () {
      n.value = r.value;
      refreshFingerprint();
    });
    n.addEventListener("input", function () {
      r.value = n.value;
      refreshFingerprint();
    });
  }

  NUM_SYNC.forEach(function (pair) {
    bindRange(pair[0], pair[1]);
  });

  // Any other input change (selects, checkboxes, bare number inputs) updates
  // the fingerprint too.
  form.addEventListener("input", refreshFingerprint);
  form.addEventListener("change", refreshFingerprint);

  presetButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyPreset(btn.getAttribute("data-preset"));
    });
  });
  applyPreset("ingame");

  dropzone.addEventListener("click", function (e) {
    if (busy) return;
    if (e.target === browseBtn) return;
    openFilePicker();
  });
  browseBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!busy) openFilePicker();
  });
  dropzone.addEventListener("keydown", function (e) {
    if (busy) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      if (busy) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      dropzone.classList.add("is-dragover");
    });
  });
  dropzone.addEventListener("dragleave", function () {
    dropzone.classList.remove("is-dragover");
  });
  dropzone.addEventListener("drop", function (e) {
    if (busy) return;
    e.preventDefault();
    dropzone.classList.remove("is-dragover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) assignFile(f);
  });

  fileInput.addEventListener("change", updateFileMeta);
  updateFileMeta();

  advancedToggle.addEventListener("click", function () {
    const open = !advancedBody.classList.contains("is-open");
    advancedBody.classList.toggle("is-open", open);
    advancedToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (advancedLabel) {
      advancedLabel.textContent = open ? "Hide advanced" : "Show advanced";
    }
  });

  // ---------- tabs -------------------------------------------------------

  function selectTab(name) {
    tabs.forEach(function (t) {
      const active = t.getAttribute("data-tab") === name;
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    panelGenerate.hidden = name !== "generate";
    panelGallery.hidden = name !== "gallery";
    if (name === "gallery" && !galleryLoaded) {
      loadGallery();
    }
  }

  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      selectTab(t.getAttribute("data-tab"));
    });
  });

  if (galleryRefresh) {
    galleryRefresh.addEventListener("click", function () {
      loadGallery();
    });
  }

  // ---------- web worker RPC ---------------------------------------------

  const BOOT_TOTAL_DEFAULT = 6;

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("/mcminimap/worker.js");
    worker.onmessage = function (ev) {
      const msg = ev.data || {};
      if (msg.type === "progress") {
        if (msg.phase === "boot" && !bootDone) {
          const total = msg.total || BOOT_TOTAL_DEFAULT;
          const step = Math.max(1, msg.step || 1);
          const pct = Math.min(95, Math.round((step / total) * 95));
          setProgress(pct, { autoHide: false });
          setStatus(msg.message || "Loading\u2026", "loading");
          if (step >= total) {
            bootDone = true;
            setProgress(100, { holdMs: 300 });
            setStatus("Ready", "success");
          }
        } else if (msg.phase === "render") {
          setStatus(msg.message || "Rendering\u2026", "loading");
          if (typeof msg.pct === "number") setProgress(msg.pct, { autoHide: false });
        } else if (msg.phase === "error") {
          setProgress(100, { error: true, holdMs: 1500 });
          setStatus(msg.message || "Error", "error");
        } else {
          setStatus(msg.message || "\u2026", "loading");
        }
        return;
      }
      if (msg.type === "result") {
        const entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.ok) entry.resolve(msg.png);
        else entry.reject(new Error(msg.error || "Render failed."));
      }
    };
    worker.onerror = function (e) {
      pending.forEach(function (entry) {
        entry.reject(new Error(e.message || "Worker error"));
      });
      pending.clear();
      setProgress(100, { error: true, holdMs: 1200 });
      setStatus(e.message || "Worker error", "error");
    };
    return worker;
  }

  function callRender(fileBytes, ext, settings) {
    ensureWorker();
    const id = ++pendingId;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      worker.postMessage(
        { type: "render", id: id, fileBytes: fileBytes, ext: ext, settings: settings },
        [fileBytes],
      );
    });
  }

  // ---------- gallery ----------------------------------------------------

  function formatShortDate(ms) {
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function renderGallery(entries) {
    galleryGrid.textContent = "";
    if (!entries || entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No minimaps yet \u2014 render one and it will appear here.";
      galleryGrid.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    entries.forEach(function (entry) {
      const fig = document.createElement("figure");
      fig.className = "card-img";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = entry.sourceName + " minimap";
      img.src = "/api/gallery/" + encodeURIComponent(entry.id);

      const cap = document.createElement("figcaption");
      const src = document.createElement("span");
      src.className = "src";
      src.textContent = entry.sourceName || "unknown";
      src.title = entry.sourceName || "unknown";
      const time = document.createElement("time");
      time.dateTime = new Date(entry.createdAt).toISOString();
      time.textContent = formatShortDate(entry.createdAt);
      cap.appendChild(src);
      cap.appendChild(time);

      fig.appendChild(img);
      fig.appendChild(cap);
      frag.appendChild(fig);
    });
    galleryGrid.appendChild(frag);
  }

  async function loadGallery() {
    galleryLoaded = true;
    galleryGrid.textContent = "";
    const loading = document.createElement("div");
    loading.className = "empty";
    loading.textContent = "Loading\u2026";
    galleryGrid.appendChild(loading);
    try {
      const res = await fetch("/api/gallery", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const entries = await res.json();
      renderGallery(Array.isArray(entries) ? entries : []);
    } catch (err) {
      galleryGrid.textContent = "";
      const box = document.createElement("div");
      box.className = "error-state";
      box.textContent =
        "Could not load gallery: " + (err && err.message ? err.message : String(err));
      galleryGrid.appendChild(box);
    }
  }

  function uploadToGallery(blob, sourceName) {
    // Fire-and-forget; never blocks the UI on a failure.
    fetch("/api/gallery", {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Source-Name": encodeURIComponent(sourceName || "unknown"),
      },
      body: blob,
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        galleryLoaded = false;
        if (!panelGallery.hidden) loadGallery();
      })
      .catch(function (err) {
        console.warn("[gallery] upload failed:", err);
      });
  }

  // ---------- submit -----------------------------------------------------

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      setStatus("Pick a file first.", "error");
      return;
    }
    if (!isSupported(file)) {
      setStatus(
        "Unsupported file: " + (fileExtension(file.name) || "no extension"),
        "error",
      );
      return;
    }

    const fingerprint = computeFingerprint();
    setBusy(true);
    setStatus("Preparing\u2026", "loading");
    setProgress(10, { autoHide: false });

    try {
      const settings = buildSettings();
      const ext = fileExtension(file.name);
      const bytes = await file.arrayBuffer();
      setProgress(30, { autoHide: false });
      setStatus("Rendering\u2026", "loading");
      const png = await callRender(bytes, ext, settings);
      setProgress(90, { autoHide: false });
      const blob = new Blob([png], { type: "image/png" });
      setImageFromBlob(blob);
      lastRenderedFingerprint = fingerprint;
      refreshFingerprint();
      setProgress(100, { holdMs: 400 });
      setStatus("Done", "success");
      uploadToGallery(blob, file.name);
    } catch (err) {
      resetImage();
      setProgress(100, { error: true, holdMs: 1500 });
      setStatus(err && err.message ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  });

  // ---------- startup ----------------------------------------------------

  refreshFingerprint();
  setProgress(2, { autoHide: false });
  setStatus("Loading runtime\u2026", "loading");
  ensureWorker();
  worker.postMessage({ type: "warmup" });
})();
