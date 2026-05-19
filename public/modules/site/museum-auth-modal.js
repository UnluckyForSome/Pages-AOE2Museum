/** In-page sign-in / sign-up / forgot-password dialog (shared across museum pages). */
(function () {
  const MODAL_ID = "museum-auth-modal";
  const TURNSTILE_HOST_ID = "museum-auth-turnstile-host";

  const VIEW_TITLES = {
    "sign-in": "Sign in",
    "sign-up": "Create account",
    "verify-pending": "Verify your email",
    "verified-success": "Account verified",
    forgot: "Reset password",
    "reset-password": "Reset password",
    "reset-success": "Password updated",
    profile: "My account",
    delete: "Delete account",
  };

  let turnstileWidget = null;
  let pendingVerificationEmail = "";
  /** @type {"active" | "expired"} */
  let verifyPanelMode = "active";
  let pendingResetToken = "";
  let onSuccessCallback = null;
  let lastActiveElement = null;
  let wired = false;
  let activeView = "sign-in";

  function $(id) {
    return document.getElementById(id);
  }

  function shouldOverlayTurnstile(text, ok) {
    if (ok) return true;
    if (/security check|captcha/i.test(text)) return false;
    return true;
  }

  function showMsg(el, text, ok) {
    if (!el) return;
    el.textContent = text;
    el.className = ok
      ? "form-msg form-msg--ok museum-auth-modal__msg museum-auth-modal__status-msg"
      : "form-msg form-msg--err museum-auth-modal__msg museum-auth-modal__status-msg";
    el.hidden = false;
    const status = el.closest(".museum-auth-modal__status");
    if (!status) return;
    if (shouldOverlayTurnstile(text, ok)) {
      status.classList.add("is-showing-msg");
    } else {
      status.classList.remove("is-showing-msg");
    }
  }

  function clearMsg(id) {
    const el = $(id);
    if (!el) return;
    el.textContent = "";
    el.className = "form-msg museum-auth-modal__msg museum-auth-modal__status-msg";
    el.hidden = true;
    el.closest(".museum-auth-modal__status")?.classList.remove("is-showing-msg");
  }

  function isVerifySessionDeadError(text) {
    if (!text) return false;
    return /no pending sign-up|verification expired|already used|invalid verification link/i.test(
      text,
    );
  }

  function setVerifyPanelMode(mode, opts) {
    verifyPanelMode = mode;
    const active = $("museum-auth-verify-active-block");
    const expired = $("museum-auth-verify-expired-block");
    const hint = $("museum-auth-verify-hint");
    if (active) active.hidden = mode === "expired";
    if (expired) expired.hidden = mode !== "expired";
    if (hint) hint.hidden = mode === "expired";
    if (mode === "expired") {
      const textEl = $("museum-auth-verify-expired-text");
      if (textEl) {
        textEl.textContent =
          opts?.message ||
          "This verification link or code has expired. Sign up again to get a new code (you can use the same email).";
      }
      if (opts?.email) pendingVerificationEmail = String(opts.email);
      setTimeout(function () {
        $("museum-auth-verify-signup-again")?.focus();
      }, 0);
    }
    clearMsg("museum-auth-verify-msg");
  }

  async function getTurnstileTokenForView(view) {
    if (!viewUsesTurnstile(view)) return "";
    try {
      await ensureTurnstileScript();
      mountTurnstileHost(view);
      await ensureTurnstileWidget(view);
    } catch {
      return "";
    }
    let token = window.MuseumTurnstile?.getToken(turnstileWidget) || "";
    if (!token) {
      window.MuseumTurnstile?.reset(turnstileWidget);
      await new Promise(function (resolve) {
        setTimeout(resolve, 400);
      });
      token = window.MuseumTurnstile?.getToken(turnstileWidget) || "";
    }
    return token;
  }

  function focusTurnstileHost() {
    const host = $(TURNSTILE_HOST_ID);
    if (!host || host.hidden) return;
    try {
      host.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch {
      /* ignore */
    }
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
      ...opts,
    });
    const data = await res.json().catch(function () {
      return {};
    });
    return { res, data };
  }

  function ensureTurnstileScript() {
    if (window.MuseumTurnstile) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="/modules/site/museum-turnstile.js"]')) {
        const wait = function () {
          if (window.MuseumTurnstile) resolve();
          else setTimeout(wait, 40);
        };
        wait();
        return;
      }
      const script = document.createElement("script");
      script.src = "/modules/site/museum-turnstile.js";
      script.defer = true;
      script.onload = function () {
        resolve();
      };
      script.onerror = function () {
        reject(new Error("Turnstile helper failed to load"));
      };
      document.body.appendChild(script);
    });
  }

  function modalMarkup() {
    return (
      '<div class="modal museum-auth-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="museum-auth-modal-title">' +
      '<div class="card modal__card museum-auth-modal__card">' +
      '<div class="modal__head">' +
      '<div class="modal__title" id="museum-auth-modal-title">Sign in</div>' +
      '<button type="button" class="modal__close" data-museum-auth-close aria-label="Close">×</button>' +
      "</div>" +
      '<div class="museum-auth-modal__stack">' +
      '<div id="museum-auth-sign-in-panel" class="museum-auth-modal__panel is-active" data-auth-view="sign-in">' +
      '<form id="museum-auth-login-form" class="museum-auth-modal__form" novalidate>' +
      '<div class="museum-auth-modal__fields">' +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">Username or Email Address</span>' +
      '<input class="museum-auth-modal__input" type="text" name="identifier" required autocomplete="username" autocapitalize="none" />' +
      "</label>" +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">Password</span>' +
      '<input class="museum-auth-modal__input" type="password" name="password" required autocomplete="current-password" />' +
      "</label>" +
      '<div class="museum-auth-modal__extras">' +
      '<label class="museum-auth-modal__remember">' +
      '<input type="checkbox" name="remember" checked />' +
      "<span>Remember me</span>" +
      "</label>" +
      '<button type="button" class="museum-auth-modal__forgot linklike" id="museum-auth-forgot-btn">Forgot your password?</button>' +
      "</div>" +
      '<div class="museum-auth-modal__status" data-turnstile-slot="sign-in">' +
      '<p id="museum-auth-msg" class="form-msg museum-auth-modal__msg museum-auth-modal__status-msg" role="status" hidden></p>' +
      "</div>" +
      '<button type="submit" class="btn museum-auth-modal__submit" id="museum-auth-submit">Sign in</button>' +
      "</div>" +
      "</form>" +
      '<p class="museum-auth-modal__footer">' +
      '<button type="button" class="linklike" id="museum-auth-show-signup">Create an account</button>' +
      "</p>" +
      "</div>" +
      '<div id="museum-auth-sign-up-panel" class="museum-auth-modal__panel" data-auth-view="sign-up">' +
      '<form id="museum-auth-signup-form" class="museum-auth-modal__form" novalidate>' +
      '<div class="museum-auth-modal__fields">' +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">Username</span>' +
      '<input class="museum-auth-modal__input" type="text" name="museum_name" required pattern="[A-Za-z0-9_]{3,20}" autocomplete="username" maxlength="20" autocapitalize="none" placeholder="3–20 letters, numbers, or underscore" />' +
      "</label>" +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">Email Address</span>' +
      '<input class="museum-auth-modal__input" type="email" name="email" required autocomplete="email" />' +
      "</label>" +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">Password</span>' +
      '<input class="museum-auth-modal__input" type="password" name="password" required minlength="8" autocomplete="new-password" />' +
      "</label>" +
      '<div class="museum-auth-modal__status" data-turnstile-slot="sign-up">' +
      '<p id="museum-auth-signup-msg" class="form-msg museum-auth-modal__msg museum-auth-modal__status-msg" role="status" hidden></p>' +
      "</div>" +
      '<button type="submit" class="btn museum-auth-modal__submit" id="museum-auth-signup-submit">Create account</button>' +
      "</div>" +
      "</form>" +
      '<p class="museum-auth-modal__footer">' +
      '<button type="button" class="linklike" id="museum-auth-show-signin-from-signup">Already have an account? Sign in</button>' +
      "</p>" +
      "</div>" +
      '<div id="museum-auth-verify-pending-panel" class="museum-auth-modal__panel" data-auth-view="verify-pending">' +
      '<div id="museum-auth-verify-expired-block" class="museum-auth-modal__verify-expired" hidden>' +
      '<p id="museum-auth-verify-expired-text" class="museum-auth-modal__hint museum-auth-modal__hint--verify"></p>' +
      '<button type="button" class="btn museum-auth-modal__submit" id="museum-auth-verify-signup-again">Sign up again</button>' +
      '<button type="button" class="linklike museum-auth-modal__back-link" id="museum-auth-verify-signin-expired">Sign in</button>' +
      "</div>" +
      '<form id="museum-auth-verify-form" class="museum-auth-modal__form" novalidate>' +
      '<div id="museum-auth-verify-active-block">' +
      '<p class="museum-auth-modal__hint museum-auth-modal__hint--verify" id="museum-auth-verify-hint">' +
      "We sent a verification code to <strong id=\"museum-auth-verify-email\"></strong>. " +
      "Enter the code below, or use the link in your email. Codes expire in 10 minutes." +
      "</p>" +
      '<div class="museum-auth-modal__fields">' +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">Verification code</span>' +
      '<input class="museum-auth-modal__input museum-auth-modal__otp" id="museum-auth-verify-otp" type="text" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />' +
      "</label>" +
      '<div class="museum-auth-modal__msg-band">' +
      '<p id="museum-auth-verify-msg" class="form-msg museum-auth-modal__msg" role="status" hidden></p>' +
      "</div>" +
      '<div class="museum-auth-modal__status" data-turnstile-slot="verify-pending" aria-label="Security check"></div>' +
      '<button type="submit" class="btn museum-auth-modal__submit" id="museum-auth-verify-submit">Verify email</button>' +
      '<button type="button" class="btn btn--ghost museum-auth-modal__submit" id="museum-auth-verify-resend">Resend code</button>' +
      '<button type="button" class="linklike museum-auth-modal__back-link" id="museum-auth-verify-back">Back to sign up</button>' +
      "</div>" +
      "</form>" +
      "</div>" +
      '<div id="museum-auth-verified-success-panel" class="museum-auth-modal__panel" data-auth-view="verified-success">' +
      '<p class="museum-auth-modal__hint">Your email is verified and your account is ready.</p>' +
      '<button type="button" class="btn museum-auth-modal__submit" id="museum-auth-verified-signin">Sign in</button>' +
      "</div>" +
      '<div id="museum-auth-forgot-panel" class="museum-auth-modal__panel" data-auth-view="forgot">' +
      '<form id="museum-auth-forgot-form" class="museum-auth-modal__form" novalidate>' +
      '<p class="museum-auth-modal__hint">Enter the email on your account and we&rsquo;ll send a reset link.</p>' +
      '<div class="museum-auth-modal__fields">' +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">Email Address</span>' +
      '<input class="museum-auth-modal__input" type="email" name="email" required autocomplete="email" />' +
      "</label>" +
      '<div class="museum-auth-modal__status" data-turnstile-slot="forgot">' +
      '<p id="museum-auth-forgot-msg" class="form-msg museum-auth-modal__msg museum-auth-modal__status-msg" role="status" hidden></p>' +
      "</div>" +
      '<button type="submit" class="btn museum-auth-modal__submit" id="museum-auth-forgot-submit">Send reset link</button>' +
      '<button type="button" class="btn btn--ghost museum-auth-modal__submit" id="museum-auth-back-btn">Back to sign in</button>' +
      "</div>" +
      "</form>" +
      "</div>" +
      '<div id="museum-auth-reset-panel" class="museum-auth-modal__panel" data-auth-view="reset-password">' +
      '<p class="museum-auth-modal__hint" id="museum-auth-reset-hint">Choose a new password for your account.</p>' +
      '<form id="museum-auth-reset-form" class="museum-auth-modal__form" novalidate>' +
      '<div class="museum-auth-modal__fields">' +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">New password</span>' +
      '<input class="museum-auth-modal__input" type="password" name="password" required minlength="8" autocomplete="new-password" />' +
      "</label>" +
      '<label class="museum-auth-modal__field">' +
      '<span class="museum-auth-modal__label">Confirm password</span>' +
      '<input class="museum-auth-modal__input" type="password" name="password_confirm" required minlength="8" autocomplete="new-password" />' +
      "</label>" +
      '<div class="museum-auth-modal__msg-band">' +
      '<p id="museum-auth-reset-msg" class="form-msg museum-auth-modal__msg" role="status" hidden></p>' +
      "</div>" +
      '<button type="submit" class="btn museum-auth-modal__submit" id="museum-auth-reset-submit">Update password</button>' +
      "</div>" +
      "</form>" +
      '<p class="museum-auth-modal__footer museum-auth-modal__footer--reset">' +
      '<button type="button" class="linklike" id="museum-auth-reset-forgot">Request a new reset link</button>' +
      '<button type="button" class="linklike museum-auth-modal__back-link" id="museum-auth-reset-back">Back to sign in</button>' +
      "</p>" +
      "</div>" +
      '<div id="museum-auth-reset-success-panel" class="museum-auth-modal__panel" data-auth-view="reset-success">' +
      '<p class="museum-auth-modal__hint">Your password has been updated.</p>' +
      '<button type="button" class="btn museum-auth-modal__submit" id="museum-auth-reset-success-signin">Sign in</button>' +
      "</div>" +
      '<div id="museum-auth-profile-panel" class="museum-auth-modal__panel" data-auth-view="profile">' +
      '<dl class="profile-dl museum-auth-modal__profile-dl">' +
      '<dt>Name</dt><dd id="museum-auth-profile-name">&hellip;</dd>' +
      '<dt>Email</dt><dd id="museum-auth-profile-email">&hellip;</dd>' +
      '<dt>Status</dt><dd id="museum-auth-profile-verified">&hellip;</dd>' +
      '</dl>' +
      '<p class="museum-auth-modal__footer">' +
      '<button type="button" class="linklike text-danger" id="museum-auth-profile-delete-link">Delete account</button>' +
      '</p>' +
      '</div>' +
      '<div id="museum-auth-delete-panel" class="museum-auth-modal__panel" data-auth-view="delete">' +
      '<p class="museum-auth-modal__hint text-danger">This permanently removes all your uploads, campaigns, generated history, and hearts. It cannot be undone.</p>' +
      '<form id="museum-auth-delete-form" class="museum-auth-modal__form">' +
      '<button type="submit" class="btn btn--danger museum-auth-modal__submit">Delete my account</button>' +
      '<button type="button" class="btn btn--ghost museum-auth-modal__submit" id="museum-auth-delete-cancel">Cancel</button>' +
      '</form>' +
      '<div class="museum-auth-modal__msg-band">' +
      '<p id="museum-auth-delete-msg" class="form-msg museum-auth-modal__msg" role="status" hidden></p>' +
      "</div>" +
      '</div>' +
      "</div>" +
      '<div id="' +
      TURNSTILE_HOST_ID +
      '" class="museum-auth-modal__turnstile" hidden aria-hidden="true"></div>' +
      "</div>" +
      "</div>"
    );
  }

  function ensureModal() {
    let backdrop = $(MODAL_ID);
    if (
      backdrop?.querySelector("#museum-auth-verify-pending-panel") &&
      backdrop?.querySelector("#museum-auth-verify-expired-block") &&
      backdrop?.querySelector("#museum-auth-reset-panel") &&
      backdrop?.querySelector("#museum-auth-profile-panel") &&
      backdrop?.querySelector(".museum-auth-modal__status")
    ) {
      return backdrop;
    }
    if (backdrop) backdrop.remove();
    wired = false;
    turnstileWidget = null;
    backdrop = document.createElement("div");
    backdrop.id = MODAL_ID;
    backdrop.className = "modal-backdrop museum-auth-modal";
    backdrop.hidden = true;
    backdrop.innerHTML = modalMarkup();

    document.body.appendChild(backdrop);
    wireModal(backdrop);
    void warmTurnstile();
    return backdrop;
  }

  function mountTurnstileHost(view) {
    const slot = backdropSlotForView(view);
    const host = $(TURNSTILE_HOST_ID);
    if (!slot || !host) return;
    host.hidden = false;
    host.removeAttribute("aria-hidden");
    if (host.parentElement !== slot) {
      slot.appendChild(host);
    }
  }

  function backdropSlotForView(view) {
    return document.querySelector('[data-turnstile-slot="' + view + '"]');
  }

  function setActivePanels(view) {
    document.querySelectorAll(".museum-auth-modal__panel").forEach(function (panel) {
      const isActive = panel.getAttribute("data-auth-view") === view;
      panel.classList.toggle("is-active", isActive);
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }

  async function warmTurnstile() {
    try {
      await ensureTurnstileScript();
      await window.MuseumTurnstile?.load();
      await ensureTurnstileWidget("sign-in");
    } catch {
      /* surfaced on submit */
    }
  }

  async function ensureTurnstileWidget(view) {
    await ensureTurnstileScript();
    await window.MuseumTurnstile?.load();
    mountTurnstileHost(view);

    const host = $(TURNSTILE_HOST_ID);
    if (!host || !window.MuseumTurnstile) return null;

    if (turnstileWidget != null) {
      window.MuseumTurnstile.reset(turnstileWidget);
      return turnstileWidget;
    }

    try {
      turnstileWidget = await window.MuseumTurnstile.render(host, {
        theme: "dark",
        size: "flexible",
      });
    } catch {
      turnstileWidget = null;
    }
    return turnstileWidget;
  }

  function viewUsesTurnstile(view) {
    return (
      view === "sign-in" ||
      view === "sign-up" ||
      view === "forgot" ||
      view === "verify-pending"
    );
  }

  function showVerifyPending(email) {
    pendingVerificationEmail = email;
    setVerifyPanelMode("active");
    const emailEl = $("museum-auth-verify-email");
    if (emailEl) emailEl.textContent = email;
    const otpInput = $("museum-auth-verify-otp");
    if (otpInput) otpInput.value = "";
    clearMsg("museum-auth-verify-msg");
    void setView("verify-pending").then(function () {
      if (otpInput) otpInput.focus();
    });
  }

  function showVerifiedSuccess() {
    void setView("verified-success");
  }

  function applyResetState(token, error) {
    pendingResetToken = token || "";
    const form = $("museum-auth-reset-form");
    const hint = $("museum-auth-reset-hint");
    const msg = $("museum-auth-reset-msg");
    if (form) {
      form.hidden = !token || !!error;
      if (!error) form.reset();
    }
    if (hint) {
      hint.textContent =
        token && !error
          ? "Choose a new password for your account."
          : "This reset link is invalid or has expired. Request a new link below.";
    }
    if (error && msg) {
      showMsg(msg, "Reset link expired or invalid.", false);
    } else {
      clearMsg("museum-auth-reset-msg");
    }
  }

  function showResetSuccess() {
    pendingResetToken = "";
    void setView("reset-success");
  }

  function populateProfile(user) {
    const nameEl = $("museum-auth-profile-name");
    const emailEl = $("museum-auth-profile-email");
    const verifiedEl = $("museum-auth-profile-verified");
    if (nameEl) nameEl.textContent = user.username || "—";
    if (emailEl) emailEl.textContent = user.email || "—";
    if (!verifiedEl) return;
    if (user.emailVerified) {
      verifiedEl.textContent = "Verified";
      return;
    }
    verifiedEl.innerHTML =
      'Not verified — <button type="button" class="linklike" id="museum-auth-profile-verify">verify your email</button>';
    $("museum-auth-profile-verify")?.addEventListener("click", function () {
      pendingVerificationEmail = user.email || "";
      showVerifyPending(user.email || "");
    });
  }

  async function loadProfilePanel() {
    const { res, data } = await api("/api/me", { method: "GET" });
    if (!res.ok || !data.user) return false;
    populateProfile(data.user);
    return true;
  }

  async function setView(view) {
    activeView = view;
    const title = $("museum-auth-modal-title");
    if (title) title.textContent = VIEW_TITLES[view] || VIEW_TITLES["sign-in"];
    setActivePanels(view);
    if (viewUsesTurnstile(view)) {
      mountTurnstileHost(view);
      try {
        await ensureTurnstileWidget(view);
      } catch {
        /* Turnstile errors surfaced on submit */
      }
    }
  }

  function focusFirstField(view) {
    const map = {
      "sign-in": '#museum-auth-login-form input[name="identifier"]',
      "sign-up": '#museum-auth-signup-form input[name="museum_name"]',
      "verify-pending": "#museum-auth-verify-otp",
      forgot: '#museum-auth-forgot-form input[name="email"]',
      "reset-password": '#museum-auth-reset-form input[name="password"]',
    };
    const sel = map[view];
    const input = sel ? document.querySelector(sel) : null;
    if (input) setTimeout(function () { input.focus(); }, 0);
  }

  function closeModal() {
    const backdrop = $(MODAL_ID);
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.documentElement.classList.remove("modal-open");
    if (lastActiveElement && typeof lastActiveElement.focus === "function") {
      try {
        lastActiveElement.focus();
      } catch (_) {}
    }
    lastActiveElement = null;
    onSuccessCallback = null;
    pendingResetToken = "";
    activeView = "sign-in";
    setActivePanels("sign-in");
  }

  function signInPathAndBody(identifier, password, rememberMe, token) {
    const base = {
      password: password,
      rememberMe: rememberMe,
      "cf-turnstile-response": token,
    };
    if (identifier.includes("@")) {
      return {
        path: "/api/auth/sign-in/email",
        body: { ...base, email: identifier },
      };
    }
    return {
      path: "/api/auth/sign-in/username",
      body: { ...base, username: identifier },
    };
  }

  function wireModal(backdrop) {
    if (!backdrop || wired) return;
    wired = true;

    backdrop.addEventListener("click", function (ev) {
      if (ev.target === backdrop) closeModal();
      if (ev.target.closest("[data-museum-auth-close]")) closeModal();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && backdrop && !backdrop.hidden) closeModal();
    });

    $("museum-auth-forgot-btn")?.addEventListener("click", function () {
      void setView("forgot").then(function () {
        focusFirstField("forgot");
      });
    });

    $("museum-auth-back-btn")?.addEventListener("click", function () {
      void setView("sign-in").then(function () {
        focusFirstField("sign-in");
      });
    });

    $("museum-auth-show-signup")?.addEventListener("click", function () {
      void setView("sign-up").then(function () {
        focusFirstField("sign-up");
      });
    });

    $("museum-auth-show-signin-from-signup")?.addEventListener("click", function () {
      void setView("sign-in").then(function () {
        focusFirstField("sign-in");
      });
    });

    $("museum-auth-verify-back")?.addEventListener("click", function () {
      void setView("sign-up").then(function () {
        focusFirstField("sign-up");
      });
    });

    $("museum-auth-verified-signin")?.addEventListener("click", function () {
      void setView("sign-in").then(function () {
        focusFirstField("sign-in");
      });
    });

    $("museum-auth-reset-success-signin")?.addEventListener("click", function () {
      void setView("sign-in").then(function () {
        focusFirstField("sign-in");
      });
    });

    $("museum-auth-reset-forgot")?.addEventListener("click", function () {
      void setView("forgot").then(function () {
        focusFirstField("forgot");
      });
    });

    $("museum-auth-reset-back")?.addEventListener("click", function () {
      void setView("sign-in").then(function () {
        focusFirstField("sign-in");
      });
    });

    $("museum-auth-profile-delete-link")?.addEventListener("click", function () {
      void setView("delete");
    });

    $("museum-auth-delete-cancel")?.addEventListener("click", function () {
      void setView("profile").then(function () {
        void loadProfilePanel();
      });
    });

    const deleteForm = $("museum-auth-delete-form");
    deleteForm?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const msg = $("museum-auth-delete-msg");
      if (!confirm("Permanently delete your account and all uploads? This cannot be undone.")) {
        return;
      }
      const submit = deleteForm.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      showMsg(msg, "Deleting…", true);

      const { res, data } = await api("/api/auth/delete-user", {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (submit) submit.disabled = false;

      if (res.ok) {
        closeModal();
        document.dispatchEvent(new CustomEvent("museum-auth-login"));
        window.location.assign("/");
        return;
      }

      showMsg(msg, data.message || data.error || "Delete failed", false);
    });

    const resetForm = $("museum-auth-reset-form");
    resetForm?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const msg = $("museum-auth-reset-msg");
      const submit = $("museum-auth-reset-submit");
      if (!pendingResetToken) {
        showMsg(msg, "Reset link expired or invalid.", false);
        return;
      }
      const fd = new FormData(resetForm);
      const password = String(fd.get("password") || "");
      const confirm = String(fd.get("password_confirm") || "");
      if (password !== confirm) {
        showMsg(msg, "Passwords do not match.", false);
        return;
      }
      if (submit) submit.disabled = true;
      showMsg(msg, "Updating…", true);

      const { res, data } = await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          newPassword: password,
          token: pendingResetToken,
        }),
      });

      if (submit) submit.disabled = false;

      if (res.ok) {
        resetForm.reset();
        showResetSuccess();
        return;
      }

      showMsg(msg, data.message || data.error || "Could not reset password", false);
    });

    function openSignUpWithEmail(email) {
      void setView("sign-up").then(function () {
        const input = document.querySelector(
          '#museum-auth-signup-form input[name="email"]',
        );
        if (input && email) input.value = email;
        focusFirstField("sign-up");
      });
    }

    $("museum-auth-verify-signup-again")?.addEventListener("click", function () {
      openSignUpWithEmail(pendingVerificationEmail);
    });

    $("museum-auth-verify-signin-expired")?.addEventListener("click", function () {
      void setView("sign-in").then(function () {
        focusFirstField("sign-in");
      });
    });

    const verifyForm = $("museum-auth-verify-form");
    verifyForm?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const msg = $("museum-auth-verify-msg");
      const submit = $("museum-auth-verify-submit");
      if (verifyPanelMode === "expired") {
        openSignUpWithEmail(pendingVerificationEmail);
        return;
      }
      const otp = String($("museum-auth-verify-otp")?.value || "").trim();
      if (!pendingVerificationEmail) {
        setVerifyPanelMode("expired", {
          message: "No active verification for this email. Sign up again to get a new code.",
        });
        return;
      }
      if (!/^[0-9]{6}$/.test(otp)) {
        showMsg(msg, "Enter the 6-digit code from your email.", false);
        return;
      }
      const token = await getTurnstileTokenForView("verify-pending");
      if (!token) {
        showMsg(msg, "Complete the security check below.", false);
        focusTurnstileHost();
        return;
      }
      if (submit) submit.disabled = true;
      showMsg(msg, "Verifying…", true);

      const { res, data } = await api("/api/auth/museum/complete-verification", {
        method: "POST",
        body: JSON.stringify({
          email: pendingVerificationEmail,
          otp: otp,
          "cf-turnstile-response": token,
        }),
      });

      if (submit) submit.disabled = false;

      if (res.ok) {
        pendingVerificationEmail = "";
        showVerifiedSuccess();
        return;
      }

      const errText = data.error || data.message || "Verification failed";
      if (isVerifySessionDeadError(errText)) {
        setVerifyPanelMode("expired", {
          message: errText,
          email: pendingVerificationEmail,
        });
        return;
      }

      showMsg(msg, errText, false);
      window.MuseumTurnstile?.reset(turnstileWidget);
    });

    $("museum-auth-verify-resend")?.addEventListener("click", async function () {
      const msg = $("museum-auth-verify-msg");
      const btn = $("museum-auth-verify-resend");
      if (verifyPanelMode === "expired") {
        openSignUpWithEmail(pendingVerificationEmail);
        return;
      }
      if (!pendingVerificationEmail) {
        setVerifyPanelMode("expired", {
          message: "No active verification for this email. Sign up again to get a new code.",
        });
        return;
      }
      const token = await getTurnstileTokenForView("verify-pending");
      if (!token) {
        showMsg(msg, "Complete the security check below.", false);
        focusTurnstileHost();
        return;
      }
      if (btn) btn.disabled = true;
      showMsg(msg, "Sending…", true);

      const { res, data } = await api("/api/auth/museum/resend-verification", {
        method: "POST",
        body: JSON.stringify({
          email: pendingVerificationEmail,
          "cf-turnstile-response": token,
        }),
      });

      if (btn) btn.disabled = false;

      if (res.ok) {
        showMsg(msg, "A new code was sent. Check your inbox.", true);
        return;
      }

      const errText = data.error || data.message || "Could not resend code";
      if (isVerifySessionDeadError(errText)) {
        setVerifyPanelMode("expired", {
          message: errText,
          email: pendingVerificationEmail,
        });
        return;
      }

      showMsg(msg, errText, false);
      window.MuseumTurnstile?.reset(turnstileWidget);
    });

    const loginForm = $("museum-auth-login-form");
    loginForm?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const msg = $("museum-auth-msg");
      const submit = $("museum-auth-submit");
      const fd = new FormData(loginForm);
      const identifier = String(fd.get("identifier") || "").trim();
      const password = String(fd.get("password") || "");
      const rememberMe = fd.get("remember") === "on";
      const token = window.MuseumTurnstile?.getToken(turnstileWidget) || "";
      if (!identifier || !password) {
        showMsg(msg, "Enter your username or email and password.", false);
        return;
      }
      if (!token) {
        showMsg(msg, "Complete the security check.", false);
        return;
      }
      if (submit) submit.disabled = true;
      showMsg(msg, "Signing in…", true);

      const { path, body } = signInPathAndBody(identifier, password, rememberMe, token);
      const { res, data } = await api(path, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (submit) submit.disabled = false;

      if (res.ok) {
        const cb = onSuccessCallback;
        closeModal();
        document.dispatchEvent(new CustomEvent("museum-auth-login"));
        if (typeof cb === "function") cb();
        return;
      }

      if (res.status === 403 && identifier.includes("@")) {
        showVerifyPending(identifier);
        return;
      }

      showMsg(msg, data.message || data.error || "Login failed", false);
      window.MuseumTurnstile?.reset(turnstileWidget);
    });

    const signupForm = $("museum-auth-signup-form");
    signupForm?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const msg = $("museum-auth-signup-msg");
      const submit = $("museum-auth-signup-submit");
      const fd = new FormData(signupForm);
      const museumName = String(fd.get("museum_name") || "").trim();
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "");
      const token = window.MuseumTurnstile?.getToken(turnstileWidget) || "";

      if (!museumName || !email || !password) {
        showMsg(msg, "Fill in username, email, and password.", false);
        return;
      }
      if (!/^[A-Za-z0-9_]{3,20}$/.test(museumName)) {
        showMsg(msg, "Username must be 3–20 letters, numbers, or underscores.", false);
        return;
      }
      if (!token) {
        showMsg(msg, "Complete the security check.", false);
        return;
      }

      if (submit) submit.disabled = true;
      showMsg(msg, "Creating account…", true);

      const { res, data } = await api("/api/auth/museum/register", {
        method: "POST",
        body: JSON.stringify({
          email: email,
          username: museumName,
          password: password,
          "cf-turnstile-response": token,
        }),
      });

      if (submit) submit.disabled = false;

      if (res.ok) {
        signupForm.reset();
        window.MuseumTurnstile?.reset(turnstileWidget);
        showVerifyPending(email);
        return;
      }

      showMsg(msg, data.message || data.error || "Sign up failed", false);
      window.MuseumTurnstile?.reset(turnstileWidget);
    });

    const forgotForm = $("museum-auth-forgot-form");
    forgotForm?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const msg = $("museum-auth-forgot-msg");
      const submit = $("museum-auth-forgot-submit");
      const fd = new FormData(forgotForm);
      const email = String(fd.get("email") || "").trim();
      const token = window.MuseumTurnstile?.getToken(turnstileWidget) || "";
      if (!email) {
        showMsg(msg, "Enter your email address.", false);
        return;
      }
      if (!token) {
        showMsg(msg, "Complete the security check.", false);
        return;
      }
      if (submit) submit.disabled = true;
      showMsg(msg, "Sending…", true);

      const redirectTo =
        window.location.origin.replace(/\/$/, "") + "/?museum-auth=reset-password";
      const { res, data } = await api("/api/auth/request-password-reset", {
        method: "POST",
        body: JSON.stringify({
          email: email,
          redirectTo: redirectTo,
          "cf-turnstile-response": token,
        }),
      });

      if (submit) submit.disabled = false;

      if (res.ok) {
        showMsg(
          msg,
          "If an account exists for that email, a reset link is on its way.",
          true,
        );
        forgotForm.reset();
        window.MuseumTurnstile?.reset(turnstileWidget);
        return;
      }

      showMsg(msg, data.message || data.error || "Could not send reset link", false);
      window.MuseumTurnstile?.reset(turnstileWidget);
    });
  }

  async function open(opts) {
    const allowed = [
      "sign-in",
      "sign-up",
      "forgot",
      "verify-pending",
      "verified-success",
      "reset-password",
      "reset-success",
      "profile",
      "delete",
    ];
    let view =
      opts && allowed.includes(opts.view) ? opts.view : "sign-in";
    let resumeView = null;
    if (view === "profile" || view === "delete") {
      const { res, data } = await api("/api/me", { method: "GET" });
      if (!res.ok || !data.user) {
        resumeView = view;
        view = "sign-in";
      }
    }
    if (opts?.email && view === "verify-pending") {
      pendingVerificationEmail = String(opts.email);
    }
    if (view === "reset-password") {
      applyResetState(
        opts?.token != null ? String(opts.token) : pendingResetToken,
        opts?.error ? String(opts.error) : "",
      );
    }
    onSuccessCallback =
      opts && typeof opts.onSuccess === "function"
        ? opts.onSuccess
        : resumeView
          ? function () {
              void open({ view: resumeView });
            }
          : null;
    lastActiveElement = document.activeElement;

    const backdrop = ensureModal();
    $("museum-auth-login-form")?.reset();
    $("museum-auth-signup-form")?.reset();
    $("museum-auth-forgot-form")?.reset();
    $("museum-auth-reset-form")?.reset();
    clearMsg("museum-auth-msg");
    clearMsg("museum-auth-signup-msg");
    clearMsg("museum-auth-forgot-msg");
    clearMsg("museum-auth-verify-msg");
    clearMsg("museum-auth-reset-msg");
    clearMsg("museum-auth-delete-msg");
    if (view === "verify-pending" && pendingVerificationEmail) {
      const emailEl = $("museum-auth-verify-email");
      if (emailEl) emailEl.textContent = pendingVerificationEmail;
    }

    backdrop.hidden = false;
    document.documentElement.classList.add("modal-open");
    document.querySelector(".site-nav")?.classList.remove("site-nav--open");
    document.body.classList.remove("museum-nav-open");

    try {
      await setView(view);
      if (view === "verify-pending") {
        if (opts?.verifyExpired) {
          setVerifyPanelMode("expired", {
            message: opts.verifyError ? String(opts.verifyError) : undefined,
            email: opts.email ? String(opts.email) : pendingVerificationEmail,
          });
        } else {
          setVerifyPanelMode("active");
        }
      }
      if (view === "profile") {
        const ok = await loadProfilePanel();
        if (!ok) {
          await setView("sign-in");
          focusFirstField("sign-in");
          return;
        }
      }
    } catch {
      const msg = view === "sign-up" ? $("museum-auth-signup-msg") : $("museum-auth-msg");
      showMsg(msg, "Could not load security check. Refresh and try again.", false);
    }

    if (view !== "profile" && view !== "delete") {
      if (!(view === "verify-pending" && verifyPanelMode === "expired")) {
        focusFirstField(view);
      }
    }
  }

  window.MuseumAuthModal = {
    open: open,
    close: closeModal,
    warmTurnstile: warmTurnstile,
  };
})();
