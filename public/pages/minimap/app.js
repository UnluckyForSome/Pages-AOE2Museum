import * as fflate from "/modules/fflate/fflate.browser.js";

(function () {

  const SUPPORTED_EXTENSIONS = [
    ".aoe2scenario",
    ".aoe2record",
    ".mgz",
    ".mgx",
    ".mgl",
    ".scx",
    ".scn",
  ];

  const CAMPAIGN_EXTENSIONS = [".cpn", ".cpx", ".aoe2campaign"];

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

  const RAINBOW_URL = "/minimap/assets/rainbow.png";

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
  const openModsModalBtn = document.getElementById("open-mods-modal");
  const openAocrecModalBtn = document.getElementById("open-aocrec-modal");
  const openMicrosoftModalBtn = document.getElementById("open-microsoft-modal");
  const scenarioModal = document.getElementById("scenario-modal");
  const modsModal = document.getElementById("mods-modal");
  const campaignFileList = document.getElementById("campaign-file-list");
  const modsWizardBackBtn = document.getElementById("mods-wizard-back");
  const modsWizardCancelBtn = document.getElementById("mods-wizard-cancel");
  const modsWizardSelectBtn = document.getElementById("mods-wizard-select");
  const modsWizardFooter = document.getElementById("mods-wizard-footer");
  const modsWizardScreenMod = document.getElementById("mods-wizard-screen-mod");
  const modsWizardScreenZip = document.getElementById("mods-wizard-screen-zip");
  const modsWizardScreenCampaign = document.getElementById("mods-wizard-screen-campaign");
  const scenarioModalCard = scenarioModal ? scenarioModal.querySelector(".modal__card") : null;
  const modsModalCard = modsModal ? modsModal.querySelector(".modal__card") : null;
  const aocrecModal = document.getElementById("aocrec-modal");
  const microsoftModal = document.getElementById("microsoft-modal");
  const campaignStandaloneModal = document.getElementById("campaign-standalone-modal");
  const campaignStandaloneList = document.getElementById("campaign-standalone-list");
  const campaignStandaloneSelectBtn = document.getElementById("campaign-standalone-select-btn");
  const aocrecModalCard = aocrecModal ? aocrecModal.querySelector(".modal__card") : null;
  const microsoftModalCard = microsoftModal ? microsoftModal.querySelector(".modal__card") : null;
  const campaignStandaloneModalCard = campaignStandaloneModal
    ? campaignStandaloneModal.querySelector(".modal__card")
    : null;
  const scenarioSelectBtn = document.getElementById("scenario-select-btn");
  const aocrecSelectBtn = document.getElementById("aocrec-select-btn");
  const msSelectBtn = document.getElementById("ms-select-btn");
  const scenarioSearch = document.getElementById("scenario-search");
  const scenarioList = document.getElementById("scenario-list");
  const modsSearch = document.getElementById("mods-search");
  const modsList = document.getElementById("mods-list");
  const modsFileList = document.getElementById("mods-file-list");
  const aocrecSearch = document.getElementById("aocrec-search");
  const aocrecList = document.getElementById("aocrec-list");
  const msProfileSearch = document.getElementById("ms-profile-search");
  const msProfileList = document.getElementById("ms-profile-list");
  const msProfileLoading = document.getElementById("ms-profile-loading");
  const msMatchList = document.getElementById("ms-match-list");
  const msMatchLoading = document.getElementById("ms-match-loading");
  const scenarioLoading = document.getElementById("scenario-loading");
  const modsLoading = document.getElementById("mods-loading");
  const aocrecLoadingEl = document.getElementById("aocrec-loading");

  // ---------- state -------------------------------------------------------

  let lastObjectUrl = null;
  let busy = false;
  let worker = null;
  let pendingId = 0;
  const pending = new Map();
  const pendingCampaign = new Map();
  let lastRenderedFingerprint = null;
  let currentFingerprint = "";
  let galleryLoaded = false;
  let progressHideTimer = 0;
  let bootDone = false;
  let campaignBusy = false;
  /** @type {ArrayBuffer | null} */
  let lastCampaignBuffer = null;
  let lastCampaignRows = [];
  let campaignSelectedIdx = -1;

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

  function isCampaignFile(file) {
    return CAMPAIGN_EXTENSIONS.indexOf(fileExtension(file.name)) !== -1;
  }

  // ---------- modal helpers -----------------------------------------------

  function isModalOpen(backdrop) {
    return !!(backdrop && backdrop.hidden === false);
  }

  const PICKER_FROZEN_STATUS = "Getting selections\u2026";
  let pickerModalDepth = 0;
  const pickerBackdropSet = new Set(
    [scenarioModal, modsModal, aocrecModal, microsoftModal, campaignStandaloneModal].filter(function (b) {
      return !!b;
    }),
  );

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

  function openPickerModal(backdrop, focusEl) {
    if (!backdrop) return;
    pickerModalDepth++;
    if (pickerModalDepth === 1) {
      statusText.textContent = PICKER_FROZEN_STATUS;
      setStatusTone("loading");
    }
    openModal(backdrop, focusEl);
  }

  function closeModal(backdrop) {
    if (!backdrop) return;
    const wasOpen = !backdrop.hidden;
    backdrop.hidden = true;
    document.documentElement.classList.remove("modal-open");
    if (wasOpen && pickerBackdropSet.has(backdrop)) {
      pickerModalDepth = Math.max(0, pickerModalDepth - 1);
      if (pickerModalDepth === 0) {
        if (busy) {
          applyMainStatus("Rendering\u2026", "loading");
        } else {
          applyMainStatus("Ready", "success");
          applyMainProgress(100, { holdMs: 350 });
        }
      }
    }
    if (!wasOpen) return;
    if (backdrop === scenarioModal) hideModalActivity(scenarioModalCard, { immediate: true });
    if (backdrop === aocrecModal) hideModalActivity(aocrecModalCard, { immediate: true });
    if (backdrop === microsoftModal) {
      msProfileFetchSeq += 1;
      hideModalActivity(microsoftModalCard, { immediate: true });
    }
    if (backdrop === campaignStandaloneModal) {
      resetCampaignPickState();
      hideModalActivity(campaignStandaloneModalCard, { immediate: true });
    }
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

  function parseContentLengthHeader(headerVal) {
    if (headerVal == null || headerVal === "") return null;
    const n = parseInt(String(headerVal).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function concatChunksToArrayBuffer(chunks, totalLen) {
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }
    return out.buffer;
  }

  /** Stream response body to ArrayBuffer; optional `onRatio` receives 0-1 download fraction. */
  async function arrayBufferFromResponseWithProgress(res, onRatio) {
    const total = parseContentLengthHeader(res.headers.get("content-length"));
    const stream = res.body;
    if (!stream || typeof stream.getReader !== "function") {
      if (onRatio) onRatio(0);
      const buf = await res.arrayBuffer();
      if (onRatio) onRatio(1);
      return buf;
    }
    const reader = stream.getReader();
    let received = 0;
    const chunks = [];
    if (onRatio) onRatio(0);

    if (total == null || total <= 0) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        if (onRatio) {
          const est = 1 - Math.exp(-received / (768 * 1024));
          onRatio(est * 0.94);
        }
      }
      if (onRatio) onRatio(1);
      return concatChunksToArrayBuffer(chunks, received);
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (onRatio) onRatio(Math.min(1, received / total));
    }
    if (onRatio) onRatio(1);
    return concatChunksToArrayBuffer(chunks, received);
  }

  function lerpProgressPct(lo, hi, t) {
    return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, t)));
  }

  // ---------- status + progress ------------------------------------------

  const STATUS_TONES = ["idle", "loading", "success", "error"];

  function setStatusTone(tone) {
    STATUS_TONES.forEach(function (t) {
      statusBar.classList.toggle("statusbar--" + t, t === tone);
    });
  }

  function applyMainStatus(text, tone) {
    statusText.textContent = text || "";
    setStatusTone(tone || "idle");
  }

  function applyMainProgress(pct, opts) {
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

  function setStatus(text, tone) {
    if (pickerModalDepth > 0) return;
    applyMainStatus(text, tone);
  }

  function setProgress(pct, opts) {
    if (pickerModalDepth > 0) return;
    applyMainProgress(pct, opts);
  }

  /** @type {WeakMap<object, number>} */
  const modalActivityTimers = new WeakMap();

  function getModalActivityParts(card) {
    if (!card) return null;
    const root = card.querySelector(".modal-activity");
    if (!root) return null;
    const ring = root.querySelector(".modal-activity__ring");
    const textEl = root.querySelector(".modal-activity__text");
    return { root: root, ring: ring, textEl: textEl };
  }

  function clearModalActivityTimer(card) {
    const t = modalActivityTimers.get(card);
    if (t) {
      clearTimeout(t);
      modalActivityTimers.delete(card);
    }
  }

  function showModalActivity(card, opts) {
    const parts = getModalActivityParts(card);
    if (!parts) return;
    clearModalActivityTimer(card);
    const o = opts || {};
    parts.root.hidden = false;
    parts.root.setAttribute("aria-hidden", "false");
    parts.root.classList.remove("is-error", "is-success");
    parts.root.classList.add("is-loading");
    if (o.indeterminate) {
      parts.root.classList.add("is-indeterminate");
      if (parts.ring) parts.ring.style.removeProperty("--p");
    } else {
      parts.root.classList.remove("is-indeterminate");
      const p = Math.max(0, Math.min(100, typeof o.pct === "number" ? o.pct : 0));
      if (parts.ring) parts.ring.style.setProperty("--p", p + "%");
    }
    if (parts.textEl) parts.textEl.textContent = o.message || "";
  }

  function setModalActivityProgress(card, pct, message) {
    const parts = getModalActivityParts(card);
    if (!parts || parts.root.hidden) return;
    parts.root.classList.remove("is-indeterminate");
    const p = Math.max(0, Math.min(100, pct));
    if (parts.ring) parts.ring.style.setProperty("--p", p + "%");
    if (message != null && parts.textEl) parts.textEl.textContent = message;
  }

  function showModalActivityError(card, message) {
    const parts = getModalActivityParts(card);
    if (!parts) return;
    clearModalActivityTimer(card);
    parts.root.hidden = false;
    parts.root.setAttribute("aria-hidden", "false");
    parts.root.classList.remove("is-loading", "is-indeterminate", "is-success");
    parts.root.classList.add("is-error");
    if (parts.ring) parts.ring.style.setProperty("--p", "100%");
    if (parts.textEl) parts.textEl.textContent = message || "Something went wrong.";
  }

  function hideModalActivity(card, opts) {
    const parts = getModalActivityParts(card);
    if (!parts) return;
    const o = opts || {};
    clearModalActivityTimer(card);
    function finish() {
      parts.root.hidden = true;
      parts.root.setAttribute("aria-hidden", "true");
      parts.root.classList.remove("is-loading", "is-error", "is-success", "is-indeterminate");
      if (parts.ring) parts.ring.style.removeProperty("--p");
      if (parts.textEl) parts.textEl.textContent = "";
    }
    if (o.immediate) {
      finish();
      return;
    }
    if (typeof o.pct === "number") {
      setModalActivityProgress(card, o.pct, o.message);
    } else if (parts.ring) {
      parts.ring.style.setProperty("--p", "100%");
    }
    parts.root.classList.remove("is-error");
    parts.root.classList.add("is-success");
    const ms = o.afterMs != null ? o.afterMs : 280;
    modalActivityTimers.set(
      card,
      setTimeout(finish, ms),
    );
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
    if (openModsModalBtn) openModsModalBtn.disabled = on;
    if (openAocrecModalBtn) openAocrecModalBtn.disabled = on;
    if (openMicrosoftModalBtn) openMicrosoftModalBtn.disabled = on;
    if (aocrecList) aocrecList.setAttribute("aria-disabled", on ? "true" : "false");
    if (msProfileSearch) msProfileSearch.disabled = on;
    if (msProfileList) msProfileList.setAttribute("aria-disabled", on ? "true" : "false");
    if (msMatchList) msMatchList.setAttribute("aria-disabled", on ? "true" : "false");
    if (msSelectBtn) msSelectBtn.disabled = on || !msSelectedProfileId || !msSelectedMatchId;
  }

  // ---------- fetch source state (which pill provided the current file) ----

  const FETCH_SOURCES = [
    { key: "museum", btn: openScenarioModalBtn },
    { key: "mods", btn: openModsModalBtn },
    { key: "aocrec", btn: openAocrecModalBtn },
    { key: "microsoft", btn: openMicrosoftModalBtn },
  ];

  function setFetchSourceActive(key) {
    FETCH_SOURCES.forEach(function (s) {
      if (!s.btn) return;
      const on = !!key && s.key === key;
      s.btn.classList.toggle("is-active", on);
      s.btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function clearFetchSourceActive() {
    setFetchSourceActive("");
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
      dropzone.classList.remove("is-set");
    } else {
      fileMeta.textContent = f.name + " \u00b7 " + formatBytes(f.size);
      fileMeta.classList.add("is-set");
      dropzone.classList.add("is-set");
    }
    // A new (different) file invalidates any prior render.
    lastRenderedFingerprint = null;
    refreshFingerprint();
  }

  function assignFile(file, sourceKey) {
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    updateFileMeta();
    if (sourceKey) setFetchSourceActive(sourceKey);
    else clearFetchSourceActive();
  }

  function clearFileInput() {
    const dt = new DataTransfer();
    fileInput.files = dt.files;
    updateFileMeta();
  }

  function openFilePicker() {
    fileInput.click();
  }

  // ---------- scenario picker (archive) -----------------------------------

  const PICKER_PAGE_SIZE = 30;
  const PICKER_MAX_ROWS = PICKER_PAGE_SIZE;
  const PICKER_MIN_QUERY_LENGTH = 2;
  /** Shared debounce for remote search inputs (mods, AOCRec, Microsoft). Scenario search is intentionally immediate — it only filters the in-memory index. */
  const PICKER_SEARCH_DEBOUNCE_MS = 300;

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

  function formatMuseumScenarioRow(filename, uploadedAtRaw) {
    let ms = NaN;
    if (uploadedAtRaw != null && uploadedAtRaw !== "") {
      if (typeof uploadedAtRaw === "number" && Number.isFinite(uploadedAtRaw)) {
        ms = uploadedAtRaw < 1e12 ? uploadedAtRaw * 1000 : uploadedAtRaw;
      } else {
        ms = new Date(uploadedAtRaw).getTime();
      }
    }
    const whenStr = Number.isFinite(ms) ? msFormatMatchStartDDMMYYYY(ms) : "";
    const fn = String(filename || "");
    let line = "\u{1F5FA}\uFE0F ";
    if (whenStr) line += whenStr + " - ";
    line += fn;
    return line;
  }

  function scenarioUploadedAtMs(raw) {
    if (raw == null || raw === "") return NaN;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw < 1e12 ? raw * 1000 : raw;
    }
    return new Date(raw).getTime();
  }

  let scenarioIndex = []; // { id, filename, label, searchText }[]
  let scenarioById = new Map();
  let scenarioPickerSelectedId = "";
  let scenarioLoadingIndex = false;

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
      if (scenarioModalCard) {
        showModalActivityError(scenarioModalCard, "Busy rendering \u2014 wait for it to finish.");
      } else {
        setStatus("Busy rendering \u2014 wait for it to finish.", "error");
      }
      return;
    }
    const entry = scenarioById.get(id);
    if (!entry) return;

    showModalActivity(scenarioModalCard, { pct: 4, message: "Downloading scenario\u2026" });

    try {
      const res = await fetch("/api/scenarios/download/" + encodeURIComponent(id), { cache: "no-store" });
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ")");
      const buf = await arrayBufferFromResponseWithProgress(res, function (ratio) {
        setModalActivityProgress(
          scenarioModalCard,
          lerpProgressPct(10, 82, ratio),
          "Downloading scenario\u2026",
        );
      });
      setModalActivityProgress(scenarioModalCard, 90, "Preparing file\u2026");

      const cd = res.headers.get("content-disposition");
      const fromHeader = parseFilenameFromContentDisposition(cd);
      const filename = fromHeader || entry.filename || "scenario";
      const mime = res.headers.get("content-type") || "application/octet-stream";
      const file = new File([buf], filename, {
        type: mime,
        lastModified: Date.now(),
      });
      assignFile(file, "museum");
      hideModalActivity(scenarioModalCard, { afterMs: 200 });
      closeModal(scenarioModal);
      applyMainStatus("Ready", "success");
      applyMainProgress(100, { holdMs: 350 });
    } catch (err) {
      showModalActivityError(
        scenarioModalCard,
        err && err.message ? err.message : String(err),
      );
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
        ? pool.filter(function (s) {
            return String(s.searchText || s.filename || "").toLowerCase().includes(q);
          })
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
      const idx = Number(li.getAttribute("data-idx") || "-1");
      if (id) commit(id, Number.isFinite(idx) ? idx : -1);
    });

    function commit(id, idx) {
      if (!id) return;
      scenarioPickerSelectedId = id;
      if (typeof idx === "number" && idx >= 0) activeIdx = idx;
      render();
      if (scenarioSelectBtn) scenarioSelectBtn.disabled = false;
    }

    render();
    return { render: render };
  }

  const scenarioPicker = createScenarioPicker();

  async function loadScenarioIndex() {
    if (!scenarioSearch || !scenarioList) return;
    if (scenarioLoadingIndex) return;
    scenarioLoadingIndex = true;
    setPickerShellLoading(scenarioLoading, scenarioList, true);
    try {
      const res = await fetch("/api/scenarios", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      const list = Array.isArray(rows) ? rows : [];
      scenarioIndex = list
        .filter(function (s) { return s && s.id != null && s.filename; })
        .map(function (s) {
          const fn = String(s.filename);
          return {
            id: String(s.id),
            filename: fn,
            searchText: fn,
            label: formatMuseumScenarioRow(fn, s.uploaded_at),
            sortMs: scenarioUploadedAtMs(s.uploaded_at),
          };
        });
      scenarioIndex.sort(function (a, b) {
        const am = Number.isFinite(a.sortMs) ? a.sortMs : 0;
        const bm = Number.isFinite(b.sortMs) ? b.sortMs : 0;
        return bm - am;
      });
      scenarioById = new Map(scenarioIndex.map(function (s) { return [s.id, s]; }));
      updateScenarioSearchPlaceholder();
      if (scenarioPicker) scenarioPicker.render();
    } catch (err) {
      scenarioIndex = [];
      scenarioById = new Map();
      updateScenarioSearchPlaceholder();
      console.warn("[scenarios] index load failed:", err);
      if (scenarioPicker) scenarioPicker.render();
      showModalActivityError(
        scenarioModalCard,
        err && err.message ? err.message : String(err),
      );
    } finally {
      scenarioLoadingIndex = false;
      setPickerShellLoading(scenarioLoading, scenarioList, false);
    }
  }

  // ---------- mods.aoe2.se modal ------------------------------------------

  let modsLoaded = false;
  let modsFetchInFlight = false;
  let modsFetchSeq = 0;
  let modsRows = []; // { modId, modName, creatorName, fileUrl, scenarioCount, campaignCount }[]
  let modsPickerSelectedId = "";
  let modsSearchTimer = 0;

  function formatModsAssetSuffix(nCampaign, nScenario) {
    const c = Number(nCampaign || 0);
    const s = Number(nScenario || 0);
    const parts = [];
    if (c > 1) parts.push(c + " campaigns");
    else if (c === 1) parts.push("1 campaign");
    if (s > 1) parts.push(s + " scenarios");
    else if (s === 1) parts.push("1 scenario");
    return parts.length ? (" \u00b7 " + parts.join(", ")) : "";
  }

  function formatModsRow(r) {
    const name = r.modName || String(r.modId);
    const who = r.creatorName ? (" by " + r.creatorName) : "";
    const suffix = formatModsAssetSuffix(r.campaignCount, r.scenarioCount);
    const created = Number.isFinite(r.createdAt) ? (msFormatMatchStartDDMMYYYY(r.createdAt) + " - ") : "";
    return created + name + who + suffix;
  }

  function paintModsPicker(options, activeIdx, selectedId) {
    if (!modsList) return;
    modsList.textContent = "";
    if (!options || options.length === 0) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      const q = modsSearch ? modsSearch.value.trim() : "";
      li.textContent = q && q.length < PICKER_MIN_QUERY_LENGTH
        ? "Type at least 2 characters"
        : (modsFetchInFlight || !modsLoaded ? "Loading..." : "No mods");
      li.setAttribute("role", "presentation");
      modsList.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const li = document.createElement("li");
      li.className = "picker__option";
      li.setAttribute("role", "option");
      li.setAttribute("data-idx", String(i));
      li.setAttribute("data-id", String(opt.modId));
      li.textContent = formatModsRow(opt);
      if (String(opt.modId) === selectedId) li.setAttribute("aria-current", "true");
      li.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
      frag.appendChild(li);
    }
    modsList.appendChild(frag);
  }

  function createModsPicker() {
    if (!modsSearch || !modsList) return null;
    let current = [];
    let activeIdx = -1;
    let selectedId = "";

    function render() {
      current = (modsRows || []).slice(0, PICKER_MAX_ROWS);
      activeIdx = current.length ? 0 : -1;
      paintModsPicker(current, activeIdx, selectedId);
    }

    function commit(id) {
      if (!id) return;
      selectedId = id;
      modsPickerSelectedId = id;
      const idx = current.findIndex(function (r) { return String(r.modId) === String(id); });
      if (idx >= 0) activeIdx = idx;
      paintModsPicker(current, activeIdx, selectedId);
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = !selectedId;
    }

    modsSearch.addEventListener("input", function () {
      if (modsSearchTimer) clearTimeout(modsSearchTimer);
      modsSearchTimer = setTimeout(function () {
        const q = modsSearch.value.trim();
        if (q && q.length < PICKER_MIN_QUERY_LENGTH) {
          modsFetchSeq += 1;
          modsFetchInFlight = false;
          modsLoaded = true;
          modsRows = [];
          modsPickerSelectedId = "";
          setPickerShellLoading(modsLoading, modsList, false);
          if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = true;
          if (modsPicker) modsPicker.render();
          return;
        }
        void fetchModsSearch(q);
      }, PICKER_SEARCH_DEBOUNCE_MS);
    });

    modsSearch.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (current.length === 0) return;
        activeIdx = (activeIdx + 1) % current.length;
        paintModsPicker(current, activeIdx, selectedId);
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (current.length === 0) return;
        activeIdx = (activeIdx - 1 + current.length) % current.length;
        paintModsPicker(current, activeIdx, selectedId);
      } else if (ev.key === "Enter") {
        if (activeIdx >= 0 && current[activeIdx]) {
          ev.preventDefault();
          commit(String(current[activeIdx].modId));
        }
      } else if (ev.key === "Escape") {
        if (modsSearch.value) {
          ev.preventDefault();
          if (modsSearchTimer) clearTimeout(modsSearchTimer);
          modsSearch.value = "";
          void fetchModsSearch("");
        }
      }
    });

    modsList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !modsList.contains(li)) return;
      const id = li.getAttribute("data-id") || "";
      const idx = Number(li.getAttribute("data-idx") || "-1");
      if (Number.isFinite(idx) && idx >= 0) activeIdx = idx;
      if (id) commit(id);
    });

    render();
    return { render: render };
  }

  const modsPicker = createModsPicker();

  function isScenarioPath(p) {
    const lower = String(p || "").toLowerCase();
    return lower.endsWith(".aoe2scenario") || lower.endsWith(".scx") || lower.endsWith(".scn");
  }

  function isCampaignPath(p) {
    const lower = String(p || "").toLowerCase();
    return lower.endsWith(".cpn") || lower.endsWith(".cpx") || lower.endsWith(".aoe2campaign");
  }

  function isSupportedModPath(p) {
    return isScenarioPath(p) || isCampaignPath(p);
  }

  function parseFileList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw !== "string") return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return [];
    }
  }

  async function fetchModsSearch(term) {
    const q = String(term || "").trim();
    const mySeq = ++modsFetchSeq;

    modsFetchInFlight = true;
    modsRows = [];
    modsPickerSelectedId = "";
    if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = true;
    if (modsPicker) modsPicker.render();

    setPickerShellLoading(modsLoading, modsList, true);
    let modsSearchHadError = false;
    try {
      const body = {
        page: 1,
        sortColumn: "createDate",
        sortDirection: "DESC",
        // Hard-filter by category:
        // - 16: scenarios
        // - 10: campaigns (contains "The Maid of Orleans CN")
        modCategories: [16, 10],
        searchTerm: q,
        civbuilder: false,
      };
      const res = await fetch("/api/mods/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (mySeq !== modsFetchSeq) return;
      const entries = data && Array.isArray(data.modEntries) ? data.modEntries : [];
      modsRows = entries
        .map(function (e) {
          let parsed = null;
          try { parsed = JSON.parse(String(e && e.json_str ? e.json_str : "{}")); } catch (_) {}
          const fileListRaw = e && e.fileList ? e.fileList : (parsed && parsed.fileList ? parsed.fileList : "");
          const fileList = parseFileList(fileListRaw);
          const scenarioCount = fileList.filter(isScenarioPath).length;
          const campaignCount = fileList.filter(isCampaignPath).length;
          return {
            modId: e && e.modId != null ? Number(e.modId) : 0,
            modName: e && e.modName ? String(e.modName) : "",
            creatorName: parsed && parsed.creatorName ? String(parsed.creatorName) : "",
            fileUrl: parsed && parsed.fileUrl ? String(parsed.fileUrl) : "",
            createdAt: scenarioUploadedAtMs(e && e.createDate),
            scenarioCount: scenarioCount,
            campaignCount: campaignCount,
          };
        })
        .filter(function (r) {
          return (
            Number.isFinite(r.modId) &&
            r.modId > 0 &&
            r.modName &&
            r.fileUrl &&
            Number(r.scenarioCount || 0) + Number(r.campaignCount || 0) > 0
          );
        })
        .slice(0, PICKER_PAGE_SIZE);
      modsPickerSelectedId = modsRows.length ? String(modsRows[0].modId) : "";
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = !modsPickerSelectedId;
    } catch (err) {
      if (mySeq !== modsFetchSeq) return;
      modsRows = [];
      modsPickerSelectedId = "";
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = true;
      console.warn("[mods] search failed:", err);
      modsSearchHadError = true;
      showModalActivityError(
        modsModalCard,
        err && err.message ? err.message : String(err),
      );
    } finally {
      if (mySeq !== modsFetchSeq) return;
      modsFetchInFlight = false;
      modsLoaded = true;
      setPickerShellLoading(modsLoading, modsList, false);
      if (modsPicker) modsPicker.render();
    }
  }

  // ---------- mod zip scenario picker (when zip has multiple scenarios) ----

  let modsZipFiles = null; // output of fflate.unzipSync
  let modsZipScenarioNames = [];
  let modsZipSelectedName = "";
  /** @type {"mod"|"zip"|"campaign"} */
  let modsWizardStep = "mod";

  function syncModsWizardChrome() {
    if (modsWizardScreenMod) modsWizardScreenMod.hidden = modsWizardStep !== "mod";
    if (modsWizardScreenZip) modsWizardScreenZip.hidden = modsWizardStep !== "zip";
    if (modsWizardScreenCampaign) modsWizardScreenCampaign.hidden = modsWizardStep !== "campaign";
    if (modsWizardFooter) modsWizardFooter.classList.toggle("is-step-mod", modsWizardStep === "mod");
    if (modsWizardBackBtn) modsWizardBackBtn.hidden = modsWizardStep === "mod";
    if (modsWizardCancelBtn) modsWizardCancelBtn.hidden = modsWizardStep !== "mod";
    const titleEl = document.getElementById("mods-modal-title");
    if (titleEl) {
      if (modsWizardStep === "mod") titleEl.textContent = "Scenarios From DE Mods";
      else if (modsWizardStep === "zip") titleEl.textContent = "Pick a file from the mod";
      else titleEl.textContent = "Pick a scenario from the campaign";
    }
  }

  function resetModsWizard() {
    modsWizardStep = "mod";
    modsZipFiles = null;
    modsZipScenarioNames = [];
    modsZipSelectedName = "";
    resetCampaignPickState();
    hideModalActivity(modsModalCard, { immediate: true });
    syncModsWizardChrome();
  }

  function closeModsModalFully() {
    resetModsWizard();
    closeModal(modsModal);
  }

  function modsWizardGoBack() {
    hideModalActivity(modsModalCard, { immediate: true });
    if (modsWizardStep === "zip") {
      modsZipFiles = null;
      modsZipScenarioNames = [];
      modsZipSelectedName = "";
      modsWizardStep = "mod";
      syncModsWizardChrome();
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = !modsPickerSelectedId;
    } else if (modsWizardStep === "campaign") {
      resetCampaignPickState();
      modsWizardStep = "zip";
      paintModsFilePicker(
        modsZipScenarioNames,
        modsZipScenarioNames.length ? 0 : -1,
        modsZipSelectedName,
      );
      syncModsWizardChrome();
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = !modsZipSelectedName;
    }
  }

  function paintModsFilePicker(options, activeIdx, selectedName) {
    if (!modsFileList) return;
    modsFileList.textContent = "";
    if (!options || options.length === 0) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      li.textContent = "No files";
      li.setAttribute("role", "presentation");
      modsFileList.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < options.length; i++) {
      const name = options[i];
      const li = document.createElement("li");
      li.className = "picker__option";
      li.setAttribute("role", "option");
      li.setAttribute("data-idx", String(i));
      li.setAttribute("data-name", String(name));
      li.textContent = String(name);
      if (name === selectedName) li.setAttribute("aria-current", "true");
      li.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
      frag.appendChild(li);
    }
    modsFileList.appendChild(frag);
  }

  if (modsFileList) {
    modsFileList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !modsFileList.contains(li)) return;
      const name = li.getAttribute("data-name") || "";
      if (!name) return;
      modsZipSelectedName = name;
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = false;
      paintModsFilePicker(modsZipScenarioNames, -1, modsZipSelectedName);
    });
  }

  async function importSelectedModZipScenario() {
    const name = modsZipSelectedName;
    if (!name || !modsZipFiles || !modsZipFiles[name]) return;
    const bytes = modsZipFiles[name];
    const file = new File([bytes], name.split("/").pop() || name, {
      type: "application/octet-stream",
      lastModified: Date.now(),
    });
    if (isCampaignFile(file)) {
      showModalActivity(modsModalCard, { pct: 12, message: "Parsing campaign\u2026" });
      await resolveCampaignToScenario(file);
      return;
    }
    assignFile(file, "mods");
    hideModalActivity(modsModalCard, { afterMs: 200 });
    closeModsModalFully();
    applyMainStatus("Ready", "success");
    applyMainProgress(100, { holdMs: 350 });
  }

  async function importSelectedModScenario() {
    const id = modsPickerSelectedId;
    if (!id) return;
    if (busy) {
      if (modsModalCard) showModalActivityError(modsModalCard, "Busy rendering \u2014 wait for it to finish.");
      else setStatus("Busy rendering \u2014 wait for it to finish.", "error");
      return;
    }
    const row = (modsRows || []).find(function (r) { return String(r.modId) === String(id); });
    if (!row || !row.fileUrl) return;

    showModalActivity(modsModalCard, { pct: 4, message: "Downloading mod\u2026" });

    try {
      const res = await fetch("/api/mods/zip?url=" + encodeURIComponent(row.fileUrl), { cache: "no-store" });
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ")");
      const buf = await arrayBufferFromResponseWithProgress(res, function (ratio) {
        setModalActivityProgress(
          modsModalCard,
          lerpProgressPct(10, 74, ratio),
          "Downloading mod\u2026",
        );
      });
      setModalActivityProgress(modsModalCard, 78, "Extracting\u2026");

      const u8 = new Uint8Array(buf);
      const files = fflate.unzipSync(u8);
      setModalActivityProgress(modsModalCard, 92, "Scanning files\u2026");
      const names = Object.keys(files || {});
      const scenarios = names
        .filter(function (n) { return isSupportedModPath(n); })
        .sort(function (a, b) { return a.localeCompare(b); });

      if (!scenarios.length) {
        throw new Error("Zip did not contain a scenario or campaign file.");
      }

      modsZipFiles = files;
      if (scenarios.length === 1) {
        modsZipSelectedName = scenarios[0];
        await importSelectedModZipScenario();
        return;
      }

      modsZipScenarioNames = scenarios.slice();
      modsZipSelectedName = modsZipScenarioNames.length ? String(modsZipScenarioNames[0]) : "";
      modsWizardStep = "zip";
      paintModsFilePicker(modsZipScenarioNames, modsZipScenarioNames.length ? 0 : -1, modsZipSelectedName);
      syncModsWizardChrome();
      hideModalActivity(modsModalCard, { afterMs: 240 });
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = !modsZipSelectedName;
    } catch (err) {
      showModalActivityError(
        modsModalCard,
        err && err.message ? err.message : String(err),
      );
    }
  }

  // ---------- campaign file scenario picker --------------------------------

  function resetCampaignPickState() {
    lastCampaignBuffer = null;
    lastCampaignRows = [];
    campaignSelectedIdx = -1;
  }

  function callParseCampaign(buf) {
    ensureWorker();
    const id = ++pendingId;
    const toSend = buf.slice(0);
    return new Promise(function (resolve, reject) {
      pendingCampaign.set(id, { resolve: resolve, reject: reject });
      worker.postMessage({ type: "parseCampaign", id: id, fileBytes: toSend }, [toSend]);
    });
  }

  function campaignRowLine(row) {
    const label = row && row.label != null ? String(row.label) : "";
    const fn = row && row.file_name != null ? String(row.file_name) : "";
    if (label && fn && label !== fn) return label + " \u2014 " + fn;
    return label || fn || "Scenario";
  }

  function paintCampaignFilePicker(rows, activeIdx, selectedIdx) {
    paintCampaignRowsIntoList(campaignFileList, rows, activeIdx, selectedIdx);
  }

  function paintCampaignRowsIntoList(ul, rows, activeIdx, selectedIdx) {
    if (!ul) return;
    ul.textContent = "";
    if (!rows || rows.length === 0) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      li.textContent = "No scenarios";
      li.setAttribute("role", "presentation");
      ul.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const li = document.createElement("li");
      li.className = "picker__option";
      li.setAttribute("role", "option");
      li.setAttribute("data-idx", String(i));
      li.textContent = campaignRowLine(row);
      li.setAttribute("aria-selected", i === activeIdx ? "true" : "false");
      if (i === selectedIdx) li.setAttribute("aria-current", "true");
      frag.appendChild(li);
    }
    ul.appendChild(frag);
  }

  function fileFromCampaignSlice(buffer, row) {
    const offset = row && row.offset != null ? Number(row.offset) : NaN;
    const size = row && row.size != null ? Number(row.size) : NaN;
    const n = buffer.byteLength;
    if (
      !Number.isFinite(offset) ||
      !Number.isFinite(size) ||
      offset < 0 ||
      size < 0 ||
      offset > n ||
      size > n - offset
    ) {
      throw new Error("Invalid scenario slice in campaign file.");
    }
    const slice = buffer.slice(offset, offset + size);
    const nameRaw = row && row.file_name != null ? String(row.file_name) : "scenario";
    const base = nameRaw.split(/[/\\]/).pop() || "scenario";
    return new File([slice], base, {
      type: "application/octet-stream",
      lastModified: Date.now(),
    });
  }

  async function importSelectedCampaignScenario() {
    if (campaignSelectedIdx < 0 || !lastCampaignBuffer) return;
    const row = lastCampaignRows[campaignSelectedIdx];
    if (!row) return;
    try {
      const file = fileFromCampaignSlice(lastCampaignBuffer, row);
      assignFile(file, "");
      hideModalActivity(modsModalCard, { immediate: true });
      hideModalActivity(campaignStandaloneModalCard, { immediate: true });
      if (isModalOpen(modsModal)) closeModsModalFully();
      if (campaignStandaloneModal && isModalOpen(campaignStandaloneModal)) {
        closeModal(campaignStandaloneModal);
      }
      lastCampaignBuffer = null;
      lastCampaignRows = [];
      campaignSelectedIdx = -1;
      applyMainStatus("Ready", "success");
      applyMainProgress(100, { holdMs: 350 });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (isModalOpen(modsModal) && modsModalCard) showModalActivityError(modsModalCard, msg);
      else if (campaignStandaloneModalCard) showModalActivityError(campaignStandaloneModalCard, msg);
      else applyMainStatus(msg, "error");
    }
  }

  async function resolveCampaignToScenario(file) {
    if (!file || !isCampaignFile(file)) return;
    if (campaignBusy || busy) {
      const msg = "Busy \u2014 wait for the current operation to finish.";
      if (isModalOpen(modsModal) && modsModalCard) showModalActivityError(modsModalCard, msg);
      else setStatus(msg, "error");
      return;
    }
    const inModsFlow = isModalOpen(modsModal);
    campaignBusy = true;
    if (inModsFlow) {
      showModalActivity(modsModalCard, { pct: 10, message: "Parsing campaign\u2026" });
    } else {
      openPickerModal(campaignStandaloneModal, campaignStandaloneList);
      showModalActivity(campaignStandaloneModalCard, { pct: 10, message: "Parsing campaign\u2026" });
    }
    try {
      const buf = await file.arrayBuffer();
      const parsed = await callParseCampaign(buf);
      const scenarios = parsed && Array.isArray(parsed.scenarios) ? parsed.scenarios : [];
      if (!scenarios.length) {
        throw new Error("Campaign contains no scenarios.");
      }
      if (scenarios.length === 1) {
        lastCampaignBuffer = buf;
        campaignSelectedIdx = 0;
        lastCampaignRows = scenarios;
        await importSelectedCampaignScenario();
        return;
      }
      lastCampaignBuffer = buf;
      lastCampaignRows = scenarios;
      campaignSelectedIdx = 0;
      if (inModsFlow) {
        modsWizardStep = "campaign";
        paintCampaignFilePicker(lastCampaignRows, 0, campaignSelectedIdx);
        hideModalActivity(modsModalCard, { afterMs: 220 });
        syncModsWizardChrome();
        if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = false;
      } else {
        paintCampaignRowsIntoList(
          campaignStandaloneList,
          lastCampaignRows,
          0,
          campaignSelectedIdx,
        );
        if (campaignStandaloneSelectBtn) campaignStandaloneSelectBtn.disabled = false;
        hideModalActivity(campaignStandaloneModalCard, { afterMs: 220 });
      }
    } catch (err) {
      resetCampaignPickState();
      const msg = err && err.message ? err.message : String(err);
      if (inModsFlow) showModalActivityError(modsModalCard, msg);
      else showModalActivityError(campaignStandaloneModalCard, msg);
    } finally {
      campaignBusy = false;
    }
  }

  if (campaignFileList) {
    campaignFileList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !campaignFileList.contains(li)) return;
      const idx = parseInt(li.getAttribute("data-idx") || "-1", 10);
      if (!Number.isFinite(idx) || idx < 0) return;
      campaignSelectedIdx = idx;
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = false;
      paintCampaignFilePicker(lastCampaignRows, -1, campaignSelectedIdx);
    });
  }

  if (campaignStandaloneList) {
    campaignStandaloneList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !campaignStandaloneList.contains(li)) return;
      const idx = parseInt(li.getAttribute("data-idx") || "-1", 10);
      if (!Number.isFinite(idx) || idx < 0) return;
      campaignSelectedIdx = idx;
      if (campaignStandaloneSelectBtn) campaignStandaloneSelectBtn.disabled = false;
      paintCampaignRowsIntoList(campaignStandaloneList, lastCampaignRows, -1, campaignSelectedIdx);
    });
  }

  // ---------- aocrec modal -------------------------------------------------

  let aocrecLoaded = false;
  let aocrecLoading = false;
  let aocrecRows = []; // { id, guid, label, zipUrl }[]
  let aocrecPickerSelectedId = "";
  let aocrecSearchTimer = 0;

  /** @type {{ civZhToEn: Record<string, string>, mapZhToEn: Record<string, string> } | null} */
  let aocrecSynonyms = null;
  let aocrecSynonymsPromise = null;

  /** @type {string[] | null} */
  let aocrecCivZhKeysSorted = null;
  /** @type {string[] | null} */
  let aocrecMapZhKeysSorted = null;
  /** @type {Record<string, string> | null} */
  let aocrecMapEnToZh = null;

  function normalizeZhPhraseKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[/_]+/g, " ")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function invertZhToEn(map) {
    /** @type {Record<string, string>} */
    const out = {};
    const add = function (enRaw, zh) {
      const aliases = String(enRaw || "")
        .split("/")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
      for (let i = 0; i < aliases.length; i++) {
        const en = aliases[i];
        const k1 = normalizeZhPhraseKey(en);
        const k2 = normalizeZhPhraseKey(en.replace(/[()]/g, " "));
        if (k1 && !out[k1]) out[k1] = zh;
        if (k2 && !out[k2]) out[k2] = zh;
      }
    };

    const keys = Object.keys(map || {});
    for (let i = 0; i < keys.length; i++) {
      add(map[keys[i]], keys[i]);
    }
    return out;
  }

  async function ensureAocrecSynonymsLoaded() {
    if (aocrecSynonyms) return;
    if (!aocrecSynonymsPromise) {
      aocrecSynonymsPromise = fetch("/api/aocrec/synonyms", { cache: "force-cache" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          /** @type {Record<string, string>} */
          const civZhToEn = {};
          /** @type {Record<string, string>} */
          const mapZhToEn = {};

          const ingestPairs = function (pairs, out) {
            if (!Array.isArray(pairs)) return;
            for (let i = 0; i < pairs.length; i++) {
              const pair = pairs[i];
              if (!pair || pair.length < 2) continue;
              const zh = String(pair[0] || "").trim();
              const en = String(pair[1] || "").trim();
              if (!zh || !en) continue;
              if (!out[zh]) out[zh] = en;
            }
          };

          ingestPairs(data && data.civ, civZhToEn);
          ingestPairs(data && data.map, mapZhToEn);

          aocrecSynonyms = { civZhToEn: civZhToEn, mapZhToEn: mapZhToEn };
          aocrecCivZhKeysSorted = null;
          aocrecMapZhKeysSorted = null;
          aocrecMapEnToZh = null;
          aocrecCivZhKeysSorted = Object.keys(civZhToEn).sort(function (a, b) {
            return b.length - a.length;
          });
          aocrecMapZhKeysSorted = Object.keys(mapZhToEn).sort(function (a, b) {
            return b.length - a.length;
          });
          aocrecMapEnToZh = invertZhToEn(mapZhToEn);
        })
        .catch(function () {
          aocrecSynonyms = null;
        });
    }
    await aocrecSynonymsPromise;
  }

  function translateChineseTokens(text, sortedZhKeys, zhToEn) {
    const s = String(text || "");
    if (!s) return "";
    const keys = sortedZhKeys || [];
    let out = "";
    for (let i = 0; i < s.length; ) {
      const ch = s.charCodeAt(i);
      const isZh =
        (ch >= 0x4e00 && ch <= 0x9fff) || // CJK Unified Ideographs (common case)
        (ch >= 0x3400 && ch <= 0x4dbf) || // CJK Extension A
        (ch >= 0xf900 && ch <= 0xfaff); // Compatibility Ideographs

      if (!isZh) {
        out += s[i];
        i += 1;
        continue;
      }

      let matched = false;
      for (let k = 0; k < keys.length; k++) {
        const zh = keys[k];
        if (!zh) continue;
        if (s.startsWith(zh, i)) {
          out += zhToEn[zh] || zh;
          i += zh.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        out += s[i];
        i += 1;
      }
    }
    return out;
  }

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

  /** If every name in matchHint (e.g. "[RVK]TheViper P1") already appears on the row, skip the parenthetical. */
  function aocrecMatchHintRedundant(rowLine, hint) {
    const h = String(hint || "").trim();
    if (!h) return true;
    const ll = String(rowLine || "").toLowerCase();
    const chunks = h
      .split(/\s*,\s*/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean);
    if (!chunks.length) return true;
    for (let i = 0; i < chunks.length; i++) {
      const nm = chunks[i].replace(/\s+P\d+\s*$/i, "").trim();
      if (!nm) return false;
      if (!ll.includes(nm.toLowerCase())) return false;
    }
    return true;
  }

  function formatAocrecRow(r) {
    // Same shape as msFormatMatchRow: ⚔️ DD/MM/YYYY HH:MM - {matchup} on {map} … plus uploaded by (+ optional match hint).

    function aocrecMapToEnglish(name) {
      const s = String(name || "").trim();
      if (!s) return "";
      const dict = (aocrecSynonyms && aocrecSynonyms.mapZhToEn) || null;
      const keys = aocrecMapZhKeysSorted;
      if (dict && keys && keys.length) {
        if (dict[s]) return dict[s];
        // Sometimes ES stores English-ish tokens; translate via inverted keys when possible.
        const nk = normalizeZhPhraseKey(s);
        if (aocrecMapEnToZh && nk && aocrecMapEnToZh[nk]) {
          const zh = aocrecMapEnToZh[nk];
          return dict[zh] || s;
        }
      }
      return s;
    }

    function aocrecMatchupToEnglish(matchup) {
      const s = String(matchup || "");
      if (!s) return "";
      const dict = (aocrecSynonyms && aocrecSynonyms.civZhToEn) || null;
      const keys = aocrecCivZhKeysSorted;
      if (!dict || !keys || !keys.length) return s;
      return translateChineseTokens(s, keys, dict);
    }

    const whenRaw = r.gameDate != null ? r.gameDate : r.uploadedAt;
    let whenMs = NaN;
    if (whenRaw != null && whenRaw !== "") {
      whenMs =
        typeof whenRaw === "number" && Number.isFinite(whenRaw)
          ? whenRaw
          : new Date(whenRaw).getTime();
    }
    const whenStr = Number.isFinite(whenMs) ? msFormatMatchStartDDMMYYYY(whenMs) : "";

    let mapEn = r.mapName ? aocrecMapToEnglish(r.mapName).trim() : "";
    if (mapEn && !/[\u4e00-\u9fff]/.test(mapEn)) mapEn = tidyMapName(mapEn);

    const grouping = r.matchup ? aocrecMatchupToEnglish(String(r.matchup)).trim() : "";
    const map = mapEn;
    const uploadedBy = r.uploadedBy ? String(r.uploadedBy).trim() : "";
    const suffix = uploadedBy ? (" uploaded by " + uploadedBy) : "";

    let line = "\u2694\ufe0f ";
    if (whenStr) line += whenStr + " - ";
    else line += "- ";

    if (grouping) line += grouping + " ";
    if (map) line += "on " + map;
    else if (!grouping) line += String(r.id || "recording");

    line += suffix;

    const mh = r.matchHint ? String(r.matchHint).trim() : "";
    if (mh && !aocrecMatchHintRedundant(line, mh)) line += " (" + mh + ")";
    return line;
  }

  function paintAocrecPicker(options, activeIdx, selectedId) {
    if (!aocrecList) return;
    aocrecList.textContent = "";
    if (!options || options.length === 0) {
      const li = document.createElement("li");
      li.className = "picker__option picker__option--empty";
      const q = aocrecSearch ? aocrecSearch.value.trim() : "";
      li.textContent = q && q.length < PICKER_MIN_QUERY_LENGTH
        ? "Type at least 2 characters"
        : (aocrecLoaded ? "No recordings" : "Loading...");
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
      if (aocrecModalCard) {
        showModalActivityError(aocrecModalCard, "Busy rendering \u2014 wait for it to finish.");
      } else {
        setStatus("Busy rendering \u2014 wait for it to finish.", "error");
      }
      return;
    }
    const row = (aocrecRows || []).find(function (r) { return r.id === id; });
    if (!row || !row.zipUrl) return;

    showModalActivity(aocrecModalCard, { pct: 4, message: "Downloading recording\u2026" });

    try {
      const res = await fetch(
        "/api/aocrec/zip?url=" + encodeURIComponent(row.zipUrl),
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ")");
      const buf = await arrayBufferFromResponseWithProgress(res, function (ratio) {
        setModalActivityProgress(
          aocrecModalCard,
          lerpProgressPct(10, 74, ratio),
          "Downloading recording\u2026",
        );
      });
      setModalActivityProgress(aocrecModalCard, 80, "Extracting\u2026");

      const u8 = new Uint8Array(buf);
      const files = fflate.unzipSync(u8);
      setModalActivityProgress(aocrecModalCard, 92, "Finding recording\u2026");
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

      assignFile(file, "aocrec");
      hideModalActivity(aocrecModalCard, { afterMs: 200 });
      closeModal(aocrecModal);
      applyMainStatus("Ready", "success");
      applyMainProgress(100, { holdMs: 350 });
    } catch (err) {
      showModalActivityError(
        aocrecModalCard,
        err && err.message ? err.message : String(err),
      );
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
      else {
        const selIdx = selectedId
          ? current.findIndex(function (r) { return r.id === selectedId; })
          : -1;
        activeIdx = selIdx >= 0 ? selIdx : 0;
      }
      paintAocrecPicker(current, activeIdx, selectedId);
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = !selectedId;
    }

    aocrecList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !aocrecList.contains(li)) return;
      const id = li.getAttribute("data-id") || "";
      const idx = Number(li.getAttribute("data-idx") || "-1");
      if (id) commit(id, Number.isFinite(idx) ? idx : -1);
    });

    function commit(id, idx) {
      selectedId = id || "";
      aocrecPickerSelectedId = selectedId;
      if (typeof idx === "number" && idx >= 0) activeIdx = idx;
      paintAocrecPicker(current, activeIdx, selectedId);
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = !selectedId;
    }

    render();
    return { render: render, setRows: function (rows) { aocrecRows = rows || []; render(); } };
  }

  const aocrecPicker = createAocrecPicker();

  async function loadAocrecRecent() {
    if (aocrecLoading) return;
    aocrecLoading = true;
    setPickerShellLoading(aocrecLoadingEl, aocrecList, true);
    try {
      const res = await fetch("/api/aocrec/recent?size=" + PICKER_PAGE_SIZE, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      await ensureAocrecSynonymsLoaded();
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
      showModalActivityError(
        aocrecModalCard,
        err && err.message ? err.message : String(err),
      );
    } finally {
      aocrecLoading = false;
      setPickerShellLoading(aocrecLoadingEl, aocrecList, false);
    }
  }

  async function fetchAocrecSearch(term) {
    const q = String(term || "").trim();
    if (!q) {
      aocrecLoaded = false;
      aocrecRows = [];
      aocrecPickerSelectedId = "";
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = true;
      if (aocrecPicker) aocrecPicker.setRows([]);
      return;
    }
    if (q.length < PICKER_MIN_QUERY_LENGTH) {
      aocrecLoaded = true;
      aocrecRows = [];
      aocrecPickerSelectedId = "";
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = true;
      if (aocrecPicker) aocrecPicker.setRows([]);
      return;
    }

    if (aocrecLoading) return;
    aocrecLoading = true;
    setPickerShellLoading(aocrecLoadingEl, aocrecList, true);
    let aocrecSearchHadError = false;
    try {
      const res = await fetch(
        "/api/aocrec/search?q=" + encodeURIComponent(q) + "&size=" + PICKER_PAGE_SIZE,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      await ensureAocrecSynonymsLoaded();
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
      aocrecPickerSelectedId = "";
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = true;
      if (aocrecPicker) aocrecPicker.setRows(aocrecRows);
    } catch (err) {
      aocrecSearchHadError = true;
      aocrecLoaded = true;
      aocrecRows = [];
      aocrecPickerSelectedId = "";
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = true;
      if (aocrecPicker) aocrecPicker.setRows([]);
      console.warn("[aocrec] search failed:", err);
      showModalActivityError(
        aocrecModalCard,
        err && err.message ? err.message : String(err),
      );
    } finally {
      aocrecLoading = false;
      setPickerShellLoading(aocrecLoadingEl, aocrecList, false);
    }
  }

  // ---------- Microsoft modal ---------------------------------------------

  let msProfiles = []; // { profileId, alias, platformName }
  let msMatches = []; // { matchId, startedAt, mapName, matchup, raceId, civilizationName, ... }
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

  function tidyMapName(raw) {
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
    const map = m.mapName ? String(m.mapName).trim() : ("Match " + m.matchId);
    let civ = "";
    if (m.civilizationName) civ = String(m.civilizationName);
    else if (m.raceId != null && Number.isFinite(Number(m.raceId))) {
      civ = "race " + m.raceId;
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
      "/api/ms/recent-matches?profileId=" + encodeURIComponent(profileId) + "&count=" + PICKER_PAGE_SIZE,
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
            mapLocationId: r.mapLocationId != null ? Number(r.mapLocationId) : undefined,
            raceId: r.raceId != null ? Number(r.raceId) : undefined,
            civilizationName: r.civilizationName != null ? String(r.civilizationName) : "",
            mappingVersion: r.mappingVersion != null ? Number(r.mappingVersion) : undefined,
          };
        })
        .filter(function (m) { return Number.isFinite(m.matchId) && m.matchId > 0; });
      msMatchActiveIdx = msMatches.length ? 0 : -1;
      renderMs();
    } catch (err) {
      showModalActivityError(
        microsoftModalCard,
        err && err.message ? err.message : String(err),
      );
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
    if (busy || campaignBusy) return;
    if (e.target === browseBtn) return;
    openFilePicker();
  });
  browseBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!busy && !campaignBusy) openFilePicker();
  });
  dropzone.addEventListener("keydown", function (e) {
    if (busy || campaignBusy) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      if (busy || campaignBusy) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      dropzone.classList.add("is-dragover");
    });
  });
  dropzone.addEventListener("dragleave", function () {
    dropzone.classList.remove("is-dragover");
  });
  dropzone.addEventListener("drop", function (e) {
    if (busy || campaignBusy) return;
    e.preventDefault();
    dropzone.classList.remove("is-dragover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (isCampaignFile(f)) {
      void resolveCampaignToScenario(f);
      return;
    }
    assignFile(f, "");
  });

  fileInput.addEventListener("change", function () {
    const f = fileInput.files && fileInput.files[0];
    if (!f) {
      updateFileMeta();
      return;
    }
    if (isCampaignFile(f)) {
      const fileCopy = f;
      clearFileInput();
      void resolveCampaignToScenario(fileCopy);
      return;
    }
    updateFileMeta();
  });
  updateFileMeta();

  // ---------- modals wiring ----------------------------------------------

  wireModal(scenarioModal);
  wireModal(aocrecModal);
  wireModal(microsoftModal);
  wireModal(campaignStandaloneModal);

  if (modsModal) {
    modsModal.addEventListener("click", function (ev) {
      if (ev.target === modsModal) closeModsModalFully();
      if (ev.target.closest && ev.target.closest("[data-mods-modal-close]")) closeModsModalFully();
    });
  }
  if (modsWizardCancelBtn) {
    modsWizardCancelBtn.addEventListener("click", function () {
      closeModsModalFully();
    });
  }
  if (modsWizardBackBtn) {
    modsWizardBackBtn.addEventListener("click", function () {
      modsWizardGoBack();
    });
  }
  if (modsWizardSelectBtn) {
    modsWizardSelectBtn.addEventListener("click", function () {
      if (modsWizardStep === "mod") void importSelectedModScenario();
      else if (modsWizardStep === "zip") void importSelectedModZipScenario();
      else void importSelectedCampaignScenario();
    });
  }
  if (campaignStandaloneSelectBtn) {
    campaignStandaloneSelectBtn.addEventListener("click", function () {
      void importSelectedCampaignScenario();
    });
  }

  if (openScenarioModalBtn) {
    openScenarioModalBtn.addEventListener("click", function () {
      if (scenarioSearch) scenarioSearch.value = "";
      scenarioIndex = [];
      scenarioById = new Map();
      scenarioPickerSelectedId = "";
      updateScenarioSearchPlaceholder();
      if (scenarioSelectBtn) scenarioSelectBtn.disabled = true;
      if (scenarioPicker) scenarioPicker.render();
      hideModalActivity(scenarioModalCard, { immediate: true });
      openPickerModal(scenarioModal, scenarioSearch);
      void loadScenarioIndex();
    });
  }
  if (openModsModalBtn) {
    openModsModalBtn.addEventListener("click", function () {
      if (modsSearchTimer) clearTimeout(modsSearchTimer);
      if (modsSearch) modsSearch.value = "";
      modsLoaded = false;
      modsFetchInFlight = false;
      modsRows = [];
      modsPickerSelectedId = "";
      resetModsWizard();
      syncModsWizardChrome();
      if (modsWizardSelectBtn) modsWizardSelectBtn.disabled = true;
      if (modsPicker) modsPicker.render();
      openPickerModal(modsModal, modsSearch);
      void fetchModsSearch("");
    });
  }
  if (openAocrecModalBtn) {
    openAocrecModalBtn.addEventListener("click", function () {
      if (aocrecSearch) aocrecSearch.value = "";
      aocrecLoaded = false;
      aocrecRows = [];
      aocrecPickerSelectedId = "";
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = true;
      if (aocrecPicker) aocrecPicker.setRows([]);
      hideModalActivity(aocrecModalCard, { immediate: true });
      openPickerModal(aocrecModal, aocrecSearch);
      void loadAocrecRecent();
      if (aocrecSelectBtn) aocrecSelectBtn.disabled = !aocrecPickerSelectedId;
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
      hideModalActivity(microsoftModalCard, { immediate: true });
      openPickerModal(microsoftModal, msProfileSearch);
    });
  }

  if (scenarioSelectBtn) scenarioSelectBtn.addEventListener("click", function () { void importSelectedScenario(); });
  if (aocrecSelectBtn) aocrecSelectBtn.addEventListener("click", function () { void importSelectedAocrec(); });

  if (aocrecSearch) {
    aocrecSearch.addEventListener("input", function () {
      if (aocrecSearchTimer) clearTimeout(aocrecSearchTimer);
      aocrecSearchTimer = setTimeout(function () {
        const q = aocrecSearch.value.trim();
        if (!q) void loadAocrecRecent();
        else void fetchAocrecSearch(q);
      }, PICKER_SEARCH_DEBOUNCE_MS);
    });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (isModalOpen(modsModal)) {
      if (modsWizardStep === "mod") closeModsModalFully();
      else modsWizardGoBack();
    } else if (isModalOpen(campaignStandaloneModal)) closeModal(campaignStandaloneModal);
    else if (isModalOpen(aocrecModal)) closeModal(aocrecModal);
    else if (isModalOpen(scenarioModal)) closeModal(scenarioModal);
    else if (isModalOpen(microsoftModal)) closeModal(microsoftModal);
  });

  if (msProfileSearch && msProfileList) {
    function scheduleSearch() {
      if (msProfileDebounce) clearTimeout(msProfileDebounce);
      const qEarly = msProfileSearch.value.trim();
      if (qEarly.length < PICKER_MIN_QUERY_LENGTH) {
        msProfileFetchSeq += 1;
        setMsProfileSearchLoading(false);
        hideModalActivity(microsoftModalCard, { immediate: true });
        msProfiles = [];
        msProfileActiveIdx = -1;
        msSelectedProfileId = 0;
        msSelectedMatchId = 0;
        msMatches = [];
        msMatchActiveIdx = -1;
        renderMs();
        return;
      }
      setMsProfileSearchLoading(false);
      msProfileDebounce = setTimeout(async function () {
        const q = msProfileSearch.value.trim();
        if (q.length < PICKER_MIN_QUERY_LENGTH) {
          msProfileFetchSeq += 1;
          setMsProfileSearchLoading(false);
          hideModalActivity(microsoftModalCard, { immediate: true });
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
          setMsProfileSearchLoading(true);
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
            .slice(0, PICKER_PAGE_SIZE);
          msProfileActiveIdx = msProfiles.length ? 0 : -1;
          renderMs();
        } catch (err) {
          if (seq !== msProfileFetchSeq) return;
          msProfiles = [];
          msProfileActiveIdx = -1;
          renderMs();
          showModalActivityError(
            microsoftModalCard,
            err && err.message ? err.message : String(err),
          );
        } finally {
          if (seq === msProfileFetchSeq) setMsProfileSearchLoading(false);
        }
      }, PICKER_SEARCH_DEBOUNCE_MS);
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
          hideModalActivity(microsoftModalCard, { immediate: true });
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
      const idx = Number(li.getAttribute("data-idx") || "-1");
      if (Number.isFinite(idx) && idx >= 0) {
        msProfileActiveIdx = idx;
        renderMs();
      }
      if (id) void msSelectProfile(id);
    });
  }

  if (msMatchList) {
    msMatchList.addEventListener("click", function (ev) {
      const li = ev.target.closest(".picker__option[role='option']");
      if (!li || !msMatchList.contains(li)) return;
      const id = Number(li.getAttribute("data-match-id") || "0");
      if (!id) return;
      const idx = Number(li.getAttribute("data-idx") || "-1");
      if (Number.isFinite(idx) && idx >= 0) msMatchActiveIdx = idx;
      msSelectedMatchId = id;
      renderMs();
      if (msSelectBtn) msSelectBtn.disabled = !msSelectedProfileId || !msSelectedMatchId;
    });
  }

  async function importSelectedMicrosoftReplay() {
    if (!msSelectedProfileId || !msSelectedMatchId) return;
    if (busy) {
      if (microsoftModalCard) {
        showModalActivityError(microsoftModalCard, "Busy rendering \u2014 wait for it to finish.");
      } else {
        setStatus("Busy rendering \u2014 wait for it to finish.", "error");
      }
      return;
    }

    showModalActivity(microsoftModalCard, { pct: 4, message: "Downloading recording\u2026" });

    try {
      const res = await fetch(
        "/api/ms/replay-zip?matchId=" +
          encodeURIComponent(msSelectedMatchId) +
          "&profileId=" +
          encodeURIComponent(msSelectedProfileId),
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ")");
      const buf = await arrayBufferFromResponseWithProgress(res, function (ratio) {
        setModalActivityProgress(
          microsoftModalCard,
          lerpProgressPct(10, 74, ratio),
          "Downloading recording\u2026",
        );
      });
      setModalActivityProgress(microsoftModalCard, 80, "Extracting\u2026");

      const u8 = new Uint8Array(buf);
      const files = fflate.unzipSync(u8);
      setModalActivityProgress(microsoftModalCard, 92, "Finding recording\u2026");
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

      assignFile(file, "microsoft");
      hideModalActivity(microsoftModalCard, { afterMs: 200 });
      closeModal(microsoftModal);
      applyMainStatus("Ready", "success");
      applyMainProgress(100, { holdMs: 350 });
    } catch (err) {
      showModalActivityError(
        microsoftModalCard,
        err && err.message ? err.message : String(err),
      );
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
    worker = new Worker("/minimap/worker.js");
    worker.onmessage = function (ev) {
      const msg = ev.data || {};
      if (msg.type === "progress") {
        if (msg.phase === "boot" && !bootDone) {
          const total = msg.total || BOOT_TOTAL_DEFAULT;
          const step = Math.max(1, msg.step || 1);
          const pct =
            typeof msg.pct === "number"
              ? Math.min(99, Math.round(msg.pct))
              : Math.min(99, Math.round((step / total) * 100));
          applyMainProgress(pct, { autoHide: false });
          applyMainStatus(msg.message || "Loading\u2026", "loading");
          if (step >= total) {
            bootDone = true;
            applyMainProgress(100, { holdMs: 300 });
            applyMainStatus("Ready", "success");
          }
        } else if (msg.phase === "campaignParse") {
          if (isModalOpen(modsModal) && modsModalCard) {
            showModalActivity(modsModalCard, {
              pct: typeof msg.pct === "number" ? msg.pct : 40,
              message: msg.message || "Parsing campaign\u2026",
            });
          } else if (isModalOpen(campaignStandaloneModal) && campaignStandaloneModalCard) {
            showModalActivity(campaignStandaloneModalCard, {
              pct: typeof msg.pct === "number" ? msg.pct : 40,
              message: msg.message || "Parsing campaign\u2026",
            });
          } else if (pickerModalDepth === 0) {
            applyMainStatus(msg.message || "\u2026", "loading");
            if (typeof msg.pct === "number") applyMainProgress(msg.pct, { autoHide: false });
          }
        } else if (pickerModalDepth > 0) {
          return;
        } else if (msg.phase === "render") {
          applyMainStatus(msg.message || "Rendering\u2026", "loading");
          if (typeof msg.pct === "number") applyMainProgress(msg.pct, { autoHide: false });
        } else if (msg.phase === "error") {
          applyMainProgress(100, { error: true, holdMs: 1500 });
          applyMainStatus(msg.message || "Error", "error");
        } else {
          applyMainStatus(msg.message || "\u2026", "loading");
        }
        return;
      }
      if (msg.type === "campaignParseResult") {
        const entry = pendingCampaign.get(msg.id);
        if (!entry) return;
        pendingCampaign.delete(msg.id);
        if (msg.ok) {
          entry.resolve({
            campaignName: msg.campaignName,
            scenarios: msg.scenarios || [],
          });
        } else {
          entry.reject(new Error(msg.error || "Campaign parse failed."));
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
      pendingCampaign.forEach(function (entry) {
        entry.reject(new Error(e.message || "Worker error"));
      });
      pendingCampaign.clear();
      applyMainProgress(100, { error: true, holdMs: 1200 });
      applyMainStatus(e.message || "Worker error", "error");
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
    setProgress(6, { autoHide: false });

    try {
      const settings = buildSettings();
      const ext = fileExtension(file.name);
      const bytes = await file.arrayBuffer();
      setProgress(18, { autoHide: false });
      setStatus("Rendering\u2026", "loading");
      const png = await callRender(bytes, ext, settings);
      setProgress(94, { autoHide: false });
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
  setProgress(4, { autoHide: false });
  setStatus("Loading runtime\u2026", "loading");
  ensureWorker();
  worker.postMessage({ type: "warmup" });
})();
