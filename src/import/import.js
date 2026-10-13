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

// TAB_OPEN_DELAY_MS (the stagger between opened tabs) lives in common.js.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildInstalledIndex(installed) {
  const byId = new Map();
  const byName = new Map();
  // Short form of each installed name (see shortName() in common.js): an
  // export made with "Shorten add-on names" on has short names, so a file
  // without ids can only be matched against installed add-ons by that. A
  // short name shared by two installed add-ons is ambiguous and is
  // stored as null, so it never guesses between them.
  const byShortName = new Map();
  for (const a of installed) {
    byId.set(a.id, a);
    byName.set(a.name.toLowerCase(), a);
    const short = shortName(a.name).toLowerCase();
    byShortName.set(short, byShortName.has(short) ? null : a);
  }
  return { byId, byName, byShortName };
}

// Matches a file's add-on to an installed one: the id first (the reliable
// way, and what makes shortened names safe), then - for an add-on with no
// id, or one whose id isn't installed - the name: the exact name
// (case-insensitive), then the shortened form, so a short name in the file
// still finds the full installed name and the other way round.
function findInstalledMatch(item, index) {
  if (item.id && index.byId.has(item.id)) {
    return index.byId.get(item.id);
  }
  const name = item.name.toLowerCase();
  if (index.byName.has(name)) return index.byName.get(name);
  const short = shortName(item.name).toLowerCase();
  return index.byShortName.get(short) || null;
}

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

// Validates the add-ons payload of an export: the JSON file, and the data
// embedded in an HTML report (the script tag #addons-exporter-data). Takes the
// raw text (or null if that tag wasn't found in the HTML file) and returns
// either the ready-to-render list or a user-facing reason the file was
// rejected.
//
// The check is strict: the file must be exactly what the exporter writes,
// including the HTML report from the version released on addons.mozilla.org
// (the same payload):
//   { "formatVersion": 1, "addons": [ { id, name, version, enabled, type, link, linkType }, ... ] }
// Anything else - another key, a missing field, a field of the wrong type - is
// rejected as a whole, naming the first problem, rather than guessed at.
// Pulled out of loadFile() as a pure function so it can be unit tested without
// a DOM. Throws if jsonText is present but isn't valid JSON - loadFile()'s
// try/catch handles that.
// The field order of an entry in each file: the HTML report's embedded data
// (also what the AMO release wrote) starts with the id; the JSON export lists
// the name first and the id last. A file must use its own format's order.
const HTML_ENTRY_KEYS = ['id', 'name', 'version', 'enabled', 'type', 'link', 'linkType'];
const JSON_ENTRY_KEYS = ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'];
const payloadError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter format (${detail}).` });
// Exactly these keys, in exactly this order (JSON.parse keeps the file's order).
const sameKeys = (obj, keys) => {
  const have = Object.keys(obj);
  return have.length === keys.length && keys.every((k, i) => have[i] === k);
};

// Returns null when the entry is exactly what the exporter writes, otherwise a
// short reason.
function addonEntryProblem(a, keys) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 'it is not an object';
  if (!sameKeys(a, keys)) return 'its fields are not exactly ' + keys.join(', ') + ', in that order';
  if (typeof a.id !== 'string' || a.id === '') return 'it has no id';
  if (typeof a.name !== 'string' || a.name.trim() === '') return 'it has no name';
  if (typeof a.version !== 'string') return 'its version is not text';
  if (typeof a.enabled !== 'boolean') return 'enabled is not true or false';
  if (a.type !== 'extension' && a.type !== 'theme') return 'its type is not extension or theme';
  if (typeof a.link !== 'string') return 'its link is not text';
  if (typeof a.linkType !== 'string') return 'its linkType is not text';
  return null;
}

function parseAddonsPayload(jsonText, entryKeys = HTML_ENTRY_KEYS) {
  if (jsonText == null) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no embedded data found)' };
  }

  const parsed = JSON.parse(jsonText);

  // A v1.0.0 export was a bare array with no formatVersion/addons wrapper at
  // all - checked for specifically, and first, so it gets a message that
  // explains why.
  if (Array.isArray(parsed)) {
    return { ok: false, error: 'This file appears to be from an old, unsupported version of Add-ons Exporter and can\'t be imported.' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return payloadError('the data is not an object');
  }

  // Format version is checked before anything about the add-ons list itself,
  // so an incompatible file gets a version-specific message.
  const formatVersion = parsed.formatVersion;
  if (!Number.isInteger(formatVersion) || formatVersion < 1) {
    return { ok: false, error: 'This file is missing its export format version and can\'t be imported.' };
  }
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.' };
  }

  const list = Array.isArray(parsed.addons) ? parsed.addons : null;
  if (!list || list.length === 0) {
    return { ok: false, error: 'No add-ons found in that file' };
  }
  if (!sameKeys(parsed, ['formatVersion', 'addons'])) {
    return payloadError('the data is not exactly formatVersion, then addons');
  }

  for (let n = 0; n < list.length; n++) {
    const problem = addonEntryProblem(list[n], entryKeys);
    if (problem) return payloadError(`add-on ${n + 1}: ${problem}`);
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(list), formatVersion) };
}

// Validates and parses a JSON export file's text content. Same return
// shape as parseAddonsPayload(): { ok, addons } or { ok: false, error }.
// Throws on malformed JSON - loadFile()'s try/catch handles it.
function parseJsonPayload(text) {
  const parsed = JSON.parse(text);
  return parseAddonsPayload(parsed && typeof parsed === 'object'
    ? JSON.stringify(parsed)
    : text, JSON_ENTRY_KEYS);
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

// The one header row buildCsvExport() (report-template.js) writes.
const CSV_HEADER = ['name', 'version', 'type', 'enabled', 'link', 'linkType', 'id'];

const csvError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter CSV format (${detail}).` });

