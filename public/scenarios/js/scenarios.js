(() => {
  const tbody = document.getElementById('scenario-body');
  const filterInput = document.getElementById('filter');
  const statsText = document.getElementById('stats-text');
  const syncLink = document.getElementById('sync-link');
  const syncPrompt = document.getElementById('sync-prompt');
  const syncSecretInput = document.getElementById('sync-secret');
  const syncBtn = document.getElementById('sync-btn');
  const syncStatus = document.getElementById('sync-status');
  const thead = document.querySelector('.scenario-table thead');
  const tablePagination = document.getElementById('table-pagination');
  const tablePaginationText = document.getElementById('table-pagination-text');
  const tablePaginationBtn = document.getElementById('table-pagination-btn');

  const PAGE_SIZE = 50;
  let allScenarios = [];
  let sortKey = 'uploaded_at';
  let sortDir = 'desc';
  let tableExpanded = false;

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function formatDate(iso) {
    const d = new Date(iso + 'Z');
    const day = d.getUTCDate();
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    const yr = String(d.getUTCFullYear()).slice(-2);
    return day + ' ' + mon + ' ' + yr;
  }

  function updateStats(scenarios, isFiltered) {
    const totalSize = scenarios.reduce((sum, s) => sum + s.size, 0);
    const totalDl = scenarios.reduce((sum, s) => sum + (s.downloads || 0), 0);
    statsText.textContent =
      scenarios.length + ' scenario' + (scenarios.length !== 1 ? 's' : '') +
      ' \u00B7 ' + formatSize(totalSize) + ' total' +
      ' \u00B7 ' + totalDl.toLocaleString() + ' download' + (totalDl !== 1 ? 's' : '') +
      (isFiltered ? ' (filtered)' : '');
  }

  function sortScenarios(scenarios) {
    const sorted = [...scenarios];
    sorted.sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
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
    if (tableExpanded) {
      tablePaginationBtn.textContent = 'Show less';
    } else {
      tablePaginationBtn.textContent = 'Show all';
    }
  }

  function renderTable(scenarios) {
    const sorted = sortScenarios(scenarios);
    if (sorted.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="empty-state">No scenarios found.</td></tr>';
      tablePagination.classList.add('hidden');
      return;
    }

    const limit = tableExpanded ? sorted.length : Math.min(PAGE_SIZE, sorted.length);
    const slice = sorted.slice(0, limit);

    tbody.innerHTML = slice
      .map(
        (s) => `
      <tr data-id="${s.id}">
        <td class="td-filename" title="${escapeHtml(s.filename)}">${escapeHtml(s.filename)}</td>
        <td class="td-type">${typeIcons(s.filetype)}</td>
        <td>${formatSize(s.size)}</td>
        <td>${formatDate(s.uploaded_at)}</td>
        <td>${(s.downloads || 0).toLocaleString()}</td>
      </tr>`
      )
      .join('');

    updatePaginationUI(sorted.length, slice.length);
  }

  function typeIcons(filetype) {
    const icon = (src, alt) =>
      '<img class="type-icon" src="/scenarios/img/' + src + '" alt="' + alt + '" width="19" height="19">';
    switch (filetype) {
      case 'scx': return icon('aoc.png', 'AoC');
      case 'scn': return icon('aok.png', 'AoK');
      case 'aoe2scenario': return icon('hd.png', 'HD') + icon('de.png', 'DE');
      default: return '';
    }
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function updateSortIndicators() {
    thead.querySelectorAll('th.sortable').forEach((th) => {
      th.classList.remove('asc', 'desc', 'active');
      if (th.dataset.sort === sortKey) {
        th.classList.add(sortDir, 'active');
      }
    });
  }

  function refresh() {
    const q = filterInput.value.toLowerCase();
    const filtered = allScenarios.filter(
      (s) =>
        s.filename.toLowerCase().includes(q) ||
        s.filetype.toLowerCase().includes(q)
    );
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
      sortDir = (key === 'filename' || key === 'filetype') ? 'asc' : 'desc';
    }
    updateSortIndicators();
    refresh();
  });

  tbody.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row) {
      window.location.href = '/api/scenarios/download/' + row.dataset.id;
    }
  });

  filterInput.addEventListener('input', () => {
    tableExpanded = false;
    refresh();
  });

  tablePaginationBtn.addEventListener('click', () => {
    tableExpanded = !tableExpanded;
    refresh();
  });

  syncLink.addEventListener('click', (e) => {
    e.preventDefault();
    syncPrompt.classList.toggle('hidden');
    syncStatus.textContent = '';
  });

  syncBtn.addEventListener('click', async () => {
    const secret = syncSecretInput.value.trim();
    if (!secret) return;

    syncBtn.disabled = true;
    syncStatus.textContent = 'Syncing...';
    syncStatus.className = 'sync-status';

    try {
      const res = await fetch('/api/scenarios/sync', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + secret },
      });
      const data = await res.json();
      if (res.ok) {
        syncStatus.textContent = 'Done!';
        syncStatus.className = 'sync-status sync-ok';
        syncSecretInput.value = '';
        const r = await fetch('/api/scenarios');
        allScenarios = await r.json();
        tableExpanded = false;
        refresh();
      } else {
        syncStatus.textContent = data.error || 'Failed';
        syncStatus.className = 'sync-status sync-err';
      }
    } catch {
      syncStatus.textContent = 'Network error';
      syncStatus.className = 'sync-status sync-err';
    } finally {
      syncBtn.disabled = false;
    }
  });

  fetch('/api/scenarios')
    .then((r) => r.json())
    .then((data) => {
      allScenarios = data;
      tableExpanded = false;
      refresh();
    })
    .catch(() => {
      tbody.innerHTML =
        '<tr><td colspan="5" class="empty-state">Failed to load scenarios.</td></tr>';
      tablePagination.classList.add('hidden');
    });
})();
