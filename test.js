// Plain Node test runner for common.js and import.js's file-parsing/
// validation pipeline - no framework, no dependencies. Loads the real
// source files via vm so these tests run against the actual files, not a
// copy. Run with: node test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function makeFakeElement() {
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

// import.js wires up DOM elements and event listeners at load time. This
// stub exists purely to let the file load without throwing - none of the
// tests below trigger DOM rendering, file reading, or messaging, so a
// generic fake element for every id is enough.
const fakeDocument = { getElementById() { return makeFakeElement(); } };

const commonSrc = fs.readFileSync(path.join(__dirname, 'common.js'), 'utf8');
const importSrc = fs.readFileSync(path.join(__dirname, 'import.js'), 'utf8');
const sandbox = { URL, document: fakeDocument };
vm.createContext(sandbox);
vm.runInContext(commonSrc, sandbox);
vm.runInContext(importSrc, sandbox);

const { escapeHtml, isSafeUrl, byName, filterAddonRows, visibleCheckboxes, extractTranslatedField, isPlausibleNameMatch } = sandbox;
const {
  parseAddonsPayload,
  buildInstalledIndex,
  findInstalledMatch,
  migrateAddonsData,
} = sandbox;

// EXPORT_FORMAT_VERSION is declared with top-level `const` in common.js,
// so (unlike the function declarations above) it isn't copied onto the
// sandbox object - it only exists in the context's own lexical scope.
// Evaluate it there directly instead of destructuring it from sandbox.
const EXPORT_FORMAT_VERSION = vm.runInContext('EXPORT_FORMAT_VERSION', sandbox);

// background.js's buildHtmlReport() inlines its own copy of
// filterAddonRows into the exported report (it can't load common.js once
// saved elsewhere). Pull that copy's literal source straight out of
// background.js - not a hand-copied snapshot - so a future edit to one
// copy and not the other gets caught here instead of silently drifting.
// (backgroundSrc is also reused further down to test doExport() directly.)
const backgroundSrc = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const reportScriptMatch = backgroundSrc.match(/<script>([\s\S]*?)<\/script>/);
if (!reportScriptMatch) {
  throw new Error("Could not find the report's inline <script> block in background.js - update this extraction if the report template changed.");
}
const reportInlineScript = reportScriptMatch[1];

// Runs the report's inline script against a fake `addonList` container and
// returns its filterAddonRows, so it can be called directly the same way
// common.js's version is called in the test below.
function loadReportFilterAddonRows(addonListContainer) {
  const stubEl = () => ({ style: {}, addEventListener() {} });
  const reportDocument = {
    getElementById(id) {
      return id === 'addonList' ? addonListContainer : stubEl();
    },
  };
  const reportSandbox = { document: reportDocument };
  vm.createContext(reportSandbox);
  vm.runInContext(reportInlineScript, reportSandbox);
  return reportSandbox.filterAddonRows;
}

let passed = 0;
let failed = 0;

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

// test() is synchronous - fine for everything above, but doExport() below
// is async. testAsync() runs the same pass/fail bookkeeping against a
// promise instead, and the calls are collected so the final summary
// waits for all of them before printing.
const pendingAsyncTests = [];
function testAsync(name, fn) {
  pendingAsyncTests.push(
    fn().then(() => {
      passed++;
      console.log(`  ok - ${name}`);
    }).catch((err) => {
      failed++;
      console.log(`  FAIL - ${name}`);
      console.log(`    ${err.message}`);
    })
  );
}

// --- escapeHtml ---

test('escapeHtml escapes & < > " \'', () => {
  assert.strictEqual(
    escapeHtml(`<script>alert("x")</script> & 'quotes'`),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;'
  );
});

test('escapeHtml leaves plain text untouched', () => {
  assert.strictEqual(escapeHtml('uBlock Origin 1.58.0'), 'uBlock Origin 1.58.0');
});

