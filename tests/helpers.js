// Shared test infrastructure for every *.test.js file in this folder: thin
// wrappers over Node's built-in test runner (node:test), plus the loading
// helpers and the minimal fake DOM below. No dependencies.
//
// Run everything:        npm test            (node --test)
// Run one file:          node --test tests/import.test.js
// Filter by test name:   node --test --test-name-pattern="zip" 
// Coverage of src/:      npm run test:coverage   (c8; see tests/coverage-preload.js)

const nodeTest = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// A synchronous test. Same signature as before the move to node:test.
function test(name, fn) {
  nodeTest.test(name, fn);
}

// An async test (the function returns a promise). A promise that never
// settles fails after timeoutMs instead of hanging the run.
const DEFAULT_ASYNC_TIMEOUT_MS = 5000;

function testAsync(name, fn, timeoutMs = DEFAULT_ASYNC_TIMEOUT_MS) {
  nodeTest.test(name, { timeout: timeoutMs }, fn);
}

// Reads a file relative to the project root (one level up from tests/),
// so every *.test.js file can say readSrc('src/common/core.js') instead
// of repeating path.join(__dirname, '..', ...) at each call site.
function readSrc(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

// Several source files read as one script, for tests that load "all the shared
// code" into one sandbox. (Which file loads in which context, and in what
// order, is checked for real in tests/script-order.test.js.)
function readSrcs(...relativePaths) {
  return relativePaths.map(readSrc).join('\n');
}
// The shared helpers: core.js + page-ui.js + addon-list.js + the background's amo.js.
function readCommon() {
  return readSrcs('src/common/core.js', 'src/common/page-ui.js', 'src/common/addon-list.js', 'src/background/amo.js');
}
// The Importer: its readers, its matching and the page script.
function readImport() {
  return readSrcs('src/common/crc32.js', 'src/import/parsers.js', 'src/import/match.js', 'src/import/zip-reader.js', 'src/import/import.js');
}
// The Settings page: the settings-file code and the page script.
function readSettings() {
  return readSrcs('src/settings/settings-file.js', 'src/settings/settings.js');
}
// Every export builder: JSON/CSV/TXT (export-formats.js) + the HTML report and its generated assets.
function readReportBuilders() {
  return readSrcs('src/background/export-formats.js', 'src/background/report-assets.generated.js', 'src/background/report-template.js');
}

// Evaluates an identifier or expression directly in a vm context instead
// of destructuring it off the sandbox object. Needed for anything the
// loaded source declares with top-level const/let - function declarations
// and var get copied onto the sandbox object when a script runs in it,
// but const/let don't, so those have to be read this way instead.
function evalInContext(sandbox, expr) {
  return vm.runInContext(expr, sandbox);
}

// A deep copy that leaves the vm sandbox's realm: a value built inside a
// context has that context's Object prototype, which deepStrictEqual rejects,
// so tests copy values out with this before comparing them.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// The data an HTML report embeds (its <script id="addons-exporter-data">
// block), parsed back into a plain object. The report escapes "/" as "\/"
// inside that JSON, so undo that before parsing.
function htmlData(html) {
  return JSON.parse(html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
}

// The browser part of an export's "source" (what getExportSource() returns for
// Firefox), exactly as the real thing looks. One copy for every test that
// builds an export carrying a source.
const FIREFOX_SOURCE = { browser: 'Firefox', basedOn: 'Gecko', browserVersion: '128.0', extensionVersion: '1.2.0' };

// A stand-in element for tests that only need a page script to load: its
// top-level code wires up DOM elements, so give it something to wire up. It
// carries every property and method those scripts touch while loading, each
// returning nothing. Not a real element - use makeFakeDom for anything that
// actually renders.
function stubElement() {
  return {
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    dataset: {},
    textContent: '',
    innerHTML: '',
    value: '',
  };
}

// A minimal `document` for those same tests: every id yields a fresh stub
// element, and listening does nothing.
function stubDocument() {
  return { getElementById() { return stubElement(); }, addEventListener() {} };
}

// Builds a vm context and runs each source in it, in order - the
// `vm.createContext(sb); vm.runInContext(...)` pair every sandbox test used to
// repeat, in one call.
function makeSandbox(globals, ...sources) {
  const sb = { ...globals };
  vm.createContext(sb);
  for (const src of sources) vm.runInContext(src, sb);
  return sb;
}

// A page starts its own async work without handing the promise to anyone -
// import.js's setSelectedFiles kicks loadFiles off and drops the result - so a
// test has nothing to await and would otherwise sleep a fixed time and hope.
// recordLoad() wraps that starter function so the promise it returns is kept,
// and returns a `settle` that awaits it: the test waits for the work itself,
// not for the clock. That matters most for a .zip, whose decoding runs on real
// streams rather than on the microtask queue alone, so a short fixed wait there
// is a race a busy machine can lose (exactly the rare flake this suite had).
// Bounded, so a page that never finishes fails the test that waits for it
// instead of hanging the run.
function recordLoad(sandbox, starterName, timeoutMs = 2000) {
  let inFlight = Promise.resolve();
  const starter = sandbox[starterName];
  sandbox[starterName] = (...args) => (inFlight = Promise.resolve(starter(...args)));
  return async () => {
    let timer;
    try {
      await Promise.race([
        inFlight,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`the page did not finish loading within ${timeoutMs} ms`)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

// Waits for a condition a test is about to assert on, rather than sleeping a
// fixed time and hoping it has happened by then (which races a busy machine).
// `what` names the condition in the failure, and the wait is bounded, so a test
// fails with a reason instead of hanging the run.
async function waitFor(condition, what, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// --- Minimal fake DOM -------------------------------------------------
// A small, real element tree (not a per-call stub) for tests that need
// to run actual rendering and interaction code - renderList/
// renderAddonList building real rows, filterAddonRows filtering them,
// select-all/search/row-click handlers reacting to them - and then
// inspect the result. It implements just the DOM surface this project's
// source files actually use (seen across export.js, import.js and
// page-ui.js): classList, style, dataset, textContent/innerHTML,
// append(Child)/replaceChildren, querySelector(All) and closest/matches
// for the small set of selectors used here (tag, .class, [attr="value"],
// :checked - no descendant combinators), plus click()/dispatchEvent()
// with bubbling for delegated click handlers. It is not a general DOM
// implementation - extend it only when a new test genuinely needs more
// of the real API surface.
//
// What it cannot do. None of the following can fail here, so a green test
// says nothing about them:
// - No styling and no layout. classList is a Set and style is a plain
//   object: there is no cascade, no computed style and no geometry, so a
//   test can see that a script added a class or set a property, never that
//   anything is styled by it, overridden, or where it lands on screen. The
//   CSS half of those contracts is checked as source text instead, in
//   tests/structure.test.js ("every class the page scripts set is styled by
//   a stylesheet") and tests/report-template.test.js (the colour, contrast
//   and motion rules).
// - No real HTML parsing. innerHTML keeps the raw string and strips tags for
//   textContent; it never builds elements from markup, so structure that
//   arrived that way cannot be asserted.
// - Single compound selectors only (tag, #id, .class, [attr="value"],
//   :checked): no descendant combinators, no :not(), no :nth-child(). A
//   selector like "a .b" quietly matches nothing.
// - getElementById never returns null: an id no test listed is created on the
//   spot as a plain div, so a script asking for an element the real page does
//   not have passes here and breaks in Firefox.
// - No focus, keyboard or input behaviour. focus() only records that it was
//   called, there is no document.activeElement and no tab order, and no event
//   carries key, input or coordinate data: only click, and the change a
//   checkbox click fires, is really dispatched.
// - No timers, requestAnimationFrame, observers or getComputedStyle: a test
//   supplies those as sandbox globals when the script under test needs them.
//
// Anything that needs a real paint - an animation replaying, a colour gliding,
// a row fading out on search - is a manual check; the README's "Checking a
// change by eye" has the recipe.

// Parses a single compound selector (no descendant combinators) into
// {tag, classes[], attrs{}, pseudos[]} once, so matching against many
// elements doesn't re-parse the same selector string repeatedly.
function parseSelector(selector) {
  const parsed = { tag: null, id: null, classes: [], attrs: {}, pseudos: [] };
  for (const m of selector.matchAll(/([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([a-zA-Z-]+)=("([^"]*)"|'([^']*)')\]|:([a-zA-Z-]+)/g)) {
    if (m[1]) parsed.tag = m[1].toUpperCase();
    else if (m[2]) parsed.id = m[2];
    else if (m[3]) parsed.classes.push(m[3]);
    else if (m[4]) parsed.attrs[m[4]] = m[6] !== undefined ? m[6] : m[7];
    else if (m[8]) parsed.pseudos.push(m[8]);
  }
  return parsed;
}

function elementMatches(el, parsed) {
  if (el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName !== parsed.tag) return false;
  if (parsed.id && el.id !== parsed.id) return false;
  for (const c of parsed.classes) if (!el.classList.contains(c)) return false;
  for (const [attr, value] of Object.entries(parsed.attrs)) {
    const actual = attr in el ? el[attr] : el.getAttribute(attr);
    if (actual !== value) return false;
  }
  for (const pseudo of parsed.pseudos) {
    if (pseudo === 'checked' && !el.checked) return false;
  }
  return true;
}

function makeEvent(type, target) {
  return {
    type,
    target,
    defaultPrevented: false,
    _stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
  };
}

class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.parentNode = null;
    this.childNodes = [];
    this._text = String(text);
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
}

class FakeElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.parentNode = null;
    this.childNodes = [];
    this._attrs = {};
    this._classes = new Set();
    // A real style declaration: plain properties (display, opacity, ...) are
    // read and written directly, and custom properties - the --rd delay
    // reveal.js puts on each row - go through setProperty/getPropertyValue.
    this.style = {
      setProperty(name, value) { this[name] = String(value); },
      getPropertyValue(name) { return this[name] || ''; },
    };
    this.dataset = {};
    this._listeners = {};
    this._checked = false;
    this._disabled = false;
    this._value = '';
    const self = this;
    this.classList = {
      add: (...cls) => cls.forEach((c) => self._classes.add(c)),
      remove: (...cls) => cls.forEach((c) => self._classes.delete(c)),
      contains: (c) => self._classes.has(c),
      toggle: (c, force) => {
        const has = self._classes.has(c);
        const next = force === undefined ? !has : force;
        if (next) self._classes.add(c); else self._classes.delete(c);
        return next;
      },
    };
  }

  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }

  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v != null) {
      const t = new FakeTextNode(v);
      t.parentNode = this;
      this.childNodes.push(t);
    }
  }

  // Not a real HTML parser - strips tags for a readable textContent and
  // keeps the raw markup available via the getter, which is enough for
  // the one or two "innerHTML = '<p>...</p>'" placeholder-text call
  // sites this project has. Extend this (or switch those call sites'
  // tests to a real container) if a test ever needs to inspect the
  // parsed structure rather than just the text.
  get innerHTML() { return this._innerHTML || ''; }
  set innerHTML(html) {
    this._innerHTML = html;
    this.textContent = String(html).replace(/<[^>]*>/g, '');
  }

  get checked() { return this._checked; }
  set checked(v) { this._checked = !!v; }
  get disabled() { return this._disabled; }
  set disabled(v) { this._disabled = !!v; }
  get value() { return this._value; }
  set value(v) { this._value = v; }

  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }

  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  append(...nodes) {
    nodes.forEach((n) => this.appendChild(typeof n === 'string' ? new FakeTextNode(n) : n));
  }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((n) => n !== this); }

  querySelectorAll(selector) {
    const parsed = parseSelector(selector);
    const out = [];
    (function walk(node) {
      for (const child of node.childNodes) {
        if (elementMatches(child, parsed)) out.push(child);
        walk(child);
      }
    })(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches(selector) { return elementMatches(this, parseSelector(selector)); }
  closest(selector) {
    const parsed = parseSelector(selector);
    let node = this;
    while (node) {
      if (elementMatches(node, parsed)) return node;
      node = node.parentNode;
    }
    return null;
  }
  contains(node) {
    let n = node;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }

  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
  }
  dispatchEvent(eventOrType) {
    const event = typeof eventOrType === 'string' ? makeEvent(eventOrType, this) : eventOrType;
    if (!event.target) event.target = this;
    let node = this;
    while (node) {
      for (const fn of (node._listeners[event.type] || []).slice()) fn.call(node, event);
      if (event._stopped) break;
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }
  // Mirrors the native behaviour createAddonRow's click delegation
  // relies on: clicking a checkbox toggles it and fires change, then
  // both events bubble the same way any other click does.
  click() {
    if (this.tagName === 'INPUT' && this.type === 'checkbox' && !this.disabled) {
      this.checked = !this.checked;
      this.dispatchEvent(makeEvent('click', this));
      this.dispatchEvent(makeEvent('change', this));
    } else {
      this.dispatchEvent(makeEvent('click', this));
    }
  }
  // Not real focus management - just enough for tests to verify *which*
  // element a piece of code intended to focus.
  focus() { this._focused = true; }
}

// Returns { document, elements }. `elements` is keyed by id for direct
// access in assertions; ids not listed still resolve (to a generic div)
// so a source file's top-level `document.getElementById(...)` calls
// never throw for ids a given test doesn't care about.
// The element ids the real pages wire up at load time, as the page scripts
// expect to find them. Tests that render a whole page hand these to
// makeFakeDom so the fake DOM has every element the script touches.
const EXPORTER_ELEMENT_IDS = [
  'addonList', 'selectAllBtn', 'deselectAllBtn', 'exportSelectedBtn',
  'status', 'selectionCount', 'searchInput', 'noSearchMatches', 'exportDesc',
];
// The .zip picker row (exportPickRow/exportPick/exportPickList) is only needed
// by the tests that open a .zip, so it is not part of the base list.
const IMPORTER_ELEMENT_IDS = [
  'status', 'fileName', 'fileNameRow', 'fileInput', 'picker', 'removeFileBtn',
  'chooseFileBtn', 'listControls', 'addonList', 'checklistBox', 'selectAllBtn',
  'deselectAllBtn', 'selectionCount', 'openSelectedBtn', 'compareNote',
  'searchInput', 'noSearchMatches',
];

function makeFakeDom(ids = []) {
  const elements = {};
  for (const id of ids) {
    const el = new FakeElement('div');
    el.id = id;
    elements[id] = el;
  }
  const document = {
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    _listeners: {},
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement('#fragment'),
    querySelectorAll(selector) {
      return [...document.documentElement.querySelectorAll(selector), ...document.body.querySelectorAll(selector)];
    },
    querySelector(selector) { return document.querySelectorAll(selector)[0] || null; },
    getElementById(id) {
      if (!elements[id]) {
        const el = new FakeElement('div');
        el.id = id;
        elements[id] = el;
      }
      return elements[id];
    },
    addEventListener(type, fn) { (document._listeners[type] = document._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (document._listeners[type]) document._listeners[type] = document._listeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(eventOrType) {
      const event = typeof eventOrType === 'string' ? makeEvent(eventOrType, document) : eventOrType;
      for (const fn of (document._listeners[event.type] || []).slice()) fn.call(document, event);
      return !event.defaultPrevented;
    },
  };
  // Real parent chain (body's parent is <html>, whose parent is the
  // document itself) - lets an event dispatched on any element bubble
  // all the way up into document's own listeners for free, via
  // FakeElement.dispatchEvent's existing parentNode walk.
  document.documentElement.parentNode = document;
  document.body.parentNode = document.documentElement;
  return { document, elements };
}

module.exports = { test, testAsync, readSrc, readSrcs, readCommon, readReportBuilders, readImport, readSettings, evalInContext, plain, htmlData, FIREFOX_SOURCE, stubElement, stubDocument, makeSandbox, recordLoad, waitFor, EXPORTER_ELEMENT_IDS, IMPORTER_ELEMENT_IDS, makeFakeDom };
