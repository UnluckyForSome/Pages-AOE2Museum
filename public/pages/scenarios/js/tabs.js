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
  const analyseScriptSrc = '/scenarios/js/inspector.js';
  const detailsRenderSrc = '/scenarios/js/scenario-details-render.js';
  let activeTab = null;
  let analyseScriptPromise = null;

  function dispatchTabChange(name) {
    document.dispatchEvent(
      new CustomEvent('scenarios:tabchange', { detail: { tab: name } })
    );
  }

  function reportAnalyseScriptError() {
    const errorEl = document.getElementById('analysis-error');
    if (errorEl) {
      errorEl.textContent = 'Failed to load analysis tools.';
      errorEl.classList.remove('hidden');
    }
  }

  function ensureAnalyseScript() {
    if (analyseScriptPromise) return analyseScriptPromise;
    analyseScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-scenarios-inspector="true"]');
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load inspector script.')), {
          once: true,
        });
        return;
      }

      if (!document.querySelector('script[data-scenario-details-render="true"]')) {
        const dr = document.createElement('script');
        dr.src = detailsRenderSrc;
        dr.defer = true;
        dr.dataset.scenarioDetailsRender = 'true';
        document.body.appendChild(dr);
      }

      const script = document.createElement('script');
      script.src = analyseScriptSrc;
      script.defer = true;
      script.dataset.scenariosInspector = 'true';
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load inspector script.'));
      document.body.appendChild(script);
    }).catch((error) => {
      analyseScriptPromise = null;
      reportAnalyseScriptError();
      throw error;
    });
    return analyseScriptPromise;
  }

  function select(name) {
    if (!panels[name]) name = 'archive';
    activeTab = name;
    tabs.forEach((t) => {
      const active = t.dataset.tab === name;
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    Object.entries(panels).forEach(([key, el]) => {
      if (el) el.hidden = key !== name;
    });
    if (name === 'analyse') {
      void ensureAnalyseScript().then(() => {
        if (activeTab === name) dispatchTabChange(name);
      });
      return;
    }
    dispatchTabChange(name);
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
