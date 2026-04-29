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
  const openScenarioModalBtn = document.getElementById("open-scenario-modal");
  const openAocrecModalBtn = document.getElementById("open-aocrec-modal");
  const openMicrosoftModalBtn = document.getElementById("open-microsoft-modal");
  const scenarioModal = document.getElementById("scenario-modal");
  const aocrecModal = document.getElementById("aocrec-modal");
  const microsoftModal = document.getElementById("microsoft-modal");
  const scenarioSelectBtn = document.getElementById("scenario-select-btn");
  const aocrecSelectBtn = document.getElementById("aocrec-select-btn");
  const msSelectBtn = document.getElementById("ms-select-btn");
  const scenarioSearch = document.getElementById("scenario-search");
  const scenarioList = document.getElementById("scenario-list");
  const aocrecList = document.getElementById("aocrec-list");
  const msProfileSearch = document.getElementById("ms-profile-search");
  const msProfileList = document.getElementById("ms-profile-list");
  const msProfileLoading = document.getElementById("ms-profile-loading");
  const msMatchList = document.getElementById("ms-match-list");
  const msMatchLoading = document.getElementById("ms-match-loading");
  const scenarioLoading = document.getElementById("scenario-loading");
  const aocrecLoadingEl = document.getElementById("aocrec-loading");

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

  // ---------- modal helpers -----------------------------------------------

  function isModalOpen(backdrop) {
    return !!(backdrop && backdrop.hidden === false);
  }

  function openModal(backdrop, focusEl) {
    if (!backdrop) return;
    backdrop.hidden = false;
    document.documentElement.classList.add("modal-open");
    try {
      const btn = backdrop.querySelector("[data-modal-close]");
      if (btn) btn.blur();
    } catch (_) {}
    if (focusEl && typeof focusEl.focus === "function") {
      setTimeout(function () { try { focusEl.focus(); } catch (_) {} }, 0);
    }
  }

  function closeModal(backdrop) {
    if (!backdrop) return;
    backdrop.hidden = true;
    document.documentElement.classList.remove("modal-open");
  }

  function wireModal(backdrop) {
    if (!backdrop) return;
    backdrop.addEventListener("click", function (ev) {
      if (ev.target === backdrop) closeModal(backdrop);
      const close = ev.target.closest && ev.target.closest("[data-modal-close]");
      if (close) closeModal(backdrop);
    });
  }

  function parseFilenameFromContentDisposition(header) {
    if (!header) return "";
    // Prefer RFC 5987 filename* when present.
    const star = header.match(/filename\*\s*=\s*([^;]+)/i);
    if (star) {
      const raw = star[1].trim();
      // Example: UTF-8''foo%20bar.scx
      const parts = raw.split("''");
      const encoded = parts.length === 2 ? parts[1] : raw;
      const cleaned = encoded.replace(/^"(.*)"$/, "$1");
      try { return decodeURIComponent(cleaned); } catch { return cleaned; }
    }
    const plain = header.match(/filename\s*=\s*([^;]+)/i);
    if (!plain) return "";
    return plain[1].trim().replace(/^"(.*)"$/, "$1");
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
        submitBtn.textContent = "Render Minimap";
        break;
      case "ready":
        submitBtn.disabled = false;
        submitBtn.textContent = "Render Minimap";
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
    if (scenarioSearch) scenarioSearch.disabled = on;
    if (scenarioList) scenarioList.setAttribute("aria-disabled", on ? "true" : "false");
    if (openScenarioModalBtn) openScenarioModalBtn.disabled = on;
    if (openAocrecModalBtn) openAocrecModalBtn.disabled = on;
    if (openMicrosoftModalBtn) openMicrosoftModalBtn.disabled = on;
    if (aocrecList) aocrecList.setAttribute("aria-disabled", on ? "true" : "false");
    if (msProfileSearch) msProfileSearch.disabled = on;
    if (msProfileList) msProfileList.setAttribute("aria-disabled", on ? "true" : "false");
    if (msMatchList) msMatchList.setAttribute("aria-disabled", on ? "true" : "false");
    if (msSelectBtn) msSelectBtn.disabled = on || !msSelectedProfileId || !msSelectedMatchId;
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

  // ---------- scenario picker (archive) -----------------------------------

  const PICKER_MAX_ROWS = 500;
  let scenarioIndex = []; // { id, filename, label }[]
  let scenarioById = new Map();
  let scenarioPickerSelectedId = "";

  function updateScenarioSearchPlaceholder() {
    if (!scenarioSearch) return;
    const n = scenarioIndex.length;
    scenarioSearch.placeholder =
      n > 0 ? "Search " + n + " scenarios..." : "Search scenarios...";
  }

  function paintScenarioPicker(options, activeIdx, selectedId) {
    if (!scenarioList) return;
    scenarioList.textContent = "";
    if (!options || options.length === 0) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      li.textContent = scenarioSearch && scenarioSearch.value.trim() ? "Nothing matches" : "No scenarios available";
      li.setAttribute("role", "presentation");
      scenarioList.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const li = document.createElement("li");
      li.className = "picker__option";
      li.setAttribute("role", "option");
      li.setAttribute("data-idx", String(i));
      li.setAttribute("data-id", opt.id);
      li.textContent = opt.label;
      if (opt.id === selectedId) li.setAttribute("aria-current", "true");
      li.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
      frag.appendChild(li);
    }
    scenarioList.appendChild(frag);
  }

  async function importSelectedScenario() {
    const id = scenarioPickerSelectedId;
    if (!id) return;
    if (busy) {
      setStatus("Busy rendering \u2014 wait for it to finish.", "error");
      return;
    }
    const entry = scenarioById.get(id);
    if (!entry) return;

    setStatus("Downloading scenario\u2026", "loading");
    setProgress(10, { autoHide: false });

    try {
      const res = await fetch("/api/scenarios/download/" + encodeURIComponent(id), { cache: "no-store" });
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ")");
      setProgress(35, { autoHide: false });
      const blob = await res.blob();
      setProgress(70, { autoHide: false });

      const cd = res.headers.get("content-disposition");
      const fromHeader = parseFilenameFromContentDisposition(cd);
      const filename = fromHeader || entry.filename || "scenario";
      const file = new File([blob], filename, {
        type: blob.type || "application/octet-stream",
        lastModified: Date.now(),
      });
      assignFile(file);
      closeModal(scenarioModal);
      setProgress(100, { holdMs: 350 });
      setStatus("Ready", "success");
    } catch (err) {
      setProgress(100, { holdMs: 1200 });
      setStatus(err && err.message ? err.message : String(err), "error");
    }
  }

  function createScenarioPicker() {
    if (!scenarioSearch || !scenarioList) return null;

    let current = [];
    let activeIdx = -1;

    function filtered() {
      const q = scenarioSearch.value.trim().toLowerCase();
      const pool = scenarioIndex || [];
      const matches = q
        ? pool.filter(function (s) { return s.label.toLowerCase().includes(q); })
        : pool.slice();
      return matches.slice(0, PICKER_MAX_ROWS);
    }

    function render() {
      current = filtered();
      if (current.length === 0) activeIdx = -1;
      else {
        const selIdx = scenarioPickerSelectedId
          ? current.findIndex(function (s) { return s.id === scenarioPickerSelectedId; })
          : -1;
        activeIdx = selIdx >= 0 ? selIdx : 0;
      }
      paintScenarioPicker(current, activeIdx, scenarioPickerSelectedId);
      if (activeIdx >= 0) {
        const nodes = scenarioList.querySelectorAll(".picker__option[role='option']");
        if (nodes[activeIdx] && typeof nodes[activeIdx].scrollIntoView === "function") {
          nodes[activeIdx].scrollIntoView({ block: "nearest" });
        }
      }
    }

    function selectAll() { try { scenarioSearch.select(); } catch (_) {} }
    scenarioSearch.addEventListener("focus", selectAll);
    scenarioSearch.addEventListener("click", selectAll);

    scenarioSearch.addEventListener("input", render);
    scenarioSearch.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (current.length === 0) return;
        activeIdx = (activeIdx + 1) % current.length;
        paintScenarioPicker(current, activeIdx, scenarioPickerSelectedId);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (current.length === 0) return;
        activeIdx = (activeIdx - 1 + current.length) % current.length;
        paintScenarioPicker(current, activeIdx, scenarioPickerSelectedId);
      } else if (ev.key === "Enter") {
        if (activeIdx >= 0 && current[activeIdx]) {
          ev.preventDefault();
          commit(current[activeIdx].id);
        }
      } else if (ev.key === "Escape") {
        if (scenarioSearch.value) {
          ev.preventDefault();
          scenarioSearch.value = "";
          render();
        }
      }
    });

    scenarioList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !scenarioList.contains(li)) return;
      const id = li.getAttribute("data-id") || "";
      if (id) commit(id);
    });

    function commit(id) {
      if (!id) return;
      scenarioPickerSelectedId = id;
      render();
      if (scenarioSelectBtn) scenarioSelectBtn.disabled = false;
    }

    render();
    return { render: render };
  }

  const scenarioPicker = createScenarioPicker();

  async function loadScenarioIndex() {
    if (!scenarioSearch || !scenarioList) return;
    setPickerShellLoading(scenarioLoading, scenarioList, true);
    try {
      const res = await fetch("/api/scenarios", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      const list = Array.isArray(rows) ? rows : [];
      scenarioIndex = list
        .filter(function (s) { return s && s.id != null && s.filename; })
        .map(function (s) {
          return {
            id: String(s.id),
            filename: String(s.filename),
            label: String(s.filename),
          };
        });
      scenarioById = new Map(scenarioIndex.map(function (s) { return [s.id, s]; }));
      updateScenarioSearchPlaceholder();
      if (scenarioPicker) scenarioPicker.render();
    } catch (err) {
      scenarioIndex = [];
      scenarioById = new Map();
      updateScenarioSearchPlaceholder();
      // Do not block dropzone usage; just show status quietly.
      console.warn("[scenarios] index load failed:", err);
      if (scenarioPicker) scenarioPicker.render();
    } finally {
      setPickerShellLoading(scenarioLoading, scenarioList, false);
    }
  }

  // ---------- aocrec modal -------------------------------------------------

  let aocrecLoaded = false;
  let aocrecLoading = false;
  let aocrecRows = []; // { id, guid, label, zipUrl }[]
  let aocrecPickerSelectedId = "";

  function formatDuration(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "";
    const s = Math.round(n / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = function (x) { return String(x).padStart(2, "0"); };
    return hh > 0 ? hh + ":" + pad(mm) + ":" + pad(ss) : mm + ":" + pad(ss);
  }

  function formatAocrecRow(r) {
    // [MM/DD HH:MM] - [matchup] on [mapName]
    const parts = [];
    const when = r.gameDate != null ? r.gameDate : r.uploadedAt;
    if (when) {
      try {
        const d = new Date(when);
        if (!Number.isNaN(d.getTime())) {
          const pad = function (x) { return String(x).padStart(2, "0"); };
          parts.push(pad(d.getMonth() + 1) + "/" + pad(d.getDate()));
          parts.push(pad(d.getHours()) + ":" + pad(d.getMinutes()));
        }
      } catch (_) {}
    }
    const left = parts.length >= 2 ? (parts[0] + " " + parts[1]) : (parts[0] || "");
    const grouping = r.matchup ? String(r.matchup) : "";
    const map = r.mapName ? String(r.mapName) : "";
    const uploadedBy = r.uploadedBy ? String(r.uploadedBy) : "";
    const suffix = uploadedBy ? (" uploaded by " + uploadedBy) : "";
    if (left && grouping && map) return left + " - " + grouping + " on " + map + suffix;
    if (left && grouping) return left + " - " + grouping + suffix;
    if (left && map) return left + " - " + map + suffix;
    const core = (grouping && map) ? (grouping + " on " + map) : (grouping || map || String(r.id));
    return core + suffix;
  }

  function paintAocrecPicker(options, activeIdx, selectedId) {
    if (!aocrecList) return;
    aocrecList.textContent = "";
    if (!options || options.length === 0) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      li.textContent = aocrecLoaded ? "No recordings" : "Loading...";
      li.setAttribute("role", "presentation");
      aocrecList.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const li = document.createElement("li");
      li.className = "picker__option";
      li.setAttribute("role", "option");
      li.setAttribute("data-idx", String(i));
      li.setAttribute("data-id", opt.id);
      li.textContent = opt.label;
      if (opt.id === selectedId) li.setAttribute("aria-current", "true");
      li.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
      frag.appendChild(li);
    }
    aocrecList.appendChild(frag);
  }

  async function importSelectedAocrec() {
    const id = aocrecPickerSelectedId;
    if (!id) return;
    if (busy) {
      setStatus("Busy rendering \u2014 wait for it to finish.", "error");
      return;
    }
    const row = (aocrecRows || []).find(function (r) { return r.id === id; });
    if (!row || !row.zipUrl) return;

    setStatus("Downloading recording\u2026", "loading");
    setProgress(10, { autoHide: false });

    try {
      const res = await fetch(
        "/api/aocrec/zip?url=" + encodeURIComponent(row.zipUrl),
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ")");
      const buf = await res.arrayBuffer();
      setProgress(55, { autoHide: false });

      const u8 = new Uint8Array(buf);
      const z = globalThis.fflate;
      if (!z || typeof z.unzipSync !== "function") {
        throw new Error("ZIP support not loaded.");
      }

      const files = z.unzipSync(u8);
      const names = Object.keys(files || {});
      const picked = names
        .filter(function (n) {
          const lower = String(n).toLowerCase();
          return lower.endsWith(".mgz") || lower.endsWith(".mgx") || lower.endsWith(".mgl");
        })
        .sort(function (a, b) { return a.localeCompare(b); })[0];

      if (!picked) {
        throw new Error("Zip did not contain a .mgz/.mgx/.mgl file.");
      }

      const bytes = files[picked];
      const file = new File([bytes], picked.split("/").pop() || picked, {
        type: "application/octet-stream",
        lastModified: Date.now(),
      });

      assignFile(file);
      closeModal(aocrecModal);
      setProgress(100, { holdMs: 350 });
      setStatus("Ready", "success");
    } catch (err) {
      setProgress(100, { holdMs: 1200 });
      setStatus(err && err.message ? err.message : String(err), "error");
    }
  }

  function createAocrecPicker() {
    if (!aocrecList) return null;
    let current = [];
    let activeIdx = -1;
    let selectedId = "";

    function render() {
      current = (aocrecRows || []).slice(0, PICKER_MAX_ROWS);
      if (current.length === 0) activeIdx = -1;
      else activeIdx = 0;
      paintAocrecPicker(current, activeIdx, selectedId);
    }

    aocrecList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !aocrecList.contains(li)) return;
      const id = li.getAttribute("data-id") || "";
      if (id) commit(id);
    });

    function commit(id) {
      selectedId = id || "";
      aocrecPickerSelectedId = selectedId;
      paintAocrecPicker(current, activeIdx, selectedId);
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = !selectedId;
    }

    render();
    return { render: render, setRows: function (rows) { aocrecRows = rows || []; render(); } };
  }

  const aocrecPicker = createAocrecPicker();

  async function loadAocrecRecent() {
    if (aocrecLoaded || aocrecLoading) return;
    aocrecLoading = true;
    setPickerShellLoading(aocrecLoadingEl, aocrecList, true);
    try {
      const res = await fetch("/api/aocrec/recent?size=20", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      const list = Array.isArray(rows) ? rows : [];
      aocrecRows = list
        .filter(function (r) { return r && r.id && r.zipUrl; })
        .map(function (r) {
          return {
            id: String(r.id),
            guid: r.guid ? String(r.guid) : "",
            zipUrl: String(r.zipUrl),
            mapName: r.mapName ? String(r.mapName) : "",
            gameDate: r.gameDate,
            uploadedAt: r.uploadedAt,
            uploadedBy: r.uploadedBy ? String(r.uploadedBy) : "",
            label: formatAocrecRow(r),
          };
        });
      aocrecLoaded = true;
      if (aocrecPicker) aocrecPicker.setRows(aocrecRows);
    } catch (err) {
      aocrecLoaded = true;
      aocrecRows = [];
      if (aocrecPicker) aocrecPicker.setRows([]);
      console.warn("[aocrec] recent load failed:", err);
    } finally {
      aocrecLoading = false;
      setPickerShellLoading(aocrecLoadingEl, aocrecList, false);
    }
  }

  // ---------- Microsoft modal ---------------------------------------------

  let msProfiles = []; // { profileId, alias, platformName }
  let msMatches = []; // { matchId, startedAt, mapName, matchup, civilizationId, civilizationName, ... }
  let msSelectedProfileId = 0;
  let msSelectedMatchId = 0;
  let msProfileActiveIdx = -1;
  let msMatchActiveIdx = -1;
  let msProfileDebounce = 0;
  let msProfileFetchSeq = 0;

  function setPickerShellLoading(loadingEl, listEl, on) {
    if (loadingEl) loadingEl.hidden = !on;
    if (listEl) listEl.setAttribute("aria-busy", on ? "true" : "false");
  }

  function setMsProfileSearchLoading(on) {
    setPickerShellLoading(msProfileLoading, msProfileList, on);
  }

  function msFormatPlatformName(name) {
    if (!name) return "";
    const s = String(name);
    if (s.startsWith("/steam/")) return "Steam";
    if (s.startsWith("/xbox/")) return "Xbox";
    if (s.startsWith("/playstation/")) return "PlayStation";
    return s.replace(/^\//, "");
  }

  function msPlatformKey(name) {
    if (!name) return "other";
    const s = String(name);
    if (s.startsWith("/steam/")) return "steam";
    if (s.startsWith("/xbox/") || s.startsWith("/xboxlive/")) return "xbox";
    if (s.startsWith("/playstation/")) return "playstation";
    return "other";
  }

  function msCountryFlagEmoji(country) {
    if (!country) return "";
    const cc = String(country).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return "";
    const A = 0x1f1e6; // Regional Indicator Symbol Letter A
    const base = "A".charCodeAt(0);
    const c1 = A + (cc.charCodeAt(0) - base);
    const c2 = A + (cc.charCodeAt(1) - base);
    try {
      return String.fromCodePoint(c1, c2);
    } catch (_) {
      return "";
    }
  }

  function msFormatMatchStartDDMMYYYY(ms) {
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    const pad = function (x) { return String(x).padStart(2, "0"); };
    return (
      pad(d.getDate()) +
      "/" +
      pad(d.getMonth() + 1) +
      "/" +
      d.getFullYear() +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function msTidyMapName(raw) {
    if (raw == null || raw === "") return "";
    let s = String(raw).trim();
    const dot = s.lastIndexOf(".");
    if (dot > 0) s = s.slice(0, dot);
    s = s.replace(/_/g, " ");
    return s.replace(/\S+/g, function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }

  function msFormatMatchRow(m) {
    const when = msFormatMatchStartDDMMYYYY(m.startedAt);
    const matchup = m.matchup ? String(m.matchup).trim() : "";
    const rawMap = m.mapName ? String(m.mapName) : "match " + m.matchId;
    const map = msTidyMapName(rawMap) || ("Match " + m.matchId);
    let civ = "";
    if (m.civilizationName) civ = String(m.civilizationName);
    else if (m.civilizationId != null && Number.isFinite(Number(m.civilizationId))) {
      civ = "civilization " + m.civilizationId;
    } else {
      civ = "Unknown";
    }
    let line = "\u2694\ufe0f " + when + " - ";
    if (matchup) line += matchup + " ";
    line += "on " + map + " w/ " + civ;
    return line;
  }

  function paintMsProfileList(options, activeIdx, selectedProfileId) {
    if (!msProfileList) return;
    msProfileList.textContent = "";
    if (!options || options.length === 0) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      const q = msProfileSearch ? msProfileSearch.value.trim() : "";
      li.textContent = q ? "No matches" : "Type to search…";
      li.setAttribute("role", "presentation");
      msProfileList.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const li = document.createElement("li");
      li.className = "picker__option";
      li.setAttribute("role", "option");
      li.setAttribute("data-idx", String(i));
      li.setAttribute("data-profile-id", String(opt.profileId));
      const row = document.createElement("span");
      row.className = "ms-suggest";

      const platform = document.createElement("span");
      platform.className = "ms-suggest__platform ms-suggest__platform--" + msPlatformKey(opt.platformName);
      platform.setAttribute("aria-hidden", "true");

      const flag = document.createElement("span");
      flag.className = "ms-suggest__flag";
      flag.textContent = msCountryFlagEmoji(opt.country);
      flag.setAttribute("aria-hidden", "true");

      const alias = document.createElement("span");
      alias.className = "ms-suggest__alias";
      alias.textContent = opt.alias;

      row.appendChild(platform);
      row.appendChild(flag);
      row.appendChild(alias);
      li.appendChild(row);
      if (opt.profileId === selectedProfileId) li.setAttribute("aria-current", "true");
      li.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
      frag.appendChild(li);
    }
    msProfileList.appendChild(frag);
  }

  function paintMsMatchList(options, activeIdx, selectedMatchId) {
    if (!msMatchList) return;
    msMatchList.textContent = "";
    if (!msSelectedProfileId) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      li.textContent = "Pick a player above";
      li.setAttribute("role", "presentation");
      msMatchList.appendChild(li);
      return;
    }
    if (!options || options.length === 0) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      li.textContent = "No matches";
      li.setAttribute("role", "presentation");
      msMatchList.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const li = document.createElement("li");
      li.className = "picker__option";
      li.setAttribute("role", "option");
      li.setAttribute("data-idx", String(i));
      li.setAttribute("data-match-id", String(opt.matchId));
      li.textContent = msFormatMatchRow(opt);
      if (opt.matchId === selectedMatchId) li.setAttribute("aria-current", "true");
      li.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
      frag.appendChild(li);
    }
    msMatchList.appendChild(frag);
  }

  function renderMs() {
    const profs = msProfiles || [];
    const matches = msMatches || [];
    paintMsProfileList(profs, msProfileActiveIdx, msSelectedProfileId);
    paintMsMatchList(matches, msMatchActiveIdx, msSelectedMatchId);
    if (msSelectBtn) msSelectBtn.disabled = !msSelectedProfileId || !msSelectedMatchId;
  }

  async function msFetchProfiles(q) {
    const res = await fetch("/api/ms/profile-search?q=" + encodeURIComponent(q), { cache: "no-store" });
    if (!res.ok) throw new Error("Search failed (HTTP " + res.status + ")");
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  async function msFetchMatches(profileId) {
    const res = await fetch(
      "/api/ms/recent-matches?profileId=" + encodeURIComponent(profileId) + "&count=20",
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error("Match list failed (HTTP " + res.status + ")");
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }

  async function msSelectProfile(profileId) {
    msSelectedProfileId = Number(profileId) || 0;
    msSelectedMatchId = 0;
    msMatches = [];
    msMatchActiveIdx = -1;
    renderMs();
    if (!msSelectedProfileId) return;
    setPickerShellLoading(msMatchLoading, msMatchList, true);
    try {
      setStatus("Loading matches…", "loading");
      const rows = await msFetchMatches(msSelectedProfileId);
      msMatches = rows
        .filter(function (r) { return r && r.matchId; })
        .map(function (r) {
          return {
            matchId: Number(r.matchId),
            startedAt: Number(r.startedAt),
            completedAt: r.completedAt != null ? Number(r.completedAt) : undefined,
            mapName: r.mapName ? String(r.mapName) : "",
            maxPlayers: r.maxPlayers != null ? Number(r.maxPlayers) : undefined,
            matchTypeId: r.matchTypeId != null ? Number(r.matchTypeId) : undefined,
            matchup: r.matchup != null ? String(r.matchup) : "",
            civilizationId: r.civilizationId != null ? Number(r.civilizationId) : undefined,
            civilizationName: r.civilizationName != null ? String(r.civilizationName) : "",
          };
        })
        .filter(function (m) { return Number.isFinite(m.matchId) && m.matchId > 0; });
      msMatchActiveIdx = msMatches.length ? 0 : -1;
      setStatus("Ready", "success");
      renderMs();
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), "error");
      msMatches = [];
      renderMs();
    } finally {
      setPickerShellLoading(msMatchLoading, msMatchList, false);
    }
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

  // ---------- modals wiring ----------------------------------------------

  wireModal(scenarioModal);
  wireModal(aocrecModal);
  wireModal(microsoftModal);

  if (openScenarioModalBtn) {
    openScenarioModalBtn.addEventListener("click", function () {
      if (scenarioSelectBtn) scenarioSelectBtn.disabled = !scenarioPickerSelectedId;
      openModal(scenarioModal, scenarioSearch);
    });
  }
  if (openAocrecModalBtn) {
    openAocrecModalBtn.addEventListener("click", function () {
      loadAocrecRecent();
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = !aocrecPickerSelectedId;
      openModal(aocrecModal, null);
    });
  }
  if (openMicrosoftModalBtn) {
    openMicrosoftModalBtn.addEventListener("click", function () {
      if (msProfileSearch) msProfileSearch.value = "";
      msProfiles = [];
      msMatches = [];
      msSelectedProfileId = 0;
      msSelectedMatchId = 0;
      msProfileActiveIdx = -1;
      msMatchActiveIdx = -1;
      msProfileFetchSeq += 1;
      setMsProfileSearchLoading(false);
      setPickerShellLoading(msMatchLoading, msMatchList, false);
      if (msSelectBtn) msSelectBtn.disabled = true;
      renderMs();
      openModal(microsoftModal, msProfileSearch);
    });
  }

  if (scenarioSelectBtn) scenarioSelectBtn.addEventListener("click", function () { void importSelectedScenario(); });
  if (aocrecSelectBtn) aocrecSelectBtn.addEventListener("click", function () { void importSelectedAocrec(); });

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (isModalOpen(aocrecModal)) closeModal(aocrecModal);
    else if (isModalOpen(scenarioModal)) closeModal(scenarioModal);
    else if (isModalOpen(microsoftModal)) closeModal(microsoftModal);
  });

  if (msProfileSearch && msProfileList) {
    function scheduleSearch() {
      if (msProfileDebounce) clearTimeout(msProfileDebounce);
      const qEarly = msProfileSearch.value.trim();
      if (qEarly.length < 2) {
        msProfileFetchSeq += 1;
        setMsProfileSearchLoading(false);
        msProfiles = [];
        msProfileActiveIdx = -1;
        msSelectedProfileId = 0;
        msSelectedMatchId = 0;
        msMatches = [];
        msMatchActiveIdx = -1;
        renderMs();
        return;
      }
      setMsProfileSearchLoading(true);
      msProfileDebounce = setTimeout(async function () {
        const q = msProfileSearch.value.trim();
        if (q.length < 2) {
          msProfileFetchSeq += 1;
          setMsProfileSearchLoading(false);
          msProfiles = [];
          msProfileActiveIdx = -1;
          msSelectedProfileId = 0;
          msSelectedMatchId = 0;
          msMatches = [];
          msMatchActiveIdx = -1;
          renderMs();
          return;
        }
        msSelectedProfileId = 0;
        msSelectedMatchId = 0;
        msMatches = [];
        msMatchActiveIdx = -1;
        const seq = ++msProfileFetchSeq;
        try {
          const rows = await msFetchProfiles(q);
          if (seq !== msProfileFetchSeq) return;
          msProfiles = rows
            .filter(function (r) { return r && r.profileId && r.alias; })
            .map(function (r) {
              return {
                profileId: Number(r.profileId),
                alias: String(r.alias),
                platformName: r.platformName ? String(r.platformName) : "",
                country: r.country ? String(r.country) : "",
              };
            })
            .filter(function (p) { return Number.isFinite(p.profileId) && p.profileId > 0 && p.alias; })
            .slice(0, 20);
          msProfileActiveIdx = msProfiles.length ? 0 : -1;
          renderMs();
        } catch (err) {
          if (seq !== msProfileFetchSeq) return;
          msProfiles = [];
          msProfileActiveIdx = -1;
          renderMs();
          setStatus(err && err.message ? err.message : String(err), "error");
        } finally {
          if (seq === msProfileFetchSeq) setMsProfileSearchLoading(false);
        }
      }, 300);
    }

    function selectAll() { try { msProfileSearch.select(); } catch (_) {} }
    msProfileSearch.addEventListener("focus", selectAll);
    msProfileSearch.addEventListener("click", selectAll);
    msProfileSearch.addEventListener("input", scheduleSearch);

    msProfileSearch.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (!msProfiles.length) return;
        msProfileActiveIdx = (msProfileActiveIdx + 1) % msProfiles.length;
        renderMs();
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (!msProfiles.length) return;
        msProfileActiveIdx = (msProfileActiveIdx - 1 + msProfiles.length) % msProfiles.length;
        renderMs();
      } else if (ev.key === "Enter") {
        if (msProfileActiveIdx >= 0 && msProfiles[msProfileActiveIdx]) {
          ev.preventDefault();
          void msSelectProfile(msProfiles[msProfileActiveIdx].profileId);
        }
      } else if (ev.key === "Escape") {
        if (msProfileSearch.value) {
          ev.preventDefault();
          msProfileSearch.value = "";
          msProfileFetchSeq += 1;
          setMsProfileSearchLoading(false);
          msProfiles = [];
          msSelectedProfileId = 0;
          msSelectedMatchId = 0;
          msMatches = [];
          msProfileActiveIdx = -1;
          msMatchActiveIdx = -1;
          renderMs();
        }
      }
    });

    msProfileList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !msProfileList.contains(li)) return;
      const id = Number(li.getAttribute("data-profile-id") || "0");
      if (id) void msSelectProfile(id);
    });
  }

  if (msMatchList) {
    msMatchList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !msMatchList.contains(li)) return;
      const id = Number(li.getAttribute("data-match-id") || "0");
      if (!id) return;
      msSelectedMatchId = id;
      renderMs();
      if (msSelectBtn) msSelectBtn.disabled = !msSelectedProfileId || !msSelectedMatchId;
    });
  }

  async function importSelectedMicrosoftReplay() {
    if (!msSelectedProfileId || !msSelectedMatchId) return;
    if (busy) {
      setStatus("Busy rendering — wait for it to finish.", "error");
      return;
    }

    setStatus("Downloading recording…", "loading");
    setProgress(10, { autoHide: false });

    try {
      const res = await fetch(
        "/api/ms/replay-zip?matchId=" +
          encodeURIComponent(msSelectedMatchId) +
          "&profileId=" +
          encodeURIComponent(msSelectedProfileId),
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ")");
      const buf = await res.arrayBuffer();
      setProgress(55, { autoHide: false });

      const u8 = new Uint8Array(buf);
      const z = globalThis.fflate;
      if (!z || typeof z.unzipSync !== "function") {
        throw new Error("ZIP support not loaded.");
      }

      const files = z.unzipSync(u8);
      const names = Object.keys(files || {});
      const picked = names
        .filter(function (n) {
          const lower = String(n).toLowerCase();
          return lower.endsWith(".aoe2record");
        })
        .sort(function (a, b) { return a.localeCompare(b); })[0];

      if (!picked) {
        throw new Error("Zip did not contain a .aoe2record file.");
      }

      const bytes = files[picked];
      const file = new File([bytes], picked.split("/").pop() || picked, {
        type: "application/octet-stream",
        lastModified: Date.now(),
      });

      assignFile(file);
      closeModal(microsoftModal);
      setProgress(100, { holdMs: 350 });
      setStatus("Ready", "success");
    } catch (err) {
      setProgress(100, { holdMs: 1200 });
      setStatus(err && err.message ? err.message : String(err), "error");
    }
  }

  if (msSelectBtn) {
    msSelectBtn.addEventListener("click", function () {
      void importSelectedMicrosoftReplay();
    });
  }

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
  loadScenarioIndex();
  setProgress(2, { autoHide: false });
  setStatus("Loading runtime\u2026", "loading");
  ensureWorker();
  worker.postMessage({ type: "warmup" });
})();