// Validates and parses a CSV export file's text content. Accepts only what
// buildCsvExport() writes:
//   line 1: # addons-hub-format-version: <n>
//   line 2: name,version,type,enabled,link,linkType,id (this exact header)
//   line 3+: one row per add-on, exactly seven fields, no blank lines
// Anything else is rejected, with the first problem found named.
// Returns { ok, addons } or { ok: false, error }.
function parseCsvPayload(text) {
  // The export starts with a byte-order mark (so Excel reads UTF-8); it is not part of the text.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const firstNewline = normalized.indexOf('\n');
  const firstLine = firstNewline === -1 ? normalized : normalized.slice(0, firstNewline);
  const rest = firstNewline === -1 ? '' : normalized.slice(firstNewline + 1);

  const versionMatch = firstLine.match(/^# addons-hub-format-version: (\d+)$/);
  if (!versionMatch) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no format-version comment found)' };
  }
  const formatVersion = parseInt(versionMatch[1], 10);
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.' };
  }

  // The rest is parsed as a whole, not line by line, so a quoted name that
  // contains a line break stays one field.
  let records;
  try {
    records = parseCsvRecords(rest);
  } catch (err) {
    return csvError(err.message);
  }

  if (records.length === 0 || records[0].join(',') !== CSV_HEADER.join(',')) {
    return csvError('the header row must be: ' + CSV_HEADER.join(','));
  }
  if (records.length === 1) {
    return { ok: false, error: 'No add-ons found in that file' };
  }

  const addons = [];
  for (let n = 1; n < records.length; n++) {
    const fields = records[n];
    const where = `row ${n}`;
    if (fields.length !== CSV_HEADER.length) {
      return csvError(`${where} has ${fields.length} fields instead of ${CSV_HEADER.length}`);
    }
    const [name, version, type, enabled, link, linkType, id] = fields.map(stripCsvFormulaGuard);
    if (name.trim() === '') return csvError(`${where} has no name`);
    if (id === '') return csvError(`${where} has no id`);
    if (type !== 'extension' && type !== 'theme') return csvError(`${where} has an unknown type`);
    if (enabled !== 'true' && enabled !== 'false') return csvError(`${where} has an unknown enabled value`);
    addons.push({ name, version, type, enabled: enabled === 'true', link, linkType, id });
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(addons), formatVersion) };
}

