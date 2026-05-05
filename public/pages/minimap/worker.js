// Pyodide-backed renderer for /pages/minimap.
// Runs in a DedicatedWorker so the UI thread stays responsive during boot +
// render. Pyodide itself and the stdlib wheels come from jsDelivr; the
// AOE2-McMinimap source tree is served from this origin as a single tarball.

const PYODIDE_VERSION = "0.28.3";
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";
const VENDOR_TAR_URL = "/modules/aoe2mcminimap/aoe2mcminimap.tar";
const BOOTSTRAP_URL = "/minimap/py/bootstrap.py";
const VENDOR_EXTRACT_DIR = "/home/pyodide/aoe2mcminimap";
importScripts(PYODIDE_BASE + "pyodide.js");

// Boot-phase steps reported to the UI; the main thread uses these to drive
// the top progress bar deterministically. Keep in sync with the calls below.
const BOOT_STEPS = 6; // runtime, Pillow+micropip, packages, tar, bootstrap, ready
let bootStep = 0;

function progress(message, opts) {
  const options = opts || {};
  const phase = options.phase || "boot";
  if (phase === "boot") bootStep++;
  const payload = { type: "progress", message: message, phase: phase };
  if (phase === "boot") {
    payload.step = bootStep;
    payload.total = BOOT_STEPS;
  }
  if (typeof options.pct === "number") payload.pct = options.pct;
  self.postMessage(payload);
}

let pyodideReady = null;

async function boot() {
  progress("Loading Python runtime\u2026", { phase: "boot", pct: 6 });
  // eslint-disable-next-line no-undef
  const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

  progress("Loading Pillow + micropip\u2026", { phase: "boot", pct: 20 });
  await pyodide.loadPackage(["Pillow", "micropip"]);

  progress("Installing Python packages\u2026", { phase: "boot", pct: 38 });
  // `construct==2.8.16` and `aocref` are vendored in the tarball because
  // PyPI only ships sdists for those (and micropip needs pure-Python
  // wheels). The remaining packages are pure-Python wheels on PyPI.
  // `keep_going=True` so one optional dep failing does not take the whole
  // render path down.
  await pyodide.runPythonAsync(
    [
      "import micropip",
      "await micropip.install(",
      "    [",
      '        "AoE2ScenarioParser",',
      '        "mgz-fast",',
      '        "tabulate",',
      "    ],",
      "    keep_going=True,",
      ")",
    ].join("\n"),
  );

  progress("Unpacking McMinimap source\u2026", { phase: "boot", pct: 56 });
  const tarRes = await fetch(VENDOR_TAR_URL);
  if (!tarRes.ok) throw new Error("Failed to fetch vendor tar: HTTP " + tarRes.status);
  const tar = new Uint8Array(await tarRes.arrayBuffer());
  try {
    pyodide.FS.mkdirTree(VENDOR_EXTRACT_DIR);
  } catch (_e) {
    // Already exists - fine.
  }
  pyodide.unpackArchive(tar, "tar", { extractDir: VENDOR_EXTRACT_DIR });

  progress("Loading renderer\u2026", { phase: "boot", pct: 74 });
  const bootstrapRes = await fetch(BOOTSTRAP_URL);
  if (!bootstrapRes.ok) {
    throw new Error("Failed to fetch bootstrap.py: HTTP " + bootstrapRes.status);
  }
  const bootstrap = await bootstrapRes.text();
  await pyodide.runPythonAsync(bootstrap);

  progress("Ready.", { phase: "boot", pct: 94 });
  return pyodide;
}

async function ensurePyodide() {
  if (!pyodideReady) {
    pyodideReady = boot().catch(function (err) {
      pyodideReady = null;
      throw err;
    });
  }
  return pyodideReady;
}

