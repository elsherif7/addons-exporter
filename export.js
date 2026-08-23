const listEl = document.getElementById('addonList');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const exportBtn = document.getElementById('exportSelectedBtn');
const statusEl = document.getElementById('status');
const selectionCountEl = document.getElementById('selectionCount');

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

  // A single counter across both groups keeps every checkbox/label id
  // attribute unique, even though enabled and disabled are rendered as
  // two separate mapped lists.
  let idx = 0;
  const rowHtml = (a) => {
    const i = idx++;
    const typeTag = a.type === 'theme' ? '<span class="addon-tag">Theme</span>' : '';
    return `<div class="addon-row">
      <input type="checkbox" id="cb-${i}" data-id="${escapeHtml(a.id)}" checked>
      <label for="cb-${i}">${escapeHtml(a.name)} <span class="addon-version">${escapeHtml(a.version)}</span>${typeTag}</label>
    </div>`;
  };

  const groupHtml = (title, items) => items.length
    ? `<div class="group-heading">${title} (${items.length})</div>${items.map(rowHtml).join('')}`
    : '';

  listEl.innerHTML = groupHtml('Enabled', enabled) + groupHtml('Disabled', disabled);

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
  checkboxes().forEach((cb) => { cb.checked = true; });
  updateSelectionCount();
});

deselectAllBtn.addEventListener('click', () => {
  checkboxes().forEach((cb) => { cb.checked = false; });
  updateSelectionCount();
});

exportBtn.addEventListener('click', async () => {
  const ids = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.dataset.id);

  exportBtn.disabled = true;
  setStatus('Exporting your add-ons, please wait...');
  try {
    await browser.runtime.sendMessage({ type: 'export', ids });
    // background.js opens the confirmation tab itself once the download
    // starts, so this tab just reports success and stays open for review.
    setStatus('Export complete - check your downloads.');
  } catch (e) {
    setStatus('Error: ' + e.message);
    exportBtn.disabled = false;
  }
});
