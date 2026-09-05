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

const { escapeHtml, isSafeUrl, byName, filterAddonRows, visibleCheckboxes } = sandbox;
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

// --- visibleCheckboxes ---
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