test('escapeHtml coerces non-strings via String()', () => {
  assert.strictEqual(escapeHtml(42), '42');
  assert.strictEqual(escapeHtml(undefined), 'undefined');
});

// --- isSafeUrl ---

test('isSafeUrl accepts http and https', () => {
  assert.strictEqual(isSafeUrl('https://example.com'), true);
  assert.strictEqual(isSafeUrl('http://example.com'), true);
});

test('isSafeUrl rejects javascript: URLs', () => {
  assert.strictEqual(isSafeUrl('javascript:alert(1)'), false);
});

test('isSafeUrl rejects malformed strings', () => {
  assert.strictEqual(isSafeUrl('not a url'), false);
  assert.strictEqual(isSafeUrl(''), false);
});

test('isSafeUrl rejects near-miss schemes (the startsWith("http") bug)', () => {
  assert.strictEqual(isSafeUrl('httpx://evil.example'), false);
  assert.strictEqual(isSafeUrl('http-evil:something'), false);
});

// --- byName ---

test('byName sorts case-insensitively', () => {
  const items = [{ name: 'banana' }, { name: 'Apple' }, { name: 'cherry' }];
  items.sort(byName);
  assert.deepStrictEqual(items.map(i => i.name), ['Apple', 'banana', 'cherry']);
});

// --- filterAddonRows ---
// Minimal fake DOM - just enough surface area (children, classList.contains,
// style.display, querySelector, textContent) for filterAddonRows to run
// against. textContent is also used below to test the report's inline
// copy of filterAddonRows, which reads a row's text directly instead of
// via querySelector('label').

function makeEl(cls, labelText) {
  return {
    style: { display: '' },
    classList: { contains: (c) => c === cls },
    querySelector: (sel) => (sel === 'label' && labelText != null ? { textContent: labelText } : null),
    textContent: labelText || '',
  };
}

function makeContainer() {
  const enabledHeading = makeEl('group-heading');
  const row1 = makeEl('addon-row', 'uBlock Origin 1.58.0');
  const row2 = makeEl('addon-row', 'Dark Reader 4.9.90');
  const disabledHeading = makeEl('group-heading');
  const row3 = makeEl('addon-row', 'Old Extension 0.5');
  return {
    container: { children: [enabledHeading, row1, row2, disabledHeading, row3] },
    enabledHeading, row1, row2, disabledHeading, row3,
  };
}

test('filterAddonRows: matching query hides non-matches, keeps matching heading visible', () => {
  const { container, enabledHeading, row1, row2, disabledHeading, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, 'dark');
  assert.strictEqual(anyMatch, true);
  assert.strictEqual(enabledHeading.style.display, '');
  assert.strictEqual(row1.style.display, 'none');
  assert.strictEqual(row2.style.display, '');
  assert.strictEqual(disabledHeading.style.display, 'none');
  assert.strictEqual(row3.style.display, 'none');
});

test('filterAddonRows: empty query shows everything', () => {
  const { container, enabledHeading, row1, row2, disabledHeading, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, '');
  assert.strictEqual(anyMatch, true);
  for (const el of [enabledHeading, row1, row2, disabledHeading, row3]) {
    assert.strictEqual(el.style.display, '');
  }
});

test('filterAddonRows: no matches hides everything and returns false', () => {
  const { container, enabledHeading, row1, row2, disabledHeading, row3 } = makeContainer();
  const anyMatch = filterAddonRows(container, 'zzz-nomatch');
  assert.strictEqual(anyMatch, false);
  for (const el of [enabledHeading, row1, row2, disabledHeading, row3]) {
    assert.strictEqual(el.style.display, 'none');
  }
});

