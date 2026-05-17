(function () {
  const authEl = document.getElementById("dev-parse-auth");
  const form = document.getElementById("dev-parse-form");
  const progressWrap = document.getElementById("dev-parse-progress");
  const fill = document.getElementById("dev-parse-fill");
  const text = document.getElementById("dev-parse-text");
  const log = document.getElementById("dev-parse-log");
  const stopBtn = document.getElementById("dev-parse-stop");
  const startBtn = document.getElementById("dev-parse-start");

  let stopAfterCurrent = false;

  function getExt(name) {
    const parts = String(name || "").split(".");
    return parts.length > 1 ? "." + parts.pop().toLowerCase() : "";
  }

  function logLine(msg, ok) {
    const li = document.createElement("li");
    li.textContent = msg;
    if (ok === true) li.className = "dev-parse-log-ok";
    if (ok === false) li.className = "dev-parse-log-err";
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  function setProgress(done, total, message) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    fill.style.width = pct + "%";
    text.textContent = message || done + " / " + total;
  }

  async function parseOne(scenario, pyodideService) {
    const dl = await fetch("/api/scenarios/download/" + scenario.id, {
      credentials: "include",
    });
    if (!dl.ok) throw new Error("download failed");

    const buffer = await dl.arrayBuffer();
    const ext = getExt(scenario.filename || scenario.original_filename);
    const result = await pyodideService.analyse(
      buffer,
      ext,
      {},
      scenario.filename,
      {
        onProgress: function (msg) {
          if (msg && msg.message) {
            text.textContent = scenario.filename + ": " + msg.message;
          }
        },
      },
    );

    const fd = new FormData();
    fd.append("analysis", JSON.stringify(result.analysis || {}));
    const minimapBlob = new Blob([result.png], { type: "image/webp" });
    fd.append("minimap", minimapBlob, "minimap.webp");

    const put = await fetch("/api/scenarios/" + scenario.id + "/details", {
      method: "PUT",
      credentials: "include",
      body: fd,
    });
    if (!put.ok) {
      const err = await put.json().catch(function () { return {}; });
      throw new Error(err.error || "PUT failed " + put.status);
    }
  }

  async function runBatch(limit, legacyOnly, staleOnly) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (staleOnly) {
      params.set("stale", "true");
    } else {
      params.set("unparsed", "true");
      if (legacyOnly) params.set("legacy", "true");
    }

    const listRes = await fetch("/api/scenarios?" + params.toString(), {
      credentials: "include",
    });
    if (!listRes.ok) throw new Error("Failed to list scenarios");
    const items = await listRes.json();
    if (!items.length) {
      logLine(staleOnly ? "No stale scenarios matched." : "No unparsed scenarios matched.", null);
      return;
    }

    const pyodideService = window.Aoe2MuseumPyodideService;
    if (!pyodideService) throw new Error("Pyodide service not loaded");

    stopAfterCurrent = false;
    stopBtn.classList.remove("hidden");
    startBtn.disabled = true;

    await pyodideService.warmup({
      onProgress: function (msg) {
        text.textContent = msg && msg.message ? msg.message : "Warming up…";
      },
    });

    let done = 0;
    const total = items.length;

    for (const s of items) {
      if (stopAfterCurrent) {
        logLine("Stopped by user.", null);
        break;
      }
      setProgress(done, total, "Parsing " + s.filename + "…");
      try {
        await parseOne(s, pyodideService);
        done++;
        logLine("OK: " + s.filename, true);
      } catch (e) {
        logLine("Skip " + s.filename + ": " + (e.message || e), false);
      }
      setProgress(done, total, done + " / " + total + " complete");
    }

    stopBtn.classList.add("hidden");
    startBtn.disabled = false;
    logLine("Batch finished.", null);
  }

  async function boot() {
    const meRes = await fetch("/api/me", { credentials: "include" });
    const me = await meRes.json();
    if (!me.user?.isAdmin) {
      authEl.textContent = "Admin access required.";
      authEl.className = "form-msg form-msg--err";
      return;
    }

    authEl.textContent = "Signed in as admin.";
    authEl.className = "form-msg form-msg--ok";
    form.classList.remove("hidden");

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      log.innerHTML = "";
      progressWrap.classList.remove("hidden");
      const fd = new FormData(form);
      const limit = Number(fd.get("limit")) || 30;
      const legacyOnly = fd.get("legacy") === "on";
      const staleOnly = fd.get("stale") === "on";

      try {
        await runBatch(limit, legacyOnly, staleOnly);
      } catch (err) {
        logLine(err.message || String(err), false);
        stopBtn.classList.add("hidden");
        startBtn.disabled = false;
      }
    });

    stopBtn.addEventListener("click", function () {
      stopAfterCurrent = true;
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