async function handleRender(id, fileBytes, ext, settings) {
  let pyodide;
  try {
    pyodide = await ensurePyodide();
  } catch (err) {
    self.postMessage({
      type: "result",
      id: id,
      ok: false,
      error: "Failed to start Python runtime: " + (err && err.message ? err.message : String(err)),
    });
    return;
  }

  let bytesView = null;
  let settingsProxy = null;
  let pngProxy = null;
  try {
    progress("Preparing render\u2026", { phase: "render", pct: 22 });
    bytesView = new Uint8Array(fileBytes);

    pyodide.globals.set("_bytes", bytesView);
    // McMinimap.py handles scenario routing by sniffing file bytes (format 1.36+ -> AoE2ScenarioParser,
    // older -> geniescx_legacy). Extension is still relevant for recorded games.
    pyodide.globals.set("_ext", ext);
    settingsProxy = pyodide.toPy(settings);
    pyodide.globals.set("_settings", settingsProxy);
    progress("Rendering minimap\u2026", { phase: "render", pct: 42 });
    pngProxy = await pyodide.runPythonAsync("render(_bytes, _ext, _settings)");
    progress("Packaging PNG\u2026", { phase: "render", pct: 84 });
    const pngBytes = pngProxy.toJs();
    // `toJs` returns a Uint8Array sharing WASM memory; copy into a
    // standalone ArrayBuffer so we can transfer it to the main thread.
    const out = new Uint8Array(pngBytes.length);
    out.set(pngBytes);
    self.postMessage({ type: "result", id: id, ok: true, png: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({
      type: "result",
      id: id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  } finally {
    try {
      if (pngProxy && typeof pngProxy.destroy === "function") pngProxy.destroy();
    } catch (_e) {}
    try {
      if (settingsProxy && typeof settingsProxy.destroy === "function") settingsProxy.destroy();
    } catch (_e) {}
    try {
      pyodide && pyodide.globals.delete("_bytes");
      pyodide && pyodide.globals.delete("_ext");
      pyodide && pyodide.globals.delete("_settings");
      pyodide && pyodide.globals.delete("_match");
    } catch (_e) {}
  }
}

async function handleParseCampaign(id, fileBytes) {
  let pyodide;
  try {
    pyodide = await ensurePyodide();
  } catch (err) {
    self.postMessage({
      type: "campaignParseResult",
      id: id,
      ok: false,
      error:
        "Failed to start Python runtime: " + (err && err.message ? err.message : String(err)),
    });
    return;
  }

  let bytesView = null;
  let jsonStrProxy = null;
  try {
    progress("Reading campaign\u2026", { phase: "campaignParse", pct: 12 });
    bytesView = new Uint8Array(fileBytes);
    pyodide.globals.set("_bytes", bytesView);
    progress("Parsing campaign\u2026", { phase: "campaignParse", pct: 38 });
    jsonStrProxy = await pyodide.runPythonAsync("parse_campaign_index_json(_bytes)");
    progress("Building scenario list\u2026", { phase: "campaignParse", pct: 78 });
    let s = jsonStrProxy;
    if (s && typeof s.toJs === "function") {
      s = s.toJs();
    } else {
      s = String(s);
    }
    const parsed = JSON.parse(s);
    if (!parsed.ok) {
      self.postMessage({
        type: "campaignParseResult",
        id: id,
        ok: false,
        error: parsed.error || "Campaign parse failed.",
      });
      return;
    }
    progress("Finishing\u2026", { phase: "campaignParse", pct: 94 });
    self.postMessage({
      type: "campaignParseResult",
      id: id,
      ok: true,
      campaignName: parsed.campaignName,
      scenarios: parsed.scenarios,
    });
  } catch (err) {
    self.postMessage({
      type: "campaignParseResult",
      id: id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  } finally {
    try {
      if (jsonStrProxy && typeof jsonStrProxy.destroy === "function") jsonStrProxy.destroy();
    } catch (_e) {}
    try {
      pyodide && pyodide.globals.delete("_bytes");
    } catch (_e) {}
  }
}

self.onmessage = function (ev) {
  const data = ev.data || {};
  if (data.type === "warmup") {
    ensurePyodide().catch(function (err) {
      progress(
        "Warmup failed: " + (err && err.message ? err.message : String(err)),
        { phase: "error" },
      );
    });
    return;
  }
  if (data.type === "render") {
    handleRender(data.id, data.fileBytes, data.ext, data.settings);
    return;
  }
  if (data.type === "parseCampaign") {
    handleParseCampaign(data.id, data.fileBytes);
    return;
  }
};
