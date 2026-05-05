// /campaignmanager/app.js
//
// UI controller for the Campaign Manager museum page. Wires the Extract
// and Pack tabs to the pure-JS rge-campaign library, with drag-drop,
// scenario reordering, ZIP-all-extracted, and a single-file download.

import {
  readCampaign,
  writeCampaign,
  detectFormat,
  extensionToFormat,
  formatToExtension,
  FORMATS,
} from "/modules/rge-campaign/rge-campaign.js";
import { zipSync } from "/modules/fflate/fflate.browser.js";

// --------------------------------------------------------------------------
// Tab controller (hash-synced)
// --------------------------------------------------------------------------

(() => {
  const tabs = Array.from(document.querySelectorAll(".tab[data-tab]"));
  if (tabs.length === 0) return;

  const panels = {
    extract: document.getElementById("panel-extract"),
    pack:    document.getElementById("panel-pack"),
  };

  function select(name) {
    if (!panels[name]) name = "extract";
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    Object.entries(panels).forEach(([k, el]) => {
      if (el) el.hidden = k !== name;
    });
  }

  tabs.forEach((t) => {
    t.addEventListener("click", () => {
      const name = t.dataset.tab;
      select(name);
      if (history.replaceState) history.replaceState(null, "", "#" + name);
      else location.hash = name;
    });
  });

  const initial = (location.hash || "").replace("#", "");
  select(panels[initial] ? initial : "extract");

  window.addEventListener("hashchange", () => {
    const n = (location.hash || "").replace("#", "");
    if (panels[n]) select(n);
  });
})();

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  if (bytes >= 1024)        return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function downloadBlob(bytes, filename, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function safeFilename(s, fallback) {
  const cleaned = String(s || "").trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "_");
  return cleaned || fallback;
}

function formatLabel(format) {
  if (format === FORMATS.LEGACY) return "Legacy";
  if (format === FORMATS.DE1)    return "AoE1: DE";
  if (format === FORMATS.DE2)    return "AoE2: DE";
  return "Unknown";
}

function badgeClass(format) {
  if (format === FORMATS.LEGACY) return "format-badge--legacy";
  if (format === FORMATS.DE1)    return "format-badge--de1";
  if (format === FORMATS.DE2)    return "format-badge--de2";
  return "";
}

function wireDropZone(zone, fileInput, onFiles) {
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  ["dragenter", "dragover", "dragleave", "drop"].forEach((evt) =>
    zone.addEventListener(evt, preventDefaults),
  );
  zone.addEventListener("dragenter", () => zone.classList.add("drag-over"));
  zone.addEventListener("dragover",  () => zone.classList.add("drag-over"));
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", (e) => {
    zone.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) onFiles(files);
  });
  zone.addEventListener("click", (e) => {
    // The <label for="..."> already triggers the file input; avoid a double click.
    if (e.target.tagName === "LABEL" || e.target.closest("label")) return;
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) onFiles(files);
    fileInput.value = "";
  });
}

function setStatus(el, textEl, kind, text) {
  if (!el) return;
  el.hidden = !text;
  el.classList.remove(
    "statusbar--idle",
    "statusbar--loading",
    "statusbar--success",
    "statusbar--error",
  );
  el.classList.add(`statusbar--${kind}`);
  if (textEl) textEl.textContent = text || "";
}

// --------------------------------------------------------------------------
// Extract tab
// --------------------------------------------------------------------------

