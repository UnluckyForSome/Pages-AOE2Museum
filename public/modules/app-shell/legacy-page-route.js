const loadedLinks = new Set();
const loadedScripts = new Map();

function absoluteUrl(url) {
  return new URL(url, window.location.origin).toString();
}

function normaliseScriptUrl(url) {
  return absoluteUrl(url);
}

function normaliseStyleUrl(url) {
  return absoluteUrl(url);
}

function shouldSkipScript(src) {
  return (
    src === "/modules/site/museum-nav.js" ||
    src === "/modules/site/location-state.js" ||
    src === "/modules/site/museum-tabs-pill.js" ||
    src === "/modules/site/museum-more-info.js" ||
    src === "/modules/site/museum-auth-modal.js"
  );
}

function runExhibitChrome(root) {
  requestAnimationFrame(function () {
    window.MuseumMoreInfo?.collapseAll(root);
    window.MuseumTabsPill?.boot();
    window.MuseumMoreInfo?.boot();
  });
}

async function ensureStyle(href) {
  const key = normaliseStyleUrl(href);
  if (loadedLinks.has(key)) return;
  await new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => {
      loadedLinks.add(key);
      resolve();
    };
    link.onerror = () => reject(new Error("Failed to load stylesheet: " + href));
    document.head.appendChild(link);
  });
}

async function ensureScript(def) {
  const key = normaliseScriptUrl(def.src);
  if (loadedScripts.has(key)) return loadedScripts.get(key);
  const promise = def.type === "module"
    ? import(def.src)
    : new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = def.src;
        script.async = false;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load script: " + def.src));
        document.body.appendChild(script);
      });
  loadedScripts.set(key, promise);
  return promise;
}

function parseLegacyPage(htmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");
  const title = doc.querySelector("title")?.textContent?.trim() || "AoE2 Museum";
  const description = doc.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const main = doc.querySelector("main");
  const footer = doc.querySelector("footer");
  const styles = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
    .map((link) => link.getAttribute("href"))
    .filter((href) => href && href !== "/assets/css/museum.css");
  const scripts = Array.from(doc.querySelectorAll("script[src]"))
    .map((script) => ({
      src: script.getAttribute("src"),
      type: script.getAttribute("type") === "module" ? "module" : "classic",
    }))
    .filter((script) => script.src && !shouldSkipScript(script.src));

  return {
    description: description,
    footerHtml: footer ? footer.innerHTML : "AoE2 Museum",
    mainHtml: main ? main.innerHTML : "",
    scripts: scripts,
    styles: styles,
    title: title,
  };
}

export function createLegacyPageRoute(config) {
  let initialized = false;
  let rootEl = null;
  let footerEl = null;
  let meta = {
    description: config.description || "",
    title: config.title || "AoE2 Museum",
  };

  async function initialise(slots) {
    const res = await fetch(config.htmlPath, {
      headers: { Accept: "text/html" },
    });
    if (!res.ok) {
      throw new Error("Failed to load route shell: HTTP " + res.status);
    }
    const parsed = parseLegacyPage(await res.text());
    meta = {
      description: parsed.description || meta.description,
      title: parsed.title || meta.title,
    };

    rootEl = document.createElement("div");
    rootEl.setAttribute("data-route-root", config.key);
    rootEl.innerHTML = parsed.mainHtml;

    footerEl = document.createElement("div");
    footerEl.setAttribute("data-route-footer", config.key);
    footerEl.innerHTML = parsed.footerHtml;

    slots.view.replaceChildren(rootEl);
    slots.footer.replaceChildren(footerEl);

    for (const href of parsed.styles) {
      await ensureStyle(href);
    }
    for (const script of parsed.scripts) {
      await ensureScript(script);
    }

    runExhibitChrome(rootEl);
    initialized = true;
  }

  return {
    key: config.key,
    async mount(slots) {
      if (!initialized) {
        await initialise(slots);
        return meta;
      }
      slots.view.replaceChildren(rootEl);
      slots.footer.replaceChildren(footerEl);
      runExhibitChrome(rootEl);
      return meta;
    },
  };
}
