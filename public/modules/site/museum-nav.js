(function () {
  /** Canonical site menu — single source of truth for all pages. */
  const MUSEUM_NAV = [
    { type: "link", label: "Home", href: "/", routeKey: "home" },
    {
      type: "mega",
      id: "archives",
      label: "Archives",
      blurb: "Classic art, wallpapers, and audio preserved for the museum.",
      items: [
        {
          label: "Concept Art",
          desc: "Development sketches and concept pieces.",
          href: "#",
          routeKey: "archives-concept",
          placeholder: true,
          icon: "palette",
        },
        {
          label: "Wallpapers",
          desc: "Official and fan desktop backgrounds.",
          href: "#",
          routeKey: "archives-wallpapers",
          placeholder: true,
          icon: "image",
        },
        {
          label: "Music & SFX",
          desc: "Soundtracks and classic game audio.",
          href: "#",
          routeKey: "archives-audio",
          placeholder: true,
          icon: "audio",
        },
      ],
    },
    {
      type: "mega",
      id: "exhibits",
      label: "Exhibits",
      blurb: "Interactive museum tools you can try in your browser.",
      items: [
        {
          label: "Minimap",
          desc: "Generate minimaps from scenarios and recordings.",
          href: "/minimap/",
          routeKey: "minimap",
          icon: "map",
        },
        {
          label: "Campaigns",
          desc: "Browse, upload, extract, and pack campaigns.",
          href: "/campaigns/",
          routeKey: "campaigns",
          icon: "campaign",
        },
        {
          label: "Scenarios",
          desc: "Community scenario archive — browse and contribute.",
          href: "/scenarios/",
          routeKey: "scenarios",
          icon: "scenario",
        },
        {
          label: "GIFs",
          desc: "Animated unit GIFs — Classic and Definitive Edition.",
          href: "/gif/",
          routeKey: "gif",
          icon: "gif",
        },
      ],
    },
    {
      type: "mega",
      id: "other",
      label: "Other",
      blurb: "More from the museum collection.",
      items: [
        {
          label: "Mods",
          desc: "Original Mods by UnluckyForSome for DE.",
          href: "/originalmods/",
          routeKey: "originalmods",
          icon: "mods",
        },
      ],
    },
    { type: "link", label: "Contact", href: "/contact/", routeKey: "contact" },
  ];

  const ICONS = {
    palette:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 3c-4 0-7 2.5-7 6.5 0 2.2 1.2 4.1 3 5.2V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3c1.8-1.1 3-3 3-5.2C19 5.5 16 3 12 3Z"/><circle cx="8.5" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="9" r="1" fill="currentColor" stroke="none"/></svg>',
    image:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.75"/><path d="m3 17 5.5-5.5 4 4L14 10l7 7"/></svg>',
    audio:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M9 18V6l10-2v14"/><path d="M6 15a3 3 0 1 0 0-6"/><path d="M17 16a3 3 0 1 0 0-6"/></svg>',
    map:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6Z"/><path d="M9 4v14M15 6v14"/></svg>',
    campaign:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M14 4v5h5"/><path d="M8 13h8M8 17h6"/></svg>',
    scenario:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M6 4h8l4 4v12H6V4Z"/><path d="M14 4v4h4"/><path d="M9 12h6M9 16h4"/></svg>',
    gif:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 10v4l3-2-3-2Z"/><path d="M14 10h4M14 14h3"/></svg>',
    mods:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 2 4 7v10l8 5 8-5V7l-8-5Z"/><path d="m9 12 3 3 5-6"/></svg>',
  };

  const DESKTOP_MQ = window.matchMedia("(min-width: 900px)");

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
    if (path === "/campaignmanager" || path.startsWith("/campaignmanager/")) return "campaigns";
    if (path === "/originalmods" || path.startsWith("/originalmods/")) return "originalmods";
    if (path === "/contact" || path.startsWith("/contact/")) return "contact";
    return null;
  }

  function iconHtml(name) {
    return '<span class="site-nav__mega-card-icon">' + (ICONS[name] || ICONS.map) + "</span>";
  }

  function buildNavShellHtml() {
    return [
      '<div class="site-nav__bar">',
      '<a class="site-nav__logo" href="/">',
      '<img class="site-nav__logo-mark" src="/assets/img/university.png" width="36" height="36" alt="" decoding="async" />',
      '<span class="site-nav__logo-text">AoE2 Museum</span>',
      "</a>",
      '<div class="site-nav__center">',
      '<ul class="site-nav__menubar" role="menubar" aria-label="Main"></ul>',
      "</div>",
      '<div class="site-nav__actions" aria-label="Account"></div>',
      '<button type="button" class="site-nav__toggle" id="site-nav-toggle" aria-expanded="false" aria-controls="site-nav-menu" aria-label="Open menu">',
      '<span class="site-nav__burger" aria-hidden="true">',
      '<span class="site-nav__burger-line"></span>',
      '<span class="site-nav__burger-line"></span>',
      '<span class="site-nav__burger-line"></span>',
      "</span></button>",
      "</div>",
      '<div class="site-nav__backdrop" aria-hidden="true"></div>',
      '<div id="site-nav-menu" class="site-nav__drawer">',
      '<div class="site-nav__links site-nav__links--mobile" aria-label="Main mobile"></div>',
      "</div>",
    ].join("");
  }

  function renderMegaCard(item, activeKey) {
    const isActive = item.routeKey && item.routeKey === activeKey;
    const soon = item.placeholder ? '<span class="site-nav__soon">Coming soon</span>' : "";
    const activeAttr = isActive ? ' aria-current="page"' : "";
    if (item.placeholder) {
      return (
        '<span class="site-nav__mega-card site-nav__mega-card--placeholder" role="listitem"' +
        (item.routeKey ? ' data-route-key="' + item.routeKey + '"' : "") +
        ">" +
        iconHtml(item.icon) +
        '<span class="site-nav__mega-card-body">' +
        '<span class="site-nav__mega-card-title">' +
        item.label +
        "</span>" +
        '<span class="site-nav__mega-card-desc">' +
        item.desc +
        "</span>" +
        soon +
        "</span></span>"
      );
    }
    return (
      '<a class="site-nav__mega-card" role="listitem" href="' +
      item.href +
      '"' +
      (item.routeKey ? ' data-route-key="' + item.routeKey + '"' : "") +
      activeAttr +
      ">" +
      iconHtml(item.icon) +
      '<span class="site-nav__mega-card-body">' +
      '<span class="site-nav__mega-card-title">' +
      item.label +
      "</span>" +
      '<span class="site-nav__mega-card-desc">' +
      item.desc +
      "</span>" +
      "</span></a>"
    );
  }

  function renderMenubar(activeKey) {
    const parts = [];
    for (const entry of MUSEUM_NAV) {
      if (entry.type === "link") {
        const isActive = entry.routeKey === activeKey;
        parts.push(
          '<li class="site-nav__item site-nav__item--link" role="none">' +
            '<a class="site-nav__link" role="menuitem" href="' +
            entry.href +
            '"' +
            (entry.routeKey ? ' data-route-key="' + entry.routeKey + '"' : "") +
            (isActive ? ' aria-current="page"' : "") +
            ">" +
            entry.label +
            "</a></li>",
        );
        continue;
      }
      if (entry.type !== "mega") continue;

      const branchActive = entry.items.some(function (it) {
        return it.routeKey === activeKey;
      });
      const panelId = "site-nav-mega-" + entry.id;
      const cards = entry.items.map(function (it) {
        return renderMegaCard(it, activeKey);
      });

      parts.push(
        '<li class="site-nav__item site-nav__item--has-mega site-nav__item--mega-' +
          entry.id +
          (branchActive ? " site-nav__item--active-branch" : "") +
          '" role="none">' +
          '<button type="button" class="site-nav__trigger site-nav__mega-trigger" role="menuitem" aria-haspopup="true" aria-expanded="false" aria-controls="' +
          panelId +
          '" id="site-nav-trigger-' +
          entry.id +
          '">' +
          '<span class="site-nav__trigger-label">' +
          entry.label +
          "</span>" +
          '<span class="site-nav__chevron" aria-hidden="true"></span>' +
          "</button>" +
          '<div class="site-nav__mega-panel" id="' +
          panelId +
          '" role="region" aria-labelledby="site-nav-trigger-' +
          entry.id +
          '" hidden>' +
          '<div class="site-nav__mega-panel-inner">' +
          '<p class="site-nav__mega-blurb">' +
          entry.blurb +
          "</p>" +
          '<div class="site-nav__mega-grid" role="list">' +
          cards.join("") +
          "</div>" +
          "</div></div></li>",
      );
    }
    return parts.join("");
  }

  function renderMobileNav(activeKey) {
    const parts = [];
    for (const entry of MUSEUM_NAV) {
      if (entry.type === "link") {
        const isActive = entry.routeKey === activeKey;
        parts.push(
          '<a href="' +
            entry.href +
            '"' +
            (entry.routeKey ? ' data-route-key="' + entry.routeKey + '"' : "") +
            (isActive ? ' aria-current="page"' : "") +
            ">" +
            entry.label +
            "</a>",
        );
        continue;
      }
      if (entry.type !== "mega") continue;

      const sectionId = "site-nav-mobile-" + entry.id;
      const links = entry.items
        .map(function (it) {
          const isActive = it.routeKey === activeKey;
          const soon = it.placeholder ? ' <span class="site-nav__soon">Coming soon</span>' : "";
          if (it.placeholder) {
            return (
              '<span class="site-nav__mobile-placeholder"' +
              (it.routeKey ? ' data-route-key="' + it.routeKey + '"' : "") +
              ">" +
              it.label +
              soon +
              "</span>"
            );
          }
          return (
            '<a href="' +
            it.href +
            '"' +
            (it.routeKey ? ' data-route-key="' + it.routeKey + '"' : "") +
            (isActive ? ' aria-current="page"' : "") +
            ">" +
            it.label +
            "</a>"
          );
        })
        .join("");

      parts.push(
        '<div class="site-nav__mobile-section">' +
          '<button type="button" class="site-nav__mobile-section-toggle" aria-expanded="false" aria-controls="' +
          sectionId +
          '">' +
          entry.label +
          '<span class="site-nav__chevron" aria-hidden="true"></span>' +
          "</button>" +
          '<div class="site-nav__mobile-section-panel" id="' +
          sectionId +
          '" hidden>' +
          links +
          "</div></div>",
      );
    }
    return parts.join("");
  }

  function applyActiveState(activeKey) {
    document.querySelectorAll("[data-route-key]").forEach(function (el) {
      if (el.getAttribute("data-route-key") === activeKey) {
        el.setAttribute("aria-current", "page");
      } else {
        el.removeAttribute("aria-current");
      }
    });

    document.querySelectorAll(".site-nav__item--has-mega").forEach(function (item) {
      const branch = item.querySelector('[aria-current="page"]');
      item.classList.toggle("site-nav__item--active-branch", !!branch);
    });
  }

  function renderNav(nav) {
    const activeKey = getActiveRouteKey();
    const menubar = nav.querySelector(".site-nav__center .site-nav__menubar");
    const mobile = nav.querySelector(".site-nav__links--mobile");
    if (menubar) {
      menubar.innerHTML = renderMenubar(activeKey);
      menubar.querySelectorAll(".site-nav__item--has-mega").forEach(function (item) {
        bindFlyoutMenu(item, { panel: ".site-nav__mega-panel" });
      });
      if (!menubar.dataset.megaLeaveBound) {
        menubar.dataset.megaLeaveBound = "1";
        menubar.addEventListener("mouseleave", function () {
          if (DESKTOP_MQ.matches) closeMegaMenus();
        });
      }
    }
    if (mobile) {
      mobile.innerHTML = renderMobileNav(activeKey);
      initMobileSections(mobile);
    }
    applyActiveState(activeKey);
  }

  function initMobileSections(mobileRoot) {
    mobileRoot.querySelectorAll(".site-nav__mobile-section").forEach(function (section) {
      const btn = section.querySelector(".site-nav__mobile-section-toggle");
      const panel = section.querySelector(".site-nav__mobile-section-panel");
      if (!btn || !panel) return;
      btn.addEventListener("click", function () {
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", open ? "false" : "true");
        panel.hidden = open;
        section.classList.toggle("site-nav__mobile-section--open", !open);
      });
    });
  }

  function closeMegaMenus(exceptItem) {
    document.querySelectorAll(".site-nav__item--has-mega.is-open").forEach(function (el) {
      if (el === exceptItem) return;
      el.classList.remove("is-open");
      const t = el.querySelector(".site-nav__trigger");
      const p = el.querySelector(".site-nav__mega-panel");
      if (t) t.setAttribute("aria-expanded", "false");
      if (p) p.hidden = true;
    });
  }

  function bindFlyoutMenu(itemEl, opts) {
    const options = opts || {};
    const panelSelector = options.panel || ".site-nav__menu, .site-nav__mega-panel";
    const trigger = itemEl.querySelector(".site-nav__trigger");
    const panel = itemEl.querySelector(panelSelector);
    if (!trigger || !panel) return;

    if (itemEl.dataset.flyoutBound === "1") return;
    itemEl.dataset.flyoutBound = "1";

    const isMega = itemEl.classList.contains("site-nav__item--has-mega");

    function open() {
      if (isMega) closeMegaMenus(itemEl);
      itemEl.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    }

    function close() {
      itemEl.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      panel.hidden = true;
    }

    function onMqChange() {
      if (!DESKTOP_MQ.matches) close();
    }

    if (DESKTOP_MQ.addEventListener) {
      DESKTOP_MQ.addEventListener("change", onMqChange);
    } else {
      DESKTOP_MQ.addListener(onMqChange);
    }

    itemEl.addEventListener("mouseenter", function () {
      if (DESKTOP_MQ.matches) open();
    });
    itemEl.addEventListener("mouseleave", function (e) {
      if (!DESKTOP_MQ.matches) return;
      const related = e.relatedTarget;
      if (related && itemEl.contains(related)) return;
      close();
    });

    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      if (itemEl.classList.contains("is-open")) close();
      else open();
    });

    trigger.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        close();
        trigger.focus();
      }
      if (e.key === "ArrowDown" && DESKTOP_MQ.matches) {
        e.preventDefault();
        open();
        const focusable = panel.querySelector("a[href], button:not([disabled])");
        if (focusable) focusable.focus();
      }
    });

    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        close();
        trigger.focus();
      }
    });
  }

  function initPlaceholderClicks(nav) {
    nav.addEventListener("click", function (e) {
      const card = e.target.closest(".site-nav__mega-card--placeholder, .site-nav__mobile-placeholder");
      if (card) e.preventDefault();
    });
  }

  function ensureStandardNav() {
    const nav = document.querySelector(".site-nav");
    if (!nav) return;

    if (!nav.querySelector(".site-nav__center")) {
      nav.innerHTML = buildNavShellHtml();
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

    renderNav(nav);
    if (!nav.dataset.placeholderClick) {
      nav.dataset.placeholderClick = "1";
      initPlaceholderClicks(nav);
    }
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
      if (!open) {
        menu.querySelectorAll(".site-nav__item--has-mega.is-open").forEach(function (item) {
          item.classList.remove("is-open");
          const t = item.querySelector(".site-nav__trigger");
          const p = item.querySelector(".site-nav__mega-panel");
          if (t) t.setAttribute("aria-expanded", "false");
          if (p) p.hidden = true;
        });
      }
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
      if (e.target.closest("a[href]:not([href='#'])")) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("site-nav--open")) {
        setOpen(false);
        btn.focus();
      }
    });
  }

  window.MuseumNav = {
    tree: MUSEUM_NAV,
    bindFlyoutMenu: bindFlyoutMenu,
    setActiveRouteKey: function (routeKey) {
      applyActiveState(routeKey);
    },
    refresh: function () {
      const nav = document.querySelector(".site-nav");
      if (nav) renderNav(nav);
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    ensureStandardNav();
    initBurger();
    document.dispatchEvent(new CustomEvent("museum-nav-ready"));
  });
})();