test('filterAddonRows: common.js and the report\'s inline copy agree on the same fixture', () => {
  const fixtureA = makeContainer(); // run through common.js's version
  const fixtureB = makeContainer(); // run through background.js's inline copy

  const reportFilterAddonRows = loadReportFilterAddonRows(fixtureB.container);

  for (const query of ['dark', '', 'zzz-nomatch']) {
    const anyMatchA = filterAddonRows(fixtureA.container, query);
    const anyMatchB = reportFilterAddonRows(query);
    assert.strictEqual(anyMatchA, anyMatchB, `anyMatch differed for query "${query}"`);

    const rowsA = [fixtureA.enabledHeading, fixtureA.row1, fixtureA.row2, fixtureA.disabledHeading, fixtureA.row3];
    const rowsB = [fixtureB.enabledHeading, fixtureB.row1, fixtureB.row2, fixtureB.disabledHeading, fixtureB.row3];
    rowsA.forEach((el, i) => {
      assert.strictEqual(el.style.display, rowsB[i].style.display, `row ${i} display differed for query "${query}"`);
    });
  }
});

// --- byName (tie-breaking) ---

test('byName with identical names: both items survive the sort', () => {
  const items = [{ name: 'uBlock Origin' }, { name: 'uBlock Origin' }];
  items.sort(byName);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].name, 'uBlock Origin');
  assert.strictEqual(items[1].name, 'uBlock Origin');
});

// --- extractTranslatedField ---
// AMO's API returns translated fields (name, summary, etc.) as a
// locale-keyed object unless a `lang` param is passed - findAmoPage()
// doesn't pass one, so it always gets the object form back.

test('extractTranslatedField: plain string passes through unchanged', () => {
  assert.strictEqual(extractTranslatedField('uBlock Origin'), 'uBlock Origin');
});

test('extractTranslatedField: locale-keyed object picks a usable value', () => {
  assert.strictEqual(extractTranslatedField({ 'en-US': 'uBlock Origin', fr: 'uBlock Origin FR' }), 'uBlock Origin');
});

test('extractTranslatedField: null/undefined/empty object returns empty string', () => {
  assert.strictEqual(extractTranslatedField(null), '');
  assert.strictEqual(extractTranslatedField(undefined), '');
  assert.strictEqual(extractTranslatedField({}), '');
});

// --- isPlausibleNameMatch ---
// Guards findAmoPage()'s fuzzy name search from handing back an
// unrelated add-on just because it happened to rank first.

test('isPlausibleNameMatch: exact name (case/whitespace-insensitive) matches', () => {
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', '  UBLOCK   origin  '), true);
});

test('isPlausibleNameMatch: a listing title with an extra tagline still matches', () => {
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', 'uBlock Origin: Ad Blocker'), true);
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin: Ad Blocker', 'uBlock Origin'), true);
});

test('isPlausibleNameMatch: reordered/extra shared words still match', () => {
  assert.strictEqual(isPlausibleNameMatch('Dark Reader Night Mode', 'Night Mode Dark Reader'), true);
});

test('isPlausibleNameMatch: an unrelated result is rejected', () => {
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', 'Grammarly for Firefox'), false);
});

test('isPlausibleNameMatch: empty installed or result name is rejected', () => {
  assert.strictEqual(isPlausibleNameMatch('', 'uBlock Origin'), false);
  assert.strictEqual(isPlausibleNameMatch('uBlock Origin', ''), false);
});


// Minimal fake checkboxes — visibleCheckboxes only needs cb.closest('.addon-row')
// and the row's style.display.

function makeCheckbox(rowDisplay) {
  const row = { style: { display: rowDisplay } };
  return { closest: (sel) => (sel === '.addon-row' ? row : null) };
}

test('visibleCheckboxes: returns all checkboxes when all rows are visible', () => {
  const cbs = [makeCheckbox(''), makeCheckbox(''), makeCheckbox('')];
  const visible = visibleCheckboxes(cbs);
  assert.strictEqual(visible.length, 3);
});

test('visibleCheckboxes: excludes checkboxes whose row is hidden', () => {
  const cbs = [makeCheckbox(''), makeCheckbox('none'), makeCheckbox('')];
  const visible = visibleCheckboxes(cbs);
  assert.strictEqual(visible.length, 2);
  assert.strictEqual(visible[0], cbs[0]);
  assert.strictEqual(visible[1], cbs[2]);
});

