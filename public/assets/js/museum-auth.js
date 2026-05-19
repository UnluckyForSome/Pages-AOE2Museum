/** Shared auth state + nav injection for AoE2 Museum pages. */

(function () {

  const VILLAGER_DISABLED = "/assets/img/idle-villager_disabled.png";

  const VILLAGER_NORMAL = "/assets/img/idle-villager_normal.png";

  const MOBILE_NAV_MQ = window.matchMedia("(max-width: 899px)");



  let cachedMe = null;



  async function fetchMe() {

    try {

      const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });

      const data = await res.json();

      cachedMe = data.user || null;

    } catch {

      cachedMe = null;

    }

    return cachedMe;

  }



  function escapeHtml(str) {

    const el = document.createElement("span");

    el.textContent = str;

    return el.innerHTML;

  }



  function villagerIcon(src) {
    return (
      '<img class="site-nav__logo-mark site-nav__auth-mark" src="' +
      src +
      '" alt="" width="36" height="36" decoding="async" />'
    );
  }

  function authBrandMarkup(label, extraClass) {
    return (
      '<span class="site-nav__auth-text">' +
      escapeHtml(label) +
      "</span>" +
      villagerIcon(extraClass === "signed-in" ? VILLAGER_NORMAL : VILLAGER_DISABLED)
    );
  }



  function clearAuthUi() {

    document.querySelector(".site-nav__auth")?.remove();

  }



  function ensureAuthModalScript() {
    if (window.MuseumAuthModal) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="/modules/site/museum-auth-modal.js"]')) {
        const wait = function () {
          if (window.MuseumAuthModal) resolve();
          else setTimeout(wait, 40);
        };
        wait();
        return;
      }
      const script = document.createElement("script");
      script.src = "/modules/site/museum-auth-modal.js";
      script.defer = true;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error("Auth modal failed to load"));
      };
      document.body.appendChild(script);
    });
  }

  async function openLoginModal(opts) {
    try {
      await ensureAuthModalScript();
      await window.MuseumAuthModal.open(opts || {});
    } catch (err) {
      console.error("[museum-auth] login modal:", err);
      window.location.href = "/account/login.html";
    }
  }

  function placeAuth() {

    const wrap = document.querySelector(".site-nav__auth");

    const actions = document.querySelector(".site-nav__actions");

    const drawer = document.getElementById("site-nav-menu");

    const links = drawer?.querySelector(".site-nav__links--mobile");

    if (!wrap || !drawer || !links) return;



    if (MOBILE_NAV_MQ.matches) {

      drawer.insertBefore(wrap, links);

    } else if (actions) {

      actions.appendChild(wrap);

    }

  }



  function injectAuth() {

    if (document.querySelector(".site-nav__auth")) return;



    const bar = document.querySelector(".site-nav__bar");

    if (!bar) return;



    const wrap = document.createElement("div");

    wrap.className = "site-nav__auth";



    if (!cachedMe) {

      wrap.innerHTML =

        '<button type="button" class="site-nav__auth-brand site-nav__auth-entry" data-museum-auth-open aria-label="Sign in">' +

        authBrandMarkup("Sign In", "signed-out") +

        "</button>";

    } else {

      const name = cachedMe.username || "Account";

      wrap.innerHTML =

        '<div class="site-nav__item site-nav__item--has-menu site-nav__item--account">' +

        '<button type="button" class="site-nav__auth-brand site-nav__trigger" id="site-nav-trigger-account" aria-haspopup="true" aria-expanded="false" aria-controls="site-nav-menu-account" aria-label="Account menu for ' +

        escapeHtml(name) +

        '">' +

        authBrandMarkup(name, "signed-in") +

        "</button>" +

        '<ul class="site-nav__menu" id="site-nav-menu-account" role="menu" aria-labelledby="site-nav-trigger-account" hidden>' +

        '<li role="none"><a role="menuitem" href="/account/profile.html">My Account</a></li>' +

        '<li role="none"><a role="menuitem" href="/minimap/#my-gallery">My Gallery</a></li>' +

        '<li role="none"><button type="button" role="menuitem" class="site-nav__sign-out-btn" id="museum-sign-out">Sign out</button></li>' +

        "</ul></div>";



      const signOut = wrap.querySelector("#museum-sign-out");

      if (signOut) {

        signOut.addEventListener("click", onSignOut);

      }

      const flyout = wrap.querySelector(".site-nav__item--has-menu");

      if (flyout && window.MuseumNav && typeof window.MuseumNav.bindFlyoutMenu === "function") {

        window.MuseumNav.bindFlyoutMenu(flyout);

      }

    }



    const actions = document.querySelector(".site-nav__actions");
    (actions || bar).appendChild(wrap);

    placeAuth();

  }



  async function onSignOut(e) {

    e.preventDefault();

    e.stopPropagation();



    const btn = e.currentTarget;

    if (btn instanceof HTMLButtonElement) btn.disabled = true;



    try {

      const res = await fetch("/api/auth/sign-out", {

        method: "POST",

        credentials: "include",

        headers: { "Content-Type": "application/json" },

        body: "{}",

      });

      if (!res.ok) {

        console.error("[museum-auth] sign-out failed:", res.status, await res.text().catch(function () { return ""; }));

        if (btn instanceof HTMLButtonElement) btn.disabled = false;

        return;

      }

    } catch (err) {

      console.error("[museum-auth] sign-out error:", err);

      if (btn instanceof HTMLButtonElement) btn.disabled = false;

      return;

    }



    cachedMe = null;

    clearAuthUi();

    injectAuth();

    window.location.assign("/");

  }



  async function saveToMyGallery(opts) {

    const me = cachedMe || (await fetchMe());

    if (!me || !me.emailVerified) return { ok: false, reason: "not_signed_in" };

    const res = await fetch("/api/history/save", {

      method: "POST",

      credentials: "include",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify(opts),

    });

    const data = await res.json().catch(function () { return {}; });

    return { ok: res.ok, data };

  }



  function handleAuthQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("museum-auth");
    if (!auth) return;

    const message = params.get("message");
    const email = params.get("email") || "";
    params.delete("museum-auth");
    params.delete("message");
    params.delete("email");
    const qs = params.toString();
    const nextUrl = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    window.history.replaceState({}, "", nextUrl);

    if (auth === "verified") {
      void ensureAuthModalScript().then(function () {
        window.MuseumAuthModal?.open({ view: "verified-success" });
      });
      return;
    }

    if (auth === "verify-pending" || auth === "verify-error") {
      void ensureAuthModalScript().then(function () {
        window.MuseumAuthModal?.open({
          view: "verify-pending",
          email: email || undefined,
        });
        if (auth === "verify-error") {
          const msg = document.getElementById("museum-auth-verify-msg");
          if (msg && message) {
            msg.textContent = message;
            msg.className = "form-msg form-msg--err museum-auth-modal__msg";
          }
        }
      });
    }
  }

  function boot() {

    fetchMe().then(function () {

      clearAuthUi();

      injectAuth();

    });

    handleAuthQueryParams();

  }



  function preloadTurnstile() {
    if (document.querySelector('script[src="/modules/site/museum-turnstile.js"]')) {
      window.MuseumTurnstile?.load();
      return;
    }
    const script = document.createElement("script");
    script.src = "/modules/site/museum-turnstile.js";
    script.defer = true;
    script.onload = function () {
      window.MuseumTurnstile?.load();
    };
    document.body.appendChild(script);
  }

  document.addEventListener("click", function (e) {
    const opener = e.target.closest("[data-museum-auth-open]");
    if (!opener) return;
    e.preventDefault();
    const view = opener.getAttribute("data-museum-auth-view");
    const opts = view === "sign-up" || view === "forgot" ? { view: view } : {};
    void openLoginModal(opts);
  });

  document.addEventListener("museum-auth-login", function () {
    void fetchMe().then(function () {
      clearAuthUi();
      injectAuth();
    });
  });

  window.MuseumAuth = {

    getUser: function () { return cachedMe; },

    fetchMe: fetchMe,

    saveToMyGallery: saveToMyGallery,

    isVerified: function () { return Boolean(cachedMe && cachedMe.emailVerified); },

    signOut: onSignOut,

    openLoginModal: openLoginModal,

  };



  if (document.readyState === "loading") {

    document.addEventListener("DOMContentLoaded", function () {
      boot();
      preloadTurnstile();
    });

  } else {

    boot();
    preloadTurnstile();

  }



  document.addEventListener("museum-nav-ready", boot);



  MOBILE_NAV_MQ.addEventListener("change", function () {

    if (document.querySelector(".site-nav__auth")) placeAuth();

  });

})();


