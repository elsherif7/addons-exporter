// runs the real report-inline.js (also built into every report by scripts/build-assets.js)
// in a sandbox with a small fake page

const assert = require('assert');
const { test, readSrc, makeSandbox } = require('./helpers');

const SCRIPT = readSrc('src/background/report-inline.js');

function el(extra = {}) {
  const attrs = {};
  const listeners = {};
  const classes = new Set();
  const node = {
    style: {}, children: [], textContent: '', innerHTML: '',
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => { if (force === undefined ? !classes.has(c) : force) classes.add(c); else classes.delete(c); },
    },
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fire: (type, event = {}) => (listeners[type] || []).forEach((fn) => fn(event)),
    querySelector: () => null,
    querySelectorAll: () => [],
    ...extra,
  };
  return node;
}

function makePage(names) {
  const rows = names.map((name) => {
    const nameEl = el({ textContent: name });
    return el({ querySelector: (sel) => (sel === '.addon-name' ? nameEl : null), nameEl });
  });
  rows.forEach((r) => r.classList.add('addon-row'));
  const box = el({ children: rows, querySelector: () => null });
  const group = el({ querySelector: (sel) => (sel === '.group-box' ? box : null) });
  const list = el({ querySelectorAll: (sel) => (sel === '.group-container' ? [group] : []) });
  const ids = { addonList: list, noSearchMatches: el(), themeToggle: el(), searchInput: el() };
  const root = el();
  const document = { documentElement: root, getElementById: (id) => ids[id], querySelector: () => null };
  return { document, ids, root, rows, group, list };
}

function run(page, { baked = 'light', stored = null, storageThrows = false, startViewTransition = false } = {}) {
  const store = {};
  if (stored) store['addons-hub-report-theme'] = stored;
  const transitions = [];
  if (startViewTransition) page.document.startViewTransition = (fn) => { transitions.push('vt'); fn(); };
  const sandbox = makeSandbox({
    document: page.document,
    localStorage: storageThrows
      ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
      : { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    setTimeout, clearTimeout,
  }, SCRIPT.replace('__BAKED_THEME__', baked));
  return { store, transitions };
}

test('report script: starts in the theme the report was exported with', () => {
  const page = makePage(['A']);
  run(page, { baked: 'dark' });
  assert.strictEqual(page.root.getAttribute('data-theme'), 'dark');
});

test('report script: a theme saved in this browser beats the exported one', () => {
  const page = makePage(['A']);
  run(page, { baked: 'light', stored: 'dark' });
  assert.strictEqual(page.root.getAttribute('data-theme'), 'dark');
});

test('report script: junk in storage is ignored, blocked storage still works', () => {
  const junk = makePage(['A']);
  run(junk, { baked: 'light', stored: 'purple' });
  assert.strictEqual(junk.root.getAttribute('data-theme'), 'light');
  const blocked = makePage(['A']);
  run(blocked, { baked: 'dark', storageThrows: true });
  assert.strictEqual(blocked.root.getAttribute('data-theme'), 'dark');
  blocked.ids.themeToggle.fire('click');  // must not throw even though saving fails
  assert.strictEqual(blocked.root.getAttribute('data-theme'), 'light');
});

test('report script: the theme button flips the theme and remembers the choice', () => {
  const page = makePage(['A']);
  const { store } = run(page, { baked: 'light' });
  assert.strictEqual(page.root.getAttribute('data-theme'), 'light');
  page.ids.themeToggle.fire('click');
  assert.strictEqual(page.root.getAttribute('data-theme'), 'dark');
  assert.strictEqual(store['addons-hub-report-theme'], 'dark');
  page.ids.themeToggle.fire('click');
  assert.strictEqual(page.root.getAttribute('data-theme'), 'light');
  assert.strictEqual(store['addons-hub-report-theme'], 'light');
});

test('report script: the first paint never animates the theme; later changes do', () => {
  const page = makePage(['A']);
  const { transitions } = run(page, { baked: 'light', stored: 'dark', startViewTransition: true });
  assert.deepStrictEqual(transitions, [], 'applying the saved theme on load is not a transition');
  page.ids.themeToggle.fire('click');
  assert.deepStrictEqual(transitions, ['vt'], 'a click after load is');
});

test('report script: searching hides the rows and groups that do not match, case-insensitively', () => {
  const page = makePage(['uBlock Origin', 'Dark Reader', 'Privacy Badger']);
  run(page);
  page.ids.searchInput.fire('input', { target: { value: '  DARK ' } });
  assert.deepStrictEqual(page.rows.map((r) => r.style.display), ['none', '', 'none']);
  assert.strictEqual(page.group.style.display, '');
  assert.strictEqual(page.ids.noSearchMatches.style.display, 'none');
  assert.ok(page.rows[0].classList.contains('is-filtered') && !page.rows[1].classList.contains('is-filtered'));
});

test('report script: no match hides the list and shows the "no add-ons match" message; clearing brings everything back', () => {
  const page = makePage(['uBlock Origin', 'Dark Reader']);
  run(page);
  page.ids.searchInput.fire('input', { target: { value: 'zzz' } });
  assert.strictEqual(page.group.style.display, 'none');
  assert.strictEqual(page.list.style.display, 'none');
  assert.strictEqual(page.ids.noSearchMatches.style.display, 'block');
  page.ids.searchInput.fire('input', { target: { value: '' } });
  assert.deepStrictEqual(page.rows.map((r) => r.style.display), ['', '']);
  assert.strictEqual(page.list.style.display, '');
  assert.strictEqual(page.ids.noSearchMatches.style.display, 'none');
});
