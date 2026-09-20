// Add-ons Manager — Phase 5: custom groups.
// Builds on Phase 4 nicknames. Add-ons can be assigned to custom groups
// stored in addonGroups / addonGroupAssignments in browser.storage.local.
// Unassigned add-ons appear in built-in Enabled / Disabled sections.

const NICKNAMES_KEY = 'addonNicknames';
const GROUPS_KEY = 'addonGroups';
const ASSIGNMENTS_KEY = 'addonGroupAssignments';
const GROUP_ORDER_KEY = 'addonGroupOrder';

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

// Returns a new order array with fromId moved immediately before toId.
// If toId is null, fromId is moved to the end.
function reorderGroups(order, fromId, toId) {
  const arr = order.filter(id => id !== fromId);
  const toIndex = toId ? arr.indexOf(toId) : arr.length;
  arr.splice(toIndex === -1 ? arr.length : toIndex, 0, fromId);
  return arr;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

async function loadAllData() {
  try {
    const stored = await browser.storage.local.get([NICKNAMES_KEY, GROUPS_KEY, ASSIGNMENTS_KEY, GROUP_ORDER_KEY]);
    return {
      nicknames: stored[NICKNAMES_KEY] || {},
      groups: stored[GROUPS_KEY] || {},
      assignments: stored[ASSIGNMENTS_KEY] || {},
      groupOrder: stored[GROUP_ORDER_KEY] || null,
    };
  } catch {
    return { nicknames: {}, groups: {}, assignments: {}, groupOrder: null };
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
let currentGroupOrder = []; // ordered array of group IDs

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
  btn.textContent = 'Group';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();

    // Toggle: if picker already open for this button, close it.
    const existing = document.querySelector('.group-picker');
    if (existing) {
      existing.remove();
      document.removeEventListener('click', existing._outsideClick);
      if (existing._btn === btn) return;
    }

    const groupList = Object.entries(currentGroups);
    if (groupList.length === 0) {
      // No groups yet — offer to create one and assign this add-on immediately.
      const name = await showInputModal('New Group', 'No groups yet. Enter a name to create one:');
      if (!name) return;
      try {
        const id = generateGroupId();
        currentGroups = createGroup(currentGroups, id, name);
        currentGroupOrder = [...currentGroupOrder, id];
        currentAssignments = assignToGroup(currentAssignments, addon.id, id);
        await saveData({ [GROUPS_KEY]: currentGroups, [GROUP_ORDER_KEY]: currentGroupOrder, [ASSIGNMENTS_KEY]: currentAssignments });
        setStatus(`Added to new group "${name}".`);
        await renderList();
      } catch (err) {
        setStatus('Could not create group: ' + err.message, true);
      }
      return;
    }

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

      const wrap = document.createElement('div');
      wrap.className = 'group-picker-option-wrap';

      const text = document.createElement('span');
      text.className = 'option-text';
      text.textContent = g.name;

      const renameOptBtn = document.createElement('button');
      renameOptBtn.className = 'picker-opt-btn';
      renameOptBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      renameOptBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        picker.remove();
        document.removeEventListener('click', outsideClick);
        const newName = await showInputModal('Rename Group', `Enter a new name for "${g.name}":`, g.name);
        if (!newName || newName === g.name) return;
        try {
          currentGroups = renameGroup(currentGroups, gId, newName);
          await saveData({ [GROUPS_KEY]: currentGroups });
          setStatus(`Group renamed to "${newName}".`);
          await renderList();
        } catch (err) {
          setStatus('Could not rename group: ' + err.message, true);
        }
      });

      const deleteOptBtn = document.createElement('button');
      deleteOptBtn.className = 'picker-opt-btn danger';
      deleteOptBtn.textContent = '✕';
      deleteOptBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        picker.remove();
        document.removeEventListener('click', outsideClick);
        const confirmed = await showConfirmModal('Delete Group',
          `Delete the group "${g.name}"? Add-ons in it will become ungrouped.`, 'Delete', true);
        if (!confirmed) return;
        try {
          currentGroups = deleteGroup(currentGroups, gId);
          currentAssignments = removeGroupAssignments(currentAssignments, gId);
          currentGroupOrder = currentGroupOrder.filter(id => id !== gId);
          await saveData({ [GROUPS_KEY]: currentGroups, [ASSIGNMENTS_KEY]: currentAssignments, [GROUP_ORDER_KEY]: currentGroupOrder });
          setStatus(`Group "${g.name}" deleted.`);
          await renderList();
        } catch (err) {
          setStatus('Could not delete group: ' + err.message, true);
        }
      });

      wrap.append(text, renameOptBtn, deleteOptBtn);
      opt.appendChild(wrap);
      picker.appendChild(opt);
    });

    // Position below the button, aligned to its right edge.
    const rect = btn.getBoundingClientRect();
    picker.style.top = (rect.bottom + 4) + 'px';
    const pickerWidth = 160;
    const rightEdge = rect.right;
    picker.style.left = Math.max(8, rightEdge - pickerWidth) + 'px';
    document.body.appendChild(picker);
    picker._btn = btn;

    async function pick(chosen) {
      picker.remove();
      document.removeEventListener('click', outsideClick);
      window.removeEventListener('wheel', outsideClick);
      window.removeEventListener('scroll', outsideClick, true);
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
      const opt = picker.children[i + 1];
      opt.querySelector('.option-text').addEventListener('click', (ev) => { ev.stopPropagation(); pick(gId); });
    });

    function outsideClick() { picker.remove(); document.removeEventListener('click', outsideClick); window.removeEventListener('wheel', outsideClick); window.removeEventListener('scroll', outsideClick, true); }
    picker._outsideClick = outsideClick;
    setTimeout(() => {
      document.addEventListener('click', outsideClick);
      window.addEventListener('wheel', outsideClick, { once: true });
      window.addEventListener('scroll', outsideClick, { once: true, capture: true });
    }, 0);
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
  nameSpan.textContent = nick || shortName(addon.name);
  if (nick) nameSpan.classList.add('has-nickname');

  const renameBtn = document.createElement('button');
  renameBtn.className = 'rename-btn';
  renameBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
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
  versionSpan.style.verticalAlign = 'baseline';
  versionSpan.textContent = addon.version;

  const typeSpan = document.createElement('span');
  typeSpan.className = 'match-label';
  typeSpan.style.verticalAlign = 'baseline';
  typeSpan.textContent = addon.type === 'theme' ? 'Theme' : 'Extension';

  const moveBtn = createMoveGroupBtn(addon);

  // Open Settings button — always shown; shows inline message if no options page.
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'open-settings-btn';
  settingsBtn.textContent = 'Settings';
  settingsBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (addon.optionsUrl) {
      try {
        await browser.tabs.create({ url: addon.optionsUrl });
      } catch (err) {
        setStatus('Could not open settings: ' + err.message, true);
      }
    } else {
      setStatus('This add-on does not have a settings page.');
    }
  });

  const label = document.createElement('div');
  label.style.flex = '1';
  label.style.textAlign = 'left';
  label.append(nameWrap, ' ', versionSpan, ' ', typeSpan);

  row.append(label, settingsBtn, moveBtn);
  return row;
}

