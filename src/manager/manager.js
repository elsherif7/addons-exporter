// Add-ons Manager — Phase 4: inline nickname (rename) editing.
// Clicking the pencil icon (or the add-on name) on any row enters
// inline edit mode. Saving stores the nickname under addonNicknames
// in browser.storage.local; clearing it removes the nickname and
// restores the real name. No full re-render is needed on save — the
// name span is updated in place.

const NICKNAMES_KEY = 'addonNicknames';

const listEl = document.getElementById('addonList');
const searchInput = document.getElementById('searchInput');
const noSearchMatchesEl = document.getElementById('noSearchMatches');
const statusEl = document.getElementById('status');

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? 'var(--danger-color)' : 'var(--text-secondary)';
}

// --- Pure helpers (tested in isolation) ---

// Returns the display name: stored nickname if set, else the real name.
function displayName(addon, nicknames) {
  return (nicknames && nicknames[addon.id]) ? nicknames[addon.id] : addon.name;
}

// Returns a copy of nicknames with the given id set or cleared.
// If nickname is empty/whitespace, the key is removed.
function applyNickname(nicknames, id, nickname) {
  const updated = Object.assign({}, nicknames);
  const trimmed = nickname.trim();
  if (trimmed) {
    updated[id] = trimmed;
  } else {
    delete updated[id];
  }
  return updated;
}

// --- Storage ---

async function loadNicknames() {
  try {
    const stored = await browser.storage.local.get(NICKNAMES_KEY);
    return (stored && stored[NICKNAMES_KEY]) || {};
  } catch {
    return {};
  }
}

async function saveNicknames(nicknames) {
  await browser.storage.local.set({ [NICKNAMES_KEY]: nicknames });
}

// Module-level nicknames cache — updated on every save without a full reload.
let currentNicknames = {};

// --- Inline editing ---

// Switches the name span into an <input> for editing.
// On save (Enter or blur): persists the new nickname and updates the span.
// On cancel (Escape): restores the original display without saving.
function startEditing(nameSpan, addonId, realName) {
  // Already editing this row — do nothing.
  if (nameSpan.parentElement.querySelector('.nickname-input')) return;

  const currentDisplay = nameSpan.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'nickname-input';
  input.value = currentDisplay;
  input.setAttribute('aria-label', 'Nickname for ' + realName);

  // Hide the name span, insert the input after it.
  nameSpan.style.display = 'none';
  nameSpan.after(input);
  input.focus();
  input.select();

  let saved = false;

  async function commitEdit() {
    if (saved) return;
    saved = true;

    const newNick = input.value.trim();
    // If the user typed the real name exactly, treat as clearing the nickname.
    const effectiveNick = newNick === realName ? '' : newNick;

    input.remove();
    nameSpan.style.display = '';

    try {
      currentNicknames = applyNickname(currentNicknames, addonId, effectiveNick);
      await saveNicknames(currentNicknames);
      const newDisplay = effectiveNick || realName;
      nameSpan.textContent = newDisplay;
      nameSpan.classList.toggle('has-nickname', !!effectiveNick);
      setStatus(effectiveNick ? `Nickname saved: "${effectiveNick}"` : 'Nickname cleared.');
    } catch (err) {
      setStatus('Could not save nickname: ' + err.message, true);
    }
  }

  function cancelEdit() {
    if (saved) return;
    saved = true;
    input.remove();
    nameSpan.style.display = '';
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });

  input.addEventListener('blur', commitEdit);
}

// --- DOM building ---

function createAddonRow(addon, nicknames) {
  const row = document.createElement('div');
  row.className = 'addon-row';
  row.dataset.id = addon.id;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'addon-name';
  const nick = nicknames[addon.id] || '';
  nameSpan.textContent = nick || addon.name;
  if (nick) nameSpan.classList.add('has-nickname');

  const renameBtn = document.createElement('button');
  renameBtn.className = 'rename-btn';
  renameBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  renameBtn.title = 'Set nickname';
  renameBtn.setAttribute('aria-label', 'Set nickname for ' + addon.name);
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startEditing(nameSpan, addon.id, addon.name);
  });

  const nameWrap = document.createElement('span');
  nameWrap.className = 'addon-name-wrap';
  nameWrap.append(renameBtn, nameSpan);

  const versionSpan = document.createElement('span');
  versionSpan.className = 'addon-version';
  versionSpan.textContent = addon.version;

  const label = document.createElement('div');
  label.style.flex = '1';
  label.style.textAlign = 'left';
  label.append(nameWrap, ' ', versionSpan);

  const typeSpan = document.createElement('span');
  typeSpan.className = 'match-label';
  typeSpan.textContent = addon.type === 'theme' ? 'Theme' : 'Extension';
  label.append(' ', typeSpan);

  row.appendChild(label);
  return row;
}

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
    const [addons, nicknames] = await Promise.all([
      browser.runtime.sendMessage({ type: 'listAddons' }),
      loadNicknames(),
    ]);

    currentNicknames = nicknames;

    if (!Array.isArray(addons) || addons.length === 0) {
      listEl.innerHTML = '<p class="placeholder-text">No add-ons found.</p>';
      return;
    }

    const byDisplayName = (a, b) =>
      displayName(a, nicknames).localeCompare(displayName(b, nicknames), undefined, { sensitivity: 'base' });

    const enabled = addons.filter(a => a.enabled).sort(byDisplayName);
    const disabled = addons.filter(a => !a.enabled).sort(byDisplayName);

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
