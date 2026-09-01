// Must equal EXPORT_FORMAT_VERSION as long as import.js handles the same
// shape. Only diverge this when EXPORT_FORMAT_VERSION bumps and the import
// side has been updated to handle the new shape via migrateAddonsData().
const SUPPORTED_FORMAT_VERSION = EXPORT_FORMAT_VERSION;

// Upgrades an old formatVersion's addon list to the current shape. A
// no-op today since there's only ever been one version - this is the
// seam to use next time EXPORT_FORMAT_VERSION bumps and old files should
// stay importable instead of getting rejected.
function migrateAddonsData(addons, formatVersion) {
  return addons;
}

// Stagger between opening tabs so dozens of add-ons don't all burst open
// at once.
const TAB_OPEN_DELAY_MS = 150;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildInstalledIndex(installed) {
  const byId = new Map();
  const byName = new Map();
  for (const a of installed) {
    byId.set(a.id, a);
    byName.set(a.name.toLowerCase(), a);
  }
  return { byId, byName };
}

// Prefers id, falls back to a case-insensitive name match for older
// export files that predate the id field.
function findInstalledMatch(item, index) {
  if (item.id && index.byId.has(item.id)) {
    return index.byId.get(item.id);
  }
  return index.byName.get(item.name.toLowerCase()) || null;
}

const statusEl = document.getElementById('status');
const fileNameEl = document.getElementById('fileName');
const fileNameRow = document.getElementById('fileNameRow');
const fileInput = document.getElementById('fileInput');
const picker = document.getElementById('picker');
const removeFileBtn = document.getElementById('removeFileBtn');
const chooseFileBtn = document.getElementById('chooseFileBtn');
const listControls = document.getElementById('listControls');
const addonListEl = document.getElementById('addonList');
const checklistBoxEl = document.getElementById('checklistBox');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const selectionCountEl = document.getElementById('selectionCount');
const openSelectedBtn = document.getElementById('openSelectedBtn');
const compareNoteEl = document.getElementById('compareNote');
const searchInput = document.getElementById('searchInput');
const noSearchMatchesEl = document.getElementById('noSearchMatches');

// Rendered order (Not Installed Yet, then Already Installed) - each
// checkbox's data-idx indexes into this array to find the right item.
let displayItems = [];

function setStatus(msg) {
  statusEl.textContent = msg;
}

function checkboxes() {
  return addonListEl.querySelectorAll('input[type="checkbox"]');
}

function updateSelectionCount() {
  const boxes = checkboxes();
  const checked = addonListEl.querySelectorAll('input[type="checkbox"]:checked').length;
  selectionCountEl.textContent = boxes.length ? `${checked} of ${boxes.length} selected` : '';
  openSelectedBtn.disabled = checked === 0;
}

function clearAddonList() {
  displayItems = [];
  addonListEl.innerHTML = '';
  checklistBoxEl.style.display = 'none';
  listControls.style.display = 'none';
  openSelectedBtn.disabled = true;
  selectionCountEl.textContent = '';
  compareNoteEl.textContent = '';
  searchInput.style.display = 'none';
  searchInput.value = '';
  noSearchMatchesEl.style.display = 'none';
}

function renderAddonList(addons, installed) {
  const index = buildInstalledIndex(installed);
  const notInstalled = [];
  const alreadyInstalled = [];

  for (const a of addons) {
    const match = findInstalledMatch(a, index);
    if (match) {
      alreadyInstalled.push(a);
    } else {
      notInstalled.push(a);
    }
  }
  notInstalled.sort(byName);
  alreadyInstalled.sort(byName);
  displayItems = [...notInstalled, ...alreadyInstalled];

  const rowHtml = (a, i, isInstalled) => {
    const safe = isSafeUrl(a.link);
    const warning = safe ? '' : '<br><span class="addon-link-preview unsafe">invalid or unsafe link - skipped</span>';
    const checkedAttr = safe && !isInstalled ? 'checked' : '';
    const disabledAttr = safe ? '' : 'disabled';
    const version = typeof a.version === 'string' ? a.version : '';
    const matchLabel = LINK_TYPE_LABELS[a.linkType] || '';
    const matchClass = UNCERTAIN_LINK_TYPES.has(a.linkType) ? ' match-uncertain' : '';
    const match = matchLabel ? ` <span class="match-label${matchClass}">${escapeHtml(matchLabel)}</span>` : '';
    return `<div class="addon-row">
      <input type="checkbox" id="icb-${i}" data-idx="${i}" ${checkedAttr} ${disabledAttr}>
      <label for="icb-${i}">${escapeHtml(a.name)} <span class="addon-version">${escapeHtml(version)}</span>${match}${warning}</label>
    </div>`;
  };

  const groupHtml = (title, items, offset, isInstalled) => items.length
    ? `<div class="group-heading">${title} (${items.length})</div>${items.map((a, i) => rowHtml(a, offset + i, isInstalled)).join('')}`
    : '';

  addonListEl.innerHTML =
    groupHtml('Not Installed Yet', notInstalled, 0, false) +
    groupHtml('Already Installed', alreadyInstalled, notInstalled.length, true);
  addonListEl.style.display = 'block';
  checklistBoxEl.style.display = 'block';
  listControls.style.display = 'flex';
  searchInput.style.display = 'block';
  noSearchMatchesEl.style.display = 'none';

  // Only note when everything from this file is already installed - a
  // count of extra add-ons installed since doesn't lead anywhere useful.
  const notes = [];
  if (notInstalled.length === 0 && alreadyInstalled.length > 0) {
    notes.push('You already have every add-on from this export installed.');
  }
  compareNoteEl.innerHTML = notes.map(n => `<span class="compare-note-line">${escapeHtml(n)}</span>`).join('');

  checkboxes().forEach((cb) => {
    cb.addEventListener('change', updateSelectionCount);
  });
  updateSelectionCount();
}