// Builds a custom group-box with rename/delete heading actions.
function createCustomGroupBox(groupId, groupName, addons) {
  const container = document.createElement('div');
  container.className = 'group-container';

  const box = document.createElement('div');
  box.className = 'group-box';

  const headingWrap = document.createElement('div');
  headingWrap.className = 'group-heading-wrap';
  headingWrap.style.padding = '0 0 8px 2px';

  const dragHandle = document.createElement('span');
  dragHandle.className = 'group-drag-handle';
  dragHandle.textContent = '⠿';
  dragHandle.setAttribute('aria-label', 'Drag to reorder');

  const headingSpan = document.createElement('div');
  headingSpan.className = 'group-heading';
  headingSpan.style.padding = '0';
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
      currentGroupOrder = currentGroupOrder.filter(id => id !== groupId);
      await saveData({ [GROUPS_KEY]: currentGroups, [ASSIGNMENTS_KEY]: currentAssignments, [GROUP_ORDER_KEY]: currentGroupOrder });
      setStatus(`Group "${groupName}" deleted.`);
      await renderList();
    } catch (err) {
      setStatus('Could not delete group: ' + err.message, true);
    }
  });

  actions.append(renameGroupBtn, deleteGroupBtn);
  headingWrap.append(dragHandle, headingSpan, actions);
  container.appendChild(headingWrap);

  // Drag-and-drop reordering
  container.draggable = true;
  container.dataset.groupId = groupId;

  container.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', groupId);
    setTimeout(() => container.style.opacity = '0.5', 0);
  });
  container.addEventListener('dragend', () => {
    container.style.opacity = '';
    document.querySelectorAll('.group-container.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.group-container.drag-over').forEach(el => el.classList.remove('drag-over'));
    container.classList.add('drag-over');
  });
  container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    container.classList.remove('drag-over');
    const fromId = e.dataTransfer.getData('text/plain');
    const toId = groupId;
    if (fromId === toId) return;
    try {
      currentGroupOrder = reorderGroups(currentGroupOrder, fromId, toId);
      await saveData({ [GROUP_ORDER_KEY]: currentGroupOrder });
      await renderList();
    } catch (err) {
      setStatus('Could not reorder groups: ' + err.message, true);
    }
  });

  addons.forEach((addon) => box.appendChild(createAddonRow(addon)));
  container.appendChild(box);
  return container;
}

// Builds an Enabled or Disabled built-in group-box (no rename/delete).
function createBuiltInGroupBox(title, addons) {
  const container = document.createElement('div');
  container.className = 'group-container';

  const heading = document.createElement('div');
  heading.className = 'group-heading';
  heading.textContent = `${title} (${addons.length})`;

  const box = document.createElement('div');
  box.className = 'group-box';
  addons.forEach((addon) => box.appendChild(createAddonRow(addon)));

  container.appendChild(heading);
  container.appendChild(box);
  return container;
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
  const groupOrder = currentGroupOrder.filter(id => currentGroups[id]);

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
    // Reconcile order: keep stored order, append any new group ids not yet in it.
    const allGroupIds = Object.keys(data.groups);
    const storedOrder = (data.groupOrder || []).filter(id => data.groups[id]);
    const missing = allGroupIds.filter(id => !storedOrder.includes(id));
    currentGroupOrder = [...storedOrder, ...missing];
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
    currentGroupOrder = [...currentGroupOrder, id];
    await saveData({ [GROUPS_KEY]: currentGroups, [GROUP_ORDER_KEY]: currentGroupOrder });
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
