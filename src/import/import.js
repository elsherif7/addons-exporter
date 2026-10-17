// TAB_OPEN_DELAY_MS (the stagger between opened tabs) lives in core.js.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A file name's extension, lower-case and without the dot ("a.JSON" -> "json").
// Used wherever a name has to be turned into a reader (validateSelectedFile,
// the .zip entries and loadFile).
function extensionOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

// A file name without its last extension ("a.json" -> "a"; a name with no dot,
// or one that starts with it, is left alone). Lets an export be named after the
// file it came from without spelling out every format it was written in.
function baseNameOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
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
const exportPickRowEl = document.getElementById('exportPickRow');
const exportPickEl = document.getElementById('exportPick');
const exportPickListEl = document.getElementById('exportPickList');

// Rendered order (Not Installed Yet, then Already Installed) - each
// checkbox's data-idx indexes into this array to find the right item.
let displayItems = [];

// What the chosen files held: one entry per distinct export (a plain file is
// one; a .zip can hold several, and so can a selection of several files), plus
// what the list needs to redraw when the picker's choice changes.
let loadedExports = [];
let loadedInstalled = [];
let loadedShorten = true;

// One line per file a load had to leave out, so a file the user picked never
// disappears without a word. Shown with the count notes under the list.
let loadWarnings = [];

// Which picker entry the list is showing: 'all', or an export's index. The
// rendered labels live here so the closed box can echo the choice without
// re-reading the DOM.
let exportSelection = 0;
let exportPickLabels = new Map();

function setStatus(msg) {
  statusEl.textContent = msg;
}

// The shared add-on list (rows, Select all, search, count, click-a-row, live
// name shortening) - addon-list.js. Select all skips disabled (unsafe-link)
// rows, and a search shows the list again as display: block.
const list = createAddonList({
  listEl: addonListEl, countEl: selectionCountEl, actionBtn: openSelectedBtn,
  selectAllBtn, deselectAllBtn, searchInput, noMatchesEl: noSearchMatchesEl,
  shownDisplay: 'block',
});

function clearAddonList() {
  displayItems = [];
  loadedExports = [];
  loadWarnings = [];
  addonListEl.replaceChildren();
  checklistBoxEl.style.display = 'none';
  listControls.style.display = 'none';
  exportPickRowEl.style.display = 'none';
  exportPickListEl.replaceChildren();
  exportPickLabels = new Map();
  exportSelection = 0;
  closeExportPicker();
  exportPickEl.textContent = '';
  openSelectedBtn.disabled = true;
  selectionCountEl.textContent = '';
  compareNoteEl.textContent = '';
  searchInput.style.display = 'none';
  searchInput.value = '';
  noSearchMatchesEl.style.display = 'none';
}

// The Importer's row: the shared parts, plus what only an import has - the link
// to the add-on's page, the match label, and a warning for an unsafe link (its
// row is disabled and skipped).
function createAddonRow(a, i, isInstalled, shorten) {
  const safe = isSafeUrl(a.link);
  const matchLabel = LINK_TYPE_LABELS[a.linkType] || '';
  const matchClass = UNCERTAIN_LINK_TYPES.has(a.linkType) ? ' match-uncertain' : '';

  const { row, label } = createAddonRowBase(a, i, {
    idPrefix: 'icb', dataset: { idx: String(i) },
    checked: safe && !isInstalled, disabled: !safe, shorten,
  });

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

  if (safe) {
    const lnk = document.createElement('a');
    lnk.className = 'match-label';
    lnk.href = a.link;
    lnk.target = '_blank';
    lnk.rel = 'noopener';
    lnk.textContent = 'AMO';
    row.append(lnk);
  }
  return row;
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

  // Every container is shown first, then the rows are drawn: render() applies
  // an active search itself, so it has to come last or its filtering (and the
  // "no matches" note) would be undone here.
  addonListEl.style.display = 'block';
  checklistBoxEl.style.display = 'block';
  listControls.style.display = 'flex';
  searchInput.style.display = 'block';
  noSearchMatchesEl.style.display = 'none';

  list.render(createAddonGroups(
    [
      { title: 'Not Installed Yet', items: notInstalled, isInstalled: false },
      { title: 'Already Installed', items: alreadyInstalled, isInstalled: true },
    ],
    (a, i, group) => createAddonRow(a, i, group.isInstalled, shorten)
  ));

  const notes = [];
  if (notInstalled.length === 0 && alreadyInstalled.length > 0) {
    notes.push('You already have every add-on from this export installed.');
  } else if (notInstalled.length > 0 && alreadyInstalled.length > 0) {
    const newWord = notInstalled.length === 1 ? 'add-on' : 'add-ons';
    const instWord = alreadyInstalled.length === 1 ? 'add-on' : 'add-ons';
    notes.push(`${notInstalled.length} new ${newWord} pre-selected, ${alreadyInstalled.length} already-installed ${instWord} shown for reference.`);
  }
  notes.push(...loadWarnings);
  const noteFragment = document.createDocumentFragment();
  notes.forEach((n) => {
    const span = document.createElement('span');
    span.className = 'compare-note-line';
    span.textContent = n;
    noteFragment.appendChild(span);
  });
  compareNoteEl.replaceChildren(noteFragment);

  list.updateSelectionCount();
}

