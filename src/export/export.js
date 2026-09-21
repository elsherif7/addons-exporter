const listEl = document.getElementById('addonList');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const exportBtn = document.getElementById('exportSelectedBtn');
const statusEl = document.getElementById('status');
const selectionCountEl = document.getElementById('selectionCount');
const searchInput = document.getElementById('searchInput');
const noSearchMatchesEl = document.getElementById('noSearchMatches');
const exportDescEl = document.getElementById('exportDesc');

// Maps the stored exportFormat value to a human-readable file type label.
function formatLabel(fmt) {
  if (fmt === 'json') return 'JSON file';
  if (fmt === 'csv') return 'CSV file';
  return 'HTML report';
}

// Updates the description paragraph to reflect the currently stored format.
async function updateExportDesc() {
  let fmt = EXPORT_FORMAT_DEFAULT;
  try {
    const stored = await browser.storage.local.get(EXPORT_FORMAT_STORAGE_KEY);
    const val = stored[EXPORT_FORMAT_STORAGE_KEY];
    if (val === 'html' || val === 'json' || val === 'csv') fmt = val;
  } catch {
    // keep default
  }
  exportDescEl.innerHTML = `Select the <strong>Add-ons</strong> you want to export, then click <strong>Export Selected</strong> to create a ${formatLabel(fmt)} you can use to reinstall them later on any Firefox&#8209;based&nbsp;browser.`;
}

updateExportDesc();

function setStatus(msg) {
  statusEl.textContent = msg;
}

function checkboxes() {
  return listEl.querySelectorAll('input[type="checkbox"]');
}

function updateSelectionCount() {
  const boxes = checkboxes();
  const checked = listEl.querySelectorAll('input[type="checkbox"]:checked').length;
  selectionCountEl.textContent = boxes.length
    ? `${checked} of ${boxes.length} selected`
    : '';
  exportBtn.disabled = checked === 0;
}

// Builds one <div class="addon-row"> via DOM APIs (not innerHTML) so
// a.name/a.version never pass through HTML parsing - textContent and
// property assignment don't need escapeHtml the way a template string did.
function createAddonRow(a, i, shorten) {
  const row = document.createElement('div');
  row.className = 'addon-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `cb-${i}`;
  checkbox.dataset.id = a.id;
  checkbox.checked = true;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'addon-name';
  nameSpan.textContent = shorten ? shortName(a.name) : a.name;

  const versionSpan = document.createElement('span');
  versionSpan.className = 'addon-version';
  versionSpan.textContent = a.version;

  const typeSpan = document.createElement('span');
  typeSpan.className = 'match-label';
  typeSpan.textContent = a.type === 'theme' ? 'Theme' : 'Extension';

  const amoLink = document.createElement('a');
  amoLink.className = 'match-label';
  amoLink.href = `https://addons.mozilla.org/en-US/firefox/addon/${encodeURIComponent(a.id)}/`;
  amoLink.target = '_blank';
  amoLink.rel = 'noopener';
  amoLink.textContent = 'AMO';
  amoLink.style.cssText = 'color:var(--link-accent);text-decoration:none;margin-left:6px;';
  amoLink.addEventListener('mouseover', () => { amoLink.style.textDecoration = 'underline'; });
  amoLink.addEventListener('mouseout', () => { amoLink.style.textDecoration = 'none'; });
  amoLink.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); window.open(amoLink.href, '_blank', 'noopener'); });

  const label = document.createElement('label');
  label.htmlFor = `cb-${i}`;
  label.append(nameSpan, ' ', versionSpan, ' ', typeSpan, amoLink);

  row.append(checkbox, label);
  return row;
}

function appendGroup(fragment, title, items, nextIndex, shorten) {
  if (items.length === 0) return;
  const container = document.createElement('div');
  container.className = 'group-container';

  const heading = document.createElement('div');
  heading.className = 'group-heading';
  heading.textContent = `${title} (${items.length})`;

  const box = document.createElement('div');
  box.className = 'group-box';
  items.forEach((a) => {
    box.appendChild(createAddonRow(a, nextIndex(), shorten));
  });

  container.appendChild(heading);
  container.appendChild(box);
  fragment.appendChild(container);
}

function renderList(addons, shorten) {
  if (addons.length === 0) {
    listEl.innerHTML = '<p class="placeholder-text">No add-ons found to export.</p>';
    updateSelectionCount();
    return;
  }

  const enabled = addons.filter(a => a.enabled).sort(byName);
  const disabled = addons.filter(a => !a.enabled).sort(byName);

  // Single counter across both groups so every checkbox id stays unique.
  let idx = 0;
  const nextIndex = () => idx++;

  const outerBox = document.createElement('div');
  outerBox.className = 'groups-outer-box';
  appendGroup(outerBox, 'Enabled', enabled, nextIndex, shorten);
  appendGroup(outerBox, 'Disabled', disabled, nextIndex, shorten);
  const fragment = document.createDocumentFragment();
  fragment.appendChild(outerBox);
  listEl.replaceChildren(fragment);
  searchInput.style.display = 'block';

  checkboxes().forEach((cb) => {
    cb.addEventListener('change', updateSelectionCount);
  });

  updateSelectionCount();
}

