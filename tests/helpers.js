// shared helpers for the tests: thin wrappers over node:test, source loaders, and a minimal fake DOM

const nodeTest = require('node:test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function test(name, fn) {
  nodeTest.test(name, fn);
}

// a promise that never settles fails after timeoutMs instead of hanging the run
const DEFAULT_ASYNC_TIMEOUT_MS = 5000;

function testAsync(name, fn, timeoutMs = DEFAULT_ASYNC_TIMEOUT_MS) {
  nodeTest.test(name, { timeout: timeoutMs }, fn);
}

function readSrc(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

// the real load order per context is checked in script-order.test.js, this is just for sandboxes
function readSrcs(...relativePaths) {
  return relativePaths.map(readSrc).join('\n');
}
function readCommon() {
  return readSrcs('src/common/core.js', 'src/common/page-ui.js', 'src/common/addon-list.js', 'src/background/amo.js');
}
function readImport() {
  return readSrcs('src/common/crc32.js', 'src/import/parsers.js', 'src/import/match.js', 'src/import/zip-reader.js', 'src/import/import.js');
}
function readSettings() {
  return readSrcs('src/settings/settings-file.js', 'src/settings/settings.js');
}
function readReportBuilders() {
  return readSrcs('src/background/export-formats.js', 'src/background/report-assets.generated.js', 'src/background/report-template.js');
}

// top-level const/let in a vm script don't end up on the sandbox object (functions and var do),
// so read those by evaluating them in the context
function evalInContext(sandbox, expr) {
  return vm.runInContext(expr, sandbox);
}

// values built inside a vm context have that realm's Object prototype, which
// deepStrictEqual rejects. copy them out with this before comparing
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// the report escapes "/" as "\/" inside its embedded json, so undo that before parsing
function htmlData(html) {
  return JSON.parse(html.match(/<script type="application\/json" id="addons-exporter-data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, '</'));
}

const FIREFOX_SOURCE = { device: 'Computer', basedOn: 'Gecko', browser: 'Firefox', browserVersion: '128.0', extensionVersion: '1.2.0' };

// just enough element for a page script's top-level wiring to run. use makeFakeDom for anything that renders
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

function stubDocument() {
  return { getElementById() { return stubElement(); }, addEventListener() {} };
}

function makeSandbox(globals, ...sources) {
  const sb = { ...globals };
  vm.createContext(sb);
  for (const src of sources) vm.runInContext(src, sb);
  return sb;
}

// import.js's setSelectedFiles starts loadFiles and drops the promise, so there's nothing to await.
// this wraps the starter to keep the promise and returns a settle() that awaits it. a fixed sleep
// races on a busy machine, esp. for a .zip since its decoding runs on real streams. bounded so a
// page that never finishes fails instead of hanging
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

// polls instead of sleeping a fixed time (flaky on a busy machine). `what` names the condition in the failure
async function waitFor(condition, what, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// --- Minimal fake DOM ---
// a real element tree for tests that run rendering and click code. only the surface the sources use.
// what it can't do, so a green test says nothing about these:
// - styling and layout: classList is a Set, style a plain object. the css side is checked as source
//   text in structure.test.js and report-template.test.js
// - html parsing: innerHTML keeps the raw string and strips tags for textContent
// - selectors: one compound selector only (tag, #id, .class, [attr="value"], :checked). "a .b" quietly
//   matches nothing
// - getElementById never returns null, an unlisted id becomes a plain div, so a script asking for an
//   id the real page lacks passes here and breaks in Firefox
// - focus, keyboard, input: focus() only records the call, only click (and a checkbox's change) is
//   really dispatched
// - timers, rAF, observers, getComputedStyle: pass them in as sandbox globals
// paint-dependent things (animations, fades) are a manual check, see "Checking a change by eye" in docs/DEVELOPMENT.md

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
    // custom properties (the --rd delay reveal.js sets on rows) go through setProperty
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

  // not a parser, only enough for the placeholder-text innerHTML call sites
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
  // like the real thing: a checkbox click toggles it and fires change (createAddonRow relies on this)
  click() {
    if (this.tagName === 'INPUT' && this.type === 'checkbox' && !this.disabled) {
      this.checked = !this.checked;
      this.dispatchEvent(makeEvent('click', this));
      this.dispatchEvent(makeEvent('change', this));
    } else {
      this.dispatchEvent(makeEvent('click', this));
    }
  }
  focus() { this._focused = true; }
}

// ids the real pages wire up at load time, for tests that render a whole page
const EXPORTER_ELEMENT_IDS = [
  'addonList', 'selectAllBtn', 'deselectAllBtn', 'exportSelectedBtn',
  'status', 'selectionCount', 'searchInput', 'noSearchMatches', 'exportDesc',
];
// no exportPickRow/exportPick/exportPickList here, only the .zip tests need them
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
  // parent chain up to the document so events bubble into its listeners
  document.documentElement.parentNode = document;
  document.body.parentNode = document.documentElement;
  return { document, elements };
}

module.exports = { test, testAsync, readSrc, readSrcs, readCommon, readReportBuilders, readImport, readSettings, evalInContext, plain, htmlData, FIREFOX_SOURCE, stubElement, stubDocument, makeSandbox, recordLoad, waitFor, EXPORTER_ELEMENT_IDS, IMPORTER_ELEMENT_IDS, makeFakeDom };
