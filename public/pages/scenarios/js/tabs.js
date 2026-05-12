(() => {
  const locationState = window.Aoe2MuseumLocation || {
    getQueryParam() {
      const hash = (location.hash || '').replace('#', '');
      return hash || null;
    },
    setQueryParam(_name, value) {
      const next = value && value !== 'archive' ? '#' + value : location.pathname;
      if (history.replaceState) {
        history.replaceState(null, '', next);
      } else {
        location.hash = value || '';
      }
    },
    subscribe(handler) {
      window.addEventListener('hashchange', handler);
    },
  };
  const tabs = Array.from(document.querySelectorAll('.tab[data-tab]'));
  if (tabs.length === 0) return;

  const panels = {
    archive: document.getElementById('panel-archive'),
    contribute: document.getElementById('panel-contribute'),
    analyse: document.getElementById('panel-analyse'),
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
      locationState.setQueryParam('tab', name, { replace: true, removeIf: 'archive' });
    });
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-tab-link]');
    if (!a) return;
    e.preventDefault();
    const name = a.getAttribute('data-tab-link');
    select(name);
    locationState.setQueryParam('tab', name, { replace: true, removeIf: 'archive' });
  });

  const initial = locationState.getQueryParam('tab') || 'archive';
  select(panels[initial] ? initial : 'archive');

  locationState.subscribe(() => {
    const name = locationState.getQueryParam('tab') || 'archive';
    if (panels[name]) select(name);
  });
})();
