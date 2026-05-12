(function () {
  var MAX_FILE_SIZE = 5 * 1024 * 1024;
  var ALLOWED_EXTENSIONS = ["scn", "scx", "aoe2scenario"];
  var PREVIEW_SETTINGS = {};

  var dropZone = document.getElementById("analyse-drop-zone");
  var fileInput = document.getElementById("analyse-file-input");
  var selectedEl = document.getElementById("analysis-selected");
  var statusEl = document.getElementById("analysis-status");
  var progressFill = document.getElementById("analysis-progress-fill");
  var progressText = document.getElementById("analysis-progress-text");
  var errorEl = document.getElementById("analysis-error");
  var outputEl = document.getElementById("analysis-output");
  var summaryGrid = document.getElementById("analysis-summary-grid");
  var playersList = document.getElementById("analysis-players-list");
  var minimapImg = document.getElementById("analysis-minimap-image");
  var panelEl = document.getElementById("panel-analyse");

  if (
    !dropZone ||
    !fileInput ||
    !selectedEl ||
    !statusEl ||
    !progressFill ||
    !progressText ||
    !errorEl ||
    !outputEl ||
    !summaryGrid ||
    !playersList ||
    !minimapImg
  ) {
    return;
  }

  if (dropZone.dataset.scenariosInspectorReady === "true") {
    return;
  }
  dropZone.dataset.scenariosInspectorReady = "true";

  var workerWarmed = false;
  var nextRequestId = 1;
  var activeRequestId = 0;
  var busy = false;
  var currentPreviewUrl = null;
  var selectedFile = null;

  function getPyodideService() {
    return window.Aoe2MuseumPyodideService || null;
  }

  function getExtension(name) {
    var parts = String(name || "").split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : "";
  }

  function escapeHtml(str) {
    var el = document.createElement("span");
    el.textContent = str == null ? "" : String(str);
    return el.innerHTML;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
  }

  function formatDataVersion(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  function formatEdition(analysis) {
    if (analysis && typeof analysis.edition === "string") {
      if (analysis.edition === "definitive") return "Definitive Edition";
      if (analysis.edition === "legacy") return "Legacy";
    }
    return analysis && analysis.isDefinitiveEdition ? "Definitive Edition" : "Legacy";
  }

  function validateFile(file) {
    var ext;
    if (!file) return "Choose a scenario file first.";
    ext = getExtension(file.name);
    if (ALLOWED_EXTENSIONS.indexOf(ext) === -1) {
      return "Only .scn, .scx and .aoe2scenario files are supported here.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "Scenario exceeds the 5 MB analysis limit.";
    }
    return "";
  }

  function setProgress(message, pct) {
    statusEl.classList.remove("hidden");
    progressText.textContent = message;
    progressFill.style.width = (typeof pct === "number" ? pct : 0) + "%";
  }

  function handleProgress(msg) {
    setProgress(
      msg && msg.message ? msg.message : "Working...",
      msg && typeof msg.pct === "number" ? msg.pct : 0,
    );
  }

  function clearError() {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  function showError(message) {
    busy = false;
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    outputEl.classList.add("hidden");
  }

  function revokePreviewUrl() {
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }
  }

  function renderSummary(file, analysis) {
    var rows = [
      ["File", file.name],
      ["File size", formatBytes(file.size)],
      ["Detected edition", formatEdition(analysis)],
      ["Container format", analysis.containerFormat || "Unavailable"],
      ["Data version", formatDataVersion(analysis.dataVersion)],
      ["Detection reason", analysis.detectionReason || "Unavailable"],
      ["Parse backend", analysis.parseBackend || "Unavailable"],
      ["Map size", formatNumber(analysis.mapDimension) + " x " + formatNumber(analysis.mapDimension)],
      ["Terrain tiles", formatNumber(analysis.tileCount)],
      ["Occupied player slots", formatNumber(analysis.activePlayerCount) + " / " + formatNumber(analysis.playerSlots)],
      ["Player objects", formatNumber(analysis.playerObjectCount)],
      ["Gaia objects", formatNumber(analysis.gaiaObjectCount)],
    ];
    var players = Array.isArray(analysis.players) ? analysis.players : [];

    summaryGrid.innerHTML = rows
      .map(function (row) {
        return "<dt>" + escapeHtml(row[0]) + "</dt><dd>" + escapeHtml(row[1]) + "</dd>";
      })
      .join("");

    playersList.innerHTML = players
      .map(function (player) {
        var startText = player.startPosition
          ? player.startPosition.x + ", " + player.startPosition.y
          : "Unavailable";
        return (
          '<div class="analysis-player">' +
            "<div><strong>Slot</strong><span>" + escapeHtml(player.slot) + "</span></div>" +
            "<div><strong>Name</strong><span>" + escapeHtml(player.name || "Unknown") + "</span></div>" +
            "<div><strong>Objects</strong><span>" + escapeHtml(formatNumber(player.objectCount)) + "</span></div>" +
            "<div><strong>Start</strong><span>" + escapeHtml(startText) + "</span></div>" +
          "</div>"
        );
      })
      .join("");
  }

  function renderPreview(pngBuffer) {
    var blob;
    revokePreviewUrl();
    blob = new Blob([pngBuffer], { type: "image/png" });
    currentPreviewUrl = URL.createObjectURL(blob);
    minimapImg.src = currentPreviewUrl;
    minimapImg.classList.remove("hidden");
  }

  function showSelectedFile(file) {
    selectedEl.innerHTML =
      "Selected file: <strong>" +
      escapeHtml(file.name) +
      "</strong> (" +
      escapeHtml(formatBytes(file.size)) +
      ")";
    selectedEl.classList.remove("hidden");
  }

  function finishAnalysisInput() {
    fileInput.value = "";
  }

  function warmWorker() {
    var pyodideService = getPyodideService();
    if (workerWarmed || !pyodideService) return;
    workerWarmed = true;
    pyodideService.warmup({ onProgress: handleProgress }).catch(function (err) {
      showError(err && err.message ? err.message : String(err));
    });
  }

  function handleAnalysisSuccess(requestId, result) {
    if (requestId !== activeRequestId) return;
    busy = false;
    setProgress("Analysis complete.", 100);
    renderSummary(selectedFile, result.analysis || {});
    renderPreview(result.png);
    outputEl.classList.remove("hidden");
  }

  function handleAnalysisError(err) {
    finishAnalysisInput();
    if (activeRequestId) {
      showError(err && err.message ? err.message : String(err));
    }
  }

  function startAnalysis(file) {
    var validationError;
    var pyodideService;
    var requestId;

    validationError = validateFile(file);
    if (validationError) {
      showError(validationError);
      return;
    }
    if (busy) {
      showError("An analysis is already running. Please wait for it to finish.");
      return;
    }

    pyodideService = getPyodideService();
    if (!pyodideService) {
      showError("Shared Pyodide service is unavailable.");
      finishAnalysisInput();
      return;
    }

    busy = true;
    selectedFile = file;
    activeRequestId = nextRequestId++;
    requestId = activeRequestId;
    clearError();
    outputEl.classList.add("hidden");
    summaryGrid.innerHTML = "";
    playersList.innerHTML = "";
    revokePreviewUrl();
    minimapImg.removeAttribute("src");
    minimapImg.classList.add("hidden");
    showSelectedFile(file);
    setProgress("Preparing analysis runtime...", 4);

    file.arrayBuffer()
      .then(function (buffer) {
        return pyodideService.analyse(
          buffer,
          "." + getExtension(file.name),
          PREVIEW_SETTINGS,
          file.name,
          { onProgress: handleProgress },
        );
      })
      .then(function (result) {
        finishAnalysisInput();
        handleAnalysisSuccess(requestId, result);
      })
      .catch(handleAnalysisError);
  }

  function pickFirstFile(files) {
    if (!files || files.length === 0) return;
    startAnalysis(files[0]);
  }

  document.addEventListener("scenarios:tabchange", function (event) {
    if (event.detail && event.detail.tab === "analyse") {
      warmWorker();
    }
  });

  fileInput.addEventListener("change", function () {
    pickFirstFile(fileInput.files);
  });

  dropZone.addEventListener("click", function (event) {
    var target = event.target;
    if (target && typeof target.closest === "function" && target.closest("label")) return;
    fileInput.click();
  });

  dropZone.addEventListener("dragover", function (event) {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", function () {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", function (event) {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
    pickFirstFile(event.dataTransfer.files);
  });

  window.addEventListener("beforeunload", function () {
    revokePreviewUrl();
  });

  if (panelEl && panelEl.hidden === false) {
    warmWorker();
  }
})();