// Bumped each time a new file load starts, so an older load in flight
// can tell it's stale and not overwrite a newer one.
let loadGeneration = 0;

const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
// The formats the Exporter writes; a .zip of them (the Exporter's own when
// several formats are ticked) is accepted too and its files read the same way.
const IMPORT_TEXT_EXTENSIONS = new Set(['html', 'htm', 'json', 'csv', 'txt']);
const ACCEPTED_IMPORT_EXTENSIONS = new Set([...IMPORT_TEXT_EXTENSIONS, 'zip']);
// The formats a selection can hold, most exact first. Files that describe the
// same export are grouped, and the group takes its data from the first of them
// in this order (see groupExports).
const ZIP_READ_ORDER = ['json', 'html', 'htm', 'csv', 'txt'];

// Checked before a file is ever read - lets a wrong-typed or oversized
// file get a clear, immediate reason instead of failing deep inside
// parsing (any unrecognised extension used to be silently parsed as
// HTML), or, for a very large file, reading the whole thing into memory
// for no reason.
function validateSelectedFile(file) {
  const ext = extensionOf(file.name);
  if (!ACCEPTED_IMPORT_EXTENSIONS.has(ext)) {
    return { ok: false, error: 'That file isn\'t a supported file type. Choose an .html, .json, .csv, .txt, or .zip export.' };
  }
  if (typeof file.size === 'number' && file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
    return { ok: false, error: `That file is too large (over ${Math.round(MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024))} MB) to be a real export.` };
  }
  return { ok: true };
}

// Reads one export's text by its file extension. Throws on text a reader
// cannot make sense of at all (e.g. malformed JSON) - callers catch that.
function parseImportText(ext, text) {
  if (ext === 'json') return parseJsonPayload(text);
  if (ext === 'csv') return parseCsvPayload(text);
  if (ext === 'txt') return parseTxtPayload(text);
  // Default to HTML (also handles .html and any unrecognised extension).
  // DOMParser never executes scripts in the parsed document, so this is
  // safe even for an untrusted file.
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const dataEl = doc.getElementById('addons-exporter-data');
  return parseAddonsPayload(dataEl ? dataEl.textContent : null);
}

// The distinct exports a selection holds, in the order to offer them. What
// counts as one export depends on where the files came from:
//   - a file chosen on its own, by its name without the extension, so the
//     formats of one export - a ticked .json and .csv, say - read as one entry.
//     Two files picked separately stay two even when they hold the same
//     add-ons: you may well have kept two snapshots of the same set, and the
//     merged "All add-ons" entry is there for the union.
//   - the files inside a .zip, by the set of add-on ids they list, since the
//     Exporter writes one export's formats into one .zip (see describeExport
//     for how the entry is then named).
// A file's own add-on ids are part of its key either way, so two files of the
// same name holding different add-ons never collapse into one and lose the
// other's. Data comes from the first entry in ZIP_READ_ORDER.
function groupExports(parsed) {
  const groups = new Map();
  for (const p of parsed) {
    const ids = [...new Set(p.addons.map((a) => a.id))].sort().join('\u0000');
    const key = extensionOf(p.file.name) === 'zip'
      ? `zip\u0000${ids}`
      : `file\u0000${baseNameOf(p.file.name)}\u0000${ids}`;
    const group = groups.get(key);
    if (group) group.entries.push(p);
    else groups.set(key, { entries: [p], addons: p.addons });
  }
  const list = [...groups.values()];

  // How many distinct exports each chosen file turned out to describe. A .zip
  // that describes exactly one is named by the .zip itself, however many
  // formats it holds; a .zip holding several names each export after its own
  // files, since the .zip alone could not tell them apart.
  const exportsPerFile = new Map();
  for (const group of list) {
    for (const file of new Set(group.entries.map((e) => e.file))) {
      exportsPerFile.set(file, (exportsPerFile.get(file) || 0) + 1);
    }
  }
  return list.map((group) => ({ names: describeExport(group.entries, exportsPerFile), addons: group.addons }));
}

