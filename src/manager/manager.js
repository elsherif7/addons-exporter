// Add-ons Manager — Phase 5: custom groups.
// Builds on Phase 4 nicknames. Add-ons can be assigned to custom groups
// stored in addonGroups / addonGroupAssignments in browser.storage.local.
// Unassigned add-ons appear in built-in Enabled / Disabled sections.

const NICKNAMES_KEY = 'addonNicknames';
const GROUPS_KEY = 'addonGroups';
const ASSIGNMENTS_KEY = 'addonGroupAssignments';

const listEl = document.getElementById('addonList');
const searchInput = document.getElementById('searchInput');
const noSearchMatchesEl = document.getElementById('noSearchMatches');
const statusEl = document.getElementById('status');
const managerToolbar = document.getElementById('managerToolbar');
const newGroupBtn = document.getElementById('newGroupBtn');

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? 'var(--danger-color)' : 'var(--text-secondary)';
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function displayName(addon, nicknames) {
  return (nicknames && nicknames[addon.id]) ? nicknames[addon.id] : addon.name;
}

function applyNickname(nicknames, id, nickname) {
  const updated = Object.assign({}, nicknames);
  const trimmed = nickname.trim();
  if (trimmed) { updated[id] = trimmed; } else { delete updated[id]; }
  return updated;
}

// Generates a simple unique id for a new group.
function generateGroupId() {
  return 'g_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// Returns a new groups object with the group added.
function createGroup(groups, id, name) {
  return Object.assign({}, groups, { [id]: { name: name.trim() } });
}

// Returns a new groups object with the group removed.
function deleteGroup(groups, id) {
  const updated = Object.assign({}, groups);
  delete updated[id];
  return updated;
}

// Returns a new groups object with the group renamed.
function renameGroup(groups, id, newName) {
  if (!groups[id]) return groups;
  return Object.assign({}, groups, { [id]: { name: newName.trim() } });
}

// Returns a new assignments object with addonId assigned to groupId.
// Pass null as groupId to remove the assignment.
function assignToGroup(assignments, addonId, groupId) {
  const updated = Object.assign({}, assignments);
  if (groupId) { updated[addonId] = groupId; } else { delete updated[addonId]; }
  return updated;
}

// Returns a new assignments object with all references to groupId removed.
function removeGroupAssignments(assignments, groupId) {
  const updated = Object.assign({}, assignments);
  for (const [addonId, gId] of Object.entries(updated)) {
    if (gId === groupId) delete updated[addonId];
  }
  return updated;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

async function loadAllData() {
  try {
    const stored = await browser.storage.local.get([NICKNAMES_KEY, GROUPS_KEY, ASSIGNMENTS_KEY]);
    return {
      nicknames: stored[NICKNAMES_KEY] || {},
      groups: stored[GROUPS_KEY] || {},
      assignments: stored[ASSIGNMENTS_KEY] || {},
    };
  } catch {
    return { nicknames: {}, groups: {}, assignments: {} };
  }
}

async function saveData(patch) {
  await browser.storage.local.set(patch);
}

// Module-level cache.
let currentAddons = [];
let currentNicknames = {};
let currentGroups = {};
let currentAssignments = {};

// ─── Custom modal ─────────────────────────────────────────────────────────────

// Shows a styled modal with a text input. Returns a Promise that resolves
// with the trimmed input value on OK, or null on Cancel/Escape.
function showInputModal(title, label, placeholder = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">Add-ons Manager</div>
        <p class="modal-label">${escapeHtml(label)}</p>
        <input type="text" class="modal-input" placeholder="${escapeHtml(placeholder)}">
        <div class="modal-actions">
          <button class="modal-btn" id="modalCancelBtn">Cancel</button>
          <button class="modal-btn confirm" id="modalOkBtn">Create</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    const input = overlay.querySelector('.modal-input');
    input.focus();

    function finish(value) {
      overlay.remove();
      resolve(value);
    }

    overlay.querySelector('#modalOkBtn').addEventListener('click', () => finish(input.value.trim() || null));
    overlay.querySelector('#modalCancelBtn').addEventListener('click', () => finish(null));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim() || null); }
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
    });
  });
}

