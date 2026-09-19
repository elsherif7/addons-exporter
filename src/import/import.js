// SUPPORTED_FORMAT_VERSION tracks EXPORT_FORMAT_VERSION, and
// migrateAddonsData() below is what's supposed to handle any shape
// change between them. These two are coupled: bumping the format
// version without also updating migrateAddonsData means old-format
// files get passed straight through unmigrated. A tripwire test in
// tests/import.test.js hardcodes today's version number specifically
// to fail when that happens - see "migrateAddonsData: bumping the
// format version requires updating this test and migrateAddonsData".
const SUPPORTED_FORMAT_VERSION = EXPORT_FORMAT_VERSION;

// No-op for format version 1. Update this (and the tripwire test above)
// before bumping EXPORT_FORMAT_VERSION for real.
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

// Validates and normalizes the embedded addons payload from an exported
// report. Takes the raw text of the #addons-exporter-data script tag (or
// null if that tag wasn't found in the file) and returns either the
// ready-to-render addon list or a user-facing reason the file was
// rejected. The file isn't trusted - could be hand-edited or corrupted -
// so every shape assumption here is checked rather than assumed.
// Pulled out of loadFile() as a pure function so it can be unit tested
// without a DOM; loadFile() still owns actually reading/parsing the file
// and reacting to the result.
// Throws if jsonText is present but isn't valid JSON - loadFile()'s
// existing try/catch around the whole read handles that the same way it
// always has, so this doesn't catch it separately.
function parseAddonsPayload(jsonText) {
  if (jsonText == null) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no embedded data found)' };
  }

  const parsed = JSON.parse(jsonText);
  const list = parsed && Array.isArray(parsed.addons) ? parsed.addons : null;

  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, error: 'No add-ons found in that file' };
  }

  // A name is the one field every row needs; entries missing one are
  // dropped instead of failing the whole import.
  const validList = list.filter((a) => a && typeof a.name === 'string' && a.name.trim() !== '');
  if (validList.length === 0) {
    return { ok: false, error: 'No valid add-ons found in that file' };
  }

  const formatVersion = parsed.formatVersion;
  if (typeof formatVersion !== 'number') {
    return { ok: false, error: 'This file is missing its export format version and can\'t be imported.' };
  }
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.' };
  }

  return { ok: true, addons: migrateAddonsData(validList, formatVersion) };
}

// Validates and parses a JSON export file's text content. Same return
// shape as parseAddonsPayload(): { ok, addons } or { ok: false, error }.
// Throws on malformed JSON - loadFile()'s try/catch handles it.
function parseJsonPayload(text) {
  const parsed = JSON.parse(text);
  return parseAddonsPayload(parsed && typeof parsed === 'object'
    ? JSON.stringify(parsed)
    : text);
}

// Validates and parses a CSV export file's text content. Expects:
//   line 1: # addons-hub-format-version: <n>
//   line 2: header row (id,name,version,enabled,type,link,linkType)
//   line 3+: one data row per add-on
// Returns { ok, addons } or { ok: false, error }.
function parseCsvPayload(text) {
  // Normalise line endings.
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim() !== '');

  // Line 1: format-version comment.
  const versionMatch = lines[0] && lines[0].match(/^#\s*addons-hub-format-version:\s*(\d+)/);
  if (!versionMatch) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no format-version comment found)' };
  }
  const formatVersion = parseInt(versionMatch[1], 10);
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.' };
  }

  // Line 2: header row — validate expected columns are present.
  const expectedHeaders = ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType'];
  const headers = parseCsvRow(lines[1] || '');
  const missingHeaders = expectedHeaders.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return { ok: false, error: 'This file is missing expected CSV columns and can\'t be imported.' };
  }

  // Lines 3+: data rows.
  const dataLines = lines.slice(2);
  if (dataLines.length === 0) {
    return { ok: false, error: 'No add-ons found in that file' };
  }

  const addons = [];
  for (const line of dataLines) {
    const fields = parseCsvRow(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = fields[i] !== undefined ? fields[i] : ''; });
    // enabled: CSV stores 'true'/'false' strings - convert back to boolean.
    row.enabled = row.enabled === 'true';
    if (typeof row.name === 'string' && row.name.trim() !== '') {
      addons.push(row);
    }
  }

  if (addons.length === 0) {
    return { ok: false, error: 'No valid add-ons found in that file' };
  }

  return { ok: true, addons: migrateAddonsData(addons, formatVersion) };
}

// Parses a single CSV row per RFC 4180: handles quoted fields (including
// embedded commas and doubled double-quotes inside quotes).
function parseCsvRow(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      // Quoted field.
      let field = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ',') i++; // skip comma after closing quote
    } else {
      // Unquoted field - read up to next comma or end.
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
  }
  return fields;
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

