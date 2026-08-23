// Highest exported-data format version this copy of the extension knows how
// to read. Mirrors EXPORT_FORMAT_VERSION in background.js. A file whose
// embedded formatVersion is higher than this was made by a newer version of
// the extension - its data shape may not match what we expect here, so we
// refuse to guess rather than risk opening bad links.
const SUPPORTED_FORMAT_VERSION = 1;

// Milliseconds to wait between opening each tab during import. Opening
// dozens of tabs back-to-back with zero delay bursts a lot of sudden load
// on the browser at once - a small stagger smooths that out without
// meaningfully slowing down the import.
const TAB_OPEN_DELAY_MS = 150;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only http/https links are ever opened. An imported file's data isn't
// trusted - it could come from someone else, or be hand-edited - so a
// link claiming to be, say, "uBlock Origin" is still just a string until
// checked. This also guards against non-navigable schemes generally.
function isSafeUrl(link) {
  try {
    const u = new URL(link);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Indexes currently-installed add-ons by both id and lowercased name, so an
// imported item can be matched against what's already installed either way.
function buildInstalledIndex(installed) {
  const byId = new Map();
  const byName = new Map();
  for (const a of installed) {
    byId.set(a.id, a);
    byName.set(a.name.toLowerCase(), a);
  }
  return { byId, byName };
}

// Matches an imported item against the installed index. Prefers id (added
// to exports going forward) but falls back to a case-insensitive name match
// for older export files that predate the id field.
function findInstalledMatch(item, index) {
  if (item.id && index.byId.has(item.id)) {
    return index.byId.get(item.id);
  }
  return index.byName.get(item.name.toLowerCase()) || null;
}

const statusEl = document.getElementById('status');
const fileNameEl = document.getElementById('fileName');
const fileNameRow = document.getElementById('fileNameRow');
const noFileText = document.getElementById('noFileText');
const fileInput = document.getElementById('fileInput');
const picker = document.getElementById('picker');
const removeFileBtn = document.getElementById('removeFileBtn');
const chooseFileBtn = document.getElementById('chooseFileBtn');
const listControls = document.getElementById('listControls');
const addonListEl = document.getElementById('addonList');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const selectionCountEl = document.getElementById('selectionCount');
const openSelectedBtn = document.getElementById('openSelectedBtn');
const compareNoteEl = document.getElementById('compareNote');

// Add-ons from the parsed file, in the exact order they're rendered
// (Not Installed Yet then Already Installed, each alphabetized) - each
// checkbox's data-idx indexes directly into this array so a display-order
// click always maps back to the right item, regardless of file ordering.
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
  addonListEl.style.display = 'none';
  listControls.style.display = 'none';
  openSelectedBtn.disabled = true;
  selectionCountEl.textContent = '';
  compareNoteEl.textContent = '';
}

function renderAddonList(addons, installed) {
  const index = buildInstalledIndex(installed);
  const matchedInstalledIds = new Set();
  const notInstalled = [];
  const alreadyInstalled = [];

  for (const a of addons) {
    const match = findInstalledMatch(a, index);
    if (match) {
      matchedInstalledIds.add(match.id);
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
    // Only surface something when there's an actual problem - a normal
    // safe link stays quiet instead of showing its hostname on every
    // single row, which was mostly noise for the common case.
    const warning = safe ? '' : '<br><span class="addon-link-preview unsafe">invalid or unsafe link - skipped</span>';
    // Already-installed items default unchecked - nothing to open for
    // something you already have, though you can still pick them.
    const checkedAttr = safe && !isInstalled ? 'checked' : '';
    return `<div class="addon-row">
      <input type="checkbox" id="icb-${i}" data-idx="${i}" ${checkedAttr}>
      <label for="icb-${i}">${escapeHtml(a.name)} <span class="addon-version">${escapeHtml(a.version)}</span>${warning}</label>
    </div>`;
  };

  const groupHtml = (title, items, offset, isInstalled) => items.length
    ? `<div class="group-heading">${title} (${items.length})</div>${items.map((a, i) => rowHtml(a, offset + i, isInstalled)).join('')}`
    : '';

  addonListEl.innerHTML =
    groupHtml('Not Installed Yet', notInstalled, 0, false) +
    groupHtml('Already Installed', alreadyInstalled, notInstalled.length, true);
  addonListEl.style.display = 'block';
  listControls.style.display = 'flex';

  // Installed add-ons this file doesn't mention at all - informational
  // only, nothing to check or open for these.
  const newSinceExport = installed.filter(a => !matchedInstalledIds.has(a.id));
  const notes = [];
  if (notInstalled.length === 0 && alreadyInstalled.length > 0) {
    notes.push('You already have every add-on from this export installed.');
  }
  if (newSinceExport.length > 0) {
    notes.push(`${newSinceExport.length} add-on${newSinceExport.length === 1 ? '' : 's'} installed now ${newSinceExport.length === 1 ? "wasn't" : "weren't"} in this export.`);
  }
  compareNoteEl.textContent = notes.join(' ');

  checkboxes().forEach((cb) => {
    cb.addEventListener('change', updateSelectionCount);
  });
  updateSelectionCount();
}

// Bumped every time a new file load starts. loadFile() captures its own
// value and checks it again after each await point (file.text(), then the
// listAddons fetch) - if a newer file was selected in the meantime, this
// call's result is stale and gets silently discarded instead of
// overwriting what the user is now looking at.
let loadGeneration = 0;

// Reads, validates, and parses the picked file, then renders the checklist.
// Runs automatically as soon as a file is selected/dropped, rather than
// waiting for a separate button click.
async function loadFile(file) {
  const myGeneration = ++loadGeneration;
  clearAddonList();
  setStatus('Reading file...');
  try {
    const html = await file.text();
    if (myGeneration !== loadGeneration) return;

    // Parsed as 'text/html' via DOMParser rather than matched with a
    // regex - more robust to whitespace/attribute changes in the export
    // format, and DOMParser never executes scripts in the parsed
    // document, so this is safe even for an untrusted file.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const dataEl = doc.getElementById('addons-exporter-data');
    if (!dataEl) {
      setStatus('This file doesn\'t look like an Add-ons Exporter export (no embedded data found)');
      return;
    }
    const parsed = JSON.parse(dataEl.textContent);
    const list = parsed && Array.isArray(parsed.addons) ? parsed.addons : null;

    if (!Array.isArray(list) || list.length === 0) {
      setStatus('No add-ons found in that file');
      return;
    }

    // Only accept files that explicitly declare a formatVersion we
    // understand. A missing formatVersion means the file predates
    // versioning (or isn't a real export) and we can't safely assume its
    // data shape - reject it rather than guessing.
    const formatVersion = parsed.formatVersion;
    if (typeof formatVersion !== 'number') {
      setStatus('This file is missing its export format version and can\'t be imported.');
      return;
    }
    if (formatVersion > SUPPORTED_FORMAT_VERSION) {
      setStatus('This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.');
      return;
    }

    // Compare against what's currently installed, so items already present
    // aren't pre-checked. If this fails for any reason, degrade gracefully
    // instead of blocking the import - treat everything as not-installed,
    // same as before this comparison existed.
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
    renderAddonList(list, installed);
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
    noFileText.style.display = 'none';
    loadFile(file);
  } else {
    fileInput.value = '';
    fileNameRow.style.display = 'none';
    noFileText.style.display = 'block';
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

// Drag and drop: dropping a file directly onto the picker box works the
// same as clicking "Choose file", without needing the native file dialog.
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
  checkboxes().forEach((cb) => { cb.checked = true; });
  updateSelectionCount();
});

deselectAllBtn.addEventListener('click', () => {
  checkboxes().forEach((cb) => { cb.checked = false; });
  updateSelectionCount();
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
  // browser.tabs.create is an extension API call, not window.open() from
  // a web page, so it is never treated as pop-up spam by the browser.
  let opened = 0;
  let failed = 0;
  for (let i = 0; i < selected.length; i++) {
    try {
      // Re-validated here regardless of checkbox state - the preview
      // already unchecks unsafe links by default, but this is the actual
      // gate: nothing but http/https ever reaches browser.tabs.create.
      if (!isSafeUrl(selected[i].link)) {
        throw new Error('unsafe link');
      }
      await browser.tabs.create({ url: selected[i].link, active: false });
      opened++;
    } catch {
      // A single bad/missing/unsafe link shouldn't stop the rest of the
      // import - skip it and keep going.
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