// Shows a styled confirmation modal. Returns a Promise resolving to true/false.
function showConfirmModal(title, message, confirmLabel = 'OK', isDanger = false) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">Add-ons Manager</div>
        <p class="modal-label">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button class="modal-btn" id="modalCancelBtn">Cancel</button>
          <button class="modal-btn ${isDanger ? 'danger' : 'primary'}" id="modalOkBtn">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('.modal-btn.primary, .modal-btn.danger').focus();

    function finish(value) { overlay.remove(); resolve(value); }
    overlay.querySelector('#modalOkBtn').addEventListener('click', () => finish(true));
    overlay.querySelector('#modalCancelBtn').addEventListener('click', () => finish(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(false); });
  });
}



function startEditing(nameSpan, addonId, realName) {
  if (nameSpan.parentElement.querySelector('.nickname-input')) return;
  const currentDisplay = nameSpan.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'nickname-input';
  input.value = currentDisplay;
  input.setAttribute('aria-label', 'Nickname for ' + realName);
  nameSpan.style.display = 'none';
  nameSpan.after(input);
  input.focus();
  input.select();
  let saved = false;
  async function commitEdit() {
    if (saved) return;
    saved = true;
    const newNick = input.value.trim();
    const effectiveNick = newNick === realName ? '' : newNick;
    input.remove();
    nameSpan.style.display = '';
    try {
      currentNicknames = applyNickname(currentNicknames, addonId, effectiveNick);
      await saveData({ [NICKNAMES_KEY]: currentNicknames });
      nameSpan.textContent = effectiveNick || realName;
      nameSpan.classList.toggle('has-nickname', !!effectiveNick);
      setStatus(effectiveNick ? `Nickname saved: "${effectiveNick}"` : 'Nickname cleared.');
    } catch (err) {
      setStatus('Could not save nickname: ' + err.message, true);
    }
  }
  function cancelEdit() {
    if (saved) return; saved = true;
    input.remove(); nameSpan.style.display = '';
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });
  input.addEventListener('blur', commitEdit);
}

// ─── Inline group name editing ────────────────────────────────────────────────

function startGroupNameEdit(headingSpan, groupId) {
  if (headingSpan.parentElement.querySelector('.group-name-input')) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group-name-input';
  // Strip the count suffix for editing.
  const fullText = headingSpan.textContent;
  const nameOnly = fullText.replace(/\s*\(\d+\)$/, '').trim();
  input.value = nameOnly;
  headingSpan.style.display = 'none';
  headingSpan.after(input);
  input.focus();
  input.select();
  let saved = false;
  async function commitGroupRename() {
    if (saved) return; saved = true;
    const newName = input.value.trim();
    input.remove(); headingSpan.style.display = '';
    if (!newName) return;
    try {
      currentGroups = renameGroup(currentGroups, groupId, newName);
      await saveData({ [GROUPS_KEY]: currentGroups });
      // Update heading text preserving the count.
      const countMatch = fullText.match(/\(\d+\)$/);
      headingSpan.textContent = newName + (countMatch ? ' ' + countMatch[0] : '');
      setStatus(`Group renamed to "${newName}".`);
    } catch (err) {
      setStatus('Could not rename group: ' + err.message, true);
    }
  }
  function cancelGroupRename() {
    if (saved) return; saved = true;
    input.remove(); headingSpan.style.display = '';
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitGroupRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelGroupRename(); }
  });
  input.addEventListener('blur', commitGroupRename);
}

// ─── DOM building ─────────────────────────────────────────────────────────────

