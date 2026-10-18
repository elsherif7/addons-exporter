// Page-only helpers (fade to the confirmation page, search filtering, the
// selection count, live name shortening). Loaded by pages after core.js, never
// by the background.

// Same as formatLabelsText, but appended to `container` with each label in <strong>.
function appendFormatLabels(container, fmts) {
  const labels = resolveExportFormats(fmts).map(formatLabel);
  labels.forEach((label, i) => {
    if (i > 0) container.append(i === labels.length - 1 ? ' and ' : ', ');
    const strong = document.createElement('strong');
    strong.textContent = label;
    container.append(strong);
  });
}

// Select all / Deselect all only touch what the search still shows.
function visibleCheckboxes(allCheckboxes) {
  return Array.from(allCheckboxes).filter((cb) => cb.closest('.addon-row').style.display !== 'none');
}

// Shows or hides `el` the way search does: display plus an .is-filtered class,
// which shared.css turns into a fade. `shownDisplay` is the display when
// visible ('' = stylesheet default).
function setFilterVisible(el, visible, shownDisplay = '') {
  el.style.display = visible ? shownDisplay : 'none';
  if (el.classList) el.classList.toggle('is-filtered', !visible);
}

// Filters rows by the search query, matched against the name only (not the
// version or labels), and hides a group when none of its rows match. Returns
// true if anything is visible.
//
// NOTE: report-inline.js has its own copy of this and of setFilterVisible()
// (a saved report can't load this file). Keep them in sync.
function filterAddonRows(container, query) {
  const q = query.trim().toLowerCase();
  let anyMatch = false;

  // Groups can sit at any depth (they're inside .groups-outer-box), hence
  // querySelectorAll.
  for (const el of container.querySelectorAll('.group-container')) {
    const box = el.querySelector('.group-box');
    let groupHasMatch = false;
    if (box) {
      for (const child of box.children) {
        if (child.classList.contains('addon-row')) {
          const nameEl = child.querySelector('.addon-name');
          const match = q === '' || (nameEl && nameEl.textContent.toLowerCase().includes(q));
          setFilterVisible(child, match);
          if (match) { groupHasMatch = true; anyMatch = true; }
        }
      }
    }
    setFilterVisible(el, groupHasMatch);
  }

  return anyMatch;
}

// When the Exporter or Importer finishes, the page fades out and the
// confirmation page replaces it in the same tab. Skipped for reduced motion,
// so callers can always just await it.
const PAGE_FADE_MS = 380;

// Resolves once the card has faded out, with the animation (held at its last
// frame) so the caller can undo it, or null if nothing was animated.
async function fadeOutPage() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const card = document.querySelector('.card');
  if (!card || typeof card.animate !== 'function') return null;
  try {
    const anim = card.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(-24px) scale(0.95)' },
      ],
      { duration: PAGE_FADE_MS, easing: 'ease-in', fill: 'forwards' }
    );
    await anim.finished;
    return anim;
  } catch {
    return null; // cosmetic only, never block the hand-off
  }
}

// `query` is the confirmation page's query string, e.g. 'from=export&format=csv'.
// location.replace so the back button doesn't return to a finished page.
async function goToConfirmation(query) {
  const anim = await fadeOutPage();
  try {
    location.replace(browser.runtime.getURL(`src/confirmation/confirmation.html?${query}`));
  } catch (e) {
    if (anim) { try { anim.cancel(); } catch { /* already gone */ } }
    throw e;
  }
}

// Restarts the page's entrance animation, for an already-open tab that gets
// brought back to the front (Settings, for example). shared.css's
// .replay-reset switches the animations off for one frame and the forced
// reflow makes them start over.
function replayEntrance() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const card = document.querySelector('.card');
  if (!card || !card.classList) return;
  card.classList.add('replay-reset');
  void card.offsetWidth;
  card.classList.remove('replay-reset');
}

// Smooth scroll back to the top (instant with reduced motion).
function scrollPageToTop() {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, left: 0, behavior: reduced ? 'auto' : 'smooth' });
}

// Replays the staged reveal (reveal.js) on the Exporter and Importer. Rows only
// animate while their list has .revealing, so this puts the flag back and
// removes it once the last row (its --rd delay plus its own wipe) is done.
// What is on the page is left alone (see answerWhereIsPage).
function replayStagedReveal() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const list = document.getElementById('addonList');
  const rows = list && typeof list.querySelectorAll === 'function' ? list.querySelectorAll('.addon-row') : [];
  if (rows.length) {
    let longest = 0;
    for (const row of rows) {
      const delay = parseFloat(row.style && row.style.getPropertyValue('--rd'));
      if (delay > longest) longest = delay;
    }
    list.classList.add('revealing');
    // A row's own wipe takes 0.55s (ROW_DURATION in reveal.js), plus a margin.
    setTimeout(() => list.classList.remove('revealing'), Math.ceil((longest + 0.85) * 1000));
  }
  replayEntrance();
}

// --- Live settings ---
// Settings changes reach every open page through storage.onChanged. The theme,
// the export format and the Settings options already follow it. These two make
// "Shorten add-on names" follow it too.