// --- parseAddonsPayload ---
// Validates the untrusted-file payload embedded in an exported report.

function payload(addons, formatVersion = EXPORT_FORMAT_VERSION) {
  return JSON.stringify({ formatVersion, addons });
}

test('parseAddonsPayload: null jsonText (no embedded data element found)', () => {
  const result = parseAddonsPayload(null);
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /no embedded data found/);
});

test('parseAddonsPayload: throws on malformed JSON', () => {
  assert.throws(() => parseAddonsPayload('{not valid json'));
});

test('parseAddonsPayload: missing addons array', () => {
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: 1 }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found/);
});

test('parseAddonsPayload: addons present but not an array', () => {
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: 1, addons: 'nope' }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found/);
});

test('parseAddonsPayload: empty addons array', () => {
  const result = parseAddonsPayload(payload([]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No add-ons found/);
});

test('parseAddonsPayload: drops entries with missing/blank/non-string name, keeps valid ones', () => {
  const result = parseAddonsPayload(payload([
    { name: 'uBlock Origin' },
    { name: '' },
    { name: '   ' },
    { name: 42 },
    {},
    null,
    { name: 'Dark Reader' },
  ]));
  assert.strictEqual(result.ok, true);
  // Array.from (called in this realm) normalizes the foreign-realm array
  // that comes back from the vm sandbox, so deepStrictEqual can compare
  // it against a plain literal instead of tripping over cross-realm
  // Array identity.
  assert.deepStrictEqual(Array.from(result.addons, (a) => a.name), ['uBlock Origin', 'Dark Reader']);
});

test('parseAddonsPayload: every entry invalid -> rejected as no valid add-ons', () => {
  const result = parseAddonsPayload(payload([{ name: '' }, { notAName: 'x' }]));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /No valid add-ons found/);
});

test('parseAddonsPayload: missing formatVersion', () => {
  const result = parseAddonsPayload(JSON.stringify({ addons: [{ name: 'X' }] }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its export format version/);
});

test('parseAddonsPayload: non-numeric formatVersion', () => {
  const result = parseAddonsPayload(JSON.stringify({ formatVersion: '1', addons: [{ name: 'X' }] }));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /missing its export format version/);
});

test('parseAddonsPayload: formatVersion newer than supported is rejected', () => {
  const result = parseAddonsPayload(payload([{ name: 'X' }], EXPORT_FORMAT_VERSION + 1));
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /newer version of Add-ons Exporter/);
});

test('parseAddonsPayload: formatVersion exactly at the supported boundary succeeds', () => {
  const result = parseAddonsPayload(payload([{ name: 'X' }], EXPORT_FORMAT_VERSION));
  assert.strictEqual(result.ok, true);
});

test('parseAddonsPayload: valid file succeeds and returns the parsed addons', () => {
  const result = parseAddonsPayload(payload([
    { id: 'ext1@example.com', name: 'uBlock Origin', version: '1.58.0', link: 'https://addons.mozilla.org/x' },
  ]));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.addons.length, 1);
  assert.strictEqual(result.addons[0].name, 'uBlock Origin');
});

// --- migrateAddonsData ---

test('migrateAddonsData: currently a no-op, returns the list unchanged', () => {
  const list = [{ name: 'X' }];
  assert.strictEqual(migrateAddonsData(list, EXPORT_FORMAT_VERSION), list);
});

// Deliberately hardcodes today's version number and today's no-op
// behavior, rather than reading EXPORT_FORMAT_VERSION dynamically like
// the test above. The moment someone bumps EXPORT_FORMAT_VERSION, this
// starts failing - that's the point. It's a tripwire: a format bump
// can't ship without someone consciously updating migrateAddonsData for
// the new shape and updating this test to match, instead of the bump
// quietly going out with the old no-op still in place.
test('migrateAddonsData: bumping the format version requires updating this test and migrateAddonsData', () => {
  assert.strictEqual(
    EXPORT_FORMAT_VERSION, 1,
    'EXPORT_FORMAT_VERSION changed - implement real migration logic in migrateAddonsData for the new format, then update this test to match.'
  );
  const list = [{ name: 'X' }];
  assert.deepStrictEqual(
    migrateAddonsData(list, 1), list,
    'migrateAddonsData is expected to still be a no-op for format version 1'
  );
});

