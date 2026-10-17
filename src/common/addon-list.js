// The add-on list shared by the Exporter and the Importer: the same rows,
// groups, Select all / Deselect all, search box, "3 of 12 selected" badge,
// click-anywhere-on-the-row and live name shortening. Each page passes its
// elements and keeps only what is its own (the Exporter's export call, the
// Importer's matching, notes and tab opening). Loaded by those two pages after
// core.js and page-ui.js.

// Builds one add-on row's common parts - the checkbox, the name (which follows
// the Shorten setting), the version and the type - and returns { row,
// checkbox, label }, with the checkbox and label already in the row. The page
// adds what is its own: extra things in the label or after it (a match label, a
// warning, the AMO link).
//   idPrefix  the checkbox id is `${idPrefix}-${index}` (unique per page)
//   dataset   data-* values for the checkbox (what the page reads back)
//   checked   the checkbox starts ticked
//   disabled  the row is skipped (unsafe link): disabled checkbox, "row-disabled"
// Built with DOM APIs, never innerHTML, so names and versions never pass
// through HTML parsing.
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
  nameEl.dataset.fullName = a.name; // so the name can follow the Shorten setting live

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

// Builds the outer box with one group (heading + box of rows) per non-empty
// entry of `groups` ([{ title, items }]), numbering the rows 0, 1, 2... across
// all the groups. makeRow(item, index, group) returns each row's element.
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

// Wires up one page's list and returns its controls:
//   listEl, countEl, actionBtn (Export / Open: off while nothing is ticked),
//   selectAllBtn, deselectAllBtn, searchInput, noMatchesEl
//   shownDisplay  what display the list gets when a search shows it again
//                 ('' = stylesheet default)
// Returns { checkboxes, updateSelectionCount, render, clearSearch }.
// Select all / Deselect all only touch rows the search still shows, and never a
// disabled one.
function createAddonList({ listEl, countEl, actionBtn, selectAllBtn, deselectAllBtn, searchInput, noMatchesEl, shownDisplay = '' }) {
  const checkboxes = () => listEl.querySelectorAll('input[type="checkbox"]');

  function updateSelectionCount() {
    const boxes = checkboxes();
    const checked = listEl.querySelectorAll('input[type="checkbox"]:checked').length;
    setSelectionCount(countEl, boxes.length ? `${checked} of ${boxes.length} selected` : '');
    actionBtn.disabled = checked === 0;
  }

  // Shows the groups built by createAddonGroups() and makes every checkbox
  // update the count. The page updates the count itself once it has finished
  // its own bits of rendering. Redrawing an already-searched list (the
  // Importer, when another export is chosen) applies the query again, so the
  // search box and the rows can never end up disagreeing.
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

  // Empties the search box and shows the whole list again - the unfiltered
  // list a freshly opened page has. Used when an already-open page is brought
  // back to the front from the popup (see answerWhereIsPage), which opens it
  // exactly like a fresh one. A no-op when there is nothing typed, so it can
  // never un-hide a list that is hidden for another reason (the Importer with
  // no file chosen yet).
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

  // "Shorten add-on names" changed (Settings page, a settings import, a reset):
  // the names on this already-open page change at once. What the search box
  // matches changes with them, so a search in progress is applied again.
  onShortenNamesChanged((shorten) => {
    if (applyNameShortening(listEl, shorten) > 0 && searchInput.value) applySearch();
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

  return { checkboxes, updateSelectionCount, render, clearSearch };
}
