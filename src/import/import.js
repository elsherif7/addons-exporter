const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// lower-case extension without the dot ("a.JSON" -> "json")
function extensionOf(name) {
  return (name.split('.').pop() || '').toLowerCase();
}

// "a.json" -> "a". A name with no dot, or starting with one, is left alone.
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

// Rendered order (Not Installed Yet, then Already Installed). Each checkbox's
// data-idx indexes into it.
let displayItems = [];

// One entry per distinct export in the chosen files, plus what the list needs
// to redraw when the picker's choice changes.
let loadedExports = [];
let loadedInstalled = [];
let loadedShorten = true;

// One line per file a load left out, shown under the list, so a picked file
// never disappears silently.
let loadWarnings = [];

// Which picker entry the list shows: 'all' or an export's index. The labels
// are kept so the closed box can echo the choice without reading the DOM.
let exportSelection = 0;
let exportPickLabels = new Map();

function setStatus(msg) {
  statusEl.textContent = msg;
}

// The shared add-on list (addon-list.js). Select all skips disabled
// (unsafe-link) rows, and a search shows the list again as display: block.
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

// The shared row plus the import-only parts: the page link, the match label and
// a warning for an unsafe link (that row is disabled and skipped).
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
    lnk.textContent = linkLabel(a.link);
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

  // The containers have to be shown before render(), which applies an active
  // search itself. Doing it after would undo the filtering.
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

// Bumped when a load starts, so an older load still running knows it's stale.
let loadGeneration = 0;

const MAX_IMPORT_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
// The formats the Exporter writes. A .zip of them is accepted too.
const IMPORT_TEXT_EXTENSIONS = new Set(['html', 'htm', 'json', 'csv', 'txt']);
const ACCEPTED_IMPORT_EXTENSIONS = new Set([...IMPORT_TEXT_EXTENSIONS, 'zip']);
// Most exact first. Files describing the same export are grouped and the group
// takes its data from the first of them (see groupExports).
const ZIP_READ_ORDER = ['json', 'html', 'htm', 'csv', 'txt'];

// Checked before reading, so a wrong-typed or oversized file gets a clear
// reason up front instead of failing inside parsing or filling memory.
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

// Throws on text a reader can't parse at all (e.g. malformed JSON).
function parseImportText(ext, text) {
  if (ext === 'json') return parseJsonPayload(text);
  if (ext === 'csv') return parseCsvPayload(text);
  if (ext === 'txt') return parseTxtPayload(text);
  // HTML is the default. DOMParser never runs scripts, so an untrusted file is safe.
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const dataEl = doc.getElementById('addons-exporter-data');
  return parseAddonsPayload(dataEl ? dataEl.textContent : null);
}

// The distinct exports a selection holds. What counts as one depends on the
// source:
//   - A file chosen on its own: its name without the extension, so a ticked
//     .json and .csv of one export read as one entry. Two files picked
//     separately stay two even with the same add-ons (they may be two
//     snapshots; the "All add-ons" entry covers the union).
//   - Files inside a .zip: the set of add-on ids, since the Exporter writes
//     one export's formats into one .zip (describeExport names the entry).
// The ids are part of the key either way, so two same-named files with
// different add-ons never collapse. Data comes from the first entry in
// ZIP_READ_ORDER.
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

  // How many exports each file describes. A .zip with exactly one is named
  // after itself; one with several names each after its own files.
  const exportsPerFile = new Map();
  for (const group of list) {
    for (const file of new Set(group.entries.map((e) => e.file))) {
      exportsPerFile.set(file, (exportsPerFile.get(file) || 0) + 1);
    }
  }
  return list.map((group) => ({ names: describeExport(group.entries, exportsPerFile), addons: group.addons }));
}

