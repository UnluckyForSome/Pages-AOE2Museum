(() => {
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = ['scn', 'scx', 'aoe2scenario'];
  const PREVIEW_SETTINGS = {};
  const pyodideService = window.Aoe2MuseumPyodideService;

  const dropZone = document.getElementById('analyse-drop-zone');
  const fileInput = document.getElementById('analyse-file-input');
  const selectedEl = document.getElementById('analysis-selected');
  const statusEl = document.getElementById('analysis-status');
  const progressFill = document.getElementById('analysis-progress-fill');
  const progressText = document.getElementById('analysis-progress-text');
  const errorEl = document.getElementById('analysis-error');
  const outputEl = document.getElementById('analysis-output');
  const summaryGrid = document.getElementById('analysis-summary-grid');
  const playersList = document.getElementById('analysis-players-list');
  const minimapImg = document.getElementById('analysis-minimap-image');

  if (!dropZone || !fileInput || !selectedEl || !statusEl || !progressFill || !progressText || !errorEl || !outputEl || !summaryGrid || !playersList || !minimapImg) {
    return;
  }

  let workerWarmed = false;
  let nextRequestId = 1;
  let activeRequestId = 0;
  let busy = false;
  let currentPreviewUrl = null;
  let selectedFile = null;

  function getExtension(name) {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str == null ? '' : String(str);
    return el.innerHTML;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
  }

  function formatDataVersion(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
    return value.toFixed(2).replace(/\.?0+$/, '');
  }

  function validateFile(file) {
    if (!file) return 'Choose a scenario file first.';
    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return 'Only .scn, .scx and .aoe2scenario files are supported here.';
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'Scenario exceeds the 5 MB analysis limit.';
    }
    return '';
  }

  function warmWorker() {
    if (workerWarmed || !pyodideService) return;
    workerWarmed = true;
    pyodideService.warmup({ onProgress: handleProgress }).catch((err) => {
      showError(err && err.message ? err.message : String(err));
    });
  }

  function setProgress(message, pct) {
    statusEl.classList.remove('hidden');
    progressText.textContent = message;
    progressFill.style.width = (typeof pct === 'number' ? pct : 0) + '%';
  }

  function handleProgress(msg) {
    setProgress(msg && msg.message ? msg.message : 'Working...', msg && typeof msg.pct === 'number' ? msg.pct : 0);
  }

  function clearError() {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }

  function showError(message) {
    busy = false;
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    outputEl.classList.add('hidden');
  }

  function revokePreviewUrl() {
    if (currentPreviewUrl) {
      URL.revokeObjectURL(currentPreviewUrl);
      currentPreviewUrl = null;
    }
  }

  function renderSummary(file, analysis) {
    const rows = [
      ['File', file.name],
      ['File size', formatBytes(file.size)],
      ['Detected edition', analysis.isDefinitiveEdition ? 'Definitive Edition' : 'Legacy'],
      ['Container format', analysis.containerFormat || 'Unavailable'],
      ['Data version', formatDataVersion(analysis.dataVersion)],
      ['Detection reason', analysis.detectionReason || 'Unavailable'],
      ['Parse backend', analysis.parseBackend || 'Unavailable'],
      ['Map size', formatNumber(analysis.mapDimension) + ' x ' + formatNumber(analysis.mapDimension)],
      ['Terrain tiles', formatNumber(analysis.tileCount)],
      ['Occupied player slots', formatNumber(analysis.activePlayerCount) + ' / ' + formatNumber(analysis.playerSlots)],
      ['Player objects', formatNumber(analysis.playerObjectCount)],
      ['Gaia objects', formatNumber(analysis.gaiaObjectCount)],
    ];

    summaryGrid.innerHTML = rows
      .map(([label, value]) => '<dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd>')
      .join('');

    const players = Array.isArray(analysis.players) ? analysis.players : [];
    playersList.innerHTML = players
      .map((player) => {
        const startText = player.startPosition
          ? player.startPosition.x + ', ' + player.startPosition.y
          : 'Unavailable';
        return (
          '<div class="analysis-player">' +
            '<div><strong>Slot</strong><span>' + escapeHtml(player.slot) + '</span></div>' +
            '<div><strong>Name</strong><span>' + escapeHtml(player.name || 'Unknown') + '</span></div>' +
            '<div><strong>Objects</strong><span>' + escapeHtml(formatNumber(player.objectCount)) + '</span></div>' +
            '<div><strong>Start</strong><span>' + escapeHtml(startText) + '</span></div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderPreview(pngBuffer) {
    revokePreviewUrl();
    const blob = new Blob([pngBuffer], { type: 'image/png' });
    currentPreviewUrl = URL.createObjectURL(blob);
    minimapImg.src = currentPreviewUrl;
    minimapImg.classList.remove('hidden');
  }

  function showSelectedFile(file) {
    selectedEl.innerHTML = 'Selected file: <strong>' + escapeHtml(file.name) + '</strong> (' + escapeHtml(formatBytes(file.size)) + ')';
    selectedEl.classList.remove('hidden');
  }

  async function startAnalysis(file) {
    const validationError = validateFile(file);
    if (validationError) {
      showError(validationError);
      return;
    }
    if (busy) {
      showError('An analysis is already running. Please wait for it to finish.');
      return;
    }

    busy = true;
    selectedFile = file;
    activeRequestId = nextRequestId++;
    clearError();
    outputEl.classList.add('hidden');
    summaryGrid.innerHTML = '';
    playersList.innerHTML = '';
    revokePreviewUrl();
    minimapImg.removeAttribute('src');
    minimapImg.classList.add('hidden');
    showSelectedFile(file);
    setProgress('Preparing analysis runtime...', 4);
    if (!pyodideService) {
      showError('Shared Pyodide service is unavailable.');
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const requestId = activeRequestId;
      const result = await pyodideService.analyse(
        buffer,
        '.' + getExtension(file.name),
        PREVIEW_SETTINGS,
        file.name,
        { onProgress: handleProgress },
      );
      if (requestId !== activeRequestId) return;
      busy = false;
      setProgress('Analysis complete.', 100);
      renderSummary(selectedFile, result.analysis || {});
      renderPreview(result.png);
      outputEl.classList.remove('hidden');
    } catch (err) {
      if (activeRequestId) {
        showError(err && err.message ? err.message : String(err));
      }
    } finally {
      fileInput.value = '';
    }
  }

  function pickFirstFile(files) {
    if (!files || files.length === 0) return;
    startAnalysis(files[0]);
  }

  document.addEventListener('scenarios:tabchange', (e) => {
    if (e.detail && e.detail.tab === 'analyse') {
      warmWorker();
    }
  });

  fileInput.addEventListener('change', () => {
    pickFirstFile(fileInput.files);
  });

  dropZone.addEventListener('click', (e) => {
    if (e.target.closest('label')) return;
    fileInput.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    pickFirstFile(e.dataTransfer.files);
  });

  window.addEventListener('beforeunload', () => {
    revokePreviewUrl();
  });
})();