// Builds the "Move to group" dropdown for a row.
function createMoveGroupBtn(addon) {
  const btn = document.createElement('button');
  btn.className = 'move-group-btn';
  btn.textContent = 'Move to group ▾';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const groupList = Object.entries(currentGroups);
    if (groupList.length === 0) {
      setStatus('No groups yet — create one with "+ New Group".', false);
      return;
    }

    // Remove any existing picker.
    document.querySelectorAll('.group-picker').forEach(el => el.remove());

    const currentGroupId = currentAssignments[addon.id] || null;
    const picker = document.createElement('div');
    picker.className = 'group-picker';

    // "No group" option.
    const noneOpt = document.createElement('div');
    noneOpt.className = 'group-picker-option none-option' + (!currentGroupId ? ' selected' : '');
    noneOpt.textContent = 'No Group';
    picker.appendChild(noneOpt);

    groupList.forEach(([gId, g]) => {
      const opt = document.createElement('div');
      opt.className = 'group-picker-option' + (gId === currentGroupId ? ' selected' : '');
      opt.textContent = g.name;
      picker.appendChild(opt);
    });

    // Position below the button.
    const rect = btn.getBoundingClientRect();
    picker.style.top = (rect.bottom + 4) + 'px';
    picker.style.left = rect.left + 'px';
    document.body.appendChild(picker);

    async function pick(chosen) {
      picker.remove();
      document.removeEventListener('click', outsideClick);
      if (chosen === currentGroupId || (chosen === null && !currentGroupId)) return;
      try {
        currentAssignments = assignToGroup(currentAssignments, addon.id, chosen);
        await saveData({ [ASSIGNMENTS_KEY]: currentAssignments });
        const groupName = chosen ? currentGroups[chosen].name : null;
        setStatus(groupName ? `Moved to group "${groupName}".` : 'Removed from group.');
        await renderList();
      } catch (err) {
        setStatus('Could not move to group: ' + err.message, true);
      }
    }

    noneOpt.addEventListener('click', (ev) => { ev.stopPropagation(); pick(null); });
    groupList.forEach(([gId], i) => {
      picker.children[i + 1].addEventListener('click', (ev) => { ev.stopPropagation(); pick(gId); });
    });

    function outsideClick() { picker.remove(); document.removeEventListener('click', outsideClick); }
    setTimeout(() => document.addEventListener('click', outsideClick), 0);
  });
  return btn;
}

function createAddonRow(addon) {
  const row = document.createElement('div');
  row.className = 'addon-row';
  row.dataset.id = addon.id;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'addon-name';
  const nick = currentNicknames[addon.id] || '';
  nameSpan.textContent = nick || addon.name;
  if (nick) nameSpan.classList.add('has-nickname');

  // Wrap name in a link to the AMO page.
  const nameLink = document.createElement('a');
  nameLink.href = `https://addons.mozilla.org/en-US/firefox/addon/${encodeURIComponent(addon.id)}/`;
  nameLink.target = '_blank';
  nameLink.rel = 'noopener';
  nameLink.style.cssText = 'text-decoration:none; color:var(--link-accent); font-weight:600;';
  nameLink.addEventListener('mouseover', () => { nameLink.style.textDecoration = 'underline'; });
  nameLink.addEventListener('mouseout', () => { nameLink.style.textDecoration = 'none'; });
  nameLink.appendChild(nameSpan);
  nameLink.addEventListener('click', (e) => e.stopPropagation());

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
  nameWrap.append(renameBtn, nameLink);

  const versionSpan = document.createElement('span');
  versionSpan.className = 'addon-version';
  versionSpan.style.verticalAlign = 'baseline';
  versionSpan.textContent = addon.version;

  const typeSpan = document.createElement('span');
  typeSpan.className = 'match-label';
  typeSpan.style.verticalAlign = 'baseline';
  typeSpan.textContent = addon.type === 'theme' ? 'Theme' : 'Extension';

  const moveBtn = createMoveGroupBtn(addon);

  const label = document.createElement('div');
  label.style.flex = '1';
  label.style.textAlign = 'left';
  label.append(nameWrap, ' ', versionSpan, ' ', typeSpan);

  row.append(label, moveBtn);
  return row;
}

// Builds a custom group-box with rename/delete heading actions.
function createCustomGroupBox(groupId, groupName, addons) {
  const box = document.createElement('div');
  box.className = 'group-box';

  const headingWrap = document.createElement('div');
  headingWrap.className = 'group-heading-wrap';

  const headingSpan = document.createElement('div');
  headingSpan.className = 'group-heading';
  headingSpan.textContent = `${groupName} (${addons.length})`;

  const actions = document.createElement('div');
  actions.className = 'group-heading-actions';

  const renameGroupBtn = document.createElement('button');
  renameGroupBtn.className = 'group-action-btn';
  renameGroupBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  renameGroupBtn.addEventListener('click', () => startGroupNameEdit(headingSpan, groupId));

  const deleteGroupBtn = document.createElement('button');
  deleteGroupBtn.className = 'group-action-btn danger';
  deleteGroupBtn.textContent = '✕';
  deleteGroupBtn.addEventListener('click', async () => {
    const confirmed = await showConfirmModal(
      'Delete Group',
      `Delete the group "${groupName}"? Add-ons in it will become ungrouped.`,
      'Delete',
      true
    );
    if (!confirmed) return;
    try {
      currentGroups = deleteGroup(currentGroups, groupId);
      currentAssignments = removeGroupAssignments(currentAssignments, groupId);
      await saveData({ [GROUPS_KEY]: currentGroups, [ASSIGNMENTS_KEY]: currentAssignments });
      setStatus(`Group "${groupName}" deleted.`);
      await renderList();
    } catch (err) {
      setStatus('Could not delete group: ' + err.message, true);
    }
  });

  actions.append(renameGroupBtn, deleteGroupBtn);
  headingWrap.append(headingSpan, actions);
  box.appendChild(headingWrap);

  addons.forEach((addon) => box.appendChild(createAddonRow(addon)));
  return box;
}