// What to call one export in the picker. A file chosen on its own keeps its
// name. Files sharing a name but not a format become one label with the
// extensions in brackets ("Add-ons (.json, .csv)"). A .zip holding just one
// export is named by the .zip; one holding several names each after its file.
function describeExport(entries, exportsPerFile) {
  // keyed by name without extension so one export's formats share a label;
  // a .zip that stands for the export keeps an empty list
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

// Every add-on once per id, for the picker's "All" entry. The first export to
// name an id decides its row.
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

// The open panel is a list of rows, not a native <select>, whose popup can't
// take the add-on list's hover. "All add-ons" is first and the default, then
// the exports, biggest first.
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

// doesn't touch the list
function setExportSelection(selection) {
  exportSelection = selection;
  exportPickEl.textContent = exportPickLabels.get(String(selection)) || '';
  for (const option of exportPickListEl.querySelectorAll('.export-pick-option')) {
    option.setAttribute('aria-selected', String(option.dataset.value === String(selection)));
  }
}

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

// `selection` is an export's index or 'all'; 0 when the picker is hidden.
function renderExports(selection) {
  const addons = selection === 'all' ? mergeExports(loadedExports) : loadedExports[selection].addons;
  renderAddonList(addons, loadedInstalled, loadedShorten);
}

const noExportInZip = () => ({ ok: false, error: "That .zip doesn't contain an Add-ons Exporter file (.html, .json, .csv, or .txt)." });

// Reads the exports out of one chosen file: a plain file is one, a .zip is
// every export file inside it. Other files in a .zip are ignored silently. A
// .zip with nothing readable says so, rather than showing one entry's own
// error. Each entry remembers its file, which names it in the picker.
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

// Loads one or more files. Files listing the same add-on ids are one export
// whichever file or .zip entry they came from. `skipped` is what was left out
// before reading (wrong type, too big); later failures are added to it, so the
// page can name every file it couldn't use.
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

    // nothing readable: the first reason stands alone
    if (parsed.length === 0) {
      setStatus(skippedFiles.length > 0 ? skippedFiles[0].error : 'Nothing to import from those files.');
      return;
    }

    // the most exact format supplies each export's data (see groupExports);
    // the sort is stable
    parsed.sort((a, b) => ZIP_READ_ORDER.indexOf(a.ext) - ZIP_READ_ORDER.indexOf(b.ext));

    // if this fails, treat everything as not installed rather than block
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

// Everything readable is loaded together; a file that can't be read is named
// under the list, so one bad file never hides the good ones.
function setSelectedFiles(files) {
  if (files.length === 0) {
    // invalidate a load in flight, or it would draw right after the clear
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

  // nothing readable: say why and leave the page as it was (invalidating a
  // load in flight, as above)
  if (accepted.length === 0) {
    loadGeneration++;
    setStatus(rejected[0].error);
    return;
  }

  // one file by name, just the count for several (the picker names the exports)
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

function setSelectedFile(file) {
  setSelectedFiles(file ? [file] : []);
}

// Removing the file plays the opening in reverse: the lowest part goes first,
// each sliding left and fading, then the file is really removed and "Choose
// file" pops back in. The page keeps its state until it's done, but a load in
// flight is cancelled at once so it can't draw mid-exit. Without animation
// support, or for reduced motion, it's removed immediately.
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
  const myGeneration = ++loadGeneration; // cancels a load in flight
  const animations = targets.map((el, i) => animateOut(el, i * 80));
  try {
    await Promise.all(animations.map((a) => a.finished));
  } catch {
    /* cancelled: remove the file anyway */
  }
  removingFile = false;
  const replaced = myGeneration !== loadGeneration; // another file was chosen meanwhile, keep it

  if (!replaced) setSelectedFile(null);
  // the held end frames must never linger on a new file's list
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

document.addEventListener('click', (e) => {
  const target = e.target;
  if (target && typeof target.closest === 'function' && target.closest('#exportPickRow')) return;
  closeExportPicker();
});

// dropping files on the picker works like "Choose file"
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
  // a drop with no files (dragged text) leaves the selection alone
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
  if (files.length > 0) setSelectedFiles(files);
});

// otherwise a file dropped outside the picker makes the browser navigate to it
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
    setStatus('Select at least one add-on to open.');
    return;
  }

  openSelectedBtn.disabled = true;
  setStatus(`Opening ${pluralTabs(selected.length)}...`);

  try {
    // the real gate: only http(s) links reach tabs.create, whatever the checkbox says
    const links = selected.map((item) => item.link);
    const safeLinks = links.filter((link) => isSafeUrl(link));
    let failed = links.length - safeLinks.length;

    // open the first one here (the first that actually opens)
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

    // nothing opened: stay here so the user sees the failure
    if (firstIdx === -1) {
      setStatus(`Opened 0 tabs, ${failed} failed to open.`);
      return;
    }

    // This page is replaced by the confirmation page and can't keep a loop
    // running, so the rest go to background.js, which opens them in turn.
    const rest = safeLinks.slice(firstIdx + 1);
    let opened = 1;
    if (rest.length > 0) {
      try {
        const reply = await browser.runtime.sendMessage({ type: 'openTabs', urls: rest });
        // background.js caps a batch; what it didn't take counts as failed
        const queued = reply && Number.isInteger(reply.queued) ? Math.min(reply.queued, rest.length) : rest.length;
        opened += queued;
        failed += rest.length - queued;
      } catch {
        // background unreachable: open them from here
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
      ? `Opened ${pluralTabs(opened)}, ${failed} failed to open.`
      : `Opened ${pluralTabs(opened)}.`);
    await goToConfirmation(failed > 0 ? `from=import&failed=${failed}` : 'from=import');
  } finally {
    openSelectedBtn.disabled = false;
  }
});

// The popup focuses this tab instead of opening a second one. The picker
// closes and a leftover search is cleared, but the chosen file, the list and
// the ticked add-ons stay as they were.
answerWhereIsPage('import', () => {
  closeExportPicker();
  list.clearSearch();
});
