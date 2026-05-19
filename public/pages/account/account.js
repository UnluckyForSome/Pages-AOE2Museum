async function api(path, opts) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function showMsg(el, text, ok) {
  if (!el) return;
  el.textContent = text;
  el.className = ok ? "form-msg form-msg--ok" : "form-msg form-msg--err";
}

document.addEventListener("DOMContentLoaded", async function () {
  const page = document.body.dataset.accountPage;
  const msg = document.getElementById("account-msg");

  if (page === "signup") {
    window.MuseumAuth?.openLoginModal?.({ view: "sign-up" });
  }

  if (page === "login") {
    window.MuseumAuth?.openLoginModal?.({
      onSuccess: function () {
        window.location.href = "/account/profile.html";
      },
    });
  }

  if (page === "reset-password") {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const error = params.get("error");
    const intro = document.getElementById("reset-password-intro");
    const form = document.getElementById("reset-password-form");

    if (error || !token) {
      if (intro) {
        intro.textContent =
          "This reset link is invalid or has expired. Request a new link from the sign-in dialog.";
      }
      showMsg(msg, error ? "Reset link expired or invalid." : "Missing reset token.", false);
      return;
    }

    if (form) form.hidden = false;

    form?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const fd = new FormData(form);
      const password = String(fd.get("password") || "");
      const confirm = String(fd.get("password_confirm") || "");
      if (password !== confirm) {
        showMsg(msg, "Passwords do not match.", false);
        return;
      }

      const { res, data } = await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          newPassword: password,
          token: token,
        }),
      });

      if (res.ok) {
        showMsg(msg, "Password updated. You can sign in now.", true);
        form.hidden = true;
        if (intro) intro.textContent = "Your password has been updated.";
        setTimeout(function () {
          window.MuseumAuth?.openLoginModal?.();
        }, 800);
      } else {
        showMsg(msg, data.message || data.error || "Could not reset password", false);
      }
    });
  }

  if (page === "profile") {
    const { res, data } = await api("/api/me", { method: "GET" });
    if (!res.ok || !data.user) {
      window.location.href = "/account/login.html";
      return;
    }
    const u = data.user;
    document.getElementById("profile-name").textContent = u.username || "—";
    document.getElementById("profile-email").textContent = u.email;
    const verifiedEl = document.getElementById("profile-verified");
    if (u.emailVerified) {
      verifiedEl.textContent = "Verified";
    } else {
      const checkUrl =
        "/?museum-auth=verify-pending&email=" + encodeURIComponent(u.email || "");
      verifiedEl.innerHTML =
        'Not verified — <a href="' + checkUrl + '">verify your email</a>';
    }
  }

  if (page === "delete") {
    document.getElementById("delete-form")?.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!confirm("Permanently delete your account and all uploads? This cannot be undone.")) return;
      const { res, data } = await api("/api/auth/delete-user", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        showMsg(msg, data.message || data.error || "Delete failed", false);
      }
    });
  }
});