(() => {
  const dropZone   = document.getElementById("extract-drop");
  const fileInput  = document.getElementById("extract-file");
  const statusEl   = document.getElementById("extract-status");
  const statusText = document.getElementById("extract-status-text");
  const resultEl   = document.getElementById("extract-result");
  const nameEl     = document.getElementById("extract-campaign-name");
  const metaEl     = document.getElementById("extract-campaign-meta");
  const tbody      = document.getElementById("campaign-tbody");
  const zipBtn     = document.getElementById("extract-zip-btn");

  if (!dropZone || !fileInput) return;

  /** @type {{ campaign: ReturnType<typeof readCampaign>, sourceName: string } | null} */
  let current = null;

  wireDropZone(dropZone, fileInput, (files) => {
    handleFile(files[0]);
  });

  async function handleFile(file) {
    if (!file) return;
    setStatus(statusEl, statusText, "loading", `Reading ${file.name}\u2026`);
    resultEl.hidden = true;
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      if (!detectFormat(buf)) {
        throw new Error("Unrecognised header. Expected .cpn / .cpx / .aoecpn / .aoe2campaign.");
      }
      const campaign = readCampaign(buf);
      current = { campaign, sourceName: file.name };
      render();
      setStatus(
        statusEl,
        statusText,
        "success",
        `Extracted ${campaign.scenarios.length} scenario${campaign.scenarios.length === 1 ? "" : "s"} from ${file.name}.`,
      );
    } catch (err) {
      console.error(err);
      current = null;
      resultEl.hidden = true;
      setStatus(statusEl, statusText, "error", err && err.message ? err.message : String(err));
    }
  }

  function render() {
    if (!current) return;
    const { campaign, sourceName } = current;

    nameEl.textContent = campaign.name || "(unnamed)";

    metaEl.innerHTML = "";
    const badge = document.createElement("span");
    badge.className = `format-badge ${badgeClass(campaign.format)}`;
    badge.textContent = formatLabel(campaign.format);
    metaEl.appendChild(badge);

    const meta = document.createElement("span");
    meta.textContent = `version ${campaign.versionString} \u00b7 ${campaign.scenarios.length} scenarios \u00b7 ${sourceName}`;
    metaEl.appendChild(meta);

    tbody.innerHTML = "";
    campaign.scenarios.forEach((s, i) => {
      const tr = document.createElement("tr");

      const numTd = document.createElement("td");
      numTd.className = "col-num";
      numTd.textContent = String(i + 1);
      tr.appendChild(numTd);

      const nameTd = document.createElement("td");
      nameTd.className = "col-name";
      nameTd.textContent = s.name || "(unnamed)";
      tr.appendChild(nameTd);

      const fileTd = document.createElement("td");
      fileTd.className = "col-file";
      fileTd.textContent = s.fileName;
      tr.appendChild(fileTd);

      const sizeTd = document.createElement("td");
      sizeTd.className = "col-size";
      sizeTd.textContent = fmtSize(s.size);
      tr.appendChild(sizeTd);

      const dlTd = document.createElement("td");
      dlTd.className = "col-dl";
      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "btn btn--small btn--ghost";
      dl.textContent = "Download";
      dl.addEventListener("click", () => downloadOne(s));
      dlTd.appendChild(dl);
      tr.appendChild(dlTd);

      tbody.appendChild(tr);
    });

    zipBtn.disabled = campaign.scenarios.length === 0;
    resultEl.hidden = false;
  }

  function downloadOne(s) {
    if (!s || !s.bytes) return;
    downloadBlob(s.bytes, safeFilename(s.fileName, "scenario.scn"));
  }

  zipBtn?.addEventListener("click", () => {
    if (!current) return;
    const { campaign } = current;

    // De-dupe filenames (some campaigns reuse names across scenarios).
    const seen = new Map();
    const entries = {};
    for (const s of campaign.scenarios) {
      let name = safeFilename(s.fileName, `scenario-${s.index + 1}.scn`);
      const count = seen.get(name) || 0;
      if (count > 0) {
        const dot = name.lastIndexOf(".");
        const stem = dot >= 0 ? name.slice(0, dot) : name;
        const ext  = dot >= 0 ? name.slice(dot)   : "";
        name = `${stem} (${count})${ext}`;
      }
      seen.set(safeFilename(s.fileName, ""), count + 1);
      // fflate accepts a flat object map of { path: Uint8Array }
      // (level 0 = stored; the scenarios inside are usually compressed already).
      entries[name] = [s.bytes, { level: 0 }];
    }

    const zipped = zipSync(entries, { level: 0 });
    const stem = safeFilename(campaign.name || "campaign", "campaign");
    downloadBlob(zipped, `${stem}.zip`, "application/zip");
  });
})();

// --------------------------------------------------------------------------
// Pack tab
// --------------------------------------------------------------------------

