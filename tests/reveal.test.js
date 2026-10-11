// Tests for src/common/reveal.js - the opening of the Exporter and Importer
// pages, which has the same cadence as the Settings page: each part of the
// page in turn from top to bottom (every 0.16s), the add-ons cascading in
// under it (every 0.08s).
const assert = require('assert');
const vm = require('vm');
const { test, readSrc } = require('./helpers');

const revealSrc = readSrc('src/common/reveal.js');

// --- a tiny DOM: just enough tree for reveal.js -------------------------------
class TextNode {
  constructor(text) { this.nodeType = 3; this.textContent = text; this.parentNode = null; }
}
class El {
  constructor(tag, { id = '', classes = [], attrs = {}, hidden = false, text = null } = {}) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = { ...attrs };
    this.hidden = hidden;
    this.classes = new Set(classes);
    this.vars = {};
    this.style = { setProperty: (k, v) => { this.vars[k] = v; }, animationDelay: '' };
    this.classList = {
      contains: (c) => this.classes.has(c),
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
    };
    if (text !== null) this.appendChild(new TextNode(text));
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.childNodes = v === '' ? [] : [Object.assign(new TextNode(v), { parentNode: this })]; }
  appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }
  replaceChild(incoming, old) {
    const list = incoming.isFragment ? incoming.childNodes : [incoming];
    list.forEach((n) => { n.parentNode = this; });
    this.childNodes.splice(this.childNodes.indexOf(old), 1, ...list);
    old.parentNode = null;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k) { return k in this.attrs; }
  _matches(simple) {
    if (simple.startsWith('#')) return this.id === simple.slice(1);
    if (simple.startsWith('.')) return this.classes.has(simple.slice(1));
    return this.tagName === simple.toUpperCase();
  }
  querySelectorAll(sel) {
    const parts = sel.split(',').map((s) => s.trim());
    const out = [];
    const walk = (el) => {
      for (const child of el.childNodes) {
        if (child.nodeType !== 1) continue;
        if (parts.some((p) => child._matches(p))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

// Builds a card and loads reveal.js against it. `time` is a mutable clock.
function load({ card, byId = {}, reducedMotion = false, time = { t: 1000000 }, noCard = false } = {}) {
  const timers = [];
  const cleared = [];
  const observers = [];
  const sandbox = {
    document: {
      querySelector: (sel) => (sel === '.card.staged' && !noCard ? card : null),
      getElementById: (id) => byId[id] || null,
      createElement: (tag) => new El(tag),
      createDocumentFragment: () => ({ isFragment: true, childNodes: [], appendChild(n) { this.childNodes.push(n); } }),
    },
    getComputedStyle: (el) => ({ display: el.hidden ? 'none' : 'block' }),
    matchMedia: () => ({ matches: reducedMotion }),
    MutationObserver: function (cb) {
      this.cb = cb;
      this.observe = (target, opts) => { this.target = target; this.opts = opts; };
      observers.push(this);
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { cleared.push(id); },
    Date: { now: () => time.t },
  };
  vm.createContext(sandbox);
  vm.runInContext(revealSrc, sandbox);
  return { timers, cleared, observers, time };
}

const secs = (el, name) => parseFloat(el.vars[name]);
const r3 = (n) => Math.round(n * 1000) / 1000;

function exporterCard() {
  const card = new El('div', { classes: ['card', 'staged'] });
  const h1 = card.appendChild(new El('h1', { text: 'Add-ons Exporter' }));
  const desc = card.appendChild(new El('p', { id: 'exportDesc', classes: ['intro-text'], text: 'Select the add-ons you want to export.' }));
  const search = card.appendChild(new El('input', { id: 'searchInput', classes: ['search-input'], attrs: { placeholder: 'Search add-ons...', 'data-stage': '' }, hidden: true }));
  const controls = card.appendChild(new El('div', { classes: ['list-controls'] }));
  controls.appendChild(new El('button', { id: 'selectAllBtn', text: 'Select all' }));
  const count = controls.appendChild(new El('span', { id: 'selectionCount' }));
  const box = card.appendChild(new El('div', { classes: ['checklist-box'] }));
  const list = box.appendChild(new El('div', { id: 'addonList' }));
  const exportBtn = card.appendChild(new El('button', { id: 'exportSelectedBtn', classes: ['primary-btn', 'hub-btn'], text: 'Export Selected' }));
  return { card, h1, desc, search, controls, count, box, list, exportBtn };
}

function addRows(list, n, { headings = 0 } = {}) {
  const items = [];
  for (let i = 0; i < headings; i++) items.push(list.appendChild(new El('div', { classes: ['group-heading'], text: `Group ${i} (${n})` })));
  for (let i = 0; i < n; i++) {
    const row = list.appendChild(new El('div', { classes: ['addon-row'] }));
    row.appendChild(new El('input', { attrs: { type: 'checkbox' } }));
    row.appendChild(new El('span', { classes: ['addon-name'], text: `Add-on ${i}` }));
    items.push(row);
  }
  return items;
}

// ---------------------------------------------------------------------------

test('reveal: it only decides timing - no text is split, hidden or rewritten', () => {
  const p = exporterCard();
  load({ card: p.card, byId: { addonList: p.list } });
  assert.strictEqual(p.h1.textContent, 'Add-ons Exporter');
  assert.strictEqual(p.desc.textContent, 'Select the add-ons you want to export.');
  assert.strictEqual(p.search.getAttribute('placeholder'), 'Search add-ons...', 'the placeholder is never touched');
  assert.strictEqual(p.exportBtn.textContent, 'Export Selected');
});

test('reveal: parts come one after another, top to bottom, every 0.16s - the pace of the Settings sections', () => {
  const p = exporterCard();
  load({ card: p.card, byId: { addonList: p.list } });
  const parts = [p.desc, p.search, p.controls, p.box, p.exportBtn];
  const starts = parts.map((el) => secs(el, '--d'));
  assert.strictEqual(starts[0], 0.82, 'the first part waits for the card and the title');
  starts.forEach((v, i) => { if (i) assert.strictEqual(r3(v - starts[i - 1]), 0.16, `part ${i + 1} follows part ${i} by 0.16s`); });
});

test('reveal: the title is not given a start time here (its slot is fixed in the stylesheet)', () => {
  const p = exporterCard();
  load({ card: p.card, byId: { addonList: p.list } });
  assert.deepStrictEqual(Object.keys(p.h1.vars), []);
});

test('reveal: the search box is hidden until the list has loaded, yet still takes its place between the text and the controls', () => {
  const p = exporterCard();
  load({ card: p.card, byId: { addonList: p.list } });
  assert.ok(secs(p.search, '--d') > secs(p.desc, '--d'), 'after the text above it');
  assert.ok(secs(p.search, '--d') < secs(p.controls, '--d'), 'before the Select all row');
});

test('reveal: a part that is hidden and not marked data-stage gets no slot and leaves no gap', () => {
  const p = exporterCard();
  p.search.hidden = true;
  delete p.search.attrs['data-stage'];
  load({ card: p.card, byId: { addonList: p.list } });
  assert.strictEqual(p.search.vars['--d'], undefined);
  assert.strictEqual(r3(secs(p.controls, '--d') - secs(p.desc, '--d')), 0.16, 'the controls follow the text directly');
});

test('reveal: the add-ons cascade in under their list box, one every 0.08s, headings first', () => {
  const p = exporterCard();
  const ctx = load({ card: p.card, byId: { addonList: p.list } });
  const items = addRows(p.list, 3, { headings: 1 });
  const listObserver = ctx.observers.find((o) => o.target === p.list);
  assert.strictEqual(JSON.stringify(listObserver.opts), JSON.stringify({ childList: true, subtree: true }));
  listObserver.cb();

  const starts = items.map((i) => secs(i, '--rd'));
  assert.strictEqual(r3(starts[0] - secs(p.box, '--d')), 0.08, 'the first row follows its list box by 0.08s');
  starts.forEach((v, i) => { if (i) assert.strictEqual(r3(v - starts[i - 1]), 0.08, 'one every 0.08s'); });
  assert.strictEqual(p.list.classes.has('revealing'), true);
});

test('reveal: only the first 14 items cascade; the rest appear together right after', () => {
  const p = exporterCard();
  const ctx = load({ card: p.card, byId: { addonList: p.list } });
  const items = addRows(p.list, 40);
  ctx.observers.find((o) => o.target === p.list).cb();
  assert.strictEqual(items[14].vars['--rd'], items[39].vars['--rd'], 'the long tail does not stretch out');
  assert.ok(secs(items[14], '--rd') > secs(items[13], '--rd'));
});

test('reveal: the .revealing flag is taken away again after the last row, so searching never replays the entrance', () => {
  const p = exporterCard();
  const ctx = load({ card: p.card, byId: { addonList: p.list } });
  addRows(p.list, 3);
  const before = ctx.timers.length;
  ctx.observers.find((o) => o.target === p.list).cb();
  const removal = ctx.timers[ctx.timers.length - 1];
  assert.ok(ctx.timers.length > before);
  assert.ok(removal.ms > 1500, 'long enough for the last row to finish its 0.55s wipe');
  removal.fn();
  assert.strictEqual(p.list.classes.has('revealing'), false);
});

test('reveal: the observer firing again for the page\'s own later edits does not move rows that are already animating', () => {
  const p = exporterCard();
  const ctx = load({ card: p.card, byId: { addonList: p.list } });
  const items = addRows(p.list, 3);
  const cb = ctx.observers.find((o) => o.target === p.list).cb;
  cb();
  const first = items.map((i) => i.vars['--rd']);
  const timersAfterFirst = ctx.timers.length;
  cb();
  assert.deepStrictEqual(items.map((i) => i.vars['--rd']), first, 'start times of running animations must not change');
  assert.strictEqual(ctx.timers.length, timersAfterFirst, 'and no new timers are started');
});

test('reveal: rows are never scheduled in the past, even if the list loads late', () => {
  const p = exporterCard();
  const time = { t: 1000000 };
  const ctx = load({ card: p.card, byId: { addonList: p.list }, time });
  time.t += 10000; // the list arrives 10 seconds in
  const items = addRows(p.list, 3);
  ctx.observers.find((o) => o.target === p.list).cb();
  const starts = items.map((i) => secs(i, '--rd'));
  assert.strictEqual(starts[0], 0, 'the first row starts right away');
  assert.ok(starts[1] > 0 && starts[2] > starts[1], 'but the rest still cascade');
});

test('reveal: an empty list (placeholder text only) starts no row reveal', () => {
  const p = exporterCard();
  const ctx = load({ card: p.card, byId: { addonList: p.list } });
  p.list.appendChild(new El('p', { classes: ['placeholder-text'], text: 'No add-ons found' }));
  ctx.observers.find((o) => o.target === p.list).cb();
  assert.strictEqual(p.list.classes.has('revealing'), false);
});

// --- the Importer: the list, search box and controls only appear after a file is chosen ---

function importerCard() {
  const card = new El('div', { classes: ['card', 'staged'] });
  const h1 = card.appendChild(new El('h1', { text: 'Add-ons Importer' }));
  const p1 = card.appendChild(new El('p', { classes: ['intro-text'], text: 'Pick an exported file.' }));
  const p2 = card.appendChild(new El('p', { classes: ['intro-text'], text: 'Note: Firefox cannot install add-ons itself.' }));
  const picker = card.appendChild(new El('div', { id: 'picker', classes: ['picker'] }));
  picker.appendChild(new El('button', { id: 'chooseFileBtn', text: 'Choose file' }));
  const search = card.appendChild(new El('input', { id: 'searchInput', classes: ['search-input'], attrs: { placeholder: 'Search add-ons...' }, hidden: true }));
  const controls = card.appendChild(new El('div', { id: 'listControls', classes: ['list-controls'], hidden: true }));
  controls.appendChild(new El('button', { id: 'selectAllBtn', text: 'Select all' }));
  const box = card.appendChild(new El('div', { id: 'checklistBox', classes: ['checklist-box'], hidden: true }));
  const list = box.appendChild(new El('div', { id: 'addonList' }));
  const openBtn = card.appendChild(new El('button', { id: 'openSelectedBtn', classes: ['primary-btn', 'hub-btn'], text: 'Open Selected' }));
  return { card, h1, p1, p2, picker, search, controls, box, list, openBtn };
}

test('reveal (Importer): the two paragraphs, the picker and the main button come in order, 0.16s apart', () => {
  const p = importerCard();
  load({ card: p.card, byId: { addonList: p.list, searchInput: p.search, listControls: p.controls, checklistBox: p.box } });
  const starts = [p.p1, p.p2, p.picker, p.openBtn].map((el) => secs(el, '--d'));
  assert.strictEqual(starts[0], 0.82);
  starts.forEach((v, i) => { if (i) assert.strictEqual(r3(v - starts[i - 1]), 0.16); });
});

test('reveal (Importer): parts hidden at first get no slot - they are timed when a file is chosen', () => {
  const p = importerCard();
  load({ card: p.card, byId: { addonList: p.list, searchInput: p.search, listControls: p.controls, checklistBox: p.box } });
  for (const later of [p.search, p.controls, p.box]) assert.strictEqual(later.vars['--d'], undefined);
});

test('reveal (Importer): when a file is chosen, the search box, Select all row, list box and then the rows take their turns from that moment', () => {
  const p = importerCard();
  const time = { t: 1000000 };
  const ctx = load({ card: p.card, byId: { addonList: p.list, searchInput: p.search, listControls: p.controls, checklistBox: p.box }, time });
  time.t += 5000; // the user picks a file five seconds in
  const rows = addRows(p.list, 2);
  ctx.observers.find((o) => o.target === p.list).cb();

  assert.strictEqual(secs(p.search, '--d'), 0, 'the search box right away');
  assert.strictEqual(secs(p.controls, '--d'), 0.16);
  assert.strictEqual(secs(p.box, '--d'), 0.32);
  assert.strictEqual(secs(rows[0], '--rd'), 0.4, 'the first row 0.08s after the list box');
  assert.strictEqual(secs(rows[1], '--rd'), 0.48);
  assert.strictEqual(p.search.getAttribute('placeholder'), 'Search add-ons...', 'the placeholder is never touched');
});

test('reveal (Importer): a second file only re-times the rows - the search box and buttons are not redone', () => {
  const p = importerCard();
  const ctx = load({ card: p.card, byId: { addonList: p.list, searchInput: p.search, listControls: p.controls, checklistBox: p.box } });
  addRows(p.list, 2);
  const cb = ctx.observers.find((o) => o.target === p.list).cb;
  cb();
  const searchTiming = p.search.vars['--d'];
  p.list.childNodes = [];
  const second = addRows(p.list, 2);
  cb();
  assert.ok(second[0].vars['--rd'], 'new rows get their turn');
  assert.strictEqual(p.search.vars['--d'], searchTiming);
});

// --- switches and edge cases -------------------------------------------------

test('reveal: with reduced motion nothing is timed - the page is simply there', () => {
  const p = exporterCard();
  const ctx = load({ card: p.card, byId: { addonList: p.list }, reducedMotion: true });
  assert.strictEqual(p.desc.vars['--d'], undefined);
  assert.strictEqual(ctx.observers.length, 0);
});

test('reveal: a page with no staged card, or no document at all, is left alone', () => {
  load({ card: null, noCard: true });
  const bare = {};
  vm.createContext(bare);
  vm.runInContext(revealSrc, bare);
});
