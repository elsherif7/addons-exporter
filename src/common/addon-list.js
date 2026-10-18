// The add-on list the Exporter and Importer share: rows, groups, Select all,
// search, the "3 of 12 selected" badge, click-anywhere-on-a-row and live name
// shortening. Each page passes in its elements and keeps only what is its own.
// Loaded after core.js and page-ui.js.

// Builds the common parts of a row (checkbox, name, version, type) and returns
// { row, checkbox, label }. The page adds its own extras (match label, warning,
// link).
//   idPrefix  checkbox id is `${idPrefix}-${index}`
//   dataset   data-* values on the checkbox, for the page to read back
//   disabled  unsafe link: disabled checkbox and "row-disabled"
// Built with DOM APIs, never innerHTML, so names never go through HTML parsing.
function createAddonRowBase(a, index, { idPrefix, dataset = {}, checked = true, disabled = false, shorten = true }) {
  const row = document.createElement('div');
  row.className = 'addon-row';
  if (disabled) row.classList.add('row-disabled');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = `${idPrefix}-${index}`;
  Object.assign(checkbox.dataset, dataset);
  checkbox.checked = checked;
  checkbox.disabled = disabled;

  const nameEl = document.createElement('span');
  nameEl.className = 'addon-name';
  nameEl.textContent = shorten ? shortName(a.name) : a.name;
  nameEl.dataset.fullName = a.name; // lets the name follow the Shorten setting live

  const versionEl = document.createElement('span');
  versionEl.className = 'addon-version';
  versionEl.textContent = typeof a.version === 'string' ? a.version : '';

  const typeEl = document.createElement('span');
  typeEl.className = 'match-label';
  typeEl.textContent = typeLabel(a.type);

  const label = document.createElement('label');
  label.htmlFor = checkbox.id;
  label.append(nameEl, ' ', versionEl, ' ', typeEl);

  row.append(checkbox, label);
  return { row, checkbox, label };
}

// Builds the outer box with one group (heading + rows) per non-empty entry of
// `groups` ([{ title, items }]), numbering rows 0, 1, 2... across all groups.
// makeRow(item, index, group) returns each row's element.
function createAddonGroups(groups, makeRow) {
  const outerBox = document.createElement('div');
  outerBox.className = 'groups-outer-box';
  let index = 0;
  for (const group of groups) {
    if (group.items.length === 0) continue;
    const container = document.createElement('div');
    container.className = 'group-container';

    const heading = document.createElement('div');
    heading.className = 'group-heading';
    heading.textContent = `${group.title} (${group.items.length})`;

    const box = document.createElement('div');
    box.className = 'group-box';
    for (const item of group.items) {
      box.appendChild(makeRow(item, index++, group));
    }

    container.appendChild(heading);
    container.appendChild(box);
    outerBox.appendChild(container);
  }
  return outerBox;
}

// Wires up one page's list. actionBtn is Export / Open (off while nothing is
// ticked). shownDisplay is the display a search gives the list when it shows
// it again ('' = stylesheet default).
// Returns { checkboxes, updateSelectionCount, render, clearSearch }.
// Select all / Deselect all skip rows the search hides and disabled rows.
function createAddonList({ listEl, countEl, actionBtn, selectAllBtn, deselectAllBtn, searchInput, noMatchesEl, shownDisplay = '' }) {
  const checkboxes = () => listEl.querySelectorAll('input[type="checkbox"]');

  function updateSelectionCount() {
    const boxes = checkboxes();
    const checked = listEl.querySelectorAll('input[type="checkbox"]:checked').length;
    setSelectionCount(countEl, boxes.length ? `${checked} of ${boxes.length} selected` : '');
    actionBtn.disabled = checked === 0;
  }

  // Shows the groups from createAddonGroups(). A search already in the box is
  // applied again, so the box and the rows never disagree (the Importer
  // redraws when another export is picked).
  function render(outerBox) {
    const fragment = document.createDocumentFragment();
    fragment.appendChild(outerBox);
    listEl.replaceChildren(fragment);
    checkboxes().forEach((cb) => {
      cb.addEventListener('change', updateSelectionCount);
    });
    if (searchInput.value) applySearch();
  }

  function applySearch() {
    const anyMatch = filterAddonRows(listEl, searchInput.value);
    setFilterVisible(listEl, anyMatch, shownDisplay);
    noMatchesEl.style.display = anyMatch ? 'none' : 'block';
  }

  // Empties the search box and shows the whole list, like a freshly opened
  // page (see answerWhereIsPage). Does nothing when the box is already empty,
  // so it can't un-hide a list that is hidden for another reason.
  function clearSearch() {
    if (!searchInput.value) return;
    searchInput.value = '';
    applySearch();
  }

  selectAllBtn.addEventListener('click', () => {
    visibleCheckboxes(checkboxes()).forEach((cb) => { if (!cb.disabled) cb.checked = true; });
    updateSelectionCount();
  });
  deselectAllBtn.addEventListener('click', () => {
    visibleCheckboxes(checkboxes()).forEach((cb) => { if (!cb.disabled) cb.checked = false; });
    updateSelectionCount();
  });

  searchInput.addEventListener('input', applySearch);

  // The names follow the Shorten setting live. What a search matches changes
  // with them, so a search in progress is applied again.
  onShortenNamesChanged((shorten) => {
    if (applyNameShortening(listEl, shorten) > 0 && searchInput.value) applySearch();
  });

  // Makes the whole row clickable. A click on the checkbox itself is left alone
  // (it toggles natively). Anything else in the row calls cb.click(), and the
  // preventDefault stops the label forwarding its own click so it doesn't
  // toggle twice.
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

  return { checkboxes, updateSelectionCount, render, clearSearch };
}
