const listEl = document.getElementById('addonList');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const exportBtn = document.getElementById('exportSelectedBtn');
const statusEl = document.getElementById('status');
const selectionCountEl = document.getElementById('selectionCount');
const searchInput = document.getElementById('searchInput');
const noSearchMatchesEl = document.getElementById('noSearchMatches');
const exportDescEl = document.getElementById('exportDesc');

// Filled by renderList(), so asynchronous AMO link lookups can find the row
// they belong to without a selector built from an add-on id.
const addonRows = new Map();
const addonLinkResults = new Map();
let addonLinksPromise = null;
// A refresh replaces every row. These tokens make sure a slow, older response
// can't paint over the newer list (or a removed add-on's link come back).
let addonLinksGeneration = 0;
let refreshGeneration = 0;
let hasLoadedAddons = false;
let lastListSignature = null;
let exportInProgress = false;

// The status after a finished export. It says how many links are exact AMO
// matches and how many are fallbacks, and reports lookup failures separately
// (doExport()'s stats), so an AMO outage doesn't read like a normal export.
function buildExportSuccessStatus(fmt, stats) {
  // one format or several (several are saved together in one .zip)
  const formats = resolveExportFormats(fmt);
  let msg = formats.length === 1
    ? `Export complete. Your ${formatLabelsText(formats)} has been saved to the folder you picked.`
    : `Export complete. Your ${formatLabelsText(formats)} have been saved together in one .zip file in the folder you picked.`;
  if (stats) {
    const total = stats.total || 0;
    const failures = stats.lookupFailures || 0;
    const skipped = stats.lookupsSkipped || 0;
    const hasBreakdown = 'amoExact' in stats;
    const amoFound = hasBreakdown ? (stats.amoExact || 0) + (stats.amoSearch || 0) : 0;
    const fallback = hasBreakdown ? (stats.homepage || 0) + (stats.searchFallback || 0) : 0;

    if (total > 0) {
      if (failures === 0 && skipped === 0 && hasBreakdown) {
        if (fallback === 0) {
          msg += ` All ${total} add\u2011on${total === 1 ? '' : 's'} found on AMO.`;
        } else if (amoFound === 0) {
          msg += ` ${fallback} add\u2011on${fallback === 1 ? '' : 's'} got a fallback link (AMO had no match).`;
        } else {
          msg += ` ${amoFound} found on AMO, ${fallback} got a fallback link.`;
        }
      } else {
        if (failures > 0) {
          msg += ` ${failures} of ${total} add\u2011on${total === 1 ? '' : 's'} couldn\u2019t be looked up on AMO and got a fallback link instead.`;
        }
        if (skipped > 0) {
          msg += ` ${skipped} add\u2011on${skipped === 1 ? '' : 's'} skipped AMO (deadline reached) and got a fallback link.`;
        }
      }
    }
  }
  return msg;
}

async function updateExportDesc() {
  const { exportFormats: formats } = await loadSettings();
  const article = indefiniteArticleFor(formatLabel(formats[0]));

  exportDescEl.textContent = '';
  const addonsStrong = document.createElement('strong');
  addonsStrong.textContent = 'Add-ons';
  const exportStrong = document.createElement('strong');
  exportStrong.textContent = 'Export Selected';
  exportDescEl.append(
    'Select the ', addonsStrong, ' you want to export, then click ', exportStrong,
    ` to create ${article} `
  );
  appendFormatLabels(exportDescEl, formats);
  exportDescEl.append(
    ' you can use to reinstall them later on any Firefox\u2011based\u00a0browser.'
  );
}

updateExportDesc();

// the format can be changed from Settings in another tab
onSettingsChanged((changed) => {
  if (changed.includes('exportFormats')) updateExportDesc();
});

function setStatus(msg) {
  statusEl.textContent = msg;
}

const list = createAddonList({
  listEl, countEl: selectionCountEl, actionBtn: exportBtn,
  selectAllBtn, deselectAllBtn, searchInput, noMatchesEl: noSearchMatchesEl,
});

function addonLinkTarget(a, link) {
  return typeof link === 'string' && isSafeUrl(link) ? link : amoSearchUrl(a.name);
}

