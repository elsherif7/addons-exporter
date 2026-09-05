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

// Builds one <div class="addon-row"> via DOM APIs (not innerHTML) so
// a.name/a.version never pass through HTML parsing - textContent and
// property assignment don't need escapeHtml the way a template string did.
function createAddonRow(a, i) {
  const row = document.createElement('div');
  row.className = 'addon-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `cb-${i}`;
  checkbox.dataset.id = a.id;
  checkbox.checked = true;

  const versionSpan = document.createElement('span');
  versionSpan.className = 'addon-version';
  versionSpan.textContent = a.version;

  const label = document.createElement('label');
  label.htmlFor = `cb-${i}`;
  label.append(`${a.name} `, versionSpan);

  row.append(checkbox, label);
  return row;
}

function appendGroup(fragment, title, items, nextIndex) {
  if (items.length === 0) return;
  const heading = document.createElement('div');
  heading.className = 'group-heading';
  heading.textContent = `${title} (${items.length})`;
  fragment.appendChild(heading);
  items.forEach((a) => {
    fragment.appendChild(createAddonRow(a, nextIndex()));
  });
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
  const nextIndex = () => idx++;

  const fragment = document.createDocumentFragment();
  appendGroup(fragment, 'Enabled', enabled, nextIndex);
  appendGroup(fragment, 'Disabled', disabled, nextIndex);
  listEl.replaceChildren(fragment);
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
    const p = document.createElement('p');
    p.className = 'placeholder-text error';
    p.textContent = `Could not load add-ons: ${e.message}`;
    listEl.replaceChildren(p);
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

// Makes the whole row clickable, not just the checkbox/label text.
// Clicking the checkbox itself is left alone - its own native click
// already toggles it. Anything else in the row calls cb.click(), which
// fires the checkbox's own native toggle and change event. The
// preventDefault stops a label click's own default forwarding to the
// checkbox, so that path doesn't also fire and double the toggle.
listEl.addEventListener('click', (e) => {
  if (e.target.matches('input[type="checkbox"]')) return;
  const row = e.target.closest('.addon-row');
  if (!row) return;
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb || cb.disabled) return;
  e.preventDefault();
  cb.click();
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