// Builds one <div class="addon-row"> via DOM APIs (not innerHTML) so
// a.name/version/matchLabel never pass through HTML parsing - textContent
// and property assignment don't need escapeHtml the way a template
// string did.
function createAddonRow(a, i, isInstalled) {
  const safe = isSafeUrl(a.link);
  const version = typeof a.version === 'string' ? a.version : '';
  const matchLabel = LINK_TYPE_LABELS[a.linkType] || '';
  const matchClass = UNCERTAIN_LINK_TYPES.has(a.linkType) ? ' match-uncertain' : '';

  const row = document.createElement('div');
  row.className = 'addon-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `icb-${i}`;
  checkbox.dataset.idx = String(i);
  checkbox.checked = safe && !isInstalled;
  checkbox.disabled = !safe;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'addon-name';
  nameSpan.textContent = a.name;

  const versionSpan = document.createElement('span');
  versionSpan.className = 'addon-version';
  versionSpan.textContent = version;

  const label = document.createElement('label');
  label.htmlFor = `icb-${i}`;
  label.append(nameSpan, ' ', versionSpan);

  if (matchLabel) {
    const matchSpan = document.createElement('span');
    matchSpan.className = `match-label${matchClass}`;
    matchSpan.textContent = matchLabel;
    label.append(' ', matchSpan);
  }

  if (!safe) {
    const warningSpan = document.createElement('span');
    warningSpan.className = 'addon-link-preview unsafe';
    warningSpan.textContent = 'invalid or unsafe link - skipped';
    label.append(document.createElement('br'), warningSpan);
  }

  row.append(checkbox, label);
  return row;
}

function appendGroup(fragment, title, items, offset, isInstalled) {
  if (items.length === 0) return;
  const box = document.createElement('div');
  box.className = 'group-box';
  const heading = document.createElement('div');
  heading.className = 'group-heading';
  heading.textContent = `${title} (${items.length})`;
  box.appendChild(heading);
  items.forEach((a, i) => {
    box.appendChild(createAddonRow(a, offset + i, isInstalled));
  });
  fragment.appendChild(box);
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

  const fragment = document.createDocumentFragment();
  appendGroup(fragment, 'Not Installed Yet', notInstalled, 0, false);
  appendGroup(fragment, 'Already Installed', alreadyInstalled, notInstalled.length, true);
  addonListEl.replaceChildren(fragment);
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
  const noteFragment = document.createDocumentFragment();
  notes.forEach((n) => {
    const span = document.createElement('span');
    span.className = 'compare-note-line';
    span.textContent = n;
    noteFragment.appendChild(span);
  });
  compareNoteEl.replaceChildren(noteFragment);

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
    const text = await file.text();
    if (myGeneration !== loadGeneration) return;

    const ext = file.name.split('.').pop().toLowerCase();
    let result;
    if (ext === 'json') {
      result = parseJsonPayload(text);
    } else if (ext === 'csv') {
      result = parseCsvPayload(text);
    } else {
      // Default to HTML (also handles .html and any unrecognised extension).
      // DOMParser never executes scripts in the parsed document, so this is
      // safe even for an untrusted file.
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const dataEl = doc.getElementById('addons-exporter-data');
      result = parseAddonsPayload(dataEl ? dataEl.textContent : null);
    }

    if (!result.ok) {
      setStatus(result.error);
      return;
    }

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
    renderAddonList(result.addons, installed);
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

// Disabled checkboxes (unsafe links) are skipped by both buttons below -
// they're not part of the selectable set, same as the row-click handler
// already respects via its own cb.disabled check.
selectAllBtn.addEventListener('click', () => {
  visibleCheckboxes(checkboxes()).forEach((cb) => { if (!cb.disabled) cb.checked = true; });
  updateSelectionCount();
});

deselectAllBtn.addEventListener('click', () => {
  visibleCheckboxes(checkboxes()).forEach((cb) => { if (!cb.disabled) cb.checked = false; });
  updateSelectionCount();
});

searchInput.addEventListener('input', () => {
  const anyMatch = filterAddonRows(addonListEl, searchInput.value);
  noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
});

// Makes the whole row clickable, not just the checkbox/label text.
// Clicking the checkbox itself is left alone - its own native click
// already toggles it. Anything else in the row calls cb.click(), which
// fires the checkbox's own native toggle and change event. The
// preventDefault stops a label click's own default forwarding to the
// checkbox, so that path doesn't also fire and double the toggle.
addonListEl.addEventListener('click', (e) => {
  if (e.target.matches('input[type="checkbox"]')) return;
  const row = e.target.closest('.addon-row');
  if (!row) return;
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb || cb.disabled) return;
  e.preventDefault();
  cb.click();
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

  // Opened first (and becomes the active tab) so it's the thing you see
  // right away - the add-ons' own pages then open behind it as
  // background tabs via the loop below.
  await browser.tabs.create({ url: browser.runtime.getURL('src/confirmation/confirmation.html?from=import') });
  await delay(TAB_OPEN_DELAY_MS);

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
