(function () {
  /** Canonical site menu — single source of truth for all pages. */
  const MUSEUM_NAV_LINKS = [
    { href: "/", label: "Home", routeKey: "home" },
    { href: "/minimap/", label: "McMinimap", routeKey: "minimap" },
    { href: "/scenarios/", label: "Scenarios", routeKey: "scenarios" },
    { href: "/gif/", label: "GIFs", routeKey: "gif" },
    { href: "/campaigns/", label: "Campaigns", routeKey: "campaigns" },
    { href: "/campaignmanager/", label: "Campaign Manager", routeKey: "campaignmanager" },
    { href: "/originalmods/", label: "Original Mods", routeKey: "originalmods" },
    { href: "/contact/", label: "Contact", routeKey: "contact" },
  ];

  function normalizePath(pathname) {
    if (!pathname || pathname === "/") return "/";
    return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  }

  function getActiveRouteKey() {
    const path = normalizePath(window.location.pathname);
    if (path === "/" || path === "/home") return "home";
    if (path === "/minimap" || path.startsWith("/minimap/")) return "minimap";
    if (path === "/scenarios" || path.startsWith("/scenarios/")) return "scenarios";
    if (path === "/gif" || path.startsWith("/gif/")) return "gif";
    if (path === "/campaigns" || path.startsWith("/campaigns/")) return "campaigns";
    if (path === "/campaignmanager" || path.startsWith("/campaignmanager/")) return "campaignmanager";
    if (path === "/originalmods" || path.startsWith("/originalmods/")) return "originalmods";
    if (path === "/contact" || path.startsWith("/contact/")) return "contact";
    return null;
  }

  function buildNavShellHtml() {
    return [
      '<div class="site-nav__bar">',
      '<a class="site-nav__logo" href="/">',
      '<img class="site-nav__logo-mark" src="/assets/img/university.png" width="36" height="36" alt="" decoding="async" />',
      '<span class="site-nav__logo-text">AoE2 Museum</span>',
      "</a>",
      '<button type="button" class="site-nav__toggle" id="site-nav-toggle" aria-expanded="false" aria-controls="site-nav-menu" aria-label="Open menu">',
      '<span class="site-nav__burger" aria-hidden="true">',
      '<span class="site-nav__burger-line"></span>',
      '<span class="site-nav__burger-line"></span>',
      '<span class="site-nav__burger-line"></span>',
      "</span></button>",
      "</div>",
      '<div class="site-nav__backdrop" aria-hidden="true"></div>',
      '<div id="site-nav-menu" class="site-nav__drawer">',
      '<div class="site-nav__links"></div>',
      "</div>",
    ].join("");
  }

  function renderNavLinks(linksEl) {
    const activeKey = getActiveRouteKey();
    linksEl.textContent = "";
    for (const item of MUSEUM_NAV_LINKS) {
      const a = document.createElement("a");
      a.href = item.href;
      a.textContent = item.label;
      if (item.routeKey) a.setAttribute("data-route-key", item.routeKey);
      if (item.routeKey === activeKey) a.setAttribute("aria-current", "page");
      linksEl.appendChild(a);
    }
  }

  function ensureStandardNav() {
    const nav = document.querySelector(".site-nav");
    if (!nav) return;

    let links = nav.querySelector(".site-nav__links");
    if (!links) {
      nav.innerHTML = buildNavShellHtml();
      links = nav.querySelector(".site-nav__links");
    }

    const bar = nav.querySelector(".site-nav__bar");
    if (bar && !bar.querySelector(".site-nav__toggle")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "site-nav__toggle";
      btn.id = "site-nav-toggle";
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", "site-nav-menu");
      btn.setAttribute("aria-label", "Open menu");
      btn.innerHTML =
        '<span class="site-nav__burger" aria-hidden="true">' +
        '<span class="site-nav__burger-line"></span><span class="site-nav__burger-line"></span><span class="site-nav__burger-line"></span></span>';
      bar.appendChild(btn);
    }

    if (!nav.querySelector("#site-nav-menu")) {
      const backdrop = document.createElement("div");
      backdrop.className = "site-nav__backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      const drawer = document.createElement("div");
      drawer.id = "site-nav-menu";
      drawer.className = "site-nav__drawer";
      const linksWrap = document.createElement("div");
      linksWrap.className = "site-nav__links";
      drawer.appendChild(linksWrap);
      nav.appendChild(backdrop);
      nav.appendChild(drawer);
      links = linksWrap;
    }

    const logo = nav.querySelector(".site-nav__logo");
    if (logo && !logo.querySelector(".site-nav__logo-mark")) {
      const img = document.createElement("img");
      img.className = "site-nav__logo-mark";
      img.src = "/assets/img/university.png";
      img.width = 36;
      img.height = 36;
      img.alt = "";
      img.decoding = "async";
      logo.insertBefore(img, logo.firstChild);
    }

    if (links) renderNavLinks(links);
  }

  function initBurger() {
    const nav = document.querySelector(".site-nav");
    const btn = document.querySelector(".site-nav__toggle");
    const backdrop = document.querySelector(".site-nav__backdrop");
    const menu = document.getElementById("site-nav-menu");
    if (!nav || !btn || !menu) return;

    function setOpen(open) {
      nav.classList.toggle("site-nav--open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.classList.toggle("museum-nav-open", open);
    }

    btn.addEventListener("click", function () {
      setOpen(!nav.classList.contains("site-nav--open"));
    });

    if (backdrop) {
      backdrop.addEventListener("click", function () {
        setOpen(false);
      });
    }

    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("site-nav--open")) {
        setOpen(false);
        btn.focus();
      }
    });
  }

  window.MuseumNav = {
    links: MUSEUM_NAV_LINKS,
    setActiveRouteKey: function (routeKey) {
      document.querySelectorAll(".site-nav__links a[data-route-key]").forEach(function (link) {
        if (link.getAttribute("data-route-key") === routeKey) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    ensureStandardNav();
    initBurger();
    document.dispatchEvent(new CustomEvent("museum-nav-ready"));
  });
})();
