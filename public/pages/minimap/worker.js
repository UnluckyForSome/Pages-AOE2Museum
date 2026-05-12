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
  // Replay parsing now comes from the vendored `AOE2-McMGZ` package
  // (import namespace `mgz`) inside the tarball. The minimap tar also bundles
  // the standalone museum `AoE2ScenarioParser` source tree plus
  // `aoe2_mcgeniescx`, so micropip only needs the small pure-Python runtime
  // dependencies that are not bundled with those package trees.
  // `keep_going=True` so one optional dep failing does not take the whole
  // render path down.
  await pyodide.runPythonAsync(
    [
      "import micropip",
      "await micropip.install(",
      "    [",
      '        "deprecation",',
      '        "typing_extensions",',
      '        "ordered-set==4.1.0",',
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

async function handleWarmup(id) {
  try {
    await ensurePyodide();
    if (id != null) {
      self.postMessage({ type: "warmupResult", id: id, ok: true });
    }
  } catch (err) {
    const errorText = err && err.message ? err.message : String(err);
    progress("Warmup failed: " + errorText, { phase: "error" });
    if (id != null) {
      self.postMessage({ type: "warmupResult", id: id, ok: false, error: errorText });
    }
  }
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
    // The Pages facade now routes scenario bytes through the bundled local
    // AoE2ScenarioParser fork first, then hands the parsed match shape to
    // McMinimap for rendering. Extension is still relevant for recordings.
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

async function handleAnalyse(id, fileBytes, ext, settings, fileName) {
  let pyodide;
  try {
    pyodide = await ensurePyodide();
  } catch (err) {
    self.postMessage({
      type: "analysisResult",
      id: id,
      ok: false,
      error: "Failed to start Python runtime: " + (err && err.message ? err.message : String(err)),
    });
    return;
  }

  let settingsProxy = null;
  let summaryProxy = null;
  let pngProxy = null;
  try {
    progress("Inspecting scenario…", { phase: "analysis", pct: 18 });
    pyodide.globals.set("_bytes", new Uint8Array(fileBytes));
    pyodide.globals.set("_ext", ext);
    pyodide.globals.set("_name", fileName || "uploaded scenario");
    settingsProxy = pyodide.toPy(settings || {});
    pyodide.globals.set("_settings", settingsProxy);

    progress("Parsing scenario and rendering minimap…", { phase: "analysis", pct: 54 });
    await pyodide.runPythonAsync("_analysis_json, _analysis_png = analyse(_bytes, _ext, _settings, _name)");

    summaryProxy = pyodide.globals.get("_analysis_json");
    pngProxy = pyodide.globals.get("_analysis_png");
    const analysisJson = summaryProxy && typeof summaryProxy.toJs === "function"
      ? summaryProxy.toJs()
      : String(summaryProxy);

    progress("Packaging preview…", { phase: "analysis", pct: 84 });
    const pngBytes = pngProxy.toJs();
    const out = new Uint8Array(pngBytes.length);
    out.set(pngBytes);
    self.postMessage(
      {
        type: "analysisResult",
        id: id,
        ok: true,
        analysis: JSON.parse(analysisJson),
        png: out.buffer,
      },
      [out.buffer],
    );
  } catch (err) {
    self.postMessage({
      type: "analysisResult",
      id: id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  } finally {
    try {
      if (summaryProxy && typeof summaryProxy.destroy === "function") summaryProxy.destroy();
    } catch (_e) {}
    try {
      if (pngProxy && typeof pngProxy.destroy === "function") pngProxy.destroy();
    } catch (_e) {}
    try {
      if (settingsProxy && typeof settingsProxy.destroy === "function") settingsProxy.destroy();
    } catch (_e) {}
    try {
      pyodide && pyodide.globals.delete("_bytes");
      pyodide && pyodide.globals.delete("_ext");
      pyodide && pyodide.globals.delete("_name");
      pyodide && pyodide.globals.delete("_settings");
      pyodide && pyodide.globals.delete("_analysis_json");
      pyodide && pyodide.globals.delete("_analysis_png");
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
    handleWarmup(data.id);
    return;
  }
  if (data.type === "render") {
    handleRender(data.id, data.fileBytes, data.ext, data.settings);
    return;
  }
  if (data.type === "analyse") {
    handleAnalyse(data.id, data.fileBytes, data.ext, data.settings, data.fileName);
    return;
  }
  if (data.type === "parseCampaign") {
    handleParseCampaign(data.id, data.fileBytes);
    return;
  }
};