// Builds an Enabled or Disabled built-in group-box (no rename/delete).
function createBuiltInGroupBox(title, addons) {
  const box = document.createElement('div');
  box.className = 'group-box';
  const heading = document.createElement('div');
  heading.className = 'group-heading';
  heading.textContent = `${title} (${addons.length})`;
  box.appendChild(heading);
  addons.forEach((addon) => box.appendChild(createAddonRow(addon)));
  return box;
}

// ─── Render ───────────────────────────────────────────────────────────────────

async function renderList() {
  if (currentAddons.length === 0) {
    listEl.innerHTML = '<p class="placeholder-text">No add-ons found.</p>';
    managerToolbar.style.display = 'none';
    return;
  }

  const byDisplayName = (a, b) =>
    displayName(a, currentNicknames).localeCompare(displayName(b, currentNicknames), undefined, { sensitivity: 'base' });

  const fragment = document.createDocumentFragment();
  const groupOrder = Object.keys(currentGroups);

  // Collect add-ons not assigned to any group (or assigned to a deleted group).
  const ungroupedAddons = currentAddons.filter(a => {
    const gId = currentAssignments[a.id];
    return !gId || !currentGroups[gId];
  });

  // Render custom groups first.
  for (const groupId of groupOrder) {
    const group = currentGroups[groupId];
    const members = currentAddons
      .filter(a => currentAssignments[a.id] === groupId)
      .sort(byDisplayName);
    if (members.length > 0) {
      fragment.appendChild(createCustomGroupBox(groupId, group.name, members));
    }
  }

  // Then Enabled / Disabled for ungrouped add-ons.
  const enabled = ungroupedAddons.filter(a => a.enabled).sort(byDisplayName);
  const disabled = ungroupedAddons.filter(a => !a.enabled).sort(byDisplayName);
  if (enabled.length > 0) fragment.appendChild(createBuiltInGroupBox('Enabled', enabled));
  if (disabled.length > 0) fragment.appendChild(createBuiltInGroupBox('Disabled', disabled));

  listEl.replaceChildren(fragment);
  managerToolbar.style.display = 'flex';

  // Re-apply search filter if active.
  if (searchInput.value.trim()) {
    const anyMatch = filterAddonRows(listEl, searchInput.value);
    noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
  } else {
    noSearchMatchesEl.style.display = 'none';
  }
}

// ─── Initialise ───────────────────────────────────────────────────────────────

async function loadAndRender() {
  try {
    const [addons, data] = await Promise.all([
      browser.runtime.sendMessage({ type: 'listAddons' }),
      loadAllData(),
    ]);
    currentAddons = Array.isArray(addons) ? addons : [];
    currentNicknames = data.nicknames;
    currentGroups = data.groups;
    currentAssignments = data.assignments;
    await renderList();
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'placeholder-text error';
    p.textContent = `Could not load add-ons: ${err.message}`;
    listEl.replaceChildren(p);
    managerToolbar.style.display = 'none';
  }
}

// ─── New Group button ─────────────────────────────────────────────────────────

newGroupBtn.addEventListener('click', async () => {
  const name = await showInputModal('New Group', 'Enter a name for the new group:');
  if (!name) return;
  try {
    const id = generateGroupId();
    currentGroups = createGroup(currentGroups, id, name);
    await saveData({ [GROUPS_KEY]: currentGroups });
    setStatus(`Group "${name}" created.`);
    await renderList();
  } catch (err) {
    setStatus('Could not create group: ' + err.message, true);
  }
});

// ─── Search ───────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', () => {
  const anyMatch = filterAddonRows(listEl, searchInput.value);
  noSearchMatchesEl.style.display = anyMatch ? 'none' : 'block';
});

loadAndRender();
