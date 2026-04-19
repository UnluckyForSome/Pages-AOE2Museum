(() => {
  const tabs = Array.from(document.querySelectorAll('.tab[data-tab]'));
  if (tabs.length === 0) return;

  const panels = {
    archive: document.getElementById('panel-archive'),
    contribute: document.getElementById('panel-contribute'),
  };

  function select(name) {
    if (!panels[name]) name = 'archive';
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Object.entries(panels).forEach(([key, el]) => {
      if (el) el.hidden = key !== name;
    });
    document.dispatchEvent(
      new CustomEvent('scenarios:tabchange', { detail: { tab: name } })
    );
  }

  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      const name = t.dataset.tab;
      select(name);
      if (history.replaceState) {
        history.replaceState(null, '', '#' + name);
      } else {
        location.hash = name;
      }
    });
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tab-link]');
    if (!a) return;
    e.preventDefault();
    const name = a.getAttribute('data-tab-link');
    select(name);
    if (history.replaceState) history.replaceState(null, '', '#' + name);
  });

  const initial = (location.hash || '').replace('#', '');
  select(panels[initial] ? initial : 'archive');

  window.addEventListener('hashchange', () => {
    const name = (location.hash || '').replace('#', '');
    if (panels[name]) select(name);
  });
})();