// Puts a resolved link and its match label on an existing row. The report and
// Importer show the same pair, so an exact AMO page gets no label while a
// homepage or a search result says which one it is.
function setAddonLink(row, a, link, linkType) {
  const anchor = row.querySelector('a.match-label');
  if (!anchor) return;

  const target = addonLinkTarget(a, link);
  anchor.href = target;
  anchor.textContent = linkLabel(target);
  delete anchor.dataset.pending;
  addonLinkResults.set(a.id, { link: target, linkType });

  const label = row.querySelector('label');
  if (!label) return;
  const text = LINK_TYPE_LABELS[linkType] || '';
  let kind = Array.from(label.querySelectorAll('span'))
    .find((span) => span.dataset.linkKind === '1');
  if (!text) {
    if (kind) kind.remove();
    return;
  }
  if (!kind) {
    kind = document.createElement('span');
    kind.dataset.linkKind = '1';
    label.append(' ', kind);
  }
  kind.className = `match-label${UNCERTAIN_LINK_TYPES.has(linkType) ? ' match-uncertain' : ''}`;
  kind.textContent = text;
}

// The shared row plus the page link. The row starts with a name-search
// fallback so the list is usable at once; loadAddonLinks() replaces it with
// the same resolved AMO page the report and Importer use.
function createAddonRow(a, index, shorten, checked = true) {
  const { row, label } = createAddonRowBase(a, index, {
    idPrefix: 'cb', dataset: { id: a.id }, checked, shorten,
  });
  row.dataset.addonId = a.id;

  const resolved = typeof a.link === 'string' && isSafeUrl(a.link);
  const amoLink = document.createElement('a');
  amoLink.className = 'match-label';
  amoLink.href = addonLinkTarget(a, a.link);
  amoLink.target = '_blank';
  amoLink.rel = 'noopener';
  amoLink.textContent = linkLabel(amoLink.href);
  if (!resolved) {
    amoLink.dataset.pending = '1';
    amoLink.addEventListener('click', (e) => {
      // Leave middle-click, modified clicks and "Open link in new tab" alone.
      // A plain click waits briefly for the lookup already in flight, so an
      // immediate click opens the add-on page rather than a search.
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      openPendingAddonLink(a, amoLink);
    });
  }

  // A sibling of the label, not a child: inside a <label for> the checkbox's
  // accessible name would swallow the link text.
  row.append(amoLink);
  addonRows.set(a.id, row);

  if (resolved) setAddonLink(row, a, a.link, a.linkType);
  return row;
}

function settleAfter(ms, promise) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function openPendingAddonLink(a, anchor) {
  const result = addonLinksPromise
    ? await settleAfter(4000, addonLinksPromise.then(() => addonLinkResults.get(a.id) || null))
    : null;
  const row = addonRows.get(a.id);
  if (result && row) setAddonLink(row, a, result.link, result.linkType);
  try {
    await browser.tabs.create({ url: result ? result.link : anchor.href });
  } catch {
    /* the row's link still works if opening the tab fails */
  }
}

// Resolves every row's link in the background. Until this finishes each row
// keeps its search fallback, so the page never looks stuck on a slow network.
function loadAddonLinks(addons) {
  if (addons.length === 0) return;
  const generation = ++addonLinksGeneration;
  addonLinksPromise = browser.runtime.sendMessage({
    type: 'resolveAddonLinks',
    ids: addons.map((a) => a.id),
  }).then((links) => {
    if (generation !== addonLinksGeneration || !Array.isArray(links)) return;
    const addonsById = new Map(addons.map((a) => [a.id, a]));
    for (const entry of links) {
      if (!entry) continue;
      const addon = addonsById.get(entry.id);
      const row = addonRows.get(entry.id);
      if (addon && row) setAddonLink(row, addon, entry.link, entry.linkType);
    }
  }).catch(() => {
    // Keep the name-search fallbacks already in the rows.
  });
}