(() => {
  const form     = document.getElementById("pack-form");
  const dropZone = document.getElementById("pack-drop");
  const fileIn   = document.getElementById("pack-file");
  const nameIn   = document.getElementById("pack-name");
  const extIn    = document.getElementById("pack-ext");
  const listEl   = document.getElementById("pack-list");
  const listUl   = document.getElementById("pack-list-items");
  const warnEl   = document.getElementById("pack-warning");
  const buildBtn = document.getElementById("pack-btn");

  if (!form || !dropZone || !fileIn) return;

  /** @type {Array<{ id: number, name: string, bytes: Uint8Array }>} */
  const scenarios = [];
  let nextId = 1;

  wireDropZone(dropZone, fileIn, addFiles);

  async function addFiles(files) {
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      scenarios.push({ id: nextId++, name: f.name, bytes });
    }
    render();
  }

  function render() {
    listEl.classList.toggle("hidden", scenarios.length === 0);
    listUl.innerHTML = "";

    const format = extensionToFormat(extIn.value);

    scenarios.forEach((s) => {
      const ext = (s.name.split(".").pop() || "").toLowerCase();
      const incompatible = !isAllowedScenarioExt(format, ext);

      const li = document.createElement("li");
      li.draggable = true;
      li.dataset.id = String(s.id);
      if (incompatible) li.classList.add("pack-item-bad");

      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.textContent = "\u2630";
      li.appendChild(handle);

      const nm = document.createElement("span");
      nm.className = "pack-item-name";
      nm.textContent = s.name;
      li.appendChild(nm);

      const sz = document.createElement("span");
      sz.className = "pack-item-size";
      sz.textContent = fmtSize(s.bytes.byteLength);
      li.appendChild(sz);

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "pack-remove-btn";
      rm.title = "Remove";
      rm.textContent = "\u00d7";
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = scenarios.findIndex((x) => x.id === s.id);
        if (idx >= 0) scenarios.splice(idx, 1);
        render();
      });
      li.appendChild(rm);

      wireDragRow(li);
      listUl.appendChild(li);
    });

    updateWarnings();
    buildBtn.disabled = scenarios.length === 0 || warnEl.classList.contains("active");
  }

  function isAllowedScenarioExt(format, ext) {
    if (ext === "scn" || ext === "scx") return true;
    if (ext === "aoescn")       return format === FORMATS.DE1 || format === FORMATS.DE2;
    if (ext === "aoe2scenario") return format === FORMATS.DE2;
    return false;
  }

  function updateWarnings() {
    const format = extensionToFormat(extIn.value);
    const bad = [];
    for (const s of scenarios) {
      const ext = (s.name.split(".").pop() || "").toLowerCase();
      if (!isAllowedScenarioExt(format, ext)) bad.push(s.name);
    }
    if (bad.length === 0) {
      warnEl.classList.add("hidden");
      warnEl.classList.remove("active");
      buildBtn.disabled = scenarios.length === 0;
    } else {
      warnEl.textContent = `Incompatible scenarios for .${formatToExtension(format)}: ${bad.join(", ")}`;
      warnEl.classList.remove("hidden");
      warnEl.classList.add("active");
      buildBtn.disabled = true;
    }
  }

  // ---- drag-to-reorder ----------------------------------------------------

  let dragId = null;

  function wireDragRow(li) {
    li.addEventListener("dragstart", (e) => {
      dragId = Number(li.dataset.id);
      li.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", li.dataset.id || "");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      Array.from(listUl.children).forEach((c) => c.classList.remove("drag-over"));
      dragId = null;
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      li.classList.add("drag-over");
    });
    li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drag-over");
      const targetId = Number(li.dataset.id);
      if (!dragId || dragId === targetId) return;
      const from = scenarios.findIndex((s) => s.id === dragId);
      const to   = scenarios.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = scenarios.splice(from, 1);
      scenarios.splice(to, 0, moved);
      render();
    });
  }

  // ---- inputs -------------------------------------------------------------

  extIn.addEventListener("change", render);
  nameIn.addEventListener("input", () => {
    buildBtn.disabled = scenarios.length === 0 || warnEl.classList.contains("active");
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (buildBtn.disabled) return;

    try {
      const out = writeCampaign({
        ext: extIn.value,
        name: nameIn.value || "Untitled",
        scenarios: scenarios.map((s) => ({ fileName: s.name, bytes: s.bytes })),
      });
      const stem = safeFilename(nameIn.value, "campaign");
      downloadBlob(out, `${stem}.${extIn.value}`);
    } catch (err) {
      console.error(err);
      warnEl.textContent = err && err.message ? err.message : String(err);
      warnEl.classList.remove("hidden");
      warnEl.classList.add("active");
    }
  });

  render();
})();
