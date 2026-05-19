const TURNSTILE_SITEKEY_PROD = "0x4AAAAAACsqOhUOmHnJaPFc";
const TURNSTILE_SITEKEY_DEV = "1x00000000000000000000AA";
function turnstileSitekey() {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" ? TURNSTILE_SITEKEY_DEV : TURNSTILE_SITEKEY_PROD;
}

const PANEL_IDS = ["browse", "upload", "extract", "pack"];

function selectTab(name) {
  if (!PANEL_IDS.includes(name)) name = "browse";
  document.querySelectorAll(".tabs .tab").forEach((t) => {
    t.setAttribute("aria-selected", t.dataset.tab === name ? "true" : "false");
  });
  PANEL_IDS.forEach((id) => {
    const el = document.getElementById("panel-" + id);
    if (el) el.hidden = id !== name;
  });
}

function tabFromHash() {
  const hash = (location.hash || "").replace(/^#/, "");
  if (PANEL_IDS.includes(hash)) return hash;
  return "browse";
}

function setHashForTab(name) {
  const path = location.pathname.replace(/\/campaignmanager\/?$/, "/campaigns/");
  if (name === "extract" || name === "pack") {
    history.replaceState(null, "", path + "#" + name);
  } else {
    history.replaceState(null, "", path);
  }
}

document.querySelectorAll(".tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    selectTab(name);
    setHashForTab(name);
  });
});

selectTab(tabFromHash());
window.addEventListener("hashchange", () => selectTab(tabFromHash()));

function esc(s) {
  const el = document.createElement("span");
  el.textContent = s;
  return el.innerHTML;
}

async function loadCampaigns() {
  const tbody = document.getElementById("campaign-body");
  if (!tbody) return;
  try {
    const res = await fetch("/api/campaigns", { credentials: "include" });
    const rows = await res.json();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5">No campaigns yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(
        (c) =>
          `<tr data-id="${c.id}"><td>${esc(c.display_title || c.original_filename)}</td>` +
          `<td>${esc(c.uploader_username || "Unknown")}</td>` +
          `<td>v${c.version}</td><td>${c.hearts_count || 0}</td>` +
          `<td>${esc((c.uploaded_at || "").slice(0, 10))}</td></tr>`,
      )
      .join("");
    document.getElementById("campaign-stats").textContent = rows.length + " campaign(s)";
  } catch {
    tbody.innerHTML = '<tr><td colspan="5">Failed to load.</td></tr>';
  }
}

let turnstileWidget = null;
function initTurnstile() {
  const el = document.getElementById("turnstile-container");
  if (!el || !window.turnstile) return;
  turnstileWidget = window.turnstile.render(el, { sitekey: turnstileSitekey() });
}

document.getElementById("campaign-upload-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = document.getElementById("upload-status");
  const me = await window.MuseumAuth?.fetchMe();
  if (!me?.emailVerified) {
    status.textContent = "Sign in with a verified email to upload.";
    status.className = "form-msg form-msg--err";
    return;
  }
  const fd = new FormData(e.target);
  const token = window.turnstile?.getResponse(turnstileWidget);
  if (!token) {
    status.textContent = "Complete the Turnstile check.";
    status.className = "form-msg form-msg--err";
    return;
  }
  fd.append("cf-turnstile-response", token);
  status.textContent = "Uploading…";
  const res = await fetch("/api/campaigns/upload", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    status.textContent = "Uploaded!";
    status.className = "form-msg form-msg--ok";
    e.target.reset();
    window.turnstile?.reset(turnstileWidget);
    loadCampaigns();
  } else {
    status.textContent =
      data.error ||
      (data.conflicts ? "Filename conflicts: " + data.conflicts.join(", ") : "Upload failed");
    status.className = "form-msg form-msg--err";
  }
});

loadCampaigns();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTurnstile);
} else {
  initTurnstile();
}
