// Opening reveal for the Exporter and Importer pages (the card with class
// "staged"; see shared.css) - the same one the Settings page has: first only
// the background, then the empty card unfolds, then the title settles in,
// then each part of the page in turn from top to bottom (every 0.16s, like
// Settings' sections), and the add-ons cascade in under it, one row after
// another (every 0.08s, like Settings' rows).
//
// This script only decides WHEN. It gives every part its start time in --d
// and each list row its start in --rd; shared.css turns those into the
// animations. The page's parts are timed in page order, so the search box
// (which is hidden until the list has loaded, but marked data-stage) takes
// its place between the text above it and the controls below it, instead of
// popping up ahead of them.
//
// Parts that are revealed later (the add-on list once it has loaded, and on
// the Importer everything below the file picker, once a file is chosen) are
// picked up by a MutationObserver and given the same cadence from that moment.
// Skipped for reduced motion. The saved HTML report cannot load this file, so
// report-template.js carries its own small copy of the same idea.
(function () {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // --- timings, in seconds - the same cadence as the Settings page ------------
  const START = 0.82;          // first part (Settings: first section at 0.7s, its first row 0.12s later)
  const PART_STEP = 0.16;      // one part of the page after another
  const ROW_LEAD = 0.08;       // the first list row follows its list box by this much
  const ROW_STEP = 0.08;       // one list row after another
  const ROW_ANIMATED_MAX = 14; // rows beyond this just appear together, so a long list stays quick
  const ROW_DURATION = 0.55;

  const startedAt = Date.now();
  const elapsed = () => (Date.now() - startedAt) / 1000;
  const rel = (abs) => Math.max(0, abs - elapsed()); // an absolute time on the page's clock -> a delay from now
  const secs = (abs) => Math.round(rel(abs) * 1000) / 1000 + 's';

  let chromePlanned = false; // the search box and Select all row were part of the opening sequence
  let chromeDone = false;    // ... or were timed later, when the Importer's list first appeared
  let listBase = null;       // when the first row may begin (null: the list is revealed later)

  function planCard() {
    const card = document.querySelector('.card.staged');
    if (!card) return;
    let t = START;
    for (const child of Array.from(card.children)) {
      if (child.tagName === 'H1') continue; // the title has its own, earlier slot (CSS)
      const takesSlot = child.hasAttribute('data-stage') || getComputedStyle(child).display !== 'none';
      if (!takesSlot) continue; // revealed later, whenever it is shown (see onListRendered)

      child.style.setProperty('--d', secs(t));
      if (child.classList.contains('search-input') || child.classList.contains('list-controls')) chromePlanned = true;
      if (child.classList.contains('checklist-box')) listBase = t + ROW_LEAD;
      t += PART_STEP;
    }
  }

  let rowTimer = null;
  function onListRendered(list) {
    const items = Array.from(list.querySelectorAll('.group-heading, .addon-row'))
      .filter((el) => !el.hasAttribute('data-seq'));
    if (!items.some((el) => el.classList.contains('addon-row'))) return;

    // Exporter: the rows start under their list box. Importer: the list shows
    // up when a file is chosen, so the search box, the Select all row and the
    // list box take their turns from that moment, then the rows.
    let base = listBase !== null ? listBase : elapsed();
    if (!chromePlanned && !chromeDone) {
      chromeDone = true;
      let t = base;
      for (const id of ['searchInput', 'listControls', 'checklistBox']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.style.setProperty('--d', secs(t));
        t += PART_STEP;
      }
      base = t - PART_STEP + ROW_LEAD; // right under the list box
    }
    base = Math.max(base, elapsed()); // never schedule rows in the past

    let k = 0;
    for (const item of items) {
      item.setAttribute('data-seq', '');
      item.style.setProperty('--rd', secs(base + Math.min(k, ROW_ANIMATED_MAX) * ROW_STEP));
      k++;
    }
    list.classList.add('revealing');
    const done = base + Math.min(k, ROW_ANIMATED_MAX) * ROW_STEP + ROW_DURATION + 0.3;
    clearTimeout(rowTimer);
    // Take the flag away again once the last row is in, so searching (which
    // hides and re-shows rows) never replays the entrance.
    rowTimer = setTimeout(() => list.classList.remove('revealing'), Math.ceil(rel(done) * 1000));
  }

  planCard();

  const list = document.getElementById('addonList');
  if (list && typeof MutationObserver === 'function') {
    new MutationObserver(() => onListRendered(list)).observe(list, { childList: true, subtree: true });
  }
})();
