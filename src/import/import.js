// TAB_OPEN_DELAY_MS (the stagger between opened tabs) lives in core.js.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A file name's extension, lower-case and without the dot ("a.JSON" -> "json").
// Used wherever a name has to be turned into a reader (validateSelectedFile,
// the .zip entries and loadFile).
function extensionOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
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

// What the chosen file held: one entry per distinct export (a plain file is
// one; a .zip can hold several), plus what the list needs to redraw when the
// picker's choice changes.
let loadedExports = [];
let loadedInstalled = [];
let loadedShorten = true;

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

  list.render(createAddonGroups(
    [
      { title: 'Not Installed Yet', items: notInstalled, isInstalled: false },
      { title: 'Already Installed', items: alreadyInstalled, isInstalled: true },
    ],
    (a, i, group) => createAddonRow(a, i, group.isInstalled, shorten)
  ));
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
// When a .zip holds several formats, the most exact one supplies an export's
// data (the rest are grouped with it; see groupZipExports).
const ZIP_READ_ORDER = ['json', 'html', 'htm', 'csv', 'txt'];

// Checked before a file is ever read - lets a wrong-typed or oversized
// file get a clear, immediate reason instead of failing deep inside
// parsing (any unrecognised extension used to be silently parsed as
// HTML), or, for a very large file, reading the whole thing into memory
// for no reason.
function validateSelectedFile(file) {
  const ext = extensionOf(file.name);
  if (!ACCEPTED_IMPORT_EXTENSIONS.has(ext)) {
    return { ok: false, error: `"${file.name}" isn't a supported file type. Choose an .html, .json, .csv, .txt, or .zip export.` };
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

// The distinct exports a chosen .zip holds, in the order to offer them. Files
// that list the same set of add-on ids describe the same export, so they become
// one entry - labelled with every file name it came from, and holding the data
// of the first of them in ZIP_READ_ORDER.
function groupZipExports(parsed) {
  const groups = new Map();
  for (const p of parsed) {
    const key = [...new Set(p.addons.map((a) => a.id))].sort().join('\u0000');
    const group = groups.get(key);
    if (group) group.names.push(p.name);
    else groups.set(key, { names: [p.name], addons: p.addons });
  }
  return [...groups.values()];
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

// Reads the add-ons out of a .zip. Files that are not Add-ons Exporter exports
// are ignored silently; the rest are grouped into distinct exports (see
// groupZipExports), which the picker then offers.
async function parseZipExport(buffer) {
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
    if (result.ok) parsed.push({ name: entry.name, addons: result.addons });
  }
  if (parsed.length === 0) return noExportInZip();
  return { ok: true, exports: groupZipExports(parsed) };
}

async function loadFile(file) {
  const myGeneration = ++loadGeneration;
  clearAddonList();
  setStatus('Reading file...');
  try {
    const ext = extensionOf(file.name);
    let exports;
    if (ext === 'zip') {
      const buffer = await file.arrayBuffer();
      if (myGeneration !== loadGeneration) return;
      const result = await parseZipExport(buffer);
      if (myGeneration !== loadGeneration) return;
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      exports = result.exports;
    } else {
      const text = await file.text();
      if (myGeneration !== loadGeneration) return;
      const result = parseImportText(ext, text);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      exports = [{ names: [file.name], addons: result.addons }];
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

    loadedExports = exports;
    loadedInstalled = installed;
    loadedShorten = settings.shortenNames !== 'off';
    setUpExportPicker(loadedExports);
    renderExports(exportSelection);
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
  setSelectedFile(fileInput.files[0] || null);
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
