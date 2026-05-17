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

      '<img class="site-nav__villager-icon" src="' +

      src +

      '" alt="" width="32" height="32" decoding="async" />'

    );

  }



  function clearAuthUi() {

    document.querySelector(".site-nav__auth")?.remove();

  }



  function placeAuth() {

    const wrap = document.querySelector(".site-nav__auth");

    const bar = document.querySelector(".site-nav__bar");

    const drawer = document.getElementById("site-nav-menu");

    const links = drawer?.querySelector(".site-nav__links");

    const toggle = bar?.querySelector(".site-nav__toggle");

    if (!wrap || !bar || !drawer || !links) return;



    if (MOBILE_NAV_MQ.matches) {

      drawer.insertBefore(wrap, links);

    } else if (toggle) {

      bar.insertBefore(wrap, toggle);

    } else {

      bar.appendChild(wrap);

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

        '<a href="/account/login.html" class="site-nav__sign-in-btn">' +

        '<span class="site-nav__sign-in-label">Sign In</span>' +

        villagerIcon(VILLAGER_DISABLED) +

        "</a>";

    } else {

      const name = cachedMe.username || "Account";

      wrap.innerHTML =

        '<details class="site-nav__account-menu">' +

        '<summary class="site-nav__account-trigger" aria-label="Account menu for ' +

        escapeHtml(name) +

        '">' +

        '<span class="site-nav__account-name">' +

        escapeHtml(name) +

        "</span>" +

        villagerIcon(VILLAGER_NORMAL) +

        "</summary>" +

        '<div class="site-nav__account-dropdown">' +

        '<a href="/account/profile.html">My Account</a>' +

        '<a href="/minimap/#my-gallery">My Gallery</a>' +

        '<button type="button" class="site-nav__sign-out-btn" id="museum-sign-out">Sign out</button>' +

        "</div></details>";



      const signOut = wrap.querySelector("#museum-sign-out");

      if (signOut) {

        signOut.addEventListener("click", onSignOut);

      }

    }



    bar.appendChild(wrap);

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



  function boot() {

    fetchMe().then(function () {

      clearAuthUi();

      injectAuth();

    });

  }



  window.MuseumAuth = {

    getUser: function () { return cachedMe; },

    fetchMe: fetchMe,

    saveToMyGallery: saveToMyGallery,

    isVerified: function () { return Boolean(cachedMe && cachedMe.emailVerified); },

    signOut: onSignOut,

  };



  if (document.readyState === "loading") {

    document.addEventListener("DOMContentLoaded", boot);

  } else {

    boot();

  }



  document.addEventListener("museum-nav-ready", boot);



  MOBILE_NAV_MQ.addEventListener("change", function () {

    if (document.querySelector(".site-nav__auth")) placeAuth();

  });

})();


