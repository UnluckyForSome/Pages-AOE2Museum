import { sharedPyodideService } from "/modules/app-shell/shared-pyodide-service.js";

const viewEl = document.getElementById("app-view");
const footerEl = document.getElementById("app-footer");
const descriptionMeta =
  document.querySelector('meta[name="description"]') ||
  document.head.appendChild(Object.assign(document.createElement("meta"), { name: "description" }));

if (!viewEl || !footerEl) {
  throw new Error("App shell is missing required root nodes.");
}

window.Aoe2MuseumPyodideService = sharedPyodideService;

const routeTable = [
  {
    key: "home",
    paths: ["/", "/home", "/home/"],
    load: () => import("/modules/app-shell/routes/home.js"),
  },
  {
    key: "minimap",
    paths: ["/minimap", "/minimap/"],
    load: () => import("/modules/app-shell/routes/minimap.js"),
  },
  {
    key: "scenarios",
    paths: ["/scenarios", "/scenarios/"],
    load: () => import("/modules/app-shell/routes/scenarios.js"),
  },
  {
    key: "gif",
    paths: ["/gif", "/gif/"],
    load: () => import("/modules/app-shell/routes/gif.js"),
  },
  {
    key: "campaignmanager",
    paths: ["/campaignmanager", "/campaignmanager/"],
    load: () => import("/modules/app-shell/routes/campaignmanager.js"),
  },
  {
    key: "originalmods",
    paths: ["/originalmods", "/originalmods/"],
    load: () => import("/modules/app-shell/routes/originalmods.js"),
  },
  {
    key: "contact",
    paths: ["/contact", "/contact/", "/contact.html"],
    load: () => import("/modules/app-shell/routes/contact.js"),
  },
];

const routeModuleCache = new Map();
let navigationToken = 0;
let currentRouteKey = null;

function normalisePath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function resolveRoute(pathname) {
  const normalised = normalisePath(pathname);
  for (const route of routeTable) {
    for (const candidate of route.paths) {
      if (normalisePath(candidate) === normalised) return route;
    }
  }
  return routeTable[0];
}

function setActiveNav(routeKey) {
  document.querySelectorAll(".site-nav__links a[data-route-key]").forEach((link) => {
    if (link.getAttribute("data-route-key") === routeKey) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function setMeta(meta) {
  document.title = meta && meta.title ? meta.title : "AoE2 Museum";
  if (descriptionMeta) {
    descriptionMeta.setAttribute(
      "content",
      meta && meta.description
        ? meta.description
        : "A small collection of Age of Empires II tools and archives.",
    );
  }
}

async function getRouteModule(route) {
  if (routeModuleCache.has(route.key)) {
    return routeModuleCache.get(route.key);
  }
  const mod = await route.load();
  const value = mod.default || mod;
  routeModuleCache.set(route.key, value);
  return value;
}

function showLoading(routeKey) {
  setActiveNav(routeKey);
  document.title = "Loading - AoE2 Museum";
  viewEl.innerHTML =
    '<header class="page-header">' +
      '<div class="page-header__backdrop" aria-hidden="true"></div>' +
      '<div class="page-header__inner">' +
        '<h1 class="page-title">AoE2 Museum</h1>' +
        '<div class="page-intro"><p>Loading exhibit...</p></div>' +
      "</div>" +
    "</header>";
  footerEl.textContent = "AoE2 Museum";
}

async function renderCurrentRoute() {
  const token = ++navigationToken;
  const route = resolveRoute(window.location.pathname);
  showLoading(route.key);
  const routeModule = await getRouteModule(route);
  if (token !== navigationToken) return;
  const meta = await routeModule.mount({
    footer: footerEl,
    view: viewEl,
  });
  if (token !== navigationToken) return;
  currentRouteKey = route.key;
  setActiveNav(route.key);
  setMeta(meta || {});
}

function navigateTo(url, opts) {
  const options = opts || {};
  const next = new URL(url, window.location.origin);
  const current = new URL(window.location.href);
  if (next.origin !== current.origin) {
    window.location.href = next.href;
    return;
  }
  const sameDocument = next.pathname === current.pathname && next.search === current.search && next.hash === current.hash;
  if (sameDocument) return;
  if (options.replace) {
    history.replaceState(null, "", next.pathname + next.search + next.hash);
  } else {
    history.pushState(null, "", next.pathname + next.search + next.hash);
  }
  if (window.Aoe2MuseumLocation) {
    window.Aoe2MuseumLocation.notify();
  }
  void renderCurrentRoute();
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;
  if (
    event.defaultPrevented ||
    link.target === "_blank" ||
    link.hasAttribute("download") ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return;
  }
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  const route = resolveRoute(url.pathname);
  const isKnown = route.paths.some((candidate) => normalisePath(candidate) === normalisePath(url.pathname));
  if (!isKnown) return;
  event.preventDefault();
  navigateTo(url.href);
});

window.addEventListener("popstate", () => {
  if (window.Aoe2MuseumLocation) {
    window.Aoe2MuseumLocation.notify();
  }
  void renderCurrentRoute();
});

void renderCurrentRoute();
