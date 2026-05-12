const BOOT_TOTAL_DEFAULT = 6;

function createSharedPyodideService() {
  let worker = null;
  let nextId = 0;
  let queue = Promise.resolve();
  let booted = false;
  let currentProgressHandler = null;
  const pending = new Map();

  function resetWorker() {
    if (worker) {
      try {
        worker.terminate();
      } catch (_e) {}
    }
    worker = null;
    booted = false;
  }

  function rejectAll(error) {
    pending.forEach((entry) => entry.reject(error));
    pending.clear();
    currentProgressHandler = null;
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("/minimap/worker.js");
    worker.onmessage = function (ev) {
      const msg = ev.data || {};
      if (msg.type === "progress") {
        if (currentProgressHandler) currentProgressHandler(msg);
        return;
      }
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg);
      else entry.reject(new Error(msg.error || "Pyodide worker request failed."));
    };
    worker.onerror = function (e) {
      const error = new Error(e.message || "Worker error");
      rejectAll(error);
      resetWorker();
    };
    return worker;
  }

  function runQueued(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  function request(type, payload, transfer, onProgress) {
    return runQueued(function () {
      ensureWorker();
      const id = ++nextId;
      currentProgressHandler = typeof onProgress === "function" ? onProgress : null;
      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject });
        worker.postMessage(Object.assign({ type: type, id: id }, payload || {}), transfer || []);
      }).finally(function () {
        currentProgressHandler = null;
      });
    });
  }

  function warmup(opts) {
    const options = opts || {};
    if (booted) {
      if (typeof options.onProgress === "function") {
        options.onProgress({
          type: "progress",
          phase: "boot",
          message: "Ready.",
          pct: 100,
          step: BOOT_TOTAL_DEFAULT,
          total: BOOT_TOTAL_DEFAULT,
        });
      }
      return Promise.resolve();
    }
    return request("warmup", {}, [], options.onProgress).then(function () {
      booted = true;
    });
  }

  function render(fileBytes, ext, settings, opts) {
    const options = opts || {};
    return warmup({ onProgress: options.onProgress }).then(function () {
      return request(
        "render",
        { fileBytes: fileBytes, ext: ext, settings: settings },
        fileBytes ? [fileBytes] : [],
        options.onProgress,
      ).then(function (msg) {
        return msg.png;
      });
    });
  }

  function analyse(fileBytes, ext, settings, fileName, opts) {
    const options = opts || {};
    return warmup({ onProgress: options.onProgress }).then(function () {
      return request(
        "analyse",
        { fileBytes: fileBytes, ext: ext, settings: settings, fileName: fileName },
        fileBytes ? [fileBytes] : [],
        options.onProgress,
      ).then(function (msg) {
        return {
          analysis: msg.analysis || {},
          png: msg.png,
        };
      });
    });
  }

  function parseCampaign(fileBytes, opts) {
    const options = opts || {};
    return warmup({ onProgress: options.onProgress }).then(function () {
      return request(
        "parseCampaign",
        { fileBytes: fileBytes },
        fileBytes ? [fileBytes] : [],
        options.onProgress,
      ).then(function (msg) {
        return {
          campaignName: msg.campaignName,
          scenarios: msg.scenarios || [],
        };
      });
    });
  }

  return {
    analyse: analyse,
    isBooted: function () {
      return booted;
    },
    parseCampaign: parseCampaign,
    render: render,
    reset: function () {
      rejectAll(new Error("Pyodide worker reset."));
      resetWorker();
    },
    warmup: warmup,
  };
}

const sharedPyodideService = createSharedPyodideService();

if (typeof window !== "undefined") {
  window.Aoe2MuseumPyodideService = sharedPyodideService;
}

export { sharedPyodideService };