// What to call one export in the picker: where it came from. A file chosen on
// its own keeps its whole name. Files sharing a name but not a format - the
// ticked .json and .csv of one export, say - become one label with their
// extensions in brackets after it ("Add-ons (.json, .csv)"). A .zip holding
// just this one export is named by the .zip itself, however many formats are
// inside it; a .zip holding several names each export after the file inside it.
function describeExport(entries, exportsPerFile) {
  // Keyed by the name without its extension, so the formats of one export
  // share a label. A .zip that stands for the export keeps an empty list.
  const labels = new Map();
  for (const entry of entries) {
    const container = entry.file;
    const zipStandsForIt = extensionOf(container.name) === 'zip' && exportsPerFile.get(container) === 1;
    const key = zipStandsForIt ? container.name : baseNameOf(entry.name);
    const names = labels.get(key);
    if (names) {
      if (!zipStandsForIt) names.push(entry.name);
    } else {
      labels.set(key, zipStandsForIt ? [] : [entry.name]);
    }
  }
  return [...labels].map(([key, names]) => {
    if (names.length === 0) return key; // the .zip's own name
    const exts = names.map(extensionOf).filter(Boolean).map((e) => `.${e}`);
    return names.length > 1 && exts.length > 0 ? `${key} (${exts.join(', ')})` : names[0];
  });
}

// Every add-on from every export, once per id - what the picker's "All" entry
// shows. The first export to name an id decides its row.
function mergeExports(exports) {
  const seen = new Set();
  const merged = [];
  for (const e of exports) {
    for (const a of e.addons) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      merged.push(a);
    }
  }
  return merged;
}

// The closed box echoes the choice; the open panel is a real list of rows (no
// native <select>, whose popup can't take the add-on list's hover), one row per
// entry. "All add-ons" comes first and is the default, then each distinct
// export, the one holding the most add-ons first.
function setUpExportPicker(exports) {
  if (exports.length < 2) {
    exportPickRowEl.style.display = 'none';
    exportPickListEl.replaceChildren();
    exportPickLabels = new Map();
    exportSelection = 0;
    closeExportPicker();
    return;
  }
  const ordered = exports
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.addons.length - a.e.addons.length);
  const entries = [
    { value: 'all', text: `All add-ons (${mergeExports(exports).length})` },
    ...ordered.map(({ e, i }) => ({ value: String(i), text: `${e.names.join(', ')} (${e.addons.length})` })),
  ];
  exportPickLabels = new Map(entries.map((entry) => [entry.value, entry.text]));
  exportPickListEl.replaceChildren(...entries.map((entry) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'export-pick-option';
    option.dataset.value = entry.value;
    option.setAttribute('role', 'option');
    option.textContent = entry.text;
    option.addEventListener('click', () => chooseExport(entry.value));
    return option;
  }));
  setExportSelection('all');
  closeExportPicker();
  exportPickRowEl.style.display = 'block';
}

// Paints the closed box and marks the chosen row, without touching the list.
function setExportSelection(selection) {
  exportSelection = selection;
  exportPickEl.textContent = exportPickLabels.get(String(selection)) || '';
  for (const option of exportPickListEl.querySelectorAll('.export-pick-option')) {
    option.setAttribute('aria-selected', String(option.dataset.value === String(selection)));
  }
}

// A picked row: remember the choice, close the panel, redraw the list.
function chooseExport(value) {
  setExportSelection(value === 'all' ? 'all' : Number(value));
  closeExportPicker();
  if (loadedExports.length > 0) renderExports(exportSelection);
  exportPickEl.focus();
}

