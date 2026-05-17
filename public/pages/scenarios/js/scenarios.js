(() => {
  const tbody = document.getElementById('scenario-body');
  const filterInput = document.getElementById('filter');
  const statsText = document.getElementById('stats-text');
  const thead = document.querySelector('.scenario-table thead');
  const tablePagination = document.getElementById('table-pagination');
  const tablePaginationText = document.getElementById('table-pagination-text');
  const tablePaginationBtn = document.getElementById('table-pagination-btn');

  const PAGE_SIZE = 50;
  const COL_COUNT = 5;
  let viewerIsAdmin = false;
  let allScenarios = [];
  let sortKey = 'display_name';
  let sortDir = 'asc';
  let tableExpanded = false;
  const expandedIds = new Set();
  let userCollapsed = false;
  const detailsCache = new Map();

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function stripExtension(name) {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(0, i) : name;
  }

  function scenarioDisplayName(s) {
    if (s.display_name) return s.display_name;
    return stripExtension(s.original_filename || s.filename);
  }

  const ERA_META = {
    aoe: { icon: 'aoe.png', label: 'Age of Empires' },
    aok: { icon: 'aok.png', label: 'Age of Kings' },
    aoc: { icon: 'aoc.png', label: 'The Conquerors' },
    hd: { icon: 'hd.png', label: 'HD Edition' },
    de: { icon: 'de.png', label: 'Definitive Edition' },
  };

  function eraIcon(gameEra) {
    if (!gameEra || !ERA_META[gameEra]) {
      return '<span class="era-unknown" title="Version unknown">—</span>';
    }
    const m = ERA_META[gameEra];
    return (
      '<img class="era-icon" src="/scenarios/img/' +
      m.icon +
      '" alt="' +
      escapeHtml(m.label) +
      '" title="' +
      escapeHtml(m.label) +
      '" width="22" height="22">'
    );
  }

  function formatDate(iso) {
    const d = new Date(iso + 'Z');
    const day = d.getUTCDate();
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    const yr = String(d.getUTCFullYear()).slice(-2);
    return day + ' ' + mon + ' ' + yr;
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function updateStats(scenarios, isFiltered) {
    const totalSize = scenarios.reduce((sum, s) => sum + s.size, 0);
    const totalDl = scenarios.reduce((sum, s) => sum + (s.downloads || 0), 0);
    const parsed = scenarios.filter((s) => s.has_details).length;
    statsText.textContent =
      scenarios.length + ' scenario' + (scenarios.length !== 1 ? 's' : '') +
      ' \u00B7 ' + formatSize(totalSize) + ' total' +
      ' \u00B7 ' + totalDl.toLocaleString() + ' download' + (totalDl !== 1 ? 's' : '') +
      (parsed > 0 ? ' \u00B7 ' + parsed + ' with preview' : '') +
      (isFiltered ? ' (filtered)' : '');
  }

  function sortScenarios(scenarios) {
    const sorted = [...scenarios];
    sorted.sort((a, b) => {
      let va = sortKey === 'display_name' ? scenarioDisplayName(a) : a[sortKey];
      let vb = sortKey === 'display_name' ? scenarioDisplayName(b) : b[sortKey];
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function updatePaginationUI(totalCount, visibleCount) {
    if (totalCount <= PAGE_SIZE) {
      tablePagination.classList.add('hidden');
      return;
    }
    tablePagination.classList.remove('hidden');
    tablePaginationText.textContent =
      'Showing ' + visibleCount.toLocaleString() + ' / ' + totalCount.toLocaleString();
    tablePaginationBtn.textContent = tableExpanded ? 'Show less' : 'Show all';
  }

  function buildDetailSkeletonHtml(startHidden) {
    let meta = '';
    for (let i = 0; i < 8; i++) {
      meta +=
        '<span class="skeleton skeleton--meta-label" style="--skeleton-w:' +
        (58 + (i % 3) * 8) +
        '%"></span>' +
        '<span class="skeleton skeleton--meta-value" style="--skeleton-w:' +
        (48 + (i % 4) * 10) +
        '%"></span>';
    }
    return (
      '<div class="scenario-detail-skeleton' +
      (startHidden ? ' hidden' : '') +
      '" aria-busy="true" aria-live="polite">' +
      '<div class="scenario-detail-skeleton-layout">' +
      '<div class="scenario-detail-skeleton-main">' +
      '<span class="skeleton skeleton--title"></span>' +
      '<span class="skeleton skeleton--byline"></span>' +
      '<div class="scenario-detail-skeleton-meta">' +
      meta +
      '</div>' +
      '<div class="scenario-view-toggles scenario-view-toggles--skeleton" aria-hidden="true">' +
      '<span class="skeleton skeleton--view-toggle"></span>' +
      '<span class="skeleton skeleton--view-toggle"></span>' +
      '<span class="skeleton skeleton--view-toggle"></span>' +
      '<span class="skeleton skeleton--view-toggle"></span>' +
      '</div></div>' +
      '<div class="scenario-detail-skeleton-minimap">' +
      '<div class="scenario-minimap-stack">' +
      '<div class="scenario-minimap-view">' +
      '<div class="scenario-minimap-inner">' +
      '<span class="skeleton skeleton--minimap"></span>' +
      '</div></div></div></div>' +
      '<div class="scenario-detail-skeleton-actions">' +
      '<span class="skeleton skeleton--btn"></span>' +
      '<span class="skeleton skeleton--btn"></span>' +
      '</div></div></div>'
    );
  }

  function setDetailPanelState(panel, state) {
    const skeleton = panel.querySelector('.scenario-detail-skeleton');
    const output = panel.querySelector('.scenario-detail-output');
    const errorEl = panel.querySelector('.scenario-detail-error');
    const loading = state === 'loading';
    const ready = state === 'ready';
    const errored = state === 'error';

    panel.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (skeleton) {
      skeleton.classList.toggle('hidden', !loading);
      skeleton.setAttribute('aria-hidden', ready || errored ? 'true' : 'false');
    }
    if (output) output.classList.toggle('hidden', !ready);
    if (errorEl) errorEl.classList.toggle('hidden', !errored);
  }

  function buildDetailPanelHtml(scenario) {
    const detailId = 'scenario-detail-' + scenario.id;
    const objectivesPanelId = 'scenario-objectives-' + scenario.id;
    const dl = scenario.downloads || 0;
    const hearts = scenario.hearts_count || 0;
    const isOpen = expandedIds.has(scenario.id);
    const cached = detailsCache.has(scenario.id);
    return (
      '<tr class="scenario-detail-row' +
      (isOpen ? ' is-open' : ' hidden') +
      '" data-detail-for="' +
      scenario.id +
      '">' +
      '<td colspan="' +
      COL_COUNT +
      '" class="scenario-detail-cell">' +
      '<div class="scenario-detail-shell">' +
      '<div class="scenario-detail-panel">' +
      '<div class="scenario-detail" id="' +
      detailId +
      '">' +
      buildDetailSkeletonHtml(cached) +
      '<p class="scenario-detail-error hidden" role="alert">Could not load details.</p>' +
      '<div class="analysis-output scenario-detail-output' +
      (cached ? '' : ' hidden') +
      '">' +
      '<p class="scenario-detail-unparsed hidden muted">Not yet parsed — preview pending backfill.</p>' +
      '<div class="card analysis-summary-card scenario-detail-main">' +
      '<h2 class="scenario-detail-title"></h2>' +
      '<p class="scenario-detail-byline"></p>' +
      '<dl class="scenario-meta analysis-summary-grid"></dl>' +
      '<div class="scenario-view-toggles" role="tablist" aria-label="Scenario preview">' +
      '<button type="button" class="scenario-view-toggle is-active" data-view="minimap" role="tab" aria-selected="true">Minimap</button>' +
      '<button type="button" class="scenario-view-toggle" data-view="instructions" role="tab" aria-selected="false" disabled>Instructions</button>' +
      '<button type="button" class="scenario-view-toggle" data-view="hints" role="tab" aria-selected="false" disabled>Hints</button>' +
      '<button type="button" class="scenario-view-toggle" data-view="scout" role="tab" aria-selected="false" disabled>Scout</button>' +
      '</div></div>' +
      '<div class="scenario-minimap-wrap" data-view="minimap">' +
      (viewerIsAdmin
        ? '<button type="button" class="scenario-delete-btn scenario-minimap-delete-btn" data-scenario-id="' +
          scenario.id +
          '" aria-label="Delete scenario"' +
          (scenario.kind === 'campaign_mirror'
            ? ' disabled title="Delete the parent campaign instead"'
            : ' title="Delete scenario (admin)"') +
          '>&times;</button>'
        : '') +
      '<div class="scenario-minimap-stack">' +
      '<div class="scenario-minimap-view">' +
      '<div class="scenario-minimap-inner">' +
      '<img class="analysis-minimap-image hidden" alt="" />' +
      '</div></div>' +
      '<div class="scenario-objectives-panel hidden" id="' +
      objectivesPanelId +
      '" role="region" aria-label="Scenario objectives">' +
      '<section class="scenario-objectives-section" data-objective="instructions">' +
      '<h3 class="scenario-objectives-heading">Instructions</h3>' +
      '<div class="scenario-objectives-body"></div></section>' +
      '<section class="scenario-objectives-section" data-objective="hints">' +
      '<h3 class="scenario-objectives-heading">Hints</h3>' +
      '<div class="scenario-objectives-body"></div></section>' +
      '<section class="scenario-objectives-section" data-objective="scout">' +
      '<h3 class="scenario-objectives-heading">Scout</h3>' +
      '<div class="scenario-objectives-body"></div></section>' +
      '</div></div></div>' +
      '<div class="scenario-detail-actions hidden">' +
      '<button type="button" class="btn btn--pill btn--heart heart-btn" data-heart-id="' +
      scenario.id +
      '" data-heart-kind="scenario" aria-pressed="false" title="Heart">' +
      '<span class="btn-label">\u2764\uFE0F Heart</span>' +
      '<span class="btn-count" data-count="hearts">' +
      hearts.toLocaleString() +
      '</span></button>' +
      '<a class="btn btn--pill btn--download" href="/api/scenarios/download/' +
      scenario.id +
      '">' +
      '<span class="btn-label">\u2B07\uFE0F Download</span>' +
      '<span class="btn-count" data-count="downloads">' +
      dl.toLocaleString() +
      '</span></a>' +
      (scenario.campaign_id
        ? '<a class="btn btn--small btn--ghost" href="/campaigns/?id=' +
          scenario.campaign_id +
          '">View campaign</a>'
        : '') +
      '</div></div></div></div></td></tr>'
    );
  }

  function renderTable(scenarios) {
    const sorted = sortScenarios(scenarios);
    if (sorted.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="' + COL_COUNT + '" class="empty-state">No scenarios found.</td></tr>';
      tablePagination.classList.add('hidden');
      expandedIds.clear();
      return;
    }

    const limit = tableExpanded ? sorted.length : Math.min(PAGE_SIZE, sorted.length);
    const slice = sorted.slice(0, limit);

    for (const id of expandedIds) {
      if (!slice.some((s) => s.id === id)) expandedIds.delete(id);
    }

    let html = '';
    for (const s of slice) {
      const isOpen = expandedIds.has(s.id);
      html +=
        '<tr class="scenario-row' +
        (isOpen ? ' scenario-row--expanded' : '') +
        (s.has_details ? ' scenario-row--has-details' : '') +
        '" data-id="' +
        s.id +
        '" data-kind="' +
        escapeHtml(s.kind || 'standalone') +
        '" role="button" tabindex="0" aria-expanded="' +
        (isOpen ? 'true' : 'false') +
        '" aria-controls="scenario-detail-' +
        s.id +
        '">' +
        '<td class="td-name" title="' +
        escapeHtml(s.filename) +
        '">' +
        escapeHtml(scenarioDisplayName(s)) +
        '</td>' +
        '<td class="td-uploader">' +
        escapeHtml(s.uploader || 'Anonymous') +
        '</td>' +
        '<td class="td-version">' +
        eraIcon(s.game_era) +
        '</td>' +
        '<td class="td-downloads">' +
        (s.downloads || 0).toLocaleString() +
        '</td>' +
        '<td class="td-hearts"><button type="button" class="heart-btn" data-heart-id="' +
        s.id +
        '" data-heart-kind="scenario" title="Heart">♥ ' +
        (s.hearts_count || 0) +
        '</button></td></tr>';
      html += buildDetailPanelHtml(s);
    }

    tbody.innerHTML = html;

    updatePaginationUI(sorted.length, slice.length);

    if (!userCollapsed && expandedIds.size === 0 && slice.length > 0) {
      void expandRow(slice[0].id);
    } else {
      for (const id of expandedIds) {
        void loadDetailsForRow(id);
      }
    }
  }

  async function loadDetailsForRow(id) {
    const panel = document.getElementById('scenario-detail-' + id);
    if (!panel) return;

    const output = panel.querySelector('.scenario-detail-output');
    const actions = panel.querySelector('.scenario-detail-actions');
    const render = window.ScenarioDetailsRender;

    let data = detailsCache.get(id);
    if (!data) {
      setDetailPanelState(panel, 'loading');
      try {
        const res = await fetch('/api/scenarios/' + id + '/details', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load details');
        data = await res.json();
        detailsCache.set(id, data);
      } catch {
        setDetailPanelState(panel, 'error');
        return;
      }
    } else if (data.minimap_url) {
      setDetailPanelState(panel, 'loading');
    }

    const placeholderUrl =
      (render && render.MINIMAP_PLACEHOLDER_URL) || '/assets/img/rainbow.png';
    let minimapUrl = data.minimap_url || null;
    let minimapPreloaded = false;
    const preloadUrl = minimapUrl || placeholderUrl;
    if (render && render.preloadMinimapUrl) {
      try {
        await render.preloadMinimapUrl(preloadUrl);
        minimapPreloaded = true;
      } catch {
        if (minimapUrl) minimapUrl = null;
      }
    }

    setDetailPanelState(panel, 'ready');
    if (actions) actions.classList.remove('hidden');

    if (render && output) {
      render.renderScenarioDetails(output, {
        title: data.title,
        uploadedAt: data.uploaded_at,
        uploader: data.uploader,
        filename: data.filename,
        size: data.size,
        analysis: data.parsed ? data.analysis : null,
        minimapUrl: minimapUrl,
        minimapPreloaded: minimapPreloaded,
        downloads: data.downloads,
        hearts: data.hearts_count,
        viewerHearted: data.viewer_hearted,
      });
    }
  }

  function updateHeartUi(scenarioId, hearted, heartsCount) {
    const s = allScenarios.find((x) => x.id === scenarioId);
    if (s) s.hearts_count = heartsCount;

    const row = tbody.querySelector('tr.scenario-row[data-id="' + scenarioId + '"]');
    if (row) {
      const rowBtn = row.querySelector('.heart-btn');
      if (rowBtn) rowBtn.textContent = '\u2665 ' + heartsCount.toLocaleString();
    }

    const panel = document.getElementById('scenario-detail-' + scenarioId);
    if (panel && window.ScenarioDetailsRender) {
      window.ScenarioDetailsRender.updateActionCounts(panel, {
        hearts: heartsCount,
        viewerHearted: hearted,
      });
    }

    const cached = detailsCache.get(scenarioId);
    if (cached) {
      cached.hearts_count = heartsCount;
      cached.viewer_hearted = hearted;
    }
  }

  function finishDetailCollapse(detailRow, rowId) {
    if (!expandedIds.has(rowId)) {
      detailRow.classList.add('hidden');
    }
  }

  function syncExpandedUi() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    tbody.querySelectorAll('.scenario-row').forEach((row) => {
      const rowId = Number(row.dataset.id);
      const open = expandedIds.has(rowId);
      row.classList.toggle('scenario-row--expanded', open);
      row.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    tbody.querySelectorAll('.scenario-detail-row').forEach((dr) => {
      const rowId = Number(dr.dataset.detailFor);
      const open = expandedIds.has(rowId);
      const shell = dr.querySelector('.scenario-detail-shell');

      if (open) {
        dr.classList.remove('hidden');
        if (reduceMotion) {
          dr.classList.add('is-open');
          return;
        }
        dr.classList.remove('is-open');
        void dr.offsetHeight;
        requestAnimationFrame(() => {
          dr.classList.add('is-open');
        });
        return;
      }

      if (!dr.classList.contains('is-open')) {
        dr.classList.add('hidden');
        return;
      }

      dr.classList.remove('is-open');
      if (reduceMotion || !shell) {
        finishDetailCollapse(dr, rowId);
        return;
      }

      let done = false;
      const onEnd = (e) => {
        if (e.target !== shell) return;
        if (e.propertyName !== 'grid-template-rows') return;
        if (done) return;
        done = true;
        shell.removeEventListener('transitionend', onEnd);
        finishDetailCollapse(dr, rowId);
      };
      shell.addEventListener('transitionend', onEnd);
      window.setTimeout(() => {
        if (done) return;
        done = true;
        shell.removeEventListener('transitionend', onEnd);
        finishDetailCollapse(dr, rowId);
      }, 480);
    });
  }

  async function expandRow(id) {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
      if (expandedIds.size === 0) userCollapsed = true;
      syncExpandedUi();
      return;
    }

    expandedIds.add(id);
    userCollapsed = false;
    syncExpandedUi();
    await loadDetailsForRow(id);
  }

  function updateSortIndicators() {
    thead.querySelectorAll('th.sortable').forEach((th) => {
      th.classList.remove('asc', 'desc', 'active');
      if (th.dataset.sort === sortKey) {
        th.classList.add(sortDir, 'active');
      }
    });
  }

  function removeScenarioFromList(scenarioId) {
    allScenarios = allScenarios.filter((s) => s.id !== scenarioId);
    expandedIds.delete(scenarioId);
    detailsCache.delete(scenarioId);
    refresh();
  }

  async function deleteScenario(scenarioId) {
    const scenario = allScenarios.find((s) => s.id === scenarioId);
    if (!scenario) return;
    if (scenario.kind === 'campaign_mirror') {
      alert('Delete the parent campaign instead.');
      return;
    }
    const label = scenarioDisplayName(scenario);
    if (
      !confirm(
        'Permanently delete "' +
          label +
          '" from the museum?\n\nThis removes the file from the site and adds a tombstone so sync will not restore it.',
      )
    ) {
      return;
    }

    const res = await fetch('/api/scenarios/' + scenarioId, {
      method: 'DELETE',
      credentials: 'include',
    });
    const payload = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      alert(payload.error || 'Delete failed (' + res.status + ').');
      return;
    }
    removeScenarioFromList(scenarioId);
  }

  function refresh() {
    const q = filterInput.value.toLowerCase();
    const filtered = allScenarios.filter((s) => {
      const name = scenarioDisplayName(s).toLowerCase();
      return (
        name.includes(q) ||
        s.filename.toLowerCase().includes(q) ||
        String(s.uploader || '').toLowerCase().includes(q)
      );
    });
    renderTable(filtered);
    updateStats(filtered, q.length > 0);
  }

  thead.addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = key === 'display_name' || key === 'game_era' || key === 'uploader' ? 'asc' : 'desc';
    }
    updateSortIndicators();
    refresh();
  });

  tbody.addEventListener('click', async (e) => {
    const viewToggle = e.target.closest('.scenario-view-toggle');
    if (viewToggle && !viewToggle.disabled) {
      e.preventDefault();
      e.stopPropagation();
      const detail = viewToggle.closest('.scenario-detail');
      const view = viewToggle.dataset.view;
      if (detail && view && window.ScenarioDetailsRender?.setBrowseDetailView) {
        window.ScenarioDetailsRender.setBrowseDetailView(detail, view);
      }
      return;
    }

    const deleteBtn = e.target.closest('.scenario-delete-btn');
    if (deleteBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (deleteBtn.disabled) return;
      const scenarioId = Number(deleteBtn.dataset.scenarioId);
      if (!Number.isFinite(scenarioId)) return;
      void deleteScenario(scenarioId);
      return;
    }

    const heartBtn = e.target.closest('.heart-btn');
    if (heartBtn) {
      e.stopPropagation();
      if (!window.MuseumAuth?.isVerified?.()) {
        alert('Sign in with a verified email to heart content.');
        return;
      }
      const scenarioId = Number(heartBtn.dataset.heartId);
      const res = await fetch('/api/hearts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: heartBtn.dataset.heartKind,
          id: scenarioId,
        }),
      });
      if (res.ok) {
        const payload = await res.json();
        const s = allScenarios.find((x) => x.id === scenarioId);
        const prev = s?.hearts_count ?? 0;
        const next = payload.hearted ? prev + 1 : Math.max(0, prev - 1);
        updateHeartUi(scenarioId, Boolean(payload.hearted), next);
      }
      return;
    }

    if (e.target.closest('.scenario-detail-cell')) return;

    const row = e.target.closest('tr.scenario-row');
    if (row) {
      e.preventDefault();
      await expandRow(Number(row.dataset.id));
    }
  });

  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr.scenario-row');
    if (!row) return;
    e.preventDefault();
    void expandRow(Number(row.dataset.id));
  });

  filterInput.addEventListener('input', () => {
    tableExpanded = false;
    refresh();
  });

  tablePaginationBtn.addEventListener('click', () => {
    tableExpanded = !tableExpanded;
    refresh();
  });

  async function boot() {
    const mePromise = window.MuseumAuth?.fetchMe?.() ?? Promise.resolve(null);
    try {
      const [me, listRes] = await Promise.all([
        mePromise,
        fetch('/api/scenarios'),
      ]);
      viewerIsAdmin = Boolean(me?.isAdmin);
      if (!listRes.ok) throw new Error('list failed');
      allScenarios = await listRes.json();
      tableExpanded = false;
      userCollapsed = false;
      expandedIds.clear();
      refresh();
    } catch {
      tbody.innerHTML =
        '<tr><td colspan="' + COL_COUNT + '" class="empty-state">Failed to load scenarios.</td></tr>';
      tablePagination.classList.add('hidden');
    }
  }

  void boot();
})();
