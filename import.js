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

// Add-ons from the parsed file, in the exact order they're rendered
// (extensions then themes, each alphabetized) - each checkbox's data-idx
// indexes directly into this array so a display-order click always maps
// back to the right item, regardless of how the file itself ordered them.
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
}

function renderAddonList(addons) {
  const extensions = addons.filter(a => a.type === 'extension').sort(byName);
  const themes = addons.filter(a => a.type === 'theme').sort(byName);
  displayItems = [...extensions, ...themes];

  const rowHtml = (a, i) => {
    const safe = isSafeUrl(a.link);
    const linkPreview = safe
      ? `<span class="addon-link-preview">${escapeHtml(new URL(a.link).hostname)}</span>`
      : `<span class="addon-link-preview unsafe">invalid or unsafe link - skipped</span>`;
    return `<div class="addon-row">
      <input type="checkbox" id="icb-${i}" data-idx="${i}" ${safe ? 'checked' : ''}>
      <label for="icb-${i}">${escapeHtml(a.name)} <span class="addon-version">${escapeHtml(a.version)}</span>${a.enabled === false ? '<span class="addon-disabled-tag">disabled</span>' : ''}<br>${linkPreview}</label>
    </div>`;
  };

  const groupHtml = (title, items, offset) => items.length
    ? `<div class="group-heading">${title} (${items.length})</div>${items.map((a, i) => rowHtml(a, offset + i)).join('')}`
    : '';

  addonListEl.innerHTML = groupHtml('Extensions', extensions, 0) + groupHtml('Themes', themes, extensions.length);
  addonListEl.style.display = 'block';
  listControls.style.display = 'flex';

  checkboxes().forEach((cb) => {
    cb.addEventListener('change', updateSelectionCount);
  });
  updateSelectionCount();
}

// Bumped every time a new file load starts. loadFile() captures its own
// value and checks it again after the only await point (file.text()) -
// if a newer file was selected in the meantime, this call's result is
// stale and gets silently discarded instead of overwriting what the user
// is now looking at.
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

    setStatus('');
    renderAddonList(list);
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
