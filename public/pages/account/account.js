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
    document.getElementById("signup-form")?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const museumName = String(fd.get("museum_name") || "").trim();
      const { res, data } = await api("/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
          name: museumName,
          username: museumName,
        }),
      });
      if (res.ok) {
        showMsg(msg, "Account created. Check your email to verify before uploading.", true);
        e.target.reset();
      } else {
        showMsg(msg, data.message || data.error || "Sign up failed", false);
      }
    });
  }

  if (page === "login") {
    document.getElementById("login-form")?.addEventListener("submit", async function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const { res, data } = await api("/api/auth/sign-in/email", {
        method: "POST",
        body: JSON.stringify({
          email: fd.get("email"),
          password: fd.get("password"),
        }),
      });
      if (res.ok) {
        window.location.href = "/account/profile.html";
      } else {
        showMsg(msg, data.message || data.error || "Login failed", false);
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
    document.getElementById("profile-verified").textContent = u.emailVerified
      ? "Verified"
      : "Not verified — check your inbox";
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