// Parses an entire CSV text (RFC 4180) into an array of records, each an
// array of field strings. It walks the whole text in one pass, so a quoted
// field containing a literal newline stays part of that one field. Throws an
// Error (with a short reason) for text buildCsvExport() never writes: a quote
// inside an unquoted field, an unclosed quote, or anything between a closing
// quote and the next comma or line end. A blank line is a record with one
// empty field, which the caller rejects as having the wrong field count.
function parseCsvRecords(text) {
  const records = [];
  let fields = [];
  let i = 0;
  const n = text.length;

  function readField() {
    let field = '';
    if (text[i] === '"') {
      i++; // skip opening quote
      let closed = false;
      while (i < n) {
        if (text[i] === '"' && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (text[i] === '"') {
          i++; // skip closing quote
          closed = true;
          break;
        } else {
          field += text[i++];
        }
      }
      if (!closed) throw new Error('a quoted value is never closed');
      if (i < n && text[i] !== ',' && text[i] !== '\n') {
        throw new Error('unexpected text after a closing quote');
      }
    } else {
      while (i < n && text[i] !== ',' && text[i] !== '\n') {
        if (text[i] === '"') throw new Error('a quote inside an unquoted value');
        field += text[i++];
      }
    }
    return field;
  }

  // No text at all is no records.
  if (n === 0) return records;
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


// Reverses the escaping buildTxtExport() (report-template.js) applies to every
// column: \\ is a backslash, \| a pipe, \n a line break, \r a carriage
// return, \s a space (used for a space at the very start or end of a value).
// Returns null for a backslash followed by anything else, which the exporter
// never writes.
function txtUnescape(text) {
  // Take the valid escapes out first; any backslash left over is not one.
  if (text.replace(/\\[\\|nrs]/g, '').includes('\\')) return null;
  return text.replace(/\\([\\|nrs])/g, (m, c) => ({ '\\': '\\', '|': '|', n: '\n', r: '\r', s: ' ' }[c]));
}

// A column's text with only the padding spaces removed (not tabs or other
// whitespace, which belong to the value), then unescaped. null if invalid.
function readTxtCell(text) {
  return txtUnescape(text.replace(/^ +| +$/g, ''));
}

const txtError = (detail) => ({ ok: false, error: `This file doesn't match the Add-ons Exporter TXT format (${detail}).` });

// Validates and parses a TXT export file's text content. Accepts only what
// buildTxtExport() writes:
//   line 1: # addons-hub-format-version: <n>
//   then the title, the section headings and their underlines (any line with
//   no " | " in it is skipped)
//   then one add-on per line, exactly six columns:
//     Name | Version | Type | Status | Link | Id
// A line with " | " in it that is not a valid add-on line rejects the whole
// file, with its line number. Returns { ok, addons } or { ok: false, error }.
function parseTxtPayload(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const versionMatch = lines[0] && lines[0].match(/^# addons-hub-format-version: (\d+)$/);
  if (!versionMatch) {
    return { ok: false, error: 'This file doesn\'t look like an Add-ons Exporter file (no format-version comment found)' };
  }
  const formatVersion = parseInt(versionMatch[1], 10);
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by a newer version of Add-ons Exporter. Please update the extension and try again.' };
  }

  const addons = [];
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line.includes(' | ')) continue;
    const parts = line.split(' | ');
    const where = `line ${n + 1}`;
    if (parts.length !== 6) return txtError(`${where} has ${parts.length} columns instead of 6`);
    const cells = parts.map(readTxtCell);
    if (cells.includes(null)) return txtError(`${where} has a backslash that is not an escape`);
    const [name, version, type, status, link, id] = cells;
    if (name === '') return txtError(`${where} has no name`);
    if (id === '') return txtError(`${where} has no id`);
    const parsedType = parseType(type);
    if (!parsedType) return txtError(`${where} has an unknown type`);
    if (status !== 'Enabled' && status !== 'Disabled') return txtError(`${where} has an unknown status`);
    addons.push({
      name,
      version,
      type: parsedType,
      enabled: status === 'Enabled',
      link,
      id,
    });
  }

  if (addons.length === 0) {
    return { ok: false, error: 'No add-ons found in that file' };
  }

  return { ok: true, addons: migrateAddonsData(dedupeAddons(addons), formatVersion) };
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
  setSelectionCount(selectionCountEl, boxes.length ? `${checked} of ${boxes.length} selected` : '');
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
  if (!safe) row.classList.add('row-disabled');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `icb-${i}`;
  checkbox.dataset.idx = String(i);
  checkbox.checked = safe && !isInstalled;
  checkbox.disabled = !safe;

  const nameEl = document.createElement('span');
  nameEl.className = 'addon-name';
  nameEl.textContent = shorten ? shortName(a.name) : a.name;
  nameEl.dataset.fullName = a.name; // so the name can follow the Shorten setting live

  const amoLink = safe ? (() => {
    const lnk = document.createElement('a');
    lnk.className = 'match-label';
    lnk.href = a.link;
    lnk.target = '_blank';
    lnk.rel = 'noopener';
    lnk.textContent = 'AMO';
    return lnk;
  })() : null;

  const versionSpan = document.createElement('span');
  versionSpan.className = 'addon-version';
  versionSpan.textContent = version;

  const typeSpan = document.createElement('span');
  typeSpan.className = 'match-label';
  typeSpan.textContent = typeLabel(a.type);

  const label = document.createElement('label');
  label.htmlFor = `icb-${i}`;
  label.append(nameEl, ' ', versionSpan, ' ', typeSpan);

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
  if (amoLink) row.append(amoLink);
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

  const notes = [];
  if (notInstalled.length === 0 && alreadyInstalled.length > 0) {
    notes.push('You already have every add-on from this export installed.');
  } else if (notInstalled.length > 0 && alreadyInstalled.length > 0) {
    const newWord = notInstalled.length === 1 ? 'add-on' : 'add-ons';
    const instWord = alreadyInstalled.length === 1 ? 'add-on' : 'add-ons';
    notes.push(`${notInstalled.length} new ${newWord} pre-selected, ${alreadyInstalled.length} already-installed ${instWord} shown for reference.`);
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

const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_IMPORT_EXTENSIONS = new Set(['html', 'htm', 'json', 'csv', 'txt']);

// Checked before a file is ever read - lets a wrong-typed or oversized
// file get a clear, immediate reason instead of failing deep inside
// parsing (any unrecognised extension used to be silently parsed as
// HTML), or, for a very large file, reading the whole thing into memory
// for no reason.
function validateSelectedFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ACCEPTED_IMPORT_EXTENSIONS.has(ext)) {
    return { ok: false, error: `"${file.name}" isn't a supported file type. Choose an .html, .json, .csv, or .txt export.` };
  }
  if (typeof file.size === 'number' && file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    return { ok: false, error: `That file is too large (over ${Math.round(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024))} MB) to be a real export.` };
  }
  return { ok: true };
}

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
    } else if (ext === 'txt') {
      result = parseTxtPayload(text);
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
    const settings = await loadSettings();
    if (myGeneration !== loadGeneration) return;
    const shorten = settings.shortenNames !== 'off';
    renderAddonList(result.addons, installed, shorten);
  } catch (err) {
    if (myGeneration !== loadGeneration) return;
    setStatus('Error reading file: ' + err.message);
  }
}

