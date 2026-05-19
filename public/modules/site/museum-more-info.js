/** Expand/collapse exhibit "More info" panels beside tab pill toggles. */
(function () {
  function setOpen(btn, open) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function initCluster(cluster) {
    if (!cluster || cluster.dataset.moreInfoInit === "true") return;
    const btn = cluster.querySelector(".tabs-more-info");
    if (!btn) return;

    cluster.dataset.moreInfoInit = "true";

    btn.addEventListener("click", function () {
      const open = btn.getAttribute("aria-expanded") !== "true";
      setOpen(btn, open);
    });
  }

  function collapseAll(root) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    scope.querySelectorAll('.tabs-more-info[aria-expanded="true"]').forEach(function (btn) {
      setOpen(btn, false);
    });
  }

  function boot() {
    document.querySelectorAll(".tabs-cluster").forEach(initCluster);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    collapseAll();
  });

  window.MuseumMoreInfo = { boot: boot, collapseAll: collapseAll };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
