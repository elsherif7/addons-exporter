const listEl = document.getElementById('addonList');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const exportBtn = document.getElementById('exportSelectedBtn');
const statusEl = document.getElementById('status');
const selectionCountEl = document.getElementById('selectionCount');
const searchInput = document.getElementById('searchInput');
const noSearchMatchesEl = document.getElementById('noSearchMatches');
const exportDescEl = document.getElementById('exportDesc');

// Builds the status shown once a desktop export has actually finished.
// Mentions the AMO lookup breakdown so the user knows how many links are
// confirmed exact matches vs fallbacks, and flags lookup failures
// separately (see doExport()'s stats in background.js) so a real AMO
// outage doesn't look identical to a completely normal export.
function buildExportSuccessStatus(fmt, stats) {
  // fmt is one format or a list of them (several can be ticked in Settings;
  // several are saved together in one .zip).
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

// Updates the description paragraph to reflect the currently stored format.
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

// Keep the description in sync if the export format is changed from
// another tab (e.g. the settings page) while this one is still open.
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

// The Exporter's row: the shared parts, plus a link that searches AMO for the
// add-on (a guessed exact-id URL could 404 for a non-AMO add-on or a theme - a
// name search always lands somewhere useful instead).
function createAddonRow(a, index, shorten) {
  const { row, label } = createAddonRowBase(a, index, {
    idPrefix: 'cb', dataset: { id: a.id }, shorten,
  });

  const amoLink = document.createElement('a');
  amoLink.className = 'match-label';
  amoLink.href = `https://addons.mozilla.org/en-US/firefox/search/?q=${encodeURIComponent(a.name)}`;
  amoLink.target = '_blank';
  amoLink.rel = 'noopener';
  amoLink.textContent = 'AMO';

  // Kept out of the label, as a sibling rather than a child - inside it, a
  // <label for> makes the checkbox's accessible name absorb the link text
  // too (e.g. "uBlock Origin 1.0 Extension Search AMO"). Native
  // target=_blank/rel=noopener already opens it in a new tab, the row's
  // own click handler already skips anchor clicks, and
  // .match-label[href]:hover in shared.css already underlines on hover -
  // none of that needed its own JS here.
  row.append(amoLink);
  return row;
}

function renderList(addons, shorten) {
  if (addons.length === 0) {
    listEl.innerHTML = '<p class="placeholder-text">No add-ons found to export.</p>';
    list.updateSelectionCount();
    return;
  }

  const { enabled, disabled } = groupForReading(addons);
  list.render(createAddonGroups(
    [{ title: 'Enabled', items: enabled }, { title: 'Disabled', items: disabled }],
    (a, index) => createAddonRow(a, index, shorten)
  ));
  searchInput.style.display = 'block';
  list.updateSelectionCount();
}

(async () => {
  try {
    const [addons, settings] = await Promise.all([
      browser.runtime.sendMessage({ type: 'listAddons' }),
      loadSettings(),
    ]);
    if (!Array.isArray(addons)) {
      throw new Error('unexpected response from the extension');
    }
    const shorten = settings.shortenNames !== 'off';
    renderList(addons, shorten);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'placeholder-text error';
    p.textContent = `Could not load add-ons: ${e.message}`;
    listEl.replaceChildren(p);
  }
})();

exportBtn.addEventListener('click', async () => {
  const ids = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.dataset.id);

  exportBtn.disabled = true;
  setStatus('Exporting your add-ons, please wait...');
  try {
    const result = await browser.runtime.sendMessage({ type: 'export', ids });

    setStatus(buildExportSuccessStatus(result.formats, result.stats));
    await goToConfirmation(`from=export&format=${result.formats.join(',')}${result.zipped ? '&zip=1' : ''}`);
  } catch (e) {
    setStatus('Error: ' + e.message);
  } finally {
    exportBtn.disabled = false;
  }
});

// The popup brings this tab to the front instead of opening a second Exporter.
answerWhereIsPage('export');

// background.js broadcasts progress as each link is resolved.
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'exportProgress') {
    setStatus(`Resolved ${message.done} of ${message.total} add-ons...`);
  }
});