// --- buildInstalledIndex / findInstalledMatch ---

test('findInstalledMatch: matches by id even when names differ', () => {
  const installed = [{ id: 'ext1@example.com', name: 'Renamed Locally' }];
  const index = buildInstalledIndex(installed);
  const match = findInstalledMatch({ id: 'ext1@example.com', name: 'Original Name' }, index);
  assert.strictEqual(match, installed[0]);
});

test('findInstalledMatch: falls back to case-insensitive name match when id is absent', () => {
  const installed = [{ id: 'ext1@example.com', name: 'Dark Reader' }];
  const index = buildInstalledIndex(installed);
  const match = findInstalledMatch({ name: 'DARK reader' }, index);
  assert.strictEqual(match, installed[0]);
});

test('findInstalledMatch: falls back to name when id is present but not found', () => {
  const installed = [{ id: 'ext1@example.com', name: 'Dark Reader' }];
  const index = buildInstalledIndex(installed);
  const match = findInstalledMatch({ id: 'some-other-id', name: 'Dark Reader' }, index);
  assert.strictEqual(match, installed[0]);
});

test('findInstalledMatch: returns null when neither id nor name matches', () => {
  const installed = [{ id: 'ext1@example.com', name: 'Dark Reader' }];
  const index = buildInstalledIndex(installed);
  const match = findInstalledMatch({ id: 'nope', name: 'Something Else' }, index);
  assert.strictEqual(match, null);
});

// --- background.js: excludes Firefox for Android's own bundled components ---
// Android bundles several of its own WebExtension-based components
// (ads/icons/fxa/readerview/search telemetry) with ids ending in
// @mozac.org - these aren't anything the user installed and shouldn't
// show up as exportable, the same way desktop's @mozilla.org ones don't.