// Switches every row's name between its short and full form, using the
// data-full-name it remembers (anything without one is left alone). Returns how
// many names changed, and gives each a quick fade (skipped for reduced motion).
function applyNameShortening(root, shorten) {
  const reduced = typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  let changed = 0;
  for (const nameEl of Array.from(root.querySelectorAll('.addon-name'))) {
    const full = nameEl.dataset && nameEl.dataset.fullName;
    if (full === undefined) continue;
    const next = shorten ? shortName(full) : full;
    if (nameEl.textContent === next) continue;
    nameEl.textContent = next;
    changed++;
    if (!reduced && typeof nameEl.animate === 'function') {
      nameEl.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' });
    }
  }
  return changed;
}

// Calls handler(true or false) when the "Shorten add-on names" setting changes,
// including when a reset removes it (back to the default).
function onShortenNamesChanged(handler) {
  if (typeof browser === 'undefined' || !browser.storage || !browser.storage.onChanged) return;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SHORT_NAME_STORAGE_KEY]) return;
    handler(resolveShortenNames(changes[SHORT_NAME_STORAGE_KEY].newValue) === 'on');
  });
}

// Sets the "12 of 12 selected" badge. When the number changes it plays three
// things at once: the number rolls like a counter (up for more, down for
// fewer), the badge pops, and it flashes green for more or amber for fewer.
// Nothing extra plays the first time it gets text or when it is cleared, or
// with reduced motion. textContent is plain text again once it's over.
const COUNT_ROLL_MS = 380;
const COUNT_UP_TINT = 'rgba(46, 160, 67, 0.4)';
const COUNT_DOWN_TINT = 'rgba(217, 119, 6, 0.35)';
const countText = new WeakMap(); // the badge's real text, even mid-roll

function setSelectionCount(el, text) {
  const before = countText.has(el) ? countText.get(el) : el.textContent;
  countText.set(el, text);
  el.textContent = text; // also ends a roll still on screen
  if (text === before || before === '' || text === '') return;
  if (typeof el.animate !== 'function') return;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const prev = parseInt(before, 10);
  const next = parseInt(text, 10);
  const direction = Number.isFinite(prev) && Number.isFinite(next) ? Math.sign(next - prev) : 0;
  const ease = 'cubic-bezier(0.34, 1.3, 0.64, 1)';

  // the pop
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.35 }, { transform: 'scale(1)' }],
    { duration: 460, easing: ease }
  );
  // the tint
  if (direction !== 0) {
    const tint = direction > 0 ? COUNT_UP_TINT : COUNT_DOWN_TINT;
    el.animate(
      [{ boxShadow: 'inset 0 0 0 999px ' + tint }, { boxShadow: 'inset 0 0 0 999px transparent' }],
      { duration: 700, easing: 'ease-out' }
    );
  }
  // the roll
  const oldNumber = /^(\d+)/.exec(before);
  const parts = /^(\d+)([\s\S]*)$/.exec(text);
  if (!oldNumber || !parts || oldNumber[1] === parts[1] ||
      typeof document === 'undefined' || typeof document.createElement !== 'function') return;

  const slot = document.createElement('span');
  slot.className = 'count-roll';
  const now = document.createElement('span');
  now.className = 'count-roll-now';
  now.textContent = parts[1];
  const old = document.createElement('span');
  old.className = 'count-roll-old';
  old.textContent = oldNumber[1];
  old.setAttribute('aria-hidden', 'true');
  slot.appendChild(now);
  slot.appendChild(old);
  const rest = document.createElement('span');
  rest.textContent = parts[2];
  el.textContent = '';
  el.appendChild(slot);
  el.appendChild(rest);

  const up = direction >= 0; // more selected: the new number comes up from below
  const rolls = [
    now.animate(
      [{ transform: `translateY(${up ? '100%' : '-100%'})` }, { transform: 'none' }],
      { duration: COUNT_ROLL_MS, easing: ease }
    ),
    old.animate(
      [{ transform: 'none' }, { transform: `translateY(${up ? '-100%' : '100%'})` }],
      { duration: COUNT_ROLL_MS, easing: ease, fill: 'forwards' }
    ),
  ];
  // Back to plain text once it's over, unless a newer update took over.
  Promise.all(rolls.map((a) => a.finished)).then(() => {
    if (countText.get(el) === text) el.textContent = text;
  }, () => {});
}

// The popup asks "is the Exporter (or Importer) already open?" before opening
// another: it broadcasts { type: 'whereIsPage', page } and the page with that
// name answers with its own tab so the popup can focus it. Answering also
// means "act like freshly opened": back to the top, reveal replayed, nothing
// left open. `resetToFresh` (optional) is the page's own extra step for that
// (closing its picker, clearing the search). It must never touch the user's
// work: a chosen file, the list and every ticked add-on stay.
function answerWhereIsPage(page, resetToFresh) {
  if (typeof browser === 'undefined' || !browser.runtime || !browser.runtime.onMessage || !browser.tabs || !browser.tabs.getCurrent) return;
  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== 'whereIsPage' || message.page !== page) return undefined;
    scrollPageToTop();
    if (typeof resetToFresh === 'function') resetToFresh();
    replayStagedReveal();
    return browser.tabs.getCurrent().then(
      (tab) => (tab ? { tabId: tab.id, windowId: tab.windowId } : undefined),
      () => undefined
    );
  });
}