function openExportPicker() {
  exportPickListEl.style.display = 'block';
  exportPickEl.setAttribute('aria-expanded', 'true');
}

function closeExportPicker() {
  exportPickListEl.style.display = 'none';
  exportPickEl.setAttribute('aria-expanded', 'false');
}

// Draws the list for one picker entry: an export's index, or 'all'. With the
// picker hidden (a single export) the selection is 0.
function renderExports(selection) {
  const addons = selection === 'all' ? mergeExports(loadedExports) : loadedExports[selection].addons;
  renderAddonList(addons, loadedInstalled, loadedShorten);
}

// That .zip held nothing the Importer can read.
const noExportInZip = () => ({ ok: false, error: "That .zip doesn't contain an Add-ons Exporter file (.html, .json, .csv, or .txt)." });

// Reads the exports out of one chosen file: a plain export file is one of
// them, a .zip is every export file inside it. Files inside a .zip that are not
// Add-ons Exporter exports are ignored silently. A .zip that holds nothing the
// Importer can read reports that, rather than one entry's own error - which is
// what a single chosen .zip has always said. Each entry remembers the file it
// came from, which is what names its export in the picker (describeExport).
async function parseChosenFile(file) {
  const ext = extensionOf(file.name);
  if (ext !== 'zip') {
    const result = parseImportText(ext, await file.text());
    if (!result.ok) return result;
    return { ok: true, parsed: [{ name: file.name, ext, addons: result.addons, file }] };
  }

  const buffer = await file.arrayBuffer();
  const zip = await readZipEntries(new Uint8Array(buffer), { extensions: IMPORT_TEXT_EXTENSIONS, maxEntryBytes: MAX_IMPORT_FILE_SIZE_BYTES });
  if (!zip.ok) return zip;
  const entries = zip.entries
    .map((e, i) => ({ ...e, ext: extensionOf(e.name), i }))
    .sort((a, b) => ZIP_READ_ORDER.indexOf(a.ext) - ZIP_READ_ORDER.indexOf(b.ext) || a.i - b.i);
  if (entries.length === 0) return noExportInZip();
  const parsed = [];
  for (const entry of entries) {
    let result;
    try {
      result = parseImportText(entry.ext, entry.text);
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (result.ok) parsed.push({ name: entry.name, ext: entry.ext, addons: result.addons, file });
  }
  if (parsed.length === 0) return noExportInZip();
  return { ok: true, parsed };
}

// Reads one or more chosen files into the exports they hold together. Files
// listing the same set of add-on ids describe the same export whichever file
// (or .zip entry) they came from, so a loose file and a .zip's contents combine
// just as two loose files do. `skipped` is what had to be left out before
// reading (the wrong type, or oversized); anything that fails later is added to
// it, so the page can name every file it could not use.
async function loadFiles(files, skipped) {
  const myGeneration = ++loadGeneration;
  clearAddonList();
  setStatus(files.length === 1 ? 'Reading file...' : `Reading ${files.length} files...`);
  try {
    const parsed = [];
    const skippedFiles = skipped.slice();
    for (const file of files) {
      let result;
      try {
        result = await parseChosenFile(file);
      } catch (err) {
        result = { ok: false, error: 'Error reading file: ' + err.message };
      }
      if (myGeneration !== loadGeneration) return;
      if (!result.ok) {
        skippedFiles.push({ name: file.name, error: result.error });
        continue;
      }
      parsed.push(...result.parsed);
    }

    // Nothing readable at all: the first reason stands alone, exactly as it
    // would if that file had been the only one chosen.
    if (parsed.length === 0) {
      setStatus(skippedFiles.length > 0 ? skippedFiles[0].error : 'Nothing to import from those files.');
      return;
    }

    // The most exact format supplies each export's data (see groupExports), so
    // order every entry by format before grouping, whichever file it came from.
    // The sort is stable, so entries of one format keep the order they arrived.
    parsed.sort((a, b) => ZIP_READ_ORDER.indexOf(a.ext) - ZIP_READ_ORDER.indexOf(b.ext));

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

    loadedExports = groupExports(parsed);
    loadedInstalled = installed;
    loadedShorten = settings.shortenNames !== 'off';
    loadWarnings = skippedFiles.map((s) => `${s.name}: ${s.error}`);
    setUpExportPicker(loadedExports);
    renderExports(exportSelection);
  } catch (err) {
    if (myGeneration !== loadGeneration) return;
    setStatus('Error reading file: ' + err.message);
  }
}

// The files a picker or a drop handed over. Everything readable is loaded
// together, and a file that cannot be read at all is named under the list
// rather than silently dropped - one bad file never hides the good ones.
function setSelectedFiles(files) {
  if (files.length === 0) {
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
    return;
  }

  const accepted = [];
  const rejected = [];
  for (const file of files) {
    const validation = validateSelectedFile(file);
    if (validation.ok) accepted.push(file);
    else rejected.push({ name: file.name, error: validation.error });
  }

  // Not one readable file was chosen: say why, the way a single rejected file
  // always has, and leave the page exactly as it was.
  if (accepted.length === 0) {
    setStatus(rejected[0].error);
    return;
  }

  // The chip describes what is loading: a single file by name, and the count
  // alone once several were chosen - the picker below already names every
  // export those files hold, and a file that had to be left out is named under
  // the list, so the chip only ever covers files the list does.
  fileNameEl.textContent = accepted.length === 1
    ? accepted[0].name
    : `${accepted.length} files`;
  fileNameRow.style.display = 'flex';
  fileNameRow.style.alignItems = 'center';
  fileNameRow.style.justifyContent = 'center';
  fileNameRow.style.gap = '8px';
  chooseFileBtn.style.display = 'none';
  loadFiles(accepted, rejected);
}

// One file, or none (a removal) - the single-file form of setSelectedFiles.
function setSelectedFile(file) {
  setSelectedFiles(file ? [file] : []);
}

// Removing the file plays out the page's opening in reverse: what is lowest
// goes first (the list, the Select all row, the search box, the export picker,
// the note, the file name), each sliding left and fading, one after another -
// then the file is really removed and "Choose file" pops back in. Until it has
// finished the page keeps its state, but a load still in flight is cancelled at
// once so it cannot draw anything in the middle of the exit. Without animation
// support, or for reduced motion, the file is simply removed at once.
let removingFile = false;

function removalTargets() {
  return [checklistBoxEl, listControls, searchInput, exportPickRowEl, compareNoteEl, fileNameRow].filter((el) => {
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
  setSelectedFiles(Array.from(fileInput.files || []));
});

// A .zip can hold more than one distinct export; this picker chooses which one
// (or all of them) the list shows. The closed box opens the row panel; picking
// a row is what redraws the list (see chooseExport).
exportPickEl.addEventListener('click', () => {
  if (exportPickListEl.style.display === 'block') closeExportPicker();
  else openExportPicker();
});

exportPickRowEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeExportPicker();
    exportPickEl.focus();
  }
});

