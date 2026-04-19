(() => {
  const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100 MB
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB per scenario file
  const MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100 MB per zip
  const MAX_SCENARIO_FILES = 900;
  const ALLOWED_EXTENSIONS = ['scn', 'scx', 'aoe2scenario', 'zip'];

  function getExtension(name) {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }

  function validateFile(file) {
    const ext = getExtension(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) return 'Invalid file type';
    if (ext === 'zip' && file.size > MAX_ZIP_SIZE) return 'Zip exceeds 100 MB';
    if (ext !== 'zip' && file.size > MAX_FILE_SIZE) return 'Exceeds 5 MB limit';
    return '';
  }

  const intro = document.getElementById('upload-intro');
  const startBtn = document.getElementById('start-upload-btn');
  const panel = document.getElementById('upload-panel');
  const form = document.getElementById('upload-form');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fileListEl = document.getElementById('file-list');
  const fileListItems = document.getElementById('file-list-items');
  const submitBtn = document.getElementById('submit-btn');
  const turnstileContainer = document.getElementById('turnstile-container');
  const progressWrapper = document.getElementById('progress-wrapper');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  const resultEl = document.getElementById('upload-result');
  const resultSummary = document.getElementById('result-summary');
  const rejectedSection = document.getElementById('rejected-section');
  const rejectedList = document.getElementById('rejected-list');
  const resultCta = document.getElementById('result-cta');
  const uploadAnotherBtn = document.getElementById('upload-another-btn');

  let turnstileLoaded = false;
  let selectedFiles = [];

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getTotalSize() {
    return selectedFiles.reduce((sum, f) => sum + f.size, 0);
  }

  function loadTurnstile() {
    if (turnstileLoaded) return;
    turnstileLoaded = true;

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
    script.async = true;
    document.head.appendChild(script);

    window.onTurnstileLoad = () => {
      turnstile.render(turnstileContainer, {
        sitekey: '0x4AAAAAACsqOhUOmHnJaPFc',
        theme: 'dark',
      });
    };
  }

  function setFiles(files) {
    selectedFiles = Array.from(files);
    renderFileList();
  }

  function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
  }

  function renderFileList() {
    if (selectedFiles.length === 0) {
      fileListEl.classList.add('hidden');
      submitBtn.disabled = false;
      return;
    }
    fileListEl.classList.remove('hidden');

    const total = getTotalSize();
    const overLimit = total > MAX_TOTAL_SIZE;
    const scenarioCount = selectedFiles.filter((f) => getExtension(f.name) !== 'zip').length;
    const tooManyFiles = scenarioCount > MAX_SCENARIO_FILES;
    const warnings = selectedFiles.map((f) => validateFile(f));
    const hasErrors = overLimit || tooManyFiles || warnings.some((w) => w);

    let titleText = selectedFiles.length + ' file(s) selected \u00B7 ' + formatSize(total) + ' total';
    if (tooManyFiles) titleText += ' \u2014 max ' + MAX_SCENARIO_FILES + ' scenario files per upload!';
    else if (overLimit) titleText += ' \u2014 exceeds 100 MB limit!';

    fileListItems.innerHTML =
      '<li class="file-list-header' + ((overLimit || tooManyFiles) ? ' over-limit' : '') + '">' + titleText + '</li>' +
      selectedFiles
        .map((f, i) => {
          const warn = warnings[i];
          const isZip = getExtension(f.name) === 'zip';
          return '<li' + (warn ? ' class="file-item-error"' : '') + '>' +
            '<span class="file-item-name">' + escapeHtml(f.name) +
              (warn ? ' <span class="file-item-warn">\u2014 ' + escapeHtml(warn) + '</span>' : '') +
            '</span>' +
            (isZip && !warn ? '<span class="file-item-zip-note">' + MAX_SCENARIO_FILES + ' files max!</span>' : '') +
            '<span class="file-item-size">' + formatSize(f.size) + '</span>' +
            '<button type="button" class="file-remove-btn" data-idx="' + i + '">&times;</button>' +
          '</li>';
        })
        .join('');

    submitBtn.disabled = hasErrors;
  }

  function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  function setProgress(pct) {
    progressFill.style.width = pct + '%';
    progressText.textContent = pct + '%';
  }

  function showResult(data) {
    form.classList.add('hidden');
    progressWrapper.classList.add('hidden');

    const accepted = (data.results || []).filter((r) => r.status === 'uploaded');
    const rejected = (data.results || []).filter((r) => r.status !== 'uploaded');

    let summary = '';
    if (accepted.length > 0) summary += accepted.length + ' file(s) accepted';
    if (accepted.length > 0 && rejected.length > 0) summary += ', ';
    if (rejected.length > 0) summary += rejected.length + ' file(s) rejected';
    resultSummary.textContent = summary;

    if (rejected.length > 0) {
      rejectedSection.classList.remove('hidden');
      rejectedList.innerHTML = rejected
        .map((r) => {
          const reason = r.status.replace('rejected: ', '');
          return '<li><strong>' + escapeHtml(r.filename) + '</strong> &mdash; ' + escapeHtml(reason) + '</li>';
        })
        .join('');
    } else {
      rejectedSection.classList.add('hidden');
    }

    if (accepted.length > 0) {
      resultCta.innerHTML = 'Go check them out in the <a href="/scenarios/">Archive</a>!';
    } else if (data.error) {
      resultCta.textContent = data.error;
    } else {
      resultCta.textContent = '';
    }

    resultEl.classList.remove('hidden');
  }

  function resetForm() {
    resultEl.classList.add('hidden');
    form.classList.remove('hidden');
    progressWrapper.classList.add('hidden');
    setProgress(0);
    selectedFiles = [];
    fileInput.value = '';
    renderFileList();
    if (typeof turnstile !== 'undefined') {
      turnstile.reset();
    }
  }

  startBtn.addEventListener('click', () => {
    intro.classList.add('hidden');
    panel.classList.remove('hidden');
    loadTurnstile();
  });

  fileInput.addEventListener('change', () => {
    setFiles(fileInput.files);
  });

  fileListItems.addEventListener('click', (e) => {
    const btn = e.target.closest('.file-remove-btn');
    if (btn) {
      removeFile(parseInt(btn.dataset.idx, 10));
    }
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
    if (e.dataTransfer.files.length) {
      setFiles(e.dataTransfer.files);
    }
  });

  uploadAnotherBtn.addEventListener('click', resetForm);

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (selectedFiles.length === 0) {
      showResult({ error: 'Please select at least one file.' });
      return;
    }

    if (getTotalSize() > MAX_TOTAL_SIZE) {
      showResult({ error: 'Combined file size exceeds 100 MB. Please remove some files and try again.' });
      return;
    }

    const turnstileInput = form.querySelector('[name="cf-turnstile-response"]');
    if (!turnstileInput || !turnstileInput.value) {
      showResult({ error: 'Please complete the verification challenge.' });
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';
    progressWrapper.classList.remove('hidden');
    setProgress(0);

    const formData = new FormData();
    for (const f of selectedFiles) {
      formData.append('file', f);
    }
    formData.append('cf-turnstile-response', turnstileInput.value);

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        setProgress(pct);
        if (pct >= 100) {
          progressText.textContent = 'Processing files on server...';
        }
      }
    });

    xhr.addEventListener('load', () => {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload';

      if (xhr.status === 413) {
        showResult({ error: 'Upload too large. Please keep combined upload size under 100 MB.' });
        return;
      }

      try {
        const data = JSON.parse(xhr.responseText);
        showResult(data);
      } catch {
        let msg = 'Server error (HTTP ' + xhr.status + ').';
        if (xhr.status === 524) {
          msg = 'Server timed out processing your files. Try uploading fewer files at once.';
        } else if (xhr.status >= 500) {
          msg = 'Server error. Try uploading fewer files at once.';
        }
        showResult({ error: msg });
      }
    });

    xhr.addEventListener('error', () => {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload';
      showResult({ error: 'Network error. Please try again.' });
    });

    xhr.addEventListener('timeout', () => {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload';
      showResult({ error: 'Upload timed out. Please try again.' });
    });

    xhr.open('POST', '/api/scenarios/upload');
    xhr.timeout = 300000; // 5 minutes
    xhr.send(formData);
  });
})();
