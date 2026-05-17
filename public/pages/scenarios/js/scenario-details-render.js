/**
 * Shared scenario analysis UI (Analyse tab + Browse accordion).
 */
(function (global) {
  var MINIMAP_PLACEHOLDER_URL = "/assets/img/rainbow.png";

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
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return Number(value).toFixed(2);
  }

  var ERA_LABELS = { aoe: "AOE", aok: "AOK", aoc: "AOC", hd: "HD", de: "DE" };

  function parseContainerMinor(format) {
    var m = /^1\.(\d)(\d)$/.exec(String(format || "").trim());
    if (!m) return null;
    return Number(m[1]) * 10 + Number(m[2]);
  }

  function deriveGameEra(analysis) {
    if (!analysis) return null;
    if (analysis.gameEra && ERA_LABELS[analysis.gameEra]) return analysis.gameEra;
    var cf = analysis.containerFormat ? String(analysis.containerFormat).trim() : "";
    var dv = analysis.dataVersion;
    var isDe = analysis.isDefinitiveEdition === true;
    if (isDe) return "de";
    if (typeof dv === "number" && Number.isFinite(dv) && dv >= 1.28) return "de";
    var minor = parseContainerMinor(cf);
    if (minor != null && minor > 22) return "de";
    if (cf === "1.18" || cf === "1.19" || cf === "1.20") return "aok";
    if (cf === "1.21" && typeof dv === "number" && Number.isFinite(dv) && dv <= 1.22) {
      return "aoc";
    }
    if (
      cf === "1.21" ||
      (cf === "1.22" && typeof dv === "number" && Number.isFinite(dv) && dv > 1.22)
    ) {
      return "hd";
    }
    if (minor != null && minor < 18) return "aoe";
    return null;
  }

  function formatEdition(analysis) {
    var era = deriveGameEra(analysis);
    return era ? ERA_LABELS[era] : "—";
  }

  function formatUploaded(iso) {
    if (!iso) return "—";
    var d = new Date(iso + (String(iso).endsWith("Z") ? "" : "Z"));
    if (Number.isNaN(d.getTime())) return "—";
    var day = d.getUTCDate();
    var mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
      d.getUTCMonth()
    ];
    var yr = String(d.getUTCFullYear()).slice(-2);
    return day + " " + mon + " " + yr;
  }

  function buildSummaryRows(opts) {
    var analysis = opts.analysis || {};
    var objects =
      (Number(analysis.playerObjectCount) || 0) + (Number(analysis.gaiaObjectCount) || 0);
    var mapDim = analysis.mapDimension;
    var mapText =
      mapDim != null && Number.isFinite(Number(mapDim))
        ? formatNumber(mapDim) + " \u00D7 " + formatNumber(mapDim)
        : "—";
    var triggers =
      analysis.triggerCount == null ? "—" : formatNumber(analysis.triggerCount);

    return [
      ["Uploaded", formatUploaded(opts.uploadedAt)],
      ["File size", formatBytes(opts.size != null ? opts.size : 0)],
      ["Edition", formatEdition(analysis)],
      ["Container", analysis.containerFormat || "—"],
      ["Version", formatDataVersion(analysis.dataVersion)],
      ["Map size", mapText],
      ["Objects", formatNumber(objects)],
      ["Triggers", triggers],
    ];
  }

  function buildSummaryRowsAnalyse(opts) {
    var file = opts.file;
    var analysis = opts.analysis || {};
    return [
      ["File", file.name || opts.filename || "—"],
      ["File size", formatBytes(file.size != null ? file.size : opts.size || 0)],
      ["Detected edition", formatEdition(analysis)],
      ["Container format", analysis.containerFormat || "Unavailable"],
      ["Data version", formatDataVersion(analysis.dataVersion)],
      ["Detection reason", analysis.detectionReason || "Unavailable"],
      ["Parse backend", analysis.parseBackend || "Unavailable"],
      [
        "Map size",
        formatNumber(analysis.mapDimension) + " x " + formatNumber(analysis.mapDimension),
      ],
      ["Terrain tiles", formatNumber(analysis.tileCount)],
      ["Player objects", formatNumber(analysis.playerObjectCount)],
      ["Gaia objects", formatNumber(analysis.gaiaObjectCount)],
    ];
  }

  function renderPlayersHtml(analysis) {
    var players = Array.isArray(analysis.players) ? analysis.players : [];
    return players
      .map(function (player) {
        var startText = player.startPosition
          ? player.startPosition.x + ", " + player.startPosition.y
          : "Unavailable";
        return (
          '<div class="analysis-player">' +
          "<div><strong>Slot</strong><span>" +
          escapeHtml(player.slot) +
          "</span></div>" +
          "<div><strong>Name</strong><span>" +
          escapeHtml(player.name || "Unknown") +
          "</span></div>" +
          "<div><strong>Objects</strong><span>" +
          escapeHtml(formatNumber(player.objectCount)) +
          "</span></div>" +
          "<div><strong>Start</strong><span>" +
          escapeHtml(startText) +
          "</span></div>" +
          "</div>"
        );
      })
      .join("");
  }

  function updateActionCounts(rootEl, opts) {
    if (!rootEl) return;
    var dlCount = rootEl.querySelector('[data-count="downloads"]');
    var heartCount = rootEl.querySelector('[data-count="hearts"]');
    var heartBtn = rootEl.querySelector(".btn--heart.heart-btn");
    if (dlCount != null && opts.downloads != null) {
      dlCount.textContent = formatNumber(opts.downloads);
    }
    if (heartCount != null && opts.hearts != null) {
      heartCount.textContent = formatNumber(opts.hearts);
    }
    if (heartBtn && opts.viewerHearted != null) {
      heartBtn.setAttribute("aria-pressed", opts.viewerHearted ? "true" : "false");
    }
  }

  function resolveBrowseTitle(opts) {
    var analysis = opts.analysis || {};
    var title =
      opts.title ||
      (analysis.scenarioTitle && String(analysis.scenarioTitle).trim()) ||
      "";
    return title || "—";
  }

  function renderBrowseByline(bylineEl, uploader) {
    if (!bylineEl) return;
    var name = (uploader && String(uploader).trim()) || "Anonymous";
    bylineEl.innerHTML =
      '<span class="scenario-detail-byline-prefix">by</span> ' +
      '<span class="scenario-detail-byline-name">' +
      escapeHtml(name) +
      "</span>";
  }

  var BROWSE_TEXT_VIEWS = ["instructions", "hints", "scout"];

  function setBrowseDetailView(detailEl, view) {
    if (!detailEl) return;
    var wrap = detailEl.querySelector(".scenario-minimap-wrap");
    if (!wrap) return;
    var panel = wrap.querySelector(".scenario-objectives-panel");
    var isMinimap = view === "minimap";
    wrap.dataset.view = view || "minimap";
    if (panel) {
      panel.classList.toggle("hidden", isMinimap);
      if (!isMinimap) {
        panel.querySelectorAll(".scenario-objectives-section").forEach(function (section) {
          var key = section.getAttribute("data-objective");
          section.classList.toggle("hidden", key !== view);
        });
      }
    }
    detailEl.querySelectorAll(".scenario-view-toggle").forEach(function (btn) {
      var v = btn.getAttribute("data-view");
      var on = v === view;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function configureBrowseViews(detailEl, analysis) {
    if (!detailEl) return;
    var wrap = detailEl.querySelector(".scenario-minimap-wrap");
    var panel = wrap && wrap.querySelector(".scenario-objectives-panel");
    if (!wrap || !panel) return;

    var objectives = analysis && analysis.objectives;
    function nonempty(key) {
      var v = objectives && objectives[key];
      return typeof v === "string" && v.trim().length > 0;
    }

    BROWSE_TEXT_VIEWS.forEach(function (key) {
      var btn = detailEl.querySelector('.scenario-view-toggle[data-view="' + key + '"]');
      var section = panel.querySelector('[data-objective="' + key + '"]');
      var body = section && section.querySelector(".scenario-objectives-body");
      var has = nonempty(key);
      if (btn) btn.disabled = !has;
      if (!section) return;
      if (!has) {
        section.classList.add("hidden");
        if (body) body.textContent = "";
        return;
      }
      var raw = objectives[key];
      var text = typeof raw === "string" ? raw : "";
      var trimmed = text.trim();
      section.classList.toggle("hidden", true);
      if (body) body.textContent = trimmed ? text : "";
    });

    setBrowseDetailView(detailEl, "minimap");
  }

  function resetMinimapImage(minimapImg) {
    if (!minimapImg) return;
    minimapImg.onload = null;
    minimapImg.onerror = null;
    minimapImg.removeAttribute("src");
    minimapImg.classList.add("hidden");
    minimapImg.setAttribute("alt", "");
  }

  function preloadMinimapUrl(minimapUrl) {
    if (!minimapUrl) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve();
      };
      img.onerror = function () {
        reject(new Error("minimap load failed"));
      };
      img.src = minimapUrl;
      if (img.complete) {
        if (img.naturalWidth > 0) resolve();
        else reject(new Error("minimap load failed"));
      }
    });
  }

  function applyMinimapImage(minimapImg, minimapUrl, options) {
    options = options || {};
    resetMinimapImage(minimapImg);
    if (!minimapImg || !minimapUrl) return;

    var isPlaceholder = minimapUrl === MINIMAP_PLACEHOLDER_URL;

    function reveal() {
      minimapImg.classList.remove("hidden");
      minimapImg.setAttribute(
        "alt",
        isPlaceholder ? "Minimap unavailable" : "Scenario minimap"
      );
    }

    function fail() {
      minimapImg.classList.add("hidden");
      minimapImg.removeAttribute("src");
      minimapImg.setAttribute("alt", "");
    }

    if (options.preloaded) {
      minimapImg.src = minimapUrl;
      reveal();
      return;
    }

    minimapImg.onload = function () {
      minimapImg.onload = null;
      minimapImg.onerror = null;
      reveal();
    };
    minimapImg.onerror = function () {
      minimapImg.onload = null;
      minimapImg.onerror = null;
      fail();
    };
    minimapImg.src = minimapUrl;
    if (minimapImg.complete && minimapImg.naturalWidth > 0) {
      minimapImg.onload = null;
      minimapImg.onerror = null;
      reveal();
    }
  }

  function renderScenarioDetails(rootEl, opts) {
    if (!rootEl) return;

    var summaryGrid =
      rootEl.querySelector(".scenario-meta") ||
      rootEl.querySelector(".analysis-summary-grid");
    var titleEl = rootEl.querySelector(".scenario-detail-title");
    var bylineEl = rootEl.querySelector(".scenario-detail-byline");
    var playersList = rootEl.querySelector(".analysis-players-list");
    var minimapImg = rootEl.querySelector(".analysis-minimap-image");
    var unparsedMsg = rootEl.querySelector(".scenario-detail-unparsed");
    var isBrowsePanel = Boolean(rootEl.querySelector(".scenario-meta"));

    updateActionCounts(rootEl, opts);

    if (isBrowsePanel && titleEl) {
      var titleText = resolveBrowseTitle(opts);
      titleEl.textContent = titleText;
      titleEl.title = titleText !== "—" ? titleText : "";
    }
    if (isBrowsePanel) {
      renderBrowseByline(bylineEl, opts.uploader);
    }

    if (!opts.analysis && isBrowsePanel) {
      if (summaryGrid) {
        var browseRows = buildSummaryRows({
          title: opts.title,
          uploadedAt: opts.uploadedAt,
          uploader: opts.uploader,
          size: opts.size,
          analysis: null,
        });
        summaryGrid.innerHTML = browseRows
          .map(function (row) {
            return "<dt>" + escapeHtml(row[0]) + "</dt><dd>" + escapeHtml(row[1]) + "</dd>";
          })
          .join("");
      }
      if (minimapImg) {
        applyMinimapImage(minimapImg, MINIMAP_PLACEHOLDER_URL, {
          preloaded: Boolean(opts.minimapPreloaded),
        });
        minimapImg.classList.add("analysis-minimap-image--placeholder");
      }
      if (unparsedMsg) unparsedMsg.classList.remove("hidden");
      configureBrowseViews(rootEl.closest(".scenario-detail"), null);
      return;
    }

    if (!opts.analysis) {
      if (summaryGrid) summaryGrid.innerHTML = "";
      if (playersList) playersList.innerHTML = "";
      if (minimapImg) resetMinimapImage(minimapImg);
      if (unparsedMsg) unparsedMsg.classList.remove("hidden");
      if (isBrowsePanel) configureBrowseViews(rootEl.closest(".scenario-detail"), null);
      return;
    }

    if (unparsedMsg) unparsedMsg.classList.add("hidden");

    var rows = isBrowsePanel
      ? buildSummaryRows({
          title: opts.title,
          uploadedAt: opts.uploadedAt,
          uploader: opts.uploader,
          size: opts.size,
          analysis: opts.analysis,
        })
      : buildSummaryRowsAnalyse({
          file: opts.file || { name: opts.filename || "—", size: opts.size || 0 },
          analysis: opts.analysis,
          filename: opts.filename,
          size: opts.size,
        });

    if (summaryGrid) {
      summaryGrid.innerHTML = rows
        .map(function (row) {
          return "<dt>" + escapeHtml(row[0]) + "</dt><dd>" + escapeHtml(row[1]) + "</dd>";
        })
        .join("");
    }
    if (playersList) {
      playersList.innerHTML = renderPlayersHtml(opts.analysis);
    }

    if (minimapImg) {
      var minimapSrc = opts.minimapUrl;
      var usePlaceholder = isBrowsePanel && !minimapSrc;
      if (usePlaceholder) minimapSrc = MINIMAP_PLACEHOLDER_URL;
      if (minimapSrc) {
        applyMinimapImage(minimapImg, minimapSrc, {
          preloaded: Boolean(opts.minimapPreloaded),
        });
        minimapImg.classList.toggle(
          "analysis-minimap-image--placeholder",
          usePlaceholder
        );
      } else {
        resetMinimapImage(minimapImg);
        minimapImg.classList.remove("analysis-minimap-image--placeholder");
      }
    }

    if (isBrowsePanel) {
      configureBrowseViews(rootEl.closest(".scenario-detail"), opts.analysis);
    }
  }

  function setMinimapFromBuffer(minimapImg, pngBuffer, mimeType) {
    if (!minimapImg || !pngBuffer) return null;
    var type = mimeType || "image/png";
    var blob = new Blob([pngBuffer], { type: type });
    var url = URL.createObjectURL(blob);
    applyMinimapImage(minimapImg, url);
    return url;
  }

  global.ScenarioDetailsRender = {
    MINIMAP_PLACEHOLDER_URL: MINIMAP_PLACEHOLDER_URL,
    setBrowseDetailView: setBrowseDetailView,
    configureBrowseViews: configureBrowseViews,
    escapeHtml: escapeHtml,
    formatBytes: formatBytes,
    formatEdition: formatEdition,
    renderScenarioDetails: renderScenarioDetails,
    preloadMinimapUrl: preloadMinimapUrl,
    setMinimapFromBuffer: setMinimapFromBuffer,
    buildSummaryRows: buildSummaryRows,
    updateActionCounts: updateActionCounts,
  };
})(typeof window !== "undefined" ? window : globalThis);