(async () => {
  try {
    const [addons, stored] = await Promise.all([
      browser.runtime.sendMessage({ type: 'listAddons' }),
      browser.storage.local.get(SHORT_NAME_STORAGE_KEY),
    ]);
    const shorten = !stored || stored[SHORT_NAME_STORAGE_KEY] !== 'off';
    renderList(addons, shorten);
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'placeholder-text error';
    p.textContent = `Could not load add-ons: ${e.message}`;
    listEl.replaceChildren(p);
  }
})();

selectAllBtn.addEventListener('click', () => {
  visibleCheckboxes(checkboxes()).forEach((cb) => { cb.checked = true; });
  updateSelectionCount();
});

deselectAllBtn.addEventListener('click', () => {
  visibleCheckboxes(checkboxes()).forEach((cb) => { cb.checked = false; });
  updateSelectionCount();
});

searchInput.addEventListener('input', () => {
  const anyMatch = filterAddonRows(listEl, searchInput.value);
  noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
});

// Makes the whole row clickable, not just the checkbox/label text.
// Clicking the checkbox itself is left alone - its own native click
// already toggles it. Anything else in the row calls cb.click(), which
// fires the checkbox's own native toggle and change event. The
// preventDefault stops a label click's own default forwarding to the
// checkbox, so that path doesn't also fire and double the toggle.
listEl.addEventListener('click', (e) => {
  if (e.target.matches('input[type="checkbox"]')) return;
  if (e.target.closest('a')) return;
  const row = e.target.closest('.addon-row');
  if (!row) return;
  const cb = row.querySelector('input[type="checkbox"]');
  if (!cb || cb.disabled) return;
  e.preventDefault();
  cb.click();
});

exportBtn.addEventListener('click', async () => {
  const ids = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
    .map((cb) => cb.dataset.id);

  exportBtn.disabled = true;
  setStatus('Exporting your add-ons, please wait...');
  try {
    const result = await browser.runtime.sendMessage({ type: 'export', ids });
    if (result) {
      // Android: background.js couldn't save the file itself there (its
      // downloads API can't handle client-generated content on Android -
      // see the comment in background.js's message listener), so it
      // handed the report back here instead. Triggering the save right
      // here, in this same click's continuation, is what gives it a
      // chance of being recognized as a real download rather than
      // getting silently dropped - the same click.download() call made
      // from a freshly opened tab or after another message hop wasn't.
      const blob = new Blob([result.html], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = result.filename;
      link.style.display = 'none';
      document.body.appendChild(link);

      setStatus('Saving report...');

      // Android shows its own download confirmation prompt for this
      // click, and navigating away before the user answers it dismisses
      // it (confirmed by testing) - a fixed delay either cuts that off
      // (too short) or forces an arbitrary wait (too long, still a
      // guess). downloads.onCreated is a real signal instead: even
      // though downloads.download() can't be called here, the browser's
      // download-tracking system still seems to observe a plain <a
      // download> click the same way, since it's the same underlying
      // mechanism either way. Falls back to a generous timeout in case
      // that turns out not to hold on a given build, so this still
      // finishes instead of hanging indefinitely either way.
      await new Promise((resolve) => {
        let settled = false;
        let fallbackTimer;
        const proceed = () => {
          if (settled) return;
          settled = true;
          browser.downloads.onCreated.removeListener(onCreated);
          clearTimeout(fallbackTimer);
          resolve();
        };
        const onCreated = () => proceed();
        browser.downloads.onCreated.addListener(onCreated);
        fallbackTimer = setTimeout(proceed, 5000);
        link.click();
      });

      link.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      const fmt = result.filename.split('.').pop().toLowerCase() || 'html';
      await browser.tabs.create({ url: browser.runtime.getURL(`src/confirmation/confirmation.html?from=export&format=${fmt}`) });
    } else {
      // Desktop: background.js already saved the file and opened the
      // confirmation tab itself - this one just reports success and stays open.
      setStatus('Export complete. Your report has been saved to the folder you picked.');
    }
  } catch (e) {
    setStatus('Error: ' + e.message);
    exportBtn.disabled = false;
  }
});

// background.js broadcasts progress as each link is resolved.
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'exportProgress') {
    setStatus(`Resolved ${message.done} of ${message.total} add-ons...`);
  }
});
