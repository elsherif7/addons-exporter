// Add-ons Manager — Phase 2: load and display installed add-ons.
// Reads nicknames from storage (addonNicknames) and falls back to the
// real add-on name when none is set. Renders Enabled/Disabled groups
// using the same group-box pattern as the exporter/importer.

const NICKNAMES_KEY = 'addonNicknames';

const listEl = document.getElementById('addonList');
const searchInput = document.getElementById('searchInput');
const noSearchMatchesEl = document.getElementById('noSearchMatches');
const statusEl = document.getElementById('status');

function setStatus(msg) {
  statusEl.textContent = msg;
}

// Returns the display name for an add-on: stored nickname if one exists,
// otherwise the real name from Firefox.
function displayName(addon, nicknames) {
  return (nicknames && nicknames[addon.id]) ? nicknames[addon.id] : addon.name;
}

// Builds one <div class="addon-row"> for the manager list.
// Uses DOM APIs (not innerHTML) so names are never parsed as HTML.
function createAddonRow(addon, nicknames) {
  const row = document.createElement('div');
  row.className = 'addon-row';
  row.dataset.id = addon.id;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'addon-name';
  nameSpan.textContent = displayName(addon, nicknames);

  const versionSpan = document.createElement('span');
  versionSpan.className = 'addon-version';
  versionSpan.textContent = addon.version;

  const typeSpan = document.createElement('span');
  typeSpan.className = 'match-label';
  typeSpan.textContent = addon.type === 'theme' ? 'Theme' : '';

  const label = document.createElement('div');
  label.style.flex = '1';
  label.style.textAlign = 'left';
  label.append(nameSpan, ' ', versionSpan);
  if (addon.type === 'theme') label.append(' ', typeSpan);

  row.appendChild(label);
  return row;
}

// Builds a group-box with heading and rows for a set of add-ons.
function createGroupBox(title, addons, nicknames) {
  const box = document.createElement('div');
  box.className = 'group-box';

  const heading = document.createElement('div');
  heading.className = 'group-heading';
  heading.textContent = `${title} (${addons.length})`;
  box.appendChild(heading);

  addons.forEach((addon) => {
    box.appendChild(createAddonRow(addon, nicknames));
  });

  return box;
}

async function loadAndRender() {
  try {
    // Fetch installed add-ons and stored nicknames in parallel.
    const [addons, stored] = await Promise.all([
      browser.runtime.sendMessage({ type: 'listAddons' }),
      browser.storage.local.get(NICKNAMES_KEY).catch(() => ({})),
    ]);

    const nicknames = (stored && stored[NICKNAMES_KEY]) || {};

    if (!Array.isArray(addons) || addons.length === 0) {
      listEl.innerHTML = '<p class="placeholder-text">No add-ons found.</p>';
      return;
    }

    const enabled = addons.filter(a => a.enabled).sort(byName);
    const disabled = addons.filter(a => !a.enabled).sort(byName);

    // Use display names for sorting when nicknames are set.
    const byDisplayName = (a, b) =>
      displayName(a, nicknames).localeCompare(displayName(b, nicknames), undefined, { sensitivity: 'base' });

    enabled.sort(byDisplayName);
    disabled.sort(byDisplayName);

    const fragment = document.createDocumentFragment();
    if (enabled.length > 0) fragment.appendChild(createGroupBox('Enabled', enabled, nicknames));
    if (disabled.length > 0) fragment.appendChild(createGroupBox('Disabled', disabled, nicknames));

    listEl.replaceChildren(fragment);
    searchInput.style.display = 'block';

  } catch (err) {
    const p = document.createElement('p');
    p.className = 'placeholder-text error';
    p.textContent = `Could not load add-ons: ${err.message}`;
    listEl.replaceChildren(p);
  }
}

searchInput.addEventListener('input', () => {
  const anyMatch = filterAddonRows(listEl, searchInput.value);
  noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
});

loadAndRender();