// A refresh redraws the list. Add-ons that were unticked stay unticked (by
// id); an add-on that has just appeared starts ticked, like a fresh page.
function renderList(addons, shorten, { preserveSelection = false } = {}) {
  const previouslyUnchecked = new Set();
  if (preserveSelection) {
    for (const cb of listEl.querySelectorAll('input[type="checkbox"]')) {
      if (!cb.checked) previouslyUnchecked.add(cb.dataset.id);
    }
  }

  addonRows.clear();
  addonLinkResults.clear();
  addonLinksPromise = null;
  addonLinksGeneration++;

  if (addons.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'placeholder-text';
    placeholder.textContent = 'No add-ons found to export.';
    listEl.replaceChildren(placeholder);
    searchInput.value = '';
    searchInput.style.display = 'none';
    noSearchMatchesEl.style.display = 'none';
    list.updateSelectionCount();
    return;
  }

  const { enabled, disabled } = groupForReading(addons);
  list.render(createAddonGroups(
    [{ title: 'Enabled', items: enabled }, { title: 'Disabled', items: disabled }],
    (a, index) => createAddonRow(a, index, shorten, !previouslyUnchecked.has(a.id))
  ));
  searchInput.style.display = 'block';
  list.updateSelectionCount();
}

// Lets a refresh leave an unchanged list (and the scroll position, focus and
// ticks in it) alone. Only what a row shows is compared.
function addonListSignature(addons, shorten) {
  return JSON.stringify([
    shorten,
    addons.map((a) => [a.id, a.name, a.version, a.enabled, a.type]),
  ]);
}

// Re-reads installed add-ons and settings. The Exporter stays open while the
// user installs, removes, enables or disables add-ons, so the list has to
// follow those changes instead of keeping the snapshot it started with.
async function refreshAddons({ preserveSelection = true } = {}) {
  const generation = ++refreshGeneration;
  let addons;
  let settings;
  try {
    [addons, settings] = await Promise.all([
      browser.runtime.sendMessage({ type: 'listAddons' }),
      loadSettings(),
    ]);
    if (!Array.isArray(addons)) {
      throw new Error('unexpected response from the extension');
    }
  } catch (e) {
    if (generation !== refreshGeneration || hasLoadedAddons) return;
    const p = document.createElement('p');
    p.className = 'placeholder-text error';
    p.textContent = `Could not load add-ons: ${e.message}`;
    listEl.replaceChildren(p);
    return;
  }
  if (generation !== refreshGeneration) return;

  const shorten = settings.shortenNames !== 'off';
  const signature = addonListSignature(addons, shorten);
  if (hasLoadedAddons && signature === lastListSignature) return;

  hasLoadedAddons = true;
  lastListSignature = signature;
  renderList(addons, shorten, { preserveSelection });
  // updateSelectionCount() inside renderList enables the button when rows are
  // ticked. Don't let a refresh in the middle of an export unlock it.
  if (exportInProgress) exportBtn.disabled = true;
  loadAddonLinks(addons);
}

// The page itself can listen for changes, so an already-open Exporter updates
// at once. visibilitychange is the fallback for a tab that was frozen while
// hidden; it also covers switching back without using the popup.
function watchAddonChanges() {
  if (typeof browser !== 'undefined' && browser.management) {
    const refresh = () => { refreshAddons(); };
    for (const name of ['onInstalled', 'onUninstalled', 'onEnabled', 'onDisabled']) {
      const event = browser.management[name];
      if (event && typeof event.addListener === 'function') event.addListener(refresh);
    }
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshAddons();
    });
  }
}

watchAddonChanges();
refreshAddons({ preserveSelection: false });

exportBtn.addEventListener('click', async () => {
  const ids = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.dataset.id);

  exportBtn.disabled = true;
  exportInProgress = true;
  setStatus('Exporting your add-ons, please wait...');
  try {
    const result = await browser.runtime.sendMessage({ type: 'export', ids });

    setStatus(buildExportSuccessStatus(result.formats, result.stats));
    await goToConfirmation(`from=export&format=${result.formats.join(',')}${result.zipped ? '&zip=1' : ''}`);
  } catch (e) {
    setStatus('Error: ' + e.message);
  } finally {
    exportInProgress = false;
    exportBtn.disabled = false;
  }
});

// The popup brings this tab to the front instead of opening a second one. A
// leftover search is cleared and the add-ons are re-read so the page looks and
// behaves like a freshly opened one.
answerWhereIsPage('export', () => {
  list.clearSearch();
  refreshAddons();
});

browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'exportProgress') {
    setStatus(`Resolved ${message.done} of ${message.total} add-ons...`);
  }
});
