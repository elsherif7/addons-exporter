// Shared test-running infrastructure for every *.test.js file in this
// folder - no framework, just enough to run assertions and print a
// summary, matching this project's existing "plain Node.js" style.
//
// Each *.test.js file requires this and calls test()/testAsync()
// directly as it loads. tests/run.js requires every *.test.js file (which
// registers their tests as a side effect of being required, same as
// before the split) and then calls finish() once, after everything -
// including async tests from every file - has settled.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
const pendingAsyncTests = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL - ${name}`);
    console.log(`    ${err.message}`);
  }
}

// test() is synchronous - fine for plain assertions, but some tests need
// to load and exercise real async code (message listeners, click
// handlers). testAsync() runs the same pass/fail bookkeeping against a
// promise instead; the calls are collected here (across every test file,
// since this module is cached and shared by all of them) so finish() can
// wait for all of them before printing the final summary.
//
// Races fn() against a timeout so a test whose promise never settles
// (a bug in the test, or in the code it's exercising) fails loudly
// instead of hanging silently. Without this, a never-settling promise
// doesn't even hang the process: a bare pending Promise keeps nothing
// in the event loop alive, so once every other callback has run, Node
// exits on its own - quietly, with no summary line and exit code 0 -
// while finish()'s `await Promise.all(...)` is still parked forever.
// The timeout's setTimeout() is what keeps the loop (and this test)
// alive long enough to actually fail and report.
const DEFAULT_ASYNC_TIMEOUT_MS = 5000;

function testAsync(name, fn, timeoutMs = DEFAULT_ASYNC_TIMEOUT_MS) {
  const timeout = new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms - the returned promise never settled`)), timeoutMs);
  });
  pendingAsyncTests.push(
    Promise.race([fn(), timeout]).then(() => {
      passed++;
      console.log(`  ok - ${name}`);
    }).catch((err) => {
      failed++;
      console.log(`  FAIL - ${name}`);
      console.log(`    ${err.message}`);
    })
  );
}

// Reads a file relative to the project root (one level up from tests/),
// so every *.test.js file can say readSrc('src/common/common.js') instead
// of repeating path.join(__dirname, '..', ...) at each call site.
function readSrc(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

// Evaluates an identifier or expression directly in a vm context instead
// of destructuring it off the sandbox object. Needed for anything the
// loaded source declares with top-level const/let - function declarations
// and var get copied onto the sandbox object when a script runs in it,
// but const/let don't, so those have to be read this way instead.
function evalInContext(sandbox, expr) {
  return vm.runInContext(expr, sandbox);
}

// Waits for every async test (from every test file that's been required)
// to settle, then prints the combined summary and exits non-zero if
// anything failed. Called once, by tests/run.js, after requiring every
// *.test.js file.
async function finish() {
  await Promise.all(pendingAsyncTests);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// --- Minimal fake DOM -------------------------------------------------
// A small, real element tree (not a per-call stub) for tests that need
// to run actual rendering and interaction code - renderList/
// renderAddonList building real rows, filterAddonRows filtering them,
// select-all/search/row-click handlers reacting to them - and then
// inspect the result. It implements just the DOM surface this project's
// source files actually use (seen across export.js, import.js and
// common.js): classList, style, dataset, textContent/innerHTML,
// append(Child)/replaceChildren, querySelector(All) and closest/matches
// for the small set of selectors used here (tag, .class, [attr="value"],
// :checked - no descendant combinators), plus click()/dispatchEvent()
// with bubbling for delegated click handlers. It is not a general DOM
// implementation - extend it only when a new test genuinely needs more
// of the real API surface.

const SELECTOR_RE = /^([a-zA-Z]*)|(\.[\w-]+)|(\[[a-zA-Z-]+=(?:"[^"]*"|'[^']*')\])|(:[a-zA-Z-]+)/g;

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
    this.style = {};
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

module.exports = { test, testAsync, readSrc, evalInContext, finish, makeFakeDom };
