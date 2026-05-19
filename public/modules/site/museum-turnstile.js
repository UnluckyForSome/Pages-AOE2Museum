/** Cloudflare Turnstile helpers (shared by upload, campaigns, account). */
(function () {
  const TURNSTILE_SITEKEY_PROD = "0x4AAAAAACsqOhUOmHnJaPFc";
  const TURNSTILE_SITEKEY_DEV = "1x00000000000000000000AA";
  /** Reserved height for normal widget — prevents layout shift while loading. */
  const WIDGET_HEIGHT_PX = 72;

  function isLocalDevHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  }

  function getSitekey() {
    return isLocalDevHost(window.location.hostname)
      ? TURNSTILE_SITEKEY_DEV
      : TURNSTILE_SITEKEY_PROD;
  }

  let loadPromise = null;

  function load() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise(function (resolve, reject) {
      window.onTurnstileLoad = function () {
        resolve(window.turnstile);
      };
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      script.async = true;
      script.onerror = function () {
        reject(new Error("Turnstile failed to load"));
      };
      document.head.appendChild(script);
    });
    return loadPromise;
  }

  async function render(container, opts) {
    const options = opts || {};
    const turnstile = await load();
    const renderOpts = {
      sitekey: getSitekey(),
      theme: options.theme || "dark",
    };
    if (options.size) renderOpts.size = options.size;
    return turnstile.render(container, renderOpts);
  }

  function getToken(widgetId) {
    if (!window.turnstile || widgetId == null) return "";
    return window.turnstile.getResponse(widgetId) || "";
  }

  function reset(widgetId) {
    if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId);
  }

  window.MuseumTurnstile = {
    WIDGET_HEIGHT_PX: WIDGET_HEIGHT_PX,
    getSitekey: getSitekey,
    load: load,
    render: render,
    getToken: getToken,
    reset: reset,
  };
})();