testAsync('listInstalledAddons: excludes both @mozilla.org and @mozac.org built-ins', async () => {
  const bgSandbox = {
    URL,
    console: { warn() {}, debug() {}, log() {}, error() {} },
    browser: {
      runtime: { onMessage: { addListener() {} } },
      management: {
        getAll: async () => [
          { id: 'ublock@example.com', name: 'uBlock Origin', version: '1.0', enabled: true, type: 'extension' },
          { id: 'webcompat@mozilla.org', name: 'Web Compat', version: '1.0', enabled: true, type: 'extension' },
          { id: 'ads@mozac.org', name: 'Mozilla Android Components - Ads Telemetry', version: '1.0', enabled: true, type: 'extension' },
          { id: 'readerview@mozac.org', name: 'Mozilla Android Components - ReaderView', version: '1.0', enabled: true, type: 'extension' },
        ],
      },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  const result = await bgSandbox.listInstalledAddons();
  assert.deepStrictEqual(Array.from(result, (a) => a.id), ['ublock@example.com']);
});


// --- background.js: export message handler, platform-specific saving ---
// Android's downloads.download() can't handle a blob: URL (Android's own
// DownloadManager only accepts http/https) and there's no saveAs dialog
// to fall back to either. The message handler now hands the report back
// to export.js on Android instead of saving it itself - see the comment
// there for why. Loads the real background.js via vm with a mocked
// browser/fetch, and invokes the actual registered message listener
// (not doExport() directly) so this covers the real platform branching.

async function captureExportMessageResult(platformOs) {
  let downloadOptions = null;
  const createdTabUrls = [];
  let messageListener = null;
  const bgSandbox = {
    URL,
    Blob,
    AbortController,
    // background.js schedules a 30s delay before revoking the blob URL
    // on desktop - firing immediately here avoids this test (and the
    // whole test.js process) actually waiting that long to exit, since
    // Node keeps the event loop alive for pending timers.
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    console: { warn() {}, debug() {}, log() {}, error() {} },
    fetch: async (url) => {
      // Exact-id lookup: pretend it's not on AMO. Name search: no results.
      // Neither path matters for this test - only the final export step does.
      if (url.includes('/addons/addon/')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    },
    browser: {
      runtime: {
        onMessage: { addListener: (fn) => { messageListener = fn; } },
        getPlatformInfo: async () => ({ os: platformOs }),
        getURL: (path) => `moz-extension://test-id/${path}`,
        sendMessage: async () => {},
      },
      management: {
        getAll: async () => [
          { id: 'ext1@example.com', name: 'Test Addon', version: '1.0', enabled: true, type: 'extension' },
        ],
      },
      downloads: {
        download: async (options) => {
          downloadOptions = options;
          return 1;
        },
      },
      tabs: {
        create: async (options) => {
          createdTabUrls.push(options.url);
          return {};
        },
      },
    },
  };
  vm.createContext(bgSandbox);
  vm.runInContext(commonSrc, bgSandbox);
  vm.runInContext(backgroundSrc, bgSandbox);
  const result = await messageListener({ type: 'export', ids: ['ext1@example.com'] });
  return { downloadOptions, createdTabUrls, result };
}

testAsync('export message: on Android, hands the report back instead of saving or opening any tab itself', async () => {
  const { downloadOptions, createdTabUrls, result } = await captureExportMessageResult('android');
  assert.strictEqual(downloadOptions, null);
  assert.strictEqual(createdTabUrls.length, 0);
  assert.match(result.html, /Test Addon/);
  assert.match(result.filename, /^Firefox-Addons \(.+\)\.html$/);
});

testAsync('export message: on desktop, downloads with saveAs, opens confirmation.html, and returns nothing', async () => {
  const { downloadOptions, createdTabUrls, result } = await captureExportMessageResult('win');
  assert.strictEqual(downloadOptions.saveAs, true);
  assert.match(downloadOptions.url, /^blob:/);
  assert.strictEqual(createdTabUrls.length, 1);
  assert.match(createdTabUrls[0], /confirmation\.html$/);
  assert.strictEqual(result, undefined);
});

// --- export.js: click handler ---
// On desktop, background.js already saves the file and opens
// confirmation.html itself, so export.js's handler does nothing beyond
// showing status text. On Android, background.js hands the report back
// instead (see above), and export.js must trigger the actual save right
// here, synchronously within this same click - not after another
// message hop - for it to have a chance of being treated as a real
// user-triggered download. Loads the real export.js via vm with a
// mocked browser/DOM, and invokes its actual exportBtn click handler.

const exportSrc = fs.readFileSync(path.join(__dirname, 'export.js'), 'utf8');

async function captureExportClick({ selectedIds, exportResponse, simulateDownloadCreated = false }) {
  const checkedCheckboxes = selectedIds.map((id) => ({ dataset: { id } }));
  const listElStub = {
    querySelectorAll: (sel) => (sel.includes('checkbox') ? checkedCheckboxes : []),
    addEventListener() {},
    replaceChildren() {},
  };
  let exportClickHandler = null;
  const appendedLinks = [];
  const bodyStub = { appendChild: (el) => appendedLinks.push(el) };
  const createdTabUrls = [];
  const sentMessages = [];
  const elements = {
    addonList: listElStub,
    selectAllBtn: { addEventListener() {} },
    deselectAllBtn: { addEventListener() {} },
    exportSelectedBtn: {
      addEventListener: (ev, fn) => { if (ev === 'click') exportClickHandler = fn; },
      disabled: false,
    },
    status: { textContent: '' },
    selectionCount: { textContent: '' },
    searchInput: { addEventListener() {}, style: {} },
    noSearchMatches: { style: {} },
  };
  const exSandbox = {
    URL: { createObjectURL: () => 'blob:fake-url', revokeObjectURL() {} },
    Blob: function Blob(parts, opts) { this.parts = parts; this.opts = opts; },
    // export.js's fallback timer fires immediately here, keeping the
    // test fast. When simulateDownloadCreated is true, the
    // downloads.onCreated stub below fires first anyway (synchronously,
    // before this fallback even runs), so the "settled" guard in
    // export.js means only one path actually resolves things either way.
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() {},
    document: {
      getElementById: (id) => elements[id],
      body: bodyStub,
      createElement: () => ({ style: {}, click() { this.clicked = true; }, remove() { this.removed = true; } }),
    },
    browser: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (msg) => {
          sentMessages.push(msg);
          if (msg.type === 'listAddons') return [];
          if (msg.type === 'export') return exportResponse;
          return undefined;
        },
        getURL: (path) => `moz-extension://test-id/${path}`,
      },
      tabs: { create: async (options) => { createdTabUrls.push(options.url); return {}; } },
      downloads: {
        onCreated: {
          // Simulates the download actually being observed - fires
          // synchronously at registration time, same as a very fast
          // real download would resolve things before the fallback
          // timer got a chance to.
          addListener: (fn) => { if (simulateDownloadCreated) fn({}); },
          removeListener() {},
        },
      },
    },
  };
  vm.createContext(exSandbox);
  vm.runInContext(commonSrc, exSandbox);
  vm.runInContext(exportSrc, exSandbox);
  // Let the top-level IIFE's listAddons call settle before the button
  // even exists to be clicked.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await exportClickHandler();
  return { sentMessages, appendedLinks, createdTabUrls, statusEl: elements.status, exportBtnEl: elements.exportSelectedBtn };
}

testAsync('export.js click handler: on Android, proceeds to confirmation.html once downloads.onCreated fires', async () => {
  const { sentMessages, appendedLinks, createdTabUrls, exportBtnEl } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { html: '<html>Test Addon report</html>', filename: 'Firefox-Addons (test).html' },
    simulateDownloadCreated: true,
  });
  const exportMsg = sentMessages.find((m) => m.type === 'export');
  // Array.from (called in this realm) normalizes the foreign-realm array
  // that comes back from the vm sandbox, so deepStrictEqual can compare
  // it against a plain literal instead of tripping over cross-realm
  // Array identity.
  assert.deepStrictEqual(Array.from(exportMsg.ids), ['ext1@example.com']);
  assert.strictEqual(appendedLinks.length, 1);
  assert.strictEqual(appendedLinks[0].href, 'blob:fake-url');
  assert.strictEqual(appendedLinks[0].download, 'Firefox-Addons (test).html');
  assert.strictEqual(appendedLinks[0].clicked, true);
  assert.strictEqual(appendedLinks[0].removed, true);
  // Both onCreated and the (immediate, mocked) fallback timer fire here -
  // the "settled" guard in export.js should mean only one tab opens.
  assert.strictEqual(createdTabUrls.length, 1);
  assert.match(createdTabUrls[0], /confirmation\.html$/);
  assert.strictEqual(exportBtnEl.disabled, true);
});

testAsync('export.js click handler: on Android, still proceeds via the fallback timer if onCreated never fires', async () => {
  const { createdTabUrls } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: { html: '<html>Test Addon report</html>', filename: 'Firefox-Addons (test).html' },
    simulateDownloadCreated: false,
  });
  assert.strictEqual(createdTabUrls.length, 1);
  assert.match(createdTabUrls[0], /confirmation\.html$/);
});

testAsync('export.js click handler: on desktop, does nothing extra since background.js already handled it', async () => {
  const { appendedLinks, createdTabUrls } = await captureExportClick({
    selectedIds: ['ext1@example.com'],
    exportResponse: undefined,
  });
  assert.strictEqual(appendedLinks.length, 0);
  assert.strictEqual(createdTabUrls.length, 0);
});

Promise.all(pendingAsyncTests).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
