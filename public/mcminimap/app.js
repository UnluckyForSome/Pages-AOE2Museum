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

  const form = document.getElementById("form");
  const fileInput = document.getElementById("file");
  const dropzone = document.getElementById("dropzone");
  const browseBtn = document.getElementById("browse-btn");
  const fileMeta = document.getElementById("file-meta");
  const statusEl = document.getElementById("status");
  const imgEl = document.getElementById("img");
  const phEl = document.getElementById("placeholder");
  const submitBtn = document.getElementById("submit");
  const loadingOverlay = document.getElementById("loading-overlay");
  const loadingOverlayMsg = document.getElementById("loading-overlay-msg");
  const advancedToggle = document.getElementById("advanced-toggle");
  const advancedCollapsible = document.getElementById("advanced-collapsible");
  const advancedToggleLabel = advancedToggle.querySelector(".btn-advanced-toggle-label");
  const presetButtons = Array.prototype.slice.call(document.querySelectorAll(".preset-btn"));

  let lastObjectUrl = null;
  let busy = false;
  let worker = null;
  let pendingId = 0;
  const pending = new Map();

  // -------- status + file metadata ---------------------------------------

  function formatBytes(n) {
    if (!Number.isFinite(n) || n < 0) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function setStatus(text, tone) {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (tone ? " status--" + tone : "");
  }

  function setBusy(on, overlayMessage) {
    busy = on;
    submitBtn.disabled = on;
    dropzone.classList.toggle("is-disabled", on);
    dropzone.tabIndex = on ? -1 : 0;
    browseBtn.disabled = on;
    loadingOverlay.classList.toggle("is-active", on);
    loadingOverlay.setAttribute("aria-hidden", on ? "false" : "true");
    if (loadingOverlayMsg) {
      loadingOverlayMsg.textContent = on
        ? overlayMessage || "Generating minimap\u2026"
        : "Generating minimap\u2026";
    }
  }

  function setImageFromBlob(blob) {
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(blob);
    imgEl.src = lastObjectUrl;
  }

  function fileExtension(name) {
    if (!name) return "";
    const idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(idx).toLowerCase() : "";
  }

  function isSupported(file) {
    return SUPPORTED_EXTENSIONS.indexOf(fileExtension(file.name)) !== -1;
  }

  function syncIdleStatusFromFile() {
    if (busy) return;
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      setStatus("Awaiting file", "idle");
    } else if (!isSupported(f)) {
      setStatus(
        "Unsupported file: " + (fileExtension(f.name) || "no extension"),
        "error",
      );
    } else {
      setStatus("Ready to render", "ready");
    }
  }

  function setFileMetaText() {
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      fileMeta.textContent = "No file selected";
    } else {
      fileMeta.textContent = f.name + " \u00b7 " + formatBytes(f.size);
    }
    syncIdleStatusFromFile();
  }

  function assignFile(file) {
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    setFileMetaText();
  }

  function openFilePicker() {
    fileInput.click();
  }

  // -------- presets ------------------------------------------------------

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
  }

  // -------- bindings -----------------------------------------------------

  function bindRange(rangeId, numberId) {
    const r = document.getElementById(rangeId);
    const n = document.getElementById(numberId);
    r.addEventListener("input", function () {
      n.value = r.value;
    });
    n.addEventListener("input", function () {
      r.value = n.value;
    });
  }

  NUM_SYNC.forEach(function (pair) {
    bindRange(pair[0], pair[1]);
  });

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

  fileInput.addEventListener("change", setFileMetaText);
  setFileMetaText();

  advancedToggle.addEventListener("click", function () {
    const open = !advancedCollapsible.classList.contains("is-open");
    advancedCollapsible.classList.toggle("is-open", open);
    advancedToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (advancedToggleLabel) {
      advancedToggleLabel.textContent = open ? "Hide advanced" : "Show advanced";
    }
  });

  // -------- web worker RPC ----------------------------------------------

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("/mcminimap/worker.js");
    worker.onmessage = function (ev) {
      const msg = ev.data || {};
      if (msg.type === "progress") {
        setStatus(msg.message || "Working\u2026", "loading");
        if (loadingOverlayMsg) loadingOverlayMsg.textContent = msg.message || "Working\u2026";
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

  // -------- form -> settings --------------------------------------------

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

  // -------- submit -------------------------------------------------------

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

    setStatus("Preparing render\u2026", "loading");
    setBusy(true, "Preparing render\u2026");
    imgEl.style.display = "none";
    phEl.style.display = "none";

    try {
      const settings = buildSettings();
      const ext = fileExtension(file.name);
      const bytes = await file.arrayBuffer();
      const png = await callRender(bytes, ext, settings);
      const blob = new Blob([png], { type: "image/png" });
      setImageFromBlob(blob);
      imgEl.style.display = "block";
      phEl.style.display = "none";
      setStatus("Done \u2014 minimap is ready.", "success");
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), "error");
      phEl.style.display = "block";
    } finally {
      setBusy(false);
    }
  });

  // Kick the worker in the background so the first render is faster.
  ensureWorker();
  worker.postMessage({ type: "warmup" });
})();
