// Pyodide-backed renderer for /mcminimap.
// Runs in a DedicatedWorker so the UI thread stays responsive during boot +
// render. Pyodide itself and the stdlib wheels come from jsDelivr; the
// AOE2-McMinimap source tree is served from this origin as a single tarball.

const PYODIDE_VERSION = "0.28.3";
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";
const VENDOR_TAR_URL = "/mcminimap/vendor/aoe2mcminimap.tar";
const BOOTSTRAP_URL = "/mcminimap/py/bootstrap.py";
const VENDOR_EXTRACT_DIR = "/home/pyodide/aoe2mcminimap";

importScripts(PYODIDE_BASE + "pyodide.js");

function progress(message) {
  self.postMessage({ type: "progress", message: message });
}

let pyodideReady = null;

async function boot() {
  progress("Loading Python runtime\u2026");
  // eslint-disable-next-line no-undef
  const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

  progress("Loading Pillow + micropip\u2026");
  await pyodide.loadPackage(["Pillow", "micropip"]);

  progress("Installing Python packages\u2026");
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

  progress("Unpacking McMinimap source\u2026");
  const tarRes = await fetch(VENDOR_TAR_URL);
  if (!tarRes.ok) throw new Error("Failed to fetch vendor tar: HTTP " + tarRes.status);
  const tar = new Uint8Array(await tarRes.arrayBuffer());
  try {
    pyodide.FS.mkdirTree(VENDOR_EXTRACT_DIR);
  } catch (_e) {
    // Already exists - fine.
  }
  pyodide.unpackArchive(tar, "tar", { extractDir: VENDOR_EXTRACT_DIR });

  progress("Loading renderer\u2026");
  const bootstrapRes = await fetch(BOOTSTRAP_URL);
  if (!bootstrapRes.ok) {
    throw new Error("Failed to fetch bootstrap.py: HTTP " + bootstrapRes.status);
  }
  const bootstrap = await bootstrapRes.text();
  await pyodide.runPythonAsync(bootstrap);

  progress("Ready.");
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
    progress("Rendering\u2026");
    bytesView = new Uint8Array(fileBytes);
    pyodide.globals.set("_bytes", bytesView);
    pyodide.globals.set("_ext", ext);
    settingsProxy = pyodide.toPy(settings);
    pyodide.globals.set("_settings", settingsProxy);
    pngProxy = await pyodide.runPythonAsync("render(_bytes, _ext, _settings)");
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
    } catch (_e) {}
  }
}

self.onmessage = function (ev) {
  const data = ev.data || {};
  if (data.type === "warmup") {
    ensurePyodide().catch(function (err) {
      progress(
        "Warmup failed: " + (err && err.message ? err.message : String(err)),
      );
    });
    return;
  }
  if (data.type === "render") {
    handleRender(data.id, data.fileBytes, data.ext, data.settings);
    return;
  }
};
