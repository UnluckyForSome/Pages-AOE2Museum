(function () {
  const nav = document.querySelector(".site-nav");
  const btn = document.querySelector(".site-nav__toggle");
  const backdrop = document.querySelector(".site-nav__backdrop");
  const menu = document.getElementById("site-nav-menu");
  if (!nav || !btn || !menu) return;

  function setOpen(open) {
    nav.classList.toggle("site-nav--open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.classList.toggle("museum-nav-open", open);
  }

  btn.addEventListener("click", function () {
    setOpen(!nav.classList.contains("site-nav--open"));
  });

  if (backdrop) {
    backdrop.addEventListener("click", function () {
      setOpen(false);
    });
  }

  menu.addEventListener("click", function (e) {
    if (e.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && nav.classList.contains("site-nav--open")) {
      setOpen(false);
      btn.focus();
    }
  });
})();
