(function () {
  const pub = document.getElementById("gif-public-grid");
  const mine = document.getElementById("gif-my-grid");
  if (!pub) return;

  async function loadPublic() {
    try {
      const res = await fetch("/api/gif/gallery", { cache: "no-store" });
      const entries = await res.json();
      pub.textContent = "";
      if (!entries.length) {
        pub.textContent = "No public GIFs yet.";
        return;
      }
      for (const e of entries) {
        const img = document.createElement("img");
        img.src = "/api/gif/gallery/" + encodeURIComponent(e.id);
        img.alt = e.sourceName || "gif";
        img.loading = "lazy";
        pub.appendChild(img);
      }
    } catch {
      pub.textContent = "Could not load public gallery.";
    }
  }

  async function loadMine() {
    if (!mine) return;
    const me = await window.MuseumAuth?.fetchMe();
    if (!me) {
      mine.textContent = "Sign in to view your GIF gallery.";
      return;
    }
    const res = await fetch("/api/history/mine?kind=gif", { credentials: "include" });
    const items = await res.json();
    mine.textContent = "";
    if (!items.length) {
      mine.textContent = "No saved GIFs yet.";
      return;
    }
    for (const item of items) {
      const img = document.createElement("img");
      img.src = "/api/history/" + encodeURIComponent(item.id);
      img.alt = item.source_filename;
      img.loading = "lazy";
      mine.appendChild(img);
    }
  }

  loadPublic();
  loadMine();
})();
