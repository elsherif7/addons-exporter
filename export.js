const listEl = document.getElementById('addonList');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const exportBtn = document.getElementById('exportSelectedBtn');
const statusEl = document.getElementById('status');
const selectionCountEl = document.getElementById('selectionCount');
const searchInput = document.getElementById('searchInput');
const noSearchMatchesEl = document.getElementById('noSearchMatches');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function checkboxes() {
  return listEl.querySelectorAll('input[type="checkbox"]');
}

function updateSelectionCount() {
  const boxes = checkboxes();
  const checked = listEl.querySelectorAll('input[type="checkbox"]:checked').length;
  selectionCountEl.textContent = boxes.length
    ? `${checked} of ${boxes.length} selected`
    : '';
  exportBtn.disabled = checked === 0;
}

function renderList(addons) {
  if (addons.length === 0) {
    listEl.innerHTML = '<p class="placeholder-text">No add-ons found to export.</p>';
    updateSelectionCount();
    return;
  }

  const enabled = addons.filter(a => a.enabled).sort(byName);
  const disabled = addons.filter(a => !a.enabled).sort(byName);

  // Single counter across both groups so every checkbox id stays unique.
  let idx = 0;
  const rowHtml = (a) => {
    const i = idx++;
    return `<div class="addon-row">
      <input type="checkbox" id="cb-${i}" data-id="${escapeHtml(a.id)}" checked>
      <label for="cb-${i}">${escapeHtml(a.name)} <span class="addon-version">${escapeHtml(a.version)}</span></label>
    </div>`;
  };

  const groupHtml = (title, items) => items.length
    ? `<div class="group-heading">${title} (${items.length})</div>${items.map(rowHtml).join('')}`
    : '';

  listEl.innerHTML = groupHtml('Enabled', enabled) + groupHtml('Disabled', disabled);
  searchInput.style.display = 'block';

  checkboxes().forEach((cb) => {
    cb.addEventListener('change', updateSelectionCount);
  });

  updateSelectionCount();
}

(async () => {
  try {
    const addons = await browser.runtime.sendMessage({ type: 'listAddons' });
    renderList(addons);
  } catch (e) {
    listEl.innerHTML = `<p class="placeholder-text error">Could not load add-ons: ${escapeHtml(e.message)}</p>`;
  }
})();

selectAllBtn.addEventListener('click', () => {
  visibleCheckboxes(checkboxes()).forEach((cb) => { cb.checked = true; });
  updateSelectionCount();
});

deselectAllBtn.addEventListener('click', () => {
  visibleCheckboxes(checkboxes()).forEach((cb) => { cb.checked = false; });
  updateSelectionCount();
});

searchInput.addEventListener('input', () => {
  const anyMatch = filterAddonRows(listEl, searchInput.value);
  noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
});

// Only the checkbox itself toggles it - clicking the name shouldn't.
listEl.addEventListener('click', (e) => {
  if (e.target.closest('label')) e.preventDefault();
});

exportBtn.addEventListener('click', async () => {
  const ids = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.dataset.id);

  exportBtn.disabled = true;
  setStatus('Exporting your add-ons, please wait...');
  try {
    await browser.runtime.sendMessage({ type: 'export', ids });
    // background.js opens the confirmation tab itself - this one just
    // reports success and stays open.
    setStatus('Export complete. Your report has been saved to the folder you picked.');
  } catch (e) {
    setStatus('Error: ' + e.message);
    exportBtn.disabled = false;
  }
});

// background.js broadcasts progress as each link is resolved.
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'exportProgress') {
    setStatus(`Resolved ${message.done} of ${message.total} add-ons...`);
  }
});
