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
// De-duplicates by id+link (or, lacking an id, name+link) - an exact
// repeat entry would otherwise show up as two rows, and if both got
// selected in the Importer, open the same add-on's page twice. Shared by
// parseAddonsPayload() and parseCsvPayload() below.
function dedupeAddonKey(a) {
  return `${a.id || (a.name || '').toLowerCase()}\u0000${a.link || ''}`;
}
function dedupeAddons(list) {
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const key = dedupeAddonKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function parseAddonsPayload(jsonText) {
  if (jsonText == null) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no embedded data found)' };
  }

  const parsed = JSON.parse(jsonText);

  // A v1.0.0 export was a bare array with no formatVersion/addons wrapper
  // at all - checked for specifically, and first, so it gets a message
  // that actually explains why, instead of falling through to the
  // generic "no add-ons found" the old code order produced here (since a
  // bare array's own .addons property is undefined either way).
  if (Array.isArray(parsed)) {
    return { ok: false, error: 'This file appears to be from an old, unsupported version of Add-ons Exporter and can\'t be imported.' };
  }

  // Format version is checked before anything about the add-ons list
  // itself, so any other incompatible/malformed file gets a version-
  // specific message rather than "No valid add-ons found" or similar,
  // which didn't explain the real reason.
  const formatVersion = parsed && parsed.formatVersion;
  if (!Number.isInteger(formatVersion) || formatVersion < 1) {
    return { ok: false, error: 'This file is missing its export format version and can\'t be imported.' };
  }
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.' };
  }

  const list = parsed && Array.isArray(parsed.addons) ? parsed.addons : null;
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, error: 'No add-ons found in that file' };
  }

  // A name is the one field every row needs; entries missing one are
  // dropped instead of failing the whole import. id/version/link are
  // coerced to undefined (dropped, not trusted as-is) when they aren't
  // strings - a hand-edited or malformed file could have any type here,
  // and a wrong-typed id in particular would otherwise reach
  // findInstalledMatch()/isPlausibleNameMatch() unchecked.
  const validList = [];
  for (const a of list) {
    if (!a || typeof a.name !== 'string' || a.name.trim() === '') continue;
    validList.push({
      ...a,
      id: typeof a.id === 'string' ? a.id : undefined,
      version: typeof a.version === 'string' ? a.version : undefined,
      link: typeof a.link === 'string' ? a.link : undefined,
    });
  }
  if (validList.length === 0) {
    return { ok: false, error: 'No valid add-ons found in that file' };
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(validList), formatVersion) };
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

