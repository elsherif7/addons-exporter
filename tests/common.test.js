// Tests for src/common/common.js's pure helper functions. Loads the real
// source via vm so these run against the actual file, not a copy.

const assert = require('assert');
const vm = require('vm');
const { test, readSrc } = require('./helpers');

const commonSrc = readSrc('src/common/common.js');
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(commonSrc, sandbox);

const { escapeHtml, isSafeUrl, byName, filterAddonRows, visibleCheckboxes, extractTranslatedField, isPlausibleNameMatch } = sandbox;

// background.js's buildHtmlReport() inlines its own copy of
// filterAddonRows into the exported report (it can't load common.js once
// saved elsewhere). Pull that copy's literal source straight out of
// background.js - not a hand-copied snapshot - so a future edit to one
// copy and not the other gets caught here instead of silently drifting.
const backgroundSrc = readSrc('src/background/background.js');
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

// --- escapeHtml ---

test('escapeHtml escapes & < > " \'', () => {
  assert.strictEqual(escapeHtml(`& < > " '`), '&amp; &lt; &gt; &quot; &#39;');
});

test('escapeHtml leaves plain text untouched', () => {
  assert.strictEqual(escapeHtml('uBlock Origin 1.58.0'), 'uBlock Origin 1.58.0');
});

test('escapeHtml coerces non-strings via String()', () => {
  assert.strictEqual(escapeHtml(42), '42');
  assert.strictEqual(escapeHtml(null), 'null');
  assert.strictEqual(escapeHtml(undefined), 'undefined');
});

// --- isSafeUrl ---

test('isSafeUrl accepts http and https', () => {
  assert.strictEqual(isSafeUrl('http://example.com'), true);
  assert.strictEqual(isSafeUrl('https://example.com'), true);
});

test('isSafeUrl rejects javascript: URLs', () => {
  assert.strictEqual(isSafeUrl('javascript:alert(1)'), false);
});

test('isSafeUrl rejects malformed strings', () => {
  assert.strictEqual(isSafeUrl('not a url'), false);
  assert.strictEqual(isSafeUrl(''), false);
});

test('isSafeUrl rejects near-miss schemes (the startsWith("http") bug)', () => {
  assert.strictEqual(isSafeUrl('httpx://example.com'), false);
});

// --- byName ---

test('byName sorts case-insensitively', () => {
  const items = [{ name: 'uBlock Origin' }, { name: 'Dark Reader' }, { name: 'adblock' }];
  items.sort(byName);
  assert.deepStrictEqual(items.map((i) => i.name), ['adblock', 'Dark Reader', 'uBlock Origin']);
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