// A click anywhere outside the picker closes the panel.
document.addEventListener('click', (e) => {
  const target = e.target;
  if (target && typeof target.closest === 'function' && target.closest('#exportPickRow')) return;
  closeExportPicker();
});

// Dropping one or more files onto the picker works the same as "Choose file".
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
  // A drop carrying no files (dragged text, say) leaves the current selection
  // alone rather than clearing it.
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
  if (files.length > 0) setSelectedFiles(files);
});

// Without this, dropping a file anywhere else on the page (outside the
// picker) falls through to the browser's default behavior - navigating
// to and displaying the file directly instead of importing it.
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => { e.preventDefault(); });

function pluralTabs(n) {
  return `${n} tab${n === 1 ? '' : 's'}`;
}

openSelectedBtn.addEventListener('click', async () => {
  const selected = Array.from(list.checkboxes())
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
      setStatus(`Opened ${pluralTabs(0)}, ${failed} failed to open`);
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
        const reply = await browser.runtime.sendMessage({ type: 'openTabs', urls: rest });
        // background.js says how many it queued (it caps a batch); anything it
        // did not take is counted as not opened, not as opened.
        const queued = reply && Number.isInteger(reply.queued) ? Math.min(reply.queued, rest.length) : rest.length;
        opened += queued;
        failed += rest.length - queued;
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

// The popup brings this tab to the front - and replays its opening - instead
// of opening a second Importer. The .zip export picker closes and any search
// left in the box is cleared with it, but the chosen file, the list it drew and
// everything ticked in that list are left exactly as they were.
answerWhereIsPage('import', () => {
  closeExportPicker();
  list.clearSearch();
});