// Bumped each time a new file load starts, so an older load in flight
// can tell it's stale and not overwrite a newer one.
let loadGeneration = 0;

async function loadFile(file) {
  const myGeneration = ++loadGeneration;
  clearAddonList();
  setStatus('Reading file...');
  try {
    const html = await file.text();
    if (myGeneration !== loadGeneration) return;

    // DOMParser never executes scripts in the parsed document, so this is
    // safe even for an untrusted file.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dataEl = doc.getElementById('addons-exporter-data');
    if (!dataEl) {
      setStatus('This file doesn\'t look like an Add-ons Exporter file (no embedded data found)');
      return;
    }
    const parsed = JSON.parse(dataEl.textContent);
    const list = parsed && Array.isArray(parsed.addons) ? parsed.addons : null;

    if (!Array.isArray(list) || list.length === 0) {
      setStatus('No add-ons found in that file');
      return;
    }

    // The file isn't trusted - could be hand-edited or corrupted. A name
    // is the one field every row needs; entries missing one are dropped
    // instead of failing the whole import.
    const validList = list.filter((a) => a && typeof a.name === 'string' && a.name.trim() !== '');
    if (validList.length === 0) {
      setStatus('No valid add-ons found in that file');
      return;
    }

    const formatVersion = parsed.formatVersion;
    if (typeof formatVersion !== 'number') {
      setStatus('This file is missing its export format version and can\'t be imported.');
      return;
    }
    if (formatVersion > SUPPORTED_FORMAT_VERSION) {
      setStatus('This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.');
      return;
    }
    const migratedList = migrateAddonsData(validList, formatVersion);

    // If this fails, degrade gracefully instead of blocking the import -
    // treat everything as not-installed.
    let installed = [];
    try {
      installed = await browser.runtime.sendMessage({ type: 'listAddons' });
      if (myGeneration !== loadGeneration) return;
      if (!Array.isArray(installed)) installed = [];
    } catch {
      if (myGeneration !== loadGeneration) return;
      installed = [];
    }

    setStatus('');
    renderAddonList(migratedList, installed);
  } catch (err) {
    if (myGeneration !== loadGeneration) return;
    setStatus('Error reading file: ' + err.message);
  }
}

function setSelectedFile(file) {
  if (file) {
    fileNameEl.textContent = file.name;
    fileNameRow.style.display = 'flex';
    fileNameRow.style.alignItems = 'center';
    fileNameRow.style.justifyContent = 'center';
    fileNameRow.style.gap = '8px';
    chooseFileBtn.style.display = 'none';
    loadFile(file);
  } else {
    fileInput.value = '';
    fileNameRow.style.display = 'none';
    chooseFileBtn.style.display = '';
    clearAddonList();
    setStatus('');
  }
}

removeFileBtn.addEventListener('click', () => setSelectedFile(null));

chooseFileBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  setSelectedFile(fileInput.files[0] || null);
});

// Dropping a file onto the picker works the same as "Choose file".
['dragenter', 'dragover'].forEach((eventName) => {
  picker.addEventListener(eventName, (e) => {
    e.preventDefault();
    picker.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  picker.addEventListener(eventName, (e) => {
    e.preventDefault();
    picker.classList.remove('dragover');
  });
});

picker.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

selectAllBtn.addEventListener('click', () => {
  visibleCheckboxes(checkboxes()).forEach((cb) => { cb.checked = true; });
  updateSelectionCount();
});

deselectAllBtn.addEventListener('click', () => {
  visibleCheckboxes(checkboxes()).forEach((cb) => { cb.checked = false; });
  updateSelectionCount();
});

searchInput.addEventListener('input', () => {
  const anyMatch = filterAddonRows(addonListEl, searchInput.value);
  noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
});

// Prevent the label's synthetic checkbox click — the label's own default
// behaviour already toggled it once; without this, it would toggle twice.
addonListEl.addEventListener('click', (e) => {
  if (e.target.closest('label')) e.preventDefault();
});

openSelectedBtn.addEventListener('click', async () => {
  const selected = Array.from(checkboxes())
    .filter((cb) => cb.checked)
    .map((cb) => displayItems[Number(cb.dataset.idx)]);

  if (selected.length === 0) {
    setStatus('Select at least one add-on to open');
    return;
  }

  openSelectedBtn.disabled = true;
  setStatus(`Opening ${selected.length} tabs...`);
  let opened = 0;
  let failed = 0;
  for (let i = 0; i < selected.length; i++) {
    try {
      // Re-checked here regardless of checkbox state - this is the real
      // gate, nothing but http/https ever reaches browser.tabs.create.
      if (!isSafeUrl(selected[i].link)) {
        throw new Error('unsafe link');
      }
      await browser.tabs.create({ url: selected[i].link, active: false });
      opened++;
    } catch {
      failed++;
    }
    if (i < selected.length - 1) {
      await delay(TAB_OPEN_DELAY_MS);
    }
  }
  setStatus(failed > 0
    ? `Opened ${opened} tabs, ${failed} failed to open`
    : `Opened ${opened} tabs`);
  openSelectedBtn.disabled = false;
});