// Undoes the leading-apostrophe formula-injection guard buildCsvExport()
// (report-template.js) adds to a field that would otherwise be read as a
// formula by a spreadsheet app (one starting with =, +, -, @, tab, or
// CR). Only strips it when the character right after it is one of those -
// a value that genuinely starts with a literal apostrophe followed by
// something else is left alone.
function stripCsvFormulaGuard(s) {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

// Validates and parses a CSV export file's text content. Expects:
//   line 1: # addons-hub-format-version: <n>
//   line 2: header row (id,name,version,enabled,type,link,linkType)
//   line 3+: one data row per add-on
// Returns { ok, addons } or { ok: false, error }.
function parseCsvPayload(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Line 1 (the format-version comment) is pulled out as plain text,
  // ahead of any CSV-field parsing - a spreadsheet that pads it with
  // extra commas on re-save (e.g. "...version: 1,,,,,,") shouldn't
  // matter, since the version number itself is never after a comma.
  const firstNewline = normalized.indexOf('\n');
  const firstLine = firstNewline === -1 ? normalized : normalized.slice(0, firstNewline);
  const rest = firstNewline === -1 ? '' : normalized.slice(firstNewline + 1);

  const versionMatch = firstLine.match(/^#\s*addons-hub-format-version:\s*(\d+)/);
  if (!versionMatch) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no format-version comment found)' };
  }
  const formatVersion = parseInt(versionMatch[1], 10);
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.' };
  }

  // Everything from the header row on is parsed as a whole, rather than
  // being split into lines first and each line parsed on its own - a
  // quoted field containing a literal newline would otherwise be cut in
  // two before parseCsvRecords ever saw it, turning one add-on into two
  // broken rows.
  const records = parseCsvRecords(rest).filter((fields) => !(fields.length === 1 && fields[0] === ''));

  if (records.length === 0) {
    return { ok: false, error: 'This file is missing expected CSV columns and can\'t be imported.' };
  }

  // Header row — validate expected columns are present.
  const expectedHeaders = ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType'];
  const headers = records[0];
  const missingHeaders = expectedHeaders.filter((h) => !headers.includes(h));
  if (missingHeaders.length > 0) {
    return { ok: false, error: 'This file is missing expected CSV columns and can\'t be imported.' };
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return { ok: false, error: 'No add-ons found in that file' };
  }

  const addons = [];
  for (const fields of dataRecords) {
    const row = {};
    headers.forEach((h, i) => { row[h] = fields[i] !== undefined ? stripCsvFormulaGuard(fields[i]) : ''; });
    // enabled: CSV stores 'true'/'false' strings - convert back to
    // boolean, case-insensitively (a spreadsheet that re-saves the file
    // often capitalizes it as TRUE/FALSE).
    row.enabled = row.enabled.toLowerCase() === 'true';
    if (typeof row.name === 'string' && row.name.trim() !== '') {
      addons.push(row);
    }
  }

  if (addons.length === 0) {
    return { ok: false, error: 'No valid add-ons found in that file' };
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(addons), formatVersion) };
}

