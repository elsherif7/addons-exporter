// Opening reveal for the Exporter and Importer (the card with class "staged";
// see shared.css). Same as the Settings page: the empty card unfolds, the
// title settles in, then each part of the page in turn from top to bottom, and
// the add-ons cascade in one row after another. The Exporter's button comes
// last.
//
// This script only decides WHEN. It writes each part's start time to --d and
// each row's to --rd, and shared.css does the animating. Parts shown later (the
// add-on list once loaded, everything under the Importer's file picker) are
// caught by a MutationObserver and timed from that moment. Skipped for reduced
// motion. report-inline.js has its own small copy for the saved report.
(function () {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // timings in seconds, same cadence as the Settings page
  const START = 0.82;
  const PART_STEP = 0.16;      // one part after another
  const ROW_LEAD = 0.08;       // first row follows its list box by this much
  const ROW_STEP = 0.08;
  const ROW_ANIMATED_MAX = 14; // rows past this appear together, so long lists stay quick
  const ROW_DURATION = 0.55;
  const BUTTON_AFTER_LAST = 0.4;

  const startedAt = Date.now();
  const elapsed = () => (Date.now() - startedAt) / 1000;
  const rel = (abs) => Math.max(0, abs - elapsed()); // a time on the page's clock -> a delay from now
  const secs = (abs) => Math.round(rel(abs) * 1000) / 1000 + 's';

  let chromePlanned = false; // search box and Select all row were timed in the opening
  let chromeDone = false;    // or later, when the Importer's list first showed
  let listBase = null;       // when the first row may begin (null: list shows later)
  let holdBtn = null;        // Exporter button waits until the last add-on is in
  let holdFrom = 0;          // but never earlier than its normal slot

  function planCard() {
    const card = document.querySelector('.card.staged');
    if (!card) return;
    let t = START;
    for (const child of Array.from(card.children)) {
      if (child.tagName === 'H1') continue; // the title has its own earlier slot (CSS)
      // data-stage parts take a slot even while hidden (the search box)
      const takesSlot = child.hasAttribute('data-stage') || getComputedStyle(child).display !== 'none';
      if (!takesSlot) continue; // timed later, when it is shown (see onListRendered)

      if (child.classList.contains('primary-btn') && listBase !== null) {
        // Park the button far in the future; onListRendered gives it its real time.
        holdBtn = child;
        holdFrom = t;
        child.style.setProperty('--d', '3600s');
        t += PART_STEP;
        continue;
      }
      child.style.setProperty('--d', secs(t));
      if (child.classList.contains('search-input') || child.classList.contains('list-controls')) chromePlanned = true;
      if (child.classList.contains('checklist-box')) listBase = t + ROW_LEAD;
      t += PART_STEP;
    }
  }

  let rowTimer = null;
  function releaseButton(abs) {
    if (!holdBtn) return;
    holdBtn.style.setProperty('--d', secs(Math.max(abs, holdFrom)));
    holdBtn = null;
  }

  function onListRendered(list) {
    const items = Array.from(list.querySelectorAll('.group-heading, .addon-row'))
      .filter((el) => !el.hasAttribute('data-seq'));
    if (!items.some((el) => el.classList.contains('addon-row'))) {
      // nothing to cascade (no add-ons, or an error message)
      releaseButton(0);
      return;
    }

    // Exporter: rows start under their list box. Importer: the list shows when
    // a file is chosen, so the search box, Select all row and list box take
    // their turns from then, and the rows come after.
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
      base = t - PART_STEP + ROW_LEAD;
    }
    base = Math.max(base, elapsed()); // never schedule rows in the past

    let k = 0;
    for (const item of items) {
      item.setAttribute('data-seq', '');
      item.style.setProperty('--rd', secs(base + Math.min(k, ROW_ANIMATED_MAX) * ROW_STEP));
      k++;
    }
    list.classList.add('revealing');
    releaseButton(base + Math.min(k - 1, ROW_ANIMATED_MAX) * ROW_STEP + BUTTON_AFTER_LAST);
    const done = base + Math.min(k, ROW_ANIMATED_MAX) * ROW_STEP + ROW_DURATION + 0.3;
    clearTimeout(rowTimer);
    // Remove the flag once the last row is in, so searching never replays the entrance.
    rowTimer = setTimeout(() => list.classList.remove('revealing'), Math.ceil(rel(done) * 1000));
  }

  planCard();

  const list = document.getElementById('addonList');
  if (list && typeof MutationObserver === 'function') {
    new MutationObserver(() => onListRendered(list)).observe(list, { childList: true, subtree: true });
  }
})();
