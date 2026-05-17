(function () {
  const grid = document.getElementById("my-gallery-grid");
  const refreshBtn = document.getElementById("my-gallery-refresh");
  const panel = document.getElementById("panel-my-gallery");
  if (!grid || !panel) return;

  async function loadMyGallery() {
    grid.textContent = "Loading…";
    const me = await window.MuseumAuth?.fetchMe();
    if (!me) {
      grid.textContent = "Sign in to view your gallery.";
      return;
    }
    const res = await fetch("/api/history/mine?kind=minimap", { credentials: "include" });
    const items = await res.json();
    if (!items.length) {
      grid.textContent = "No saved minimaps yet. Render one and choose Save to My Gallery.";
      return;
    }
    grid.textContent = "";
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const fig = document.createElement("figure");
      fig.className = "gallery-item";
      const img = document.createElement("img");
      img.src = "/api/history/" + encodeURIComponent(item.id);
      img.alt = item.source_filename;
      img.loading = "lazy";
      const cap = document.createElement("figcaption");
      cap.textContent = item.source_filename + (item.visibility === "hidden" ? " (private)" : "");
      fig.appendChild(img);
      fig.appendChild(cap);
      frag.appendChild(fig);
    }
    grid.appendChild(frag);
  }

  refreshBtn?.addEventListener("click", loadMyGallery);

  document.querySelector('[data-tab="my-gallery"]')?.addEventListener("click", function () {
    loadMyGallery();
  });

  if (window.location.hash === "#my-gallery") {
    document.querySelector('[data-tab="my-gallery"]')?.click();
  }
})();

/** Prompt after render — called from app.js when available. */
window.MuseumSavePrompt = async function (blob, sourceName, settings) {
  const me = await window.MuseumAuth?.fetchMe();
  if (!me?.emailVerified) return;
  const pub = confirm(
    "Save this minimap to My Gallery?\n\nOK = also show in Public Gallery\nCancel = private (My Gallery only)",
  );
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  const b64 = btoa(binary);
  await window.MuseumAuth.saveToMyGallery({
    kind: "minimap",
    source_filename: sourceName,
    settings: settings || {},
    visibility: pub ? "public" : "hidden",
    artifact_base64: b64,
    content_type: "image/png",
  });
  if (pub) {
    fetch("/api/gallery", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-source-name": encodeURIComponent(sourceName),
      },
      body: blob,
    }).catch(function () {});
  } else {
    fetch("/api/gallery", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-source-name": encodeURIComponent(sourceName),
        "x-skip-public-gallery": "1",
      },
      body: blob,
    }).catch(function () {});
  }
};