// Parses an entire CSV text (RFC 4180-ish) into an array of records, each
// an array of field strings. Unlike parsing line by line, this walks the
// whole text in one pass, so a quoted field containing a literal newline
// stays part of that one field/record instead of being cut into two. A
// stray character right after a field's closing quote (from a hand-edited
// or oddly re-saved file) is folded into that same field rather than
// starting a new, phantom column.
function parseCsvRecords(text) {
  const records = [];
  let fields = [];
  let i = 0;
  const n = text.length;

  function readField() {
    let field = '';
    if (text[i] === '"') {
      i++; // skip opening quote
      while (i < n) {
        if (text[i] === '"' && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (text[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += text[i++];
        }
      }
      // Lenient: anything right after the closing quote that isn't a
      // delimiter is folded into this same field instead of starting a
      // phantom extra column.
      while (i < n && text[i] !== ',' && text[i] !== '\n') {
        field += text[i++];
      }
    } else {
      while (i < n && text[i] !== ',' && text[i] !== '\n') {
        field += text[i++];
      }
    }
    return field;
  }

  while (i <= n) {
    fields.push(readField());
    if (text[i] === ',') {
      i++;
      continue;
    }
    records.push(fields);
    fields = [];
    if (text[i] === '\n') {
      i++;
    } else {
      break; // end of text
    }
  }
  return records;
}

// Parses a single CSV row per RFC 4180: handles quoted fields (including
// embedded commas and doubled double-quotes inside quotes). A thin
// wrapper around parseCsvRecords() (which parseCsvPayload() above uses
// directly, since it needs to handle newlines *inside* a field spanning
// what would otherwise look like a row break) - kept for anything that
// only ever needs to parse one already-separated line at a time.
function parseCsvRow(line) {
  return parseCsvRecords(line)[0] || [];
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
function createAddonRow(a, i, isInstalled, shorten) {
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

  const nameEl = document.createElement('span');
  nameEl.className = 'addon-name';
  nameEl.textContent = shorten ? shortName(a.name) : a.name;

  const amoLink = safe ? (() => {
    const lnk = document.createElement('a');
    lnk.className = 'match-label';
    lnk.href = a.link;
    lnk.target = '_blank';
    lnk.rel = 'noopener';
    lnk.textContent = 'AMO';
    lnk.style.cssText = 'color:var(--link-accent);text-decoration:none;margin-left:6px;';
    lnk.addEventListener('mouseover', () => { lnk.style.textDecoration = 'underline'; });
    lnk.addEventListener('mouseout', () => { lnk.style.textDecoration = 'none'; });
    lnk.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); window.open(lnk.href, '_blank', 'noopener'); });
    return lnk;
  })() : null;

  const versionSpan = document.createElement('span');
  versionSpan.className = 'addon-version';
  versionSpan.textContent = version;

  const typeSpan = document.createElement('span');
  typeSpan.className = 'match-label';
  typeSpan.textContent = (a.type === 'theme') ? 'Theme' : 'Extension';

  const label = document.createElement('label');
  label.htmlFor = `icb-${i}`;
  const labelChildren = [nameEl, ' ', versionSpan, ' ', typeSpan];
  if (amoLink) labelChildren.push(amoLink);
  label.append(...labelChildren);

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

function appendGroup(fragment, title, items, offset, isInstalled, shorten) {
  if (items.length === 0) return;
  const container = document.createElement('div');
  container.className = 'group-container';

  const heading = document.createElement('div');
  heading.className = 'group-heading';
  heading.textContent = `${title} (${items.length})`;

  const box = document.createElement('div');
  box.className = 'group-box';
  items.forEach((a, i) => {
    box.appendChild(createAddonRow(a, offset + i, isInstalled, shorten));
  });

  container.appendChild(heading);
  container.appendChild(box);
  fragment.appendChild(container);
}

function renderAddonList(addons, installed, shorten) {
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

  const outerBox = document.createElement('div');
  outerBox.className = 'groups-outer-box';
  appendGroup(outerBox, 'Not Installed Yet', notInstalled, 0, false, shorten);
  appendGroup(outerBox, 'Already Installed', alreadyInstalled, notInstalled.length, true, shorten);
  const fragment = document.createDocumentFragment();
  fragment.appendChild(outerBox);
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

async function loadFile(file) {  const myGeneration = ++loadGeneration;
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
    let shorten = true;
    try {
      const s = await browser.storage.local.get(SHORT_NAME_STORAGE_KEY);
      if (myGeneration !== loadGeneration) return;
      if (s && s[SHORT_NAME_STORAGE_KEY] === 'off') shorten = false;
    } catch {
      if (myGeneration !== loadGeneration) return;
      /* default to true */
    }
    renderAddonList(result.addons, installed, shorten);
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
    // Invalidates any load already in flight - without this, removing
    // the file while a read/listAddons/storage.get was still pending
    // let that stale load render its results anyway, right after this
    // branch had just cleared the list.
    loadGeneration++;
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
  if (e.target.closest('a')) return;
  const row = e.target.closest('.addon-row');
  if (!row) return;
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb || cb.disabled) return;
  e.preventDefault();
  cb.click();
});

function pluralTabs(n) {
  return `${n} tab${n === 1 ? '' : 's'}`;
}

openSelectedBtn.addEventListener('click', async () => {
  const selected = Array.from(checkboxes())
    .filter((cb) => cb.checked)
    .map((cb) => displayItems[Number(cb.dataset.idx)]);

  if (selected.length === 0) {
    setStatus('Select at least one add-on to open');
    return;
  }

  openSelectedBtn.disabled = true;
  setStatus(`Opening ${pluralTabs(selected.length)}...`);

  try {
    // Opened first (and becomes the active tab) so it's the thing you see
    // right away - the add-ons' own pages then open behind it as
    // background tabs via the loop below. Wrapped in its own try/catch:
    // if this fails, still go on and open the add-ons - a missing
    // confirmation tab is far less bad than the button staying stuck on
    // "Opening..." forever because this one tab couldn't be created.
    try {
      await browser.tabs.create({ url: browser.runtime.getURL('src/confirmation/confirmation.html?from=import') });
    } catch {
      /* not fatal - see comment above */
    }
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
      ? `Opened ${pluralTabs(opened)}, ${failed} failed to open`
      : `Opened ${pluralTabs(opened)}`);
  } finally {
    openSelectedBtn.disabled = false;
  }
});
