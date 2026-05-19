/** Sliding highlight for museum tab pill toggles. */
(function () {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function initNav(nav) {
    if (!nav || nav.dataset.tabsPill === "true") return;
    const tabs = nav.querySelectorAll(".tab");
    if (!tabs.length) return;

    nav.dataset.tabsPill = "true";

    if (reduceMotion) return;

    nav.classList.add("tabs--animated");

    const indicator = document.createElement("span");
    indicator.className = "tabs-indicator";
    indicator.setAttribute("aria-hidden", "true");
    nav.insertBefore(indicator, nav.firstChild);

    let pending = 0;

    function update() {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(function () {
        const active = nav.querySelector('.tab[aria-selected="true"]');
        if (!active) {
          indicator.style.opacity = "0";
          return;
        }
        const navRect = nav.getBoundingClientRect();
        const tabRect = active.getBoundingClientRect();
        indicator.style.opacity = "1";
        indicator.style.width = tabRect.width + "px";
        indicator.style.transform = "translateX(" + (tabRect.left - navRect.left) + "px)";
      });
    }

    nav.addEventListener("click", function (e) {
      if (e.target.closest(".tab")) update();
    });

    const observer = new MutationObserver(update);
    tabs.forEach(function (tab) {
      observer.observe(tab, { attributes: true, attributeFilter: ["aria-selected"] });
    });

    window.addEventListener("resize", update);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(nav);
      tabs.forEach(function (tab) {
        ro.observe(tab);
      });
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(update).catch(function () {});
    }
    update();
    requestAnimationFrame(update);
  }

  function boot() {
    document.querySelectorAll("nav.tabs").forEach(initNav);
  }

  window.MuseumTabsPill = { boot: boot };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