function setSelectedFile(file) {
  if (file) {
    const validation = validateSelectedFile(file);
    if (!validation.ok) {
      setStatus(validation.error);
      return;
    }
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

// Removing the file plays out the page's opening in reverse: what is lowest
// goes first (the list, the Select all row, the search box, the note, the file
// name), each sliding left and fading, one after another - then the file is
// really removed and "Choose file" pops back in. Until it has finished the
// page keeps its state, but a load still in flight is cancelled at once so it
// cannot draw anything in the middle of the exit. Without animation support,
// or for reduced motion, the file is simply removed at once.
let removingFile = false;

function removalTargets() {
  return [checklistBoxEl, listControls, searchInput, compareNoteEl, fileNameRow].filter((el) => {
    if (!el || el.style.display === 'none') return false;
    return el !== compareNoteEl || el.textContent !== '';
  });
}

function animateOut(el, delayMs) {
  return el.animate(
    [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-14px)' }],
    { duration: 220, delay: delayMs, easing: 'ease-in', fill: 'forwards' }
  );
}

async function removeFileAnimated() {
  if (removingFile) return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = reduced ? [] : removalTargets().filter((el) => typeof el.animate === 'function');
  if (targets.length === 0) {
    setSelectedFile(null);
    return;
  }

  removingFile = true;
  const myGeneration = ++loadGeneration; // a load still in flight is stale from now on
  const animations = targets.map((el, i) => animateOut(el, i * 80));
  try {
    await Promise.all(animations.map((a) => a.finished));
  } catch {
    /* an animation was cancelled - carry on and remove the file anyway */
  }
  removingFile = false;
  const replaced = myGeneration !== loadGeneration; // another file was chosen meanwhile: keep it

  if (!replaced) setSelectedFile(null); // hides everything for real...
  // ...so the held end frames can go (they must never linger on a new file's list).
  animations.forEach((a) => { try { a.cancel(); } catch { /* already gone */ } });
  if (replaced) return;
  if (typeof chooseFileBtn.animate === 'function') {
    chooseFileBtn.animate(
      [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'none' }],
      { duration: 350, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' }
    );
  }
}

removeFileBtn.addEventListener('click', removeFileAnimated);

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

// Without this, dropping a file anywhere else on the page (outside the
// picker) falls through to the browser's default behavior - navigating
// to and displaying the file directly instead of importing it.
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => { e.preventDefault(); });

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

function applySearch() {
  const anyMatch = filterAddonRows(addonListEl, searchInput.value);
  setFilterVisible(addonListEl, anyMatch, 'block');
  noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
}
searchInput.addEventListener('input', applySearch);

// "Shorten add-on names" changed (Settings page, a settings import, a reset):
// the names on this already-open page change at once. What the search box
// matches changes with them, so a search in progress is applied again.
onShortenNamesChanged((shorten) => {
  if (applyNameShortening(addonListEl, shorten) > 0 && searchInput.value) applySearch();
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
    // Only http/https links ever reach browser.tabs.create. Re-checked here
    // regardless of checkbox state - this is the real gate.
    const links = selected.map((item) => item.link);
    const safeLinks = links.filter((link) => isSafeUrl(link));
    let failed = links.length - safeLinks.length;

    // Open the first add-on's page right here, as a background tab (the
    // first one that actually opens - a failure just moves on to the next).
    let firstIdx = -1;
    for (let i = 0; i < safeLinks.length; i++) {
      try {
        await browser.tabs.create({ url: safeLinks[i], active: false });
        firstIdx = i;
        break;
      } catch {
        failed++;
      }
    }

    // Nothing opened means there's nothing to confirm - stay here so the
    // status (all failed) is what the user sees.
    if (firstIdx === -1) {
      setStatus(`Opened 0 tabs, ${failed} failed to open`);
      return;
    }

    // The confirmation page replaces this page right after the first tab
    // opens, and a page that has navigated away can't keep running a loop.
    // So the remaining add-ons are handed to background.js, which opens
    // them one after another (starting at once) while the confirmation
    // page is already on screen.
    const rest = safeLinks.slice(firstIdx + 1);
    let opened = 1;
    if (rest.length > 0) {
      try {
        await browser.runtime.sendMessage({ type: 'openTabs', urls: rest });
        opened += rest.length; // queued: background.js opens them from here
      } catch {
        // Background unreachable: open them from here instead, then go on.
        for (let i = 0; i < rest.length; i++) {
          await delay(TAB_OPEN_DELAY_MS);
          try {
            await browser.tabs.create({ url: rest[i], active: false });
            opened++;
          } catch {
            failed++;
          }
        }
      }
    }

    setStatus(failed > 0
      ? `Opened ${pluralTabs(opened)}, ${failed} failed to open`
      : `Opened ${pluralTabs(opened)}`);
    await goToConfirmation(failed > 0 ? `from=import&failed=${failed}` : 'from=import');
  } finally {
    openSelectedBtn.disabled = false;
  }
});
