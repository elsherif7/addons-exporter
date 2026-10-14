// Page-only helpers: everything that touches the document - the fade to the
// confirmation page, search filtering, the selection count, live name
// shortening. Loaded by the extension's pages after core.js, never by the
// background (it has no document).

// Same list as formatLabelsText, but appended to `container` with each label
// in <strong>, for the messages that bold them.
function appendFormatLabels(container, fmts) {
  const labels = resolveExportFormats(fmts).map(formatLabel);
  labels.forEach((label, i) => {
    if (i > 0) container.append(i === labels.length - 1 ? ' and ' : ', ');
    const strong = document.createElement('strong');
    strong.textContent = label;
    container.append(strong);
  });
}

// Select all/Deselect all only touch what the current search still shows -
// a checked box that gets filtered out of view stays checked.
function visibleCheckboxes(allCheckboxes) {
  return Array.from(allCheckboxes).filter((cb) => cb.closest('.addon-row').style.display !== 'none');
}

// Filters .addon-row elements by search query (matched against each row's
// .addon-name only, not version numbers or match-type labels), hiding a
// .group-box if none of its rows still match. Returns true if
// anything's visible.
//
// Shows or hides `el` the way search filtering does: display plus an
// .is-filtered class, which shared.css turns into a fade out / fade in
// (and which is simply instant where that CSS isn't supported).
// `shownDisplay` is what display becomes when visible ('' = stylesheet
// default).
function setFilterVisible(el, visible, shownDisplay = '') {
  el.style.display = visible ? shownDisplay : 'none';
  if (el.classList) el.classList.toggle('is-filtered', !visible);
}

// NOTE: report-template.js's buildHtmlReport() has its own copy of this
// (and of setFilterVisible above) inlined into the exported report (it
// can't load page-ui.js once saved elsewhere). Keep both copies in sync if
// you change this.
function filterAddonRows(container, query) {
  const q = query.trim().toLowerCase();
  let anyMatch = false;

  // Group containers can sit at any depth - export.js/import.js/the report
  // all wrap them in an outer .groups-outer-box (see appendGroup()/
  // renderList()/renderAddonList()), so they're no longer necessarily
  // direct children of `container`. querySelectorAll finds them
  // regardless of nesting.
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

// Used by export.js and import.js when they finish: the page fades out
// and is replaced, in the same tab, by the confirmation page (instead of
// opening a second tab next to it). The fade uses the Web Animations API
// on the page's .card and is skipped when that isn't available or the
// user has asked for reduced motion, so callers can always just await it.
const PAGE_FADE_MS = 380;

// Resolves once the card has faded out, with the animation (held at its
// final frame) so the caller can undo it, or null if nothing was animated.
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
    return null; // cosmetic only - never block the hand-off
  }
}

// `query` is the confirmation page's query string, e.g. 'from=export&format=csv'.
// location.replace (not assign) so the back button doesn't return to a
// finished export/import page.
async function goToConfirmation(query) {
  const anim = await fadeOutPage();
  try {
    location.replace(browser.runtime.getURL(`src/confirmation/confirmation.html?${query}`));
  } catch (e) {
    if (anim) { try { anim.cancel(); } catch { /* already gone */ } }
    throw e;
  }
}

// Restarts the page's entrance animation (the .card and its children
// spring in again). Used when an already-open tab is brought back to the
// front - e.g. Settings, which Firefox reuses instead of reopening - so it
// gets the same entrance as a freshly opened page. shared.css's
// .replay-reset switches the animations off for one frame; forcing a
// reflow in between makes them start over.
function replayEntrance() {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  const card = document.querySelector('.card');
  if (!card || !card.classList) return;
  card.classList.add('replay-reset');
  void card.offsetWidth;
  card.classList.remove('replay-reset');
}

// --- Live settings ------------------------------------------------------------
// Settings changed anywhere (the Settings page, a settings import, a reset)
// reach every other open extension page through storage.onChanged. The theme
// (theme.js), the export format (export.js) and the Settings page's own
// options already follow it; these two make "Shorten add-on names" follow it
// too, so the names on an already-open Exporter or Importer change the moment
// the setting does.

// Switches every row's name between its short and its full form, in place.
// Rows remember their full name (data-full-name); anything without one is
// left alone. Returns how many names changed, and gives each a quick fade so
// the change is noticed (skipped for reduced motion).
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

// Calls handler(shorten) - true or false - whenever the "Shorten add-on
// names" setting changes in storage, including when a reset removes it (which
// means back to the default).
function onShortenNamesChanged(handler) {
  if (typeof browser === 'undefined' || !browser.storage || !browser.storage.onChanged) return;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SHORT_NAME_STORAGE_KEY]) return;
    handler(resolveShortenNames(changes[SHORT_NAME_STORAGE_KEY].newValue) === 'on');
  });
}

// Sets the "12 of 12 selected" badge's text. When the number CHANGES it plays
// a clear animation, in three parts at once:
//  1. the number ROLLS over like a counter - the new one slides in while the
//     old one slides out (upwards when more are selected, downwards when
//     fewer), clipped to a little slot around the number;
//  2. the whole badge POPS up in size and settles;
//  3. it FLASHES a tint that shows the direction: green for more, amber for
//     fewer (no tint when only the total changed).
// The first time the badge gets text, or when it is cleared, nothing extra
// plays (the badge's own fade-in covers that). Skipped for reduced motion.
// textContent is always the plain text again once the animation is over.
const COUNT_ROLL_MS = 380;
const COUNT_UP_TINT = 'rgba(46, 160, 67, 0.4)';
const COUNT_DOWN_TINT = 'rgba(217, 119, 6, 0.35)';
const countText = new WeakMap(); // the badge's real text, even while a roll is on screen

function setSelectionCount(el, text) {
  const before = countText.has(el) ? countText.get(el) : el.textContent;
  countText.set(el, text);
  el.textContent = text; // also ends any roll that is still on screen
  if (text === before || before === '' || text === '') return;
  if (typeof el.animate !== 'function') return;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const prev = parseInt(before, 10);
  const next = parseInt(text, 10);
  const direction = Number.isFinite(prev) && Number.isFinite(next) ? Math.sign(next - prev) : 0;
  const ease = 'cubic-bezier(0.34, 1.3, 0.64, 1)';

  // 2. the pop
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.35 }, { transform: 'scale(1)' }],
    { duration: 460, easing: ease }
  );
  // 3. the tint
  if (direction !== 0) {
    const tint = direction > 0 ? COUNT_UP_TINT : COUNT_DOWN_TINT;
    el.animate(
      [{ boxShadow: 'inset 0 0 0 999px ' + tint }, { boxShadow: 'inset 0 0 0 999px transparent' }],
      { duration: 700, easing: 'ease-out' }
    );
  }
  // 1. the roll
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
  // Back to plain text once it is over - unless a newer update already took over.
  Promise.all(rolls.map((a) => a.finished)).then(() => {
    if (countText.get(el) === text) el.textContent = text;
  }, () => {});
}
