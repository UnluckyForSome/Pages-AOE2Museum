(function () {
  var SEARCH_TERM = "UnluckyForSome";
  /**
   * mods.aoe2.se rejects requests without modCategories. Use the full public set
   * (SiegeEngineers mod-directory) so scenario-only filters do not hide other work.
   */
  var MOD_CATEGORIES_ALL = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26];

  var statusEl = document.getElementById("originalmods-status");
  var summaryEl = document.getElementById("originalmods-summary");
  var loadingEl = document.getElementById("originalmods-loading");
  var errorEl = document.getElementById("originalmods-error");
  var gridEl = document.getElementById("originalmods-grid");

  function stripHtml(html) {
    if (!html || typeof html !== "string") return "";
    var t = document.createElement("template");
    t.innerHTML = html;
    var text = t.content.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  }

  function formatDate(iso) {
    if (!iso || typeof iso !== "string") return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formatNumber(n) {
    if (n == null || !Number.isFinite(Number(n))) return "";
    return Number(n).toLocaleString();
  }

  function detailUrl(modId) {
    return "https://www.ageofempires.com/mods/details/" + encodeURIComponent(String(modId)) + "/";
  }

  function modsAoe2SeUrl(modId) {
    return "https://mods.aoe2.se/" + encodeURIComponent(String(modId));
  }

  function copyText(text) {
    var s = String(text || "");
    if (!s) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(
        function () {
          return true;
        },
        function () {
          return false;
        }
      );
    }
    return new Promise(function (resolve) {
      try {
        var ta = document.createElement("textarea");
        ta.value = s;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        resolve(ok);
      } catch (_) {
        resolve(false);
      }
    });
  }

  function parseEntry(e) {
    var parsed = {};
    try {
      parsed = JSON.parse(String(e && e.json_str ? e.json_str : "{}"));
    } catch (_) {}
    var modId = e && e.modId != null ? Number(e.modId) : Number(parsed.modId);
    if (!Number.isFinite(modId) || modId <= 0) return null;

    var thumbnail = parsed.thumbnail ? String(parsed.thumbnail) : "";

    var tagNames = Array.isArray(parsed.modTagNames)
      ? parsed.modTagNames.map(function (x) {
          return String(x);
        })
      : [];

    return {
      modId: modId,
      modName: parsed.modName ? String(parsed.modName) : String(e.modName || ""),
      createDate: parsed.createDate ? String(parsed.createDate) : "",
      lastUpdate: parsed.lastUpdate ? String(parsed.lastUpdate) : "",
      downloads: parsed.downloads != null ? Number(parsed.downloads) : NaN,
      description: stripHtml(parsed.modDescription || parsed.description || ""),
      thumbnail: thumbnail,
      tagNames: tagNames,
    };
  }

  function el(tag, cls, attrs) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function renderCard(mod) {
    var article = el("article", "om-card");
    var titleText = mod.modName || "Mod " + mod.modId;

    var media = el("div", "om-card__media");
    if (mod.thumbnail) {
      var img = el("img", "", {
        src: mod.thumbnail,
        alt: mod.modName ? "Thumbnail for " + mod.modName : "Mod thumbnail",
        loading: "lazy",
        decoding: "async",
      });
      media.appendChild(img);
    }
    article.appendChild(media);

    var body = el("div", "om-card__body");
    var h2 = el("h2", "om-card__title");
    h2.textContent = titleText;
    body.appendChild(h2);

    var stats = el("div", "om-card__stats");
    if (mod.createDate) {
      var sp = document.createElement("span");
      sp.textContent = "Created " + formatDate(mod.createDate);
      stats.appendChild(sp);
    }
    if (mod.lastUpdate && mod.lastUpdate !== mod.createDate) {
      var sp2 = document.createElement("span");
      sp2.textContent = "Updated " + formatDate(mod.lastUpdate);
      stats.appendChild(sp2);
    }
    if (Number.isFinite(mod.downloads)) {
      var sp3 = document.createElement("span");
      sp3.textContent = formatNumber(mod.downloads) + " downloads";
      stats.appendChild(sp3);
    }
    if (stats.childNodes.length) body.appendChild(stats);

    if (mod.description) {
      var p = el("p", "om-card__desc");
      p.textContent = mod.description;
      body.appendChild(p);
    }

    if (mod.tagNames.length) {
      var ul = el("ul", "om-card__tags");
      for (var t = 0; t < Math.min(mod.tagNames.length, 8); t++) {
        var li = document.createElement("li");
        li.textContent = mod.tagNames[t];
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }

    var actions = el("div", "om-card__actions");
    var official = el("a", "om-card__action", {
      href: detailUrl(mod.modId),
      target: "_blank",
      rel: "noopener noreferrer",
    });
    official.textContent = "ageofempires";

    var copyBtn = el("button", "om-card__action om-card__action--copy", { type: "button" });
    copyBtn.textContent = "copy title";
    copyBtn.addEventListener("click", function () {
      copyText(titleText).then(function (ok) {
        var prev = copyBtn.textContent;
        copyBtn.textContent = ok ? "copied" : "failed";
        window.setTimeout(function () {
          copyBtn.textContent = prev;
        }, 1200);
      });
    });

    var aoe2 = el("a", "om-card__action", {
      href: modsAoe2SeUrl(mod.modId),
      target: "_blank",
      rel: "noopener noreferrer",
    });
    aoe2.textContent = "mods.aoe2.se";

    actions.appendChild(official);
    actions.appendChild(copyBtn);
    actions.appendChild(aoe2);
    body.appendChild(actions);

    article.appendChild(body);
    return article;
  }

  function setLoading(on) {
    if (!loadingEl) return;
    loadingEl.toggleAttribute("hidden", !on);
  }

  function clearSummary() {
    if (!summaryEl) return;
    summaryEl.hidden = true;
    summaryEl.replaceChildren();
  }

  function fillSummary(modsLen, filteredRaw) {
    if (!summaryEl) return;
    summaryEl.hidden = false;
    summaryEl.replaceChildren();

    var span1 = document.createElement("span");
    var b1 = document.createElement("strong");
    b1.textContent = String(modsLen);
    span1.appendChild(b1);
    span1.appendChild(document.createTextNode(' "Original" Mods'));
    summaryEl.appendChild(span1);

    var filtered = Number(filteredRaw);
    if (Number.isFinite(filtered) && filtered !== modsLen) {
      var span2 = document.createElement("span");
      span2.appendChild(document.createTextNode("Filtered total: "));
      var b2 = document.createElement("strong");
      b2.textContent = String(filtered);
      span2.appendChild(b2);
      summaryEl.appendChild(span2);
    }
  }

  function setError(msg, canRetry) {
    if (!errorEl) return;
    errorEl.hidden = !msg;
    errorEl.textContent = "";
    if (!msg) return;
    var p = document.createElement("p");
    p.textContent = msg;
    errorEl.appendChild(p);
    if (canRetry) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = "Retry";
      btn.addEventListener("click", function () {
        load(true);
      });
      errorEl.appendChild(btn);
    }
  }

  function announce(text) {
    if (statusEl) statusEl.textContent = text;
  }

  var loadInvoked = false;

  async function load(isRetry) {
    if (!gridEl) return;
    if (loadInvoked && !isRetry) return;
    loadInvoked = true;

    clearSummary();
    setError("", false);
    setLoading(true);
    announce("Loading mods.");
    gridEl.innerHTML = "";

    try {
      var res = await fetch("/api/mods/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page: 1,
          sortColumn: "createDate",
          sortDirection: "DESC",
          modCategories: MOD_CATEGORIES_ALL,
          searchTerm: SEARCH_TERM,
          civbuilder: false,
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var entries = data && Array.isArray(data.modEntries) ? data.modEntries : [];

      var mods = [];
      var seenIds = {};
      for (var i = 0; i < entries.length; i++) {
        var m = parseEntry(entries[i]);
        if (!m || seenIds[m.modId]) continue;
        seenIds[m.modId] = true;
        mods.push(m);
      }
      mods.sort(function (a, b) {
        var da = Number.isFinite(a.downloads) ? a.downloads : 0;
        var db = Number.isFinite(b.downloads) ? b.downloads : 0;
        if (db !== da) return db - da;
        return String(b.createDate).localeCompare(String(a.createDate));
      });

      fillSummary(mods.length, data.filtered);

      if (!mods.length) {
        announce("No mods found.");
        var empty = el("p", "card");
        empty.style.padding = "1.5rem";
        empty.textContent = "No mods returned for this search.";
        gridEl.appendChild(empty);
        return;
      }

      for (var j = 0; j < mods.length; j++) {
        gridEl.appendChild(renderCard(mods[j]));
      }
      announce("Loaded " + mods.length + " mods.");
    } catch (err) {
      console.warn("[originalmods]", err);
      var msg = err && err.message ? err.message : String(err);
      setError("Could not load mods: " + msg + ". Check your connection or try again later.", true);
      announce("Error loading mods.");
    } finally {
      setLoading(false);
    }
  }

  load(false);
})();
